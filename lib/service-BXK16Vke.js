import { readdirSync, statSync } from "node:fs";
//#region src/cost.ts
/** deepseek-v4-flash official prices (CNY per 1M tokens). */
const FLASH_COST_CONFIG = {
	inputPerMillion: 1,
	cacheReadPerMillion: .02,
	cacheWritePerMillion: 0,
	outputPerMillion: 2,
	currency: "CNY"
};
/** deepseek-v4-pro official prices (CNY per 1M tokens). */
const PRO_COST_CONFIG = {
	inputPerMillion: 3,
	cacheReadPerMillion: .025,
	cacheWritePerMillion: 0,
	outputPerMillion: 6,
	currency: "CNY"
};
/** The default pricing preset (deepseek-v4-flash). */
const DEFAULT_COST_CONFIG = FLASH_COST_CONFIG;
/** Resolve a partial cost config against the defaults. */
function resolveCostConfig(config = {}) {
	return {
		inputPerMillion: config.inputPerMillion ?? DEFAULT_COST_CONFIG.inputPerMillion,
		cacheReadPerMillion: config.cacheReadPerMillion ?? DEFAULT_COST_CONFIG.cacheReadPerMillion,
		cacheWritePerMillion: config.cacheWritePerMillion ?? DEFAULT_COST_CONFIG.cacheWritePerMillion,
		outputPerMillion: config.outputPerMillion ?? DEFAULT_COST_CONFIG.outputPerMillion,
		currency: config.currency ?? DEFAULT_COST_CONFIG.currency
	};
}
/** Cost of a token count at a per-million price. */
function costOfTokens(count, perMillion) {
	if (count <= 0 || !Number.isFinite(count)) return 0;
	return count / 1e6 * perMillion;
}
/** Total cost of one provider usage record. */
function costOfUsage(usage, config) {
	return costOfTokens(usage.inputTokens, config.inputPerMillion) + costOfTokens(usage.cacheReadTokens ?? 0, config.cacheReadPerMillion) + costOfTokens(usage.cacheWriteTokens ?? 0, config.cacheWritePerMillion) + costOfTokens(usage.outputTokens, config.outputPerMillion);
}
//#endregion
//#region src/pricing.ts
/** Official pricing page URL (zh-cn). */
const PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
/** Number regex: `0.02`, `1`, `2`, `3.0` etc. Deliberately non-global: a
* shared global regex leaks `lastIndex` across `exec` calls and would skip the
* second price cell (the pro price), silently repricing pro sessions at the
* flash rate. */
const PRICE_RE = /(\d+(?:\.\d+)?)\s*元/;
/** Strip HTML tags to plain text (keeps cell order). */
function stripHtml(html) {
	return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}
/** Parse one price cell text like `0.02元` into a number; NaN when absent. */
function parsePriceCell(text) {
	const m = PRICE_RE.exec(text);
	if (m === null) return void 0;
	const value = Number(m[1]);
	return Number.isFinite(value) ? value : void 0;
}
/**
* Parse the current single-price table: three rows labeled with the bucket
* names, each carrying the flash and pro price cells.
*/
function parseCurrentTable(html) {
	const hit = /百万tokens输入（缓存命中）([\s\S]{0,400}?)百万tokens输入（缓存未命中）([\s\S]{0,400}?)百万tokens输出([\s\S]{0,400}?)(?:并发限制|<\/table)/i.exec(stripHtml(html));
	if (hit === null) return void 0;
	const cacheReadCell = hit[1];
	const inputCell = hit[2];
	const outputCell = hit[3];
	const cacheReadFlash = parsePriceCell(cacheReadCell);
	const cacheReadPro = parsePriceCell(cacheReadCell.replace(/^\s*(\d+(?:\.\d+)?元)/, ""));
	const inputFlash = parsePriceCell(inputCell);
	const inputPro = parsePriceCell(inputCell.replace(/^\s*(\d+(?:\.\d+)?元)/, ""));
	const outputFlash = parsePriceCell(outputCell);
	const outputPro = parsePriceCell(outputCell.replace(/^\s*(\d+(?:\.\d+)?元)/, ""));
	if (cacheReadFlash === void 0 || inputFlash === void 0 || outputFlash === void 0) return void 0;
	return {
		flash: {
			cacheReadPerMillion: cacheReadFlash,
			inputPerMillion: inputFlash,
			outputPerMillion: outputFlash
		},
		pro: {
			cacheReadPerMillion: cacheReadPro ?? cacheReadFlash,
			inputPerMillion: inputPro ?? inputFlash,
			outputPerMillion: outputPro ?? outputFlash
		}
	};
}
/**
* Parse the upcoming peak-pricing table: model rows with off-peak and peak
* cells, e.g. `deepseek-v4-flash 空闲时段 0.05 1.5 4.5 高峰时段 0.10 3.0 9.0`.
*/
function parsePeakTable(html) {
	const text = stripHtml(html);
	const flash = /deepseek-v4-flash\s+空闲时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+高峰时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元/i.exec(text);
	const pro = /deepseek-v4-pro\s+空闲时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+高峰时段\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元\s+(\d+(?:\.\d+)?)元/i.exec(text);
	if (flash === null || pro === null) return void 0;
	return {
		flash: {
			offPeak: {
				cacheReadPerMillion: Number(flash[1]),
				inputPerMillion: Number(flash[2]),
				outputPerMillion: Number(flash[3])
			},
			peak: {
				cacheReadPerMillion: Number(flash[4]),
				inputPerMillion: Number(flash[5]),
				outputPerMillion: Number(flash[6])
			}
		},
		pro: {
			offPeak: {
				cacheReadPerMillion: Number(pro[1]),
				inputPerMillion: Number(pro[2]),
				outputPerMillion: Number(pro[3])
			},
			peak: {
				cacheReadPerMillion: Number(pro[4]),
				inputPerMillion: Number(pro[5]),
				outputPerMillion: Number(pro[6])
			}
		}
	};
}
/**
* Fetch and parse the official pricing page.
* @param fetchImpl - fetch-compatible function (injected for testability).
* @param timeoutMs - abort timeout.
* @returns the parsed snapshot; `error` is set when fetch/parse failed.
*/
async function fetchPricing(fetchImpl = globalThis.fetch, timeoutMs = 15e3) {
	const fetchedAt = Date.now();
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let response;
		try {
			response = await fetchImpl(PRICING_URL, { signal: controller.signal });
		} finally {
			clearTimeout(timer);
		}
		if (!response.ok) return {
			fetchedAt,
			current: fallbackCurrent(),
			error: `pricing page HTTP ${response.status}`
		};
		const html = await response.text();
		const current = parseCurrentTable(html);
		if (current === void 0) return {
			fetchedAt,
			current: fallbackCurrent(),
			error: "pricing table not found"
		};
		return {
			fetchedAt,
			current,
			...parsePeakTable(html) === void 0 ? {} : { peak: parsePeakTable(html) }
		};
	} catch (error) {
		return {
			fetchedAt,
			current: fallbackCurrent(),
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
/** Built-in fallback (deepseek-v4-flash current official prices). */
function fallbackCurrent() {
	return {
		flash: {
			cacheReadPerMillion: .02,
			inputPerMillion: 1,
			outputPerMillion: 2
		},
		pro: {
			cacheReadPerMillion: .025,
			inputPerMillion: 3,
			outputPerMillion: 6
		}
	};
}
/**
* Whether the current moment is a peak-pricing hour in Beijing time:
* 09:00-12:00 and 14:00-18:00 (peak); everything else is off-peak.
*/
function isPeakHour(now = /* @__PURE__ */ new Date()) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Shanghai",
		hour: "numeric",
		hour12: false,
		weekday: "short"
	}).formatToParts(now);
	const hour = Number(parts.find((p) => p.type === "hour")?.value);
	const weekday = (parts.find((p) => p.type === "weekday")?.value ?? "").replace(".", "");
	if (Number.isNaN(hour)) return false;
	if (weekday === "Sat" || weekday === "Sun") return false;
	return hour >= 9 && hour < 12 || hour >= 14 && hour < 18;
}
//#endregion
//#region src/service.ts
/** 提问类工具（等人回答）的名字匹配：其时长单列，不并入工具调用用时。 */
const ASK_TOOL_PATTERN = /ask|question/i;
/** 模型显示名目录的缓存时长（毫秒）。 */
const MODEL_NAMES_TTL_MS = 3e5;
/** 供应商 /models 新模型发现结果的缓存时长（毫秒，默认 6 小时）。 */
const MODEL_DISCOVERY_TTL_MS = 216e5;
/** DeepSeek API base URL. */
const DEFAULT_BASE_URL = "https://api.deepseek.com";
/** Default credential reference for the DeepSeek API key. */
const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
/** Default provider query pacing. */
const DEFAULT_REFRESH_INTERVAL_SECONDS = 30;
/** Official peak-pricing rollout: 2026-08-17 00:00 Beijing time (UTC+8). */
const PEAK_PRICING_START_MS = Date.UTC(2026, 7, 16, 16, 0, 0);
/** All-zero billing buckets, used when no projection value is available. */
const ZERO_BUCKETS = {
	uncachedInputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0
};
/** Narrow a provider usage record to billing buckets (token-meter semantics). */
function turnBucketsFrom(usage) {
	const u = usage ?? {};
	const num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
	return {
		uncachedInputTokens: num(u.inputTokens),
		outputTokens: num(u.outputTokens),
		cacheReadTokens: num(u.cacheReadTokens),
		cacheWriteTokens: num(u.cacheWriteTokens)
	};
}
/** Add a step's latest buckets to a turn total, REPLACING the step's earlier value (token-meter semantics). */
function addReplacingBuckets(totals, previous, next) {
	return {
		uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
		outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
		cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
		cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens
	};
}
/**
* The session's full event log across the DSH 0.1.5 accessor change.
*
* Up to 0.1.0-rc.6 the log was the public `session.events` array; 0.1.5-rc
* replaced it with `snapshotEvents()` (an immutable half-open range view) and
* removed `events`. Reading the removed accessor threw
* `session.events is not iterable` inside the route handler — which the web
* server turns into a bare 400 for /api/balance/turns and a 500 for
* /api/balance/cost, silently emptying the per-turn money rows.
* @param session - the live session whose log is folded.
* @returns the session's events in log order.
*/
function sessionEvents(session) {
	const modern = session;
	if (typeof modern.snapshotEvents === "function") return modern.snapshotEvents();
	return session.events;
}
/** 官方 isTokenDelta：哪些 chunk 算「一个 token」（文本/推理增量、带内容或名字的工具调用增量）。 */
function isTokenDelta(chunk) {
	const c = chunk;
	switch (c?.type) {
		case "text-delta":
		case "reasoning-delta": return c.text !== "";
		case "tool-call-delta": return c.argumentsDelta !== "" || c.name !== void 0;
		default: return false;
	}
}
/** 官方 firstRunMemberTime：在压缩 run 内按 dt 累加时间，返回第一个满足条件的成员时间。 */
function firstRunMemberTime(run, predicate) {
	const fragments = run.type === "tool-call-chunks" ? run.args : run.texts;
	if (!Array.isArray(fragments)) return void 0;
	const dt = Array.isArray(run.dt) ? run.dt : [];
	let time = typeof run.time0 === "number" ? run.time0 : void 0;
	for (let index = 0; index < fragments.length; index += 1) {
		if (index > 0) time = (time ?? 0) + (typeof dt[index - 1] === "number" ? dt[index - 1] : 0);
		if (typeof fragments[index] === "string" && predicate(fragments[index])) return time;
	}
}
/**
* 官方 assistantStreamFirstTokenTime 的等价实现：从一条 assistant 事件的压缩 stream 里
* 读出第一个 token 的时间。DSH 0.1.5 的会话日志把流式增量压缩进 assistant/message 的
* `stream`（本会话日志里没有 assistant/chunk 事件），所以首 token 只能这样取。
* @param stream - assistant 事件的压缩 stream 记录。
* @returns 第一个 token 的时间，取不到时 undefined。
*/
function assistantStreamFirstTokenTime(stream) {
	if (!Array.isArray(stream)) return void 0;
	for (const record of stream) {
		if (record === null || typeof record !== "object") continue;
		const time = record.type === "chunk" ? isTokenDelta(record.chunk) && typeof record.time === "number" ? record.time : void 0 : record.type === "tool-call-chunks" && record.name !== void 0 && typeof record.time0 === "number" ? record.time0 : firstRunMemberTime(record, (fragment) => fragment !== "");
		if (time !== void 0) return time;
	}
}
/** Parse a base URL into a safe `{ origin, pathPrefix }` pair. */
function parseBaseUrl(raw) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`dsh-balance-meter: invalid baseUrl "${raw}"`);
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`dsh-balance-meter: baseUrl must be http(s), got "${url.protocol}"`);
	let prefix = url.pathname.replace(/\/+$/, "");
	return {
		origin: url.origin,
		prefix
	};
}
/**
* DeepSeek Get User Balance client. Resolution of the API key re-reads the
* credentials seam on every query so a changed key reaches the next query
* without a plugin restart.
*/
var BalanceService = class {
	apiKeyEnv;
	baseUrl;
	refreshIntervalMs;
	model;
	/** Explicit per-million price overrides from `config.cost`, applied on top of any model preset. */
	userCostOverrides;
	pricingSnapshot;
	pricingTimer;
	cached;
	cachedAt = 0;
	inflight;
	enabled;
	/** 宿主上下文：用于惰性解析 credentials / sessions 服务（不继承 cordis Service，避免依赖 @deepseek-ai/cordis 运行时解析）。 */
	ctx;
	constructor(ctx, config = {}) {
		this.ctx = ctx;
		this.apiKeyEnv = config.apiKeyEnv ?? "DEEPSEEK_API_KEY";
		this.baseUrl = config.baseUrl ?? "https://api.deepseek.com";
		this.refreshIntervalMs = Math.max(0, (config.refreshIntervalSeconds ?? 30) * 1e3);
		this.model = config.model ?? "auto";
		this.userCostOverrides = config.cost;
		this.enabled = config.enabled ?? true;
		this.refreshPricing();
		const cadenceMs = (config.pricingRefreshHours ?? 6) * 36e5;
		this.pricingTimer = setInterval(() => {
			this.refreshPricing();
		}, cadenceMs);
		this.pricingTimer.unref?.();
	}
	/** Whether the balance service answers queries while enabled. */
	isEnabled() {
		return this.enabled;
	}
	/** Master switch: stop answering fresh provider queries (cache may still read). */
	setEnabled(enabled) {
		this.enabled = enabled;
	}
	/**
	* RPC: most recent balance + usage view. A healthy (error-free) cached view
	* is returned while still fresh; an erroneous view is never reused as fresh,
	* so the next poll re-queries the provider and the readout recovers
	* automatically once the underlying condition clears (without a manual
	* click). Concurrent queries are deduped.
	*/
	async view() {
		if (!this.enabled) return {
			fetchedAt: Date.now(),
			available: false,
			balances: [],
			error: "disabled"
		};
		const now = Date.now();
		const cached = this.cached;
		if (cached !== void 0 && cached.error === void 0 && now - this.cachedAt < this.refreshIntervalMs && this.refreshIntervalMs > 0) return cached;
		if (this.inflight !== void 0) return this.inflight;
		this.inflight = this.query().then((view) => {
			this.cached = view;
			this.cachedAt = Date.now();
			return view;
		}).finally(() => {
			this.inflight = void 0;
		});
		return this.inflight;
	}
	/** RPC: force a fresh provider query (bypasses the cache window). */
	async refresh() {
		this.modelNamesCache = void 0;
		this.discoveredCache = void 0;
		const view = await this.query();
		this.cached = view;
		this.cachedAt = Date.now();
		return view;
	}
	/**
	* RPC: current session token usage + estimated cost. Reads the official
	* `tokenUsage` projection (registered by dsh-token-meter) through the
	* session-projection registry and applies per-million prices for the model
	* actually driving this session (read from the session's request header),
	* falling back to the configured `model` preset when the live model cannot
	* be resolved. Returns zeroed values when the projection is unavailable.
	* @param session - the session whose usage is read.
	*/
	sessionCost(session) {
		const { model, pricingKey } = this.resolveModelForSession(session);
		return this.costFromBuckets(this.usageOf(session), pricingKey, model);
	}
	/**
	* RPC: the PREVIOUS conversation turn's estimated cost — "上一场" is the
	* last COMPLETED turn inside the current session (a turn/end event exists),
	* not a different historical session: the chip's "本场" already shows the
	* whole-session cumulative spend, so the previous figure must be one
	* conversation task of the same session. Token usage is folded per turn
	* from the session event log with token-meter semantics (usage reported by
	* `assistant/chunk` usage chunks and `assistant/message` final samples,
	* each carrying its turn/step; a repeated sample for the same turn/step
	* REPLACES the earlier value instead of double counting). Pricing uses the
	* live session's request-header model, like `sessionCost`.
	* @param session - the live session whose previous turn is priced.
	* @returns the priced previous-turn snapshot, or undefined when no turn has
	*   completed yet (or the session carries no usage events).
	*/
	previousTurnCost(session) {
		const perTurn = /* @__PURE__ */ new Map();
		let lastCompletedTurn;
		for (const event of sessionEvents(session)) {
			if (event.type === "turn/end") {
				const turn = event.data.turn;
				if (typeof turn === "number") lastCompletedTurn = turn;
				continue;
			}
			const data = event.data;
			let usage;
			if (event.type === "assistant/chunk" && data?.chunk?.type === "usage") usage = data.chunk.usage;
			else if (event.type === "assistant/message" && data?.usage !== void 0) usage = data.usage;
			else continue;
			if (typeof data?.turn !== "number" || typeof data?.step !== "number") continue;
			const buckets = turnBucketsFrom(usage);
			let cell = perTurn.get(data.turn);
			if (cell === void 0) {
				cell = {
					totals: ZERO_BUCKETS,
					last: /* @__PURE__ */ new Map()
				};
				perTurn.set(data.turn, cell);
			}
			const previous = cell.last.get(data.step);
			cell.last.set(data.step, buckets);
			cell.totals = addReplacingBuckets(cell.totals, previous, buckets);
		}
		if (lastCompletedTurn === void 0) return void 0;
		const usage = perTurn.get(lastCompletedTurn)?.totals;
		if (usage === void 0) return void 0;
		const { model, pricingKey } = this.resolveModelForSession(session);
		const cost = this.costFromBuckets(usage, pricingKey, model);
		return {
			turn: lastCompletedTurn,
			uncachedInputTokens: cost.uncachedInputTokens,
			outputTokens: cost.outputTokens,
			cacheReadTokens: cost.cacheReadTokens,
			cacheWriteTokens: cost.cacheWriteTokens,
			cost: cost.cost,
			currency: cost.currency,
			breakdown: cost.breakdown,
			pricingKey: cost.pricingKey,
			...cost.model === void 0 ? {} : { model: cost.model }
		};
	}
	/**
	* RPC: full per-turn usage/cost statistics for one session. Folds the event
	* log with sessionStats-equivalent timing (llmMs closes at
	* assistant/message, toolMs at tool/result, steps at step/end) and
	* token-meter usage semantics per turn; waitMs is the closed
	* approval/asked → approval/decided span attributed to the turn that was
	* open when the approval was requested (falls back to the most recently
	* active turn). Turn costs use the live session's request-header model.
	* @param session - the live session whose turns are folded.
	*/
	turnStats(session) {
		const cells = /* @__PURE__ */ new Map();
		let openStep = null;
		const pendingCalls = /* @__PURE__ */ new Map();
		/** rootCallId → { turn, step }：把 run_code 内部的子工具调用挂回它所属的那一步。 */
		const rootCalls = /* @__PURE__ */ new Map();
		/** 每轮每步的子工具名计数（tool/ptc-dispatch-start，即 run_code 内部真正调用的工具）。 */
		const subToolsByTurnStep = /* @__PURE__ */ new Map();
		const pendingApprovals = /* @__PURE__ */ new Map();
		const toolsByTurnStep = /* @__PURE__ */ new Map();
		const modelByTurn = /* @__PURE__ */ new Map();
		/** 每轮的助手消息 id 列表（轮次从 DOM/节点都拿不到时的反查依据）。 */
		const messageIdsByTurn = /* @__PURE__ */ new Map();
		let lastTurn = 0;
		let lastEndedTurn = 0;
		const cellFor = (turn) => {
			let cell = cells.get(turn);
			if (cell === void 0) {
				cell = {
					steps: 0,
					llmMs: 0,
					toolMs: 0,
					waitMs: 0,
					totals: ZERO_BUCKETS,
					lastStep: /* @__PURE__ */ new Map(),
					ttftMs: null,
					decodeMs: 0,
					decodeTokens: 0,
					sampled: false,
					askMs: 0
				};
				cells.set(turn, cell);
			}
			return cell;
		};
		const addUsage = (cell, step, usage) => {
			const buckets = turnBucketsFrom(usage);
			const previous = cell.lastStep.get(step);
			cell.lastStep.set(step, buckets);
			cell.totals = addReplacingBuckets(cell.totals, previous, buckets);
		};
		for (const raw of sessionEvents(session)) {
			const event = raw;
			const data = event.data;
			if (typeof data?.turn === "number") lastTurn = data.turn;
			const turn = typeof data?.turn === "number" ? data.turn : openStep?.turn ?? lastTurn;
			switch (event.type) {
				case "step/start":
					openStep = {
						turn,
						step: data?.step ?? 0,
						startTime: event.time,
						firstTokenTime: null
					};
					break;
				case "assistant/chunk":
					if (openStep !== null && openStep.turn === turn && openStep.step === data?.step) {
						if (data?.chunk?.type === "usage" && data.chunk.usage !== void 0) addUsage(cellFor(turn), openStep.step, data.chunk.usage);
						if (openStep.firstTokenTime === null && isTokenDelta(data?.chunk)) openStep.firstTokenTime = event.time;
					}
					break;
				case "assistant/message": {
					const messageId = data?.message?.id;
					if (typeof messageId === "string" && messageId.length > 0) {
						const list = messageIdsByTurn.get(turn);
						if (list === void 0) messageIdsByTurn.set(turn, [messageId]);
						else if (!list.includes(messageId)) list.push(messageId);
					}
					const open = openStep;
					if (open !== null && open.turn === turn && open.step === data?.step) {
						const cell = cellFor(open.turn);
						cell.llmMs += Math.max(0, event.time - open.startTime);
						const firstToken = open.firstTokenTime ?? assistantStreamFirstTokenTime(data?.stream) ?? null;
						if (firstToken !== null) {
							if (cell.ttftMs === null) cell.ttftMs = Math.max(0, firstToken - open.startTime);
							const outputTokens = turnBucketsFrom(data?.usage).outputTokens;
							if (outputTokens > 0) {
								cell.decodeMs += Math.max(0, event.time - firstToken);
								cell.decodeTokens += outputTokens;
								cell.sampled = true;
							}
						}
						openStep = null;
					}
					if (data?.usage !== void 0 && typeof data.step === "number") addUsage(cellFor(turn), data.step, data.usage);
					break;
				}
				case "tool/call": {
					const callId = data?.callId ?? String(event.seq);
					const callName = typeof data?.name === "string" ? data.name : "";
					const isAsk = ASK_TOOL_PATTERN.test(callName);
					pendingCalls.set(callId, {
						turn,
						time: event.time,
						ask: isAsk
					});
					if (typeof data?.step === "number") rootCalls.set(callId, {
						turn,
						step: data.step
					});
					if (typeof data?.step === "number" && callName.length > 0) {
						let byTurn = toolsByTurnStep.get(turn);
						if (byTurn === void 0) {
							byTurn = /* @__PURE__ */ new Map();
							toolsByTurnStep.set(turn, byTurn);
						}
						let byStep = byTurn.get(data.step);
						if (byStep === void 0) {
							byStep = /* @__PURE__ */ new Map();
							byTurn.set(data.step, byStep);
						}
						byStep.set(callName, (byStep.get(callName) ?? 0) + 1);
					}
					break;
				}
				case "tool/ptc-dispatch-start":
				case "tool/ptc-dispatch": {
					const rootCallId = data?.rootCallId;
					const subName = data?.name;
					if (typeof rootCallId !== "string" || typeof subName !== "string" || subName.length === 0) break;
					const owner = rootCalls.get(rootCallId);
					if (owner === void 0) break;
					let subByTurn = subToolsByTurnStep.get(owner.turn);
					if (subByTurn === void 0) {
						subByTurn = /* @__PURE__ */ new Map();
						subToolsByTurnStep.set(owner.turn, subByTurn);
					}
					let subByStep = subByTurn.get(owner.step);
					if (subByStep === void 0) {
						subByStep = /* @__PURE__ */ new Map();
						subByTurn.set(owner.step, subByStep);
					}
					if (event.type === "tool/ptc-dispatch-start") subByStep.set(subName, (subByStep.get(subName) ?? 0) + 1);
					break;
				}
				case "tool/result": {
					const callId = data?.message?.source?.callId;
					if (callId !== void 0) {
						const dispatched = pendingCalls.get(callId);
						if (dispatched !== void 0) {
							const span = Math.max(0, event.time - dispatched.time);
							if (dispatched.ask) cellFor(dispatched.turn).askMs += span;
							else cellFor(dispatched.turn).toolMs += span;
							pendingCalls.delete(callId);
						}
					}
					break;
				}
				case "request/header": {
					const headerModel = data?.header?.config?.model;
					if (typeof headerModel === "string" && headerModel.length > 0 && typeof turn === "number") modelByTurn.set(turn, headerModel);
					break;
				}
				case "step/end":
					cellFor(turn).steps += 1;
					break;
				case "turn/start":
					if (typeof data?.turn === "number") {
						const cell = cellFor(data.turn);
						if (cell.startedAt === void 0) cell.startedAt = event.time;
					}
					break;
				case "turn/end":
					if (typeof data?.turn === "number") {
						cellFor(data.turn).endedAt = event.time;
						if (data.turn > lastEndedTurn) lastEndedTurn = data.turn;
					}
					break;
				case "approval/asked":
					pendingApprovals.set(data?.id ?? String(event.seq), { time: event.time });
					break;
				case "approval/decided": {
					const id = data?.id ?? String(event.seq);
					const asked = pendingApprovals.get(id);
					if (asked !== void 0) {
						cellFor(turn).waitMs += Math.max(0, event.time - asked.time);
						pendingApprovals.delete(id);
					}
					break;
				}
			}
		}
		const { model, pricingKey } = this.resolveModelForSession(session);
		const config = this.effectiveCostConfig(pricingKey);
		const turns = [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([turn, cell]) => {
			const cost = this.costFromBuckets(cell.totals, pricingKey, model);
			const stepsDetail = [...cell.lastStep.entries()].map(([step, buckets]) => {
				const toolsMap = toolsByTurnStep.get(turn)?.get(step);
				const tools = toolsMap === void 0 ? [] : [...toolsMap.entries()].map(([name, count]) => ({
					name,
					count
				})).sort((a, b) => b.count - a.count);
				const subMap = subToolsByTurnStep.get(turn)?.get(step);
				const subTools = subMap === void 0 ? [] : [...subMap.entries()].map(([name, count]) => ({
					name,
					count
				})).sort((a, b) => b.count - a.count);
				return {
					step,
					tools,
					...subTools.length === 0 ? {} : { subTools },
					uncachedInputTokens: buckets.uncachedInputTokens,
					cacheReadTokens: buckets.cacheReadTokens,
					cacheWriteTokens: buckets.cacheWriteTokens,
					outputTokens: buckets.outputTokens,
					cost: costOfUsage({
						inputTokens: buckets.uncachedInputTokens,
						outputTokens: buckets.outputTokens,
						cacheReadTokens: buckets.cacheReadTokens,
						cacheWriteTokens: buckets.cacheWriteTokens
					}, config)
				};
			}).filter((entry) => entry.tools.length > 0 || entry.cost > 0);
			const turnModel = modelByTurn.get(turn);
			return {
				turn,
				...turnModel === void 0 && model === void 0 ? {} : { model: turnModel ?? model },
				steps: cell.steps,
				...cell.startedAt === void 0 || cell.endedAt === void 0 ? {} : { runMs: Math.max(0, cell.endedAt - cell.startedAt) },
				...messageIdsByTurn.get(turn) === void 0 ? {} : { messageIds: messageIdsByTurn.get(turn) },
				totalTokens: cell.totals.uncachedInputTokens + cell.totals.cacheReadTokens + cell.totals.cacheWriteTokens + cell.totals.outputTokens,
				llmMs: cell.llmMs,
				toolMs: cell.toolMs,
				waitMs: cell.waitMs,
				...cell.askMs > 0 ? { askMs: cell.askMs } : {},
				...cell.ttftMs === null ? {} : { ttftMs: cell.ttftMs },
				...cell.sampled && cell.decodeMs > 0 ? { tokensPerSecond: cell.decodeTokens / (cell.decodeMs / 1e3) } : {},
				uncachedInputTokens: cell.totals.uncachedInputTokens,
				outputTokens: cell.totals.outputTokens,
				cacheReadTokens: cell.totals.cacheReadTokens,
				cacheWriteTokens: cell.totals.cacheWriteTokens,
				cost: cost.cost,
				detail: {
					uncachedInputTokens: cell.totals.uncachedInputTokens,
					cacheReadTokens: cell.totals.cacheReadTokens,
					outputTokens: cell.totals.outputTokens,
					uncachedInputCost: cost.breakdown.input,
					cacheReadCost: cost.breakdown.cacheRead,
					outputCost: cost.breakdown.output,
					cost: cost.cost
				},
				stepsDetail
			};
		});
		const totals = turns.reduce((acc, t) => ({
			turns: acc.turns + 1,
			steps: acc.steps + t.steps,
			llmMs: acc.llmMs + t.llmMs,
			toolMs: acc.toolMs + t.toolMs,
			waitMs: acc.waitMs + t.waitMs,
			askMs: acc.askMs + (t.askMs ?? 0),
			uncachedInputTokens: acc.uncachedInputTokens + t.uncachedInputTokens,
			outputTokens: acc.outputTokens + t.outputTokens,
			cacheReadTokens: acc.cacheReadTokens + t.cacheReadTokens,
			cacheWriteTokens: acc.cacheWriteTokens + t.cacheWriteTokens,
			cost: acc.cost + t.cost
		}), {
			turns: 0,
			steps: 0,
			llmMs: 0,
			toolMs: 0,
			waitMs: 0,
			askMs: 0,
			uncachedInputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			cost: 0
		});
		const ongoingTurn = [...cells.keys()].reduce((max, t) => Math.max(max, t), 0);
		const ongoingCell = ongoingTurn > 0 ? cells.get(ongoingTurn) : void 0;
		let ongoing = null;
		if (ongoingCell !== void 0) {
			const cost = this.costFromBuckets(ongoingCell.totals, pricingKey, model);
			const billed = ongoingCell.totals.uncachedInputTokens + ongoingCell.totals.cacheReadTokens + ongoingCell.totals.cacheWriteTokens;
			const ongoingModel = modelByTurn.get(ongoingTurn) ?? model;
			ongoing = {
				turn: ongoingTurn,
				...ongoingModel === void 0 ? {} : { model: ongoingModel },
				steps: ongoingCell.steps,
				llmMs: ongoingCell.llmMs,
				toolMs: ongoingCell.toolMs,
				waitMs: ongoingCell.waitMs,
				uncachedInputTokens: ongoingCell.totals.uncachedInputTokens,
				outputTokens: ongoingCell.totals.outputTokens,
				cacheReadTokens: ongoingCell.totals.cacheReadTokens,
				cacheWriteTokens: ongoingCell.totals.cacheWriteTokens,
				cost: cost.cost,
				cacheHitPercent: billed === 0 ? null : Math.round(ongoingCell.totals.cacheReadTokens / billed * 1e4) / 100
			};
		}
		return {
			turns,
			totals,
			ongoing
		};
	}
	/** The billing buckets of one session, zeroed when the projection is unavailable. */
	usageOf(session) {
		const registry = this.ctx.get("sessionProjections");
		let usage;
		if (registry !== void 0) {
			const value = registry.snapshot(session).values.tokenUsage;
			if (value !== null && typeof value === "object") usage = value;
		}
		return usage ?? ZERO_BUCKETS;
	}
	/** Price one usage record into the full cost snapshot shared by live and cold sessions. */
	costFromBuckets(buckets, pricingKey, model) {
		const config = this.effectiveCostConfig(pricingKey);
		const cost = costOfUsage({
			inputTokens: buckets.uncachedInputTokens,
			outputTokens: buckets.outputTokens,
			cacheReadTokens: buckets.cacheReadTokens,
			cacheWriteTokens: buckets.cacheWriteTokens
		}, config);
		return {
			...buckets,
			cost,
			currency: config.currency,
			pricingKey,
			...model === void 0 ? {} : { model },
			breakdown: {
				input: costOfTokens(buckets.uncachedInputTokens, config.inputPerMillion),
				cacheRead: costOfTokens(buckets.cacheReadTokens, config.cacheReadPerMillion),
				cacheWrite: costOfTokens(buckets.cacheWriteTokens, config.cacheWritePerMillion),
				output: costOfTokens(buckets.outputTokens, config.outputPerMillion)
			}
		};
	}
	/**
	* Resolve the pricing preset (and the raw model id, when known) for this
	* session. An explicit configured `model` (`flash`/`pro`) wins over
	* auto-detection; otherwise (`auto`) the session's request header model id is
	* mapped to a preset, falling back to flash when no header exists or the id
	* is not a known DeepSeek family.
	* @param session - the session whose model to resolve.
	*/
	resolveModelForSession(session) {
		if (this.model !== "auto") return { pricingKey: this.model };
		const modelId = (typeof session.requestHeader === "function" ? session.requestHeader() : void 0)?.config?.model;
		if (typeof modelId === "string" && modelId.length > 0) {
			const lower = modelId.toLowerCase();
			if (lower.includes("pro")) return {
				model: modelId,
				pricingKey: "pro"
			};
			if (lower.includes("flash")) return {
				model: modelId,
				pricingKey: "flash"
			};
		}
		return { pricingKey: "flash" };
	}
	/**
	* The cost config in effect right now for one pricing preset: auto-fetched
	* official prices when available (peak table applied by the current
	* Beijing-hour band once the peak rollout is live), otherwise the configured
	* preset for that model.
	* @param pricingKey - the model preset to price for (`flash` or `pro`).
	*/
	/**
	* 活动模型目录的 id → 显示名映射（`ctx.llm.listProviders()` + `listModels()`）。
	* 该目录就是设置里那份模型清单（含你改过的 `name`），因此显示名会自动跟着走，
	* 不受请求头里记录的路由 id 影响。结果缓存 5 分钟。
	* @returns 模型 id 到显示名的映射；目录不可用时为空 Map。
	*/
	async modelCatalog() {
		const now = Date.now();
		const cached = this.modelNamesCache;
		if (cached !== void 0 && now - cached.at < MODEL_NAMES_TTL_MS) return cached.value;
		const models = /* @__PURE__ */ new Map();
		const providers = /* @__PURE__ */ new Map();
		/** 模型 id → 提供方 id：0.2.0 桌面版客户端拿不到每轮的 provider，用目录反查。 */
		const modelProviders = /* @__PURE__ */ new Map();
		const llm = this.ctx.get("llm");
		if (llm !== void 0 && typeof llm.listProviders === "function" && typeof llm.listModels === "function") {
			let roster = [];
			try {
				roster = llm.listProviders();
			} catch {
				roster = [];
			}
			for (const provider of roster) {
				if (typeof provider?.id !== "string" || provider.id.length === 0) continue;
				providers.set(provider.id, typeof provider.name === "string" && provider.name.length > 0 ? provider.name : provider.id);
				try {
					const list = await llm.listModels(provider.id);
					for (const model of list) {
						if (typeof model?.id !== "string" || model.id.length === 0) continue;
						models.set(model.id, typeof model.name === "string" && model.name.length > 0 ? model.name : model.id);
						modelProviders.set(model.id, provider.id);
					}
				} catch {}
			}
		}
		const value = {
			models,
			providers,
			modelProviders
		};
		this.modelNamesCache = {
			at: now,
			value
		};
		return value;
	}
	/**
	* 最近活跃的会话 id（按会话日志文件的修改时间挑最新的那个）。
	* 0.2.0 桌面版的客户端不一定拿得到 sessionId，客户端不带 session 参数时用它兜底，
	* 这样「本轮金额 / 用时 / 提供方」在桌面版也能显示。
	* @returns 会话 id；一个都读不到时 undefined。
	*/
	mostRecentSessionId() {
		try {
			const root = (process.env.DSH_HOME ?? "C:\\Users\\lin\\.dsh").replace(/\\/g, "/") + "/sessions";
			let best;
			for (const slug of readdirSync(root)) for (const id of readdirSync(root + "/" + slug)) try {
				for (const file of readdirSync(root + "/" + slug + "/" + id)) {
					if (!file.startsWith("session.v")) continue;
					const at = statSync(root + "/" + slug + "/" + id + "/" + file).mtimeMs;
					if (best === void 0 || at > best.at) best = {
						id,
						at
					};
				}
			} catch {}
			return best?.id;
		} catch {
			return;
		}
	}
	/**
	* 活动模型目录的 id → 显示名映射（见 {@link modelCatalog}）。
	* @returns 模型 id 到显示名的映射；目录不可用时为空 Map。
	*/
	async modelNames() {
		return (await this.modelCatalog()).models;
	}
	/**
	* 提供方 id → 显示名映射（例如 deepseek-official → DeepSeek）。
	* @returns 提供方 id 到显示名的映射；目录不可用时为空 Map。
	*/
	async providerNames() {
		return (await this.modelCatalog()).providers;
	}
	/** 目录名缓存（见 {@link modelCatalog}）。 */
	modelNamesCache;
	/** 新模型发现缓存（见 {@link discoveredModels}）。 */
	discoveredCache;
	/**
	* 供应商自己广告的模型 id 列表（`GET {baseUrl}/models`，OpenAI 兼容）。
	* 用来发现「还没写进设置」的新模型：设置里那份清单决定选择器里有什么，
	* 这个接口决定供应商现在到底提供了什么。结果缓存 6 小时，点击余额即刷新。
	* @returns 供应商广告的模型 id（失败时为空数组）。
	*/
	async discoveredModels() {
		const now = Date.now();
		const cached = this.discoveredCache;
		if (cached !== void 0 && now - cached.at < MODEL_DISCOVERY_TTL_MS) return cached.value;
		let ids = [];
		try {
			const key = await this.resolveApiKey();
			if (key !== void 0 && key.length > 0) {
				const { origin, prefix } = parseBaseUrl(this.baseUrl);
				const response = await fetch(`${origin}${prefix}/models`, { headers: { authorization: `Bearer ${key}` } });
				if (response.ok) {
					const body = await response.json();
					ids = (Array.isArray(body.data) ? body.data : []).map((row) => row !== null && typeof row === "object" ? row.id : void 0).filter((id) => typeof id === "string" && id.length > 0);
				}
			}
		} catch {
			ids = [];
		}
		this.discoveredCache = {
			at: now,
			value: ids
		};
		return ids;
	}
	/**
	* 供应商广告、但设置里还没有的模型 id（「发现新模型」）。
	* @returns 未配置的模型 id 列表，按字母序；没有新模型时为空数组。
	*/
	async unconfiguredModels() {
		const [discovered, catalog] = await Promise.all([this.discoveredModels(), this.modelCatalog()]);
		return discovered.filter((id) => !catalog.models.has(id)).sort();
	}
	effectiveCostConfig(pricingKey = "flash") {
		const snapshot = this.pricingSnapshot;
		if (snapshot !== void 0 && snapshot.error === void 0) {
			const prices = snapshot.current[pricingKey];
			let cacheRead = prices.cacheReadPerMillion;
			let input = prices.inputPerMillion;
			let output = prices.outputPerMillion;
			const peak = snapshot.peak?.[pricingKey];
			if (peak !== void 0 && Date.now() >= PEAK_PRICING_START_MS) {
				const band = isPeakHour() ? peak.peak : peak.offPeak;
				cacheRead = band.cacheReadPerMillion;
				input = band.inputPerMillion;
				output = band.outputPerMillion;
			}
			return resolveCostConfig({
				inputPerMillion: input,
				cacheReadPerMillion: cacheRead,
				outputPerMillion: output,
				currency: this.userCostOverrides?.currency ?? this.modelCost(pricingKey).currency
			});
		}
		return resolveCostConfig({
			inputPerMillion: this.applyOverride(pricingKey, "inputPerMillion"),
			cacheReadPerMillion: this.applyOverride(pricingKey, "cacheReadPerMillion"),
			cacheWritePerMillion: pricingKey === "pro" ? PRO_COST_CONFIG.cacheWritePerMillion : FLASH_COST_CONFIG.cacheWritePerMillion,
			outputPerMillion: this.applyOverride(pricingKey, "outputPerMillion"),
			currency: this.userCostOverrides?.currency ?? this.modelCost(pricingKey).currency
		});
	}
	/** One preset field, with any explicit user override applied. */
	applyOverride(pricingKey, field) {
		const override = this.userCostOverrides?.[field];
		if (typeof override === "number") return override;
		return this.modelCost(pricingKey)[field];
	}
	/** The built-in preset prices for one model. */
	modelCost(pricingKey) {
		return pricingKey === "pro" ? PRO_COST_CONFIG : FLASH_COST_CONFIG;
	}
	/**
	* Re-fetch the official pricing page and update the effective cost config.
	* Failures keep the previous snapshot (or the built-in preset) and record
	* the error so the client can surface it.
	*/
	async refreshPricing() {
		this.pricingSnapshot = await fetchPricing();
	}
	/** Current pricing snapshot (for diagnostics / client display). */
	pricingInfo() {
		return this.pricingSnapshot;
	}
	/** The pricing preset (flash / pro) in effect for one session. */
	pricingKeyFor(session) {
		return this.resolveModelForSession(session).pricingKey;
	}
	/**
	* Current pricing band + input multiplier for one model (client display).
	* Band is 'peak' only during a Beijing peak window (Mon-Fri 09:00-12:00 /
	* 14:00-18:00, weekends are NOT peak) AND the official peak table gives an
	* input multiplier > 1; otherwise 'offPeak' (multiplier 1).
	* @param pricingKey - the model preset to price for (`flash` or `pro`).
	*/
	pricingBand(pricingKey = "pro") {
		let inputMultiplier = 1;
		const snapshot = this.pricingSnapshot;
		if (snapshot !== void 0 && snapshot.error === void 0 && snapshot.peak !== void 0) {
			const p = snapshot.peak[pricingKey];
			if (p !== void 0 && p.offPeak.inputPerMillion > 0) inputMultiplier = p.peak.inputPerMillion / p.offPeak.inputPerMillion;
		}
		const band = Date.now() >= PEAK_PRICING_START_MS && isPeakHour() && inputMultiplier > 1 ? "peak" : "offPeak";
		return {
			band,
			inputMultiplier: band === "peak" ? inputMultiplier : 1
		};
	}
	async query() {
		const key = await this.resolveApiKey();
		const fetchedAt = Date.now();
		if (key === void 0) return {
			fetchedAt,
			available: false,
			balances: [],
			error: `no API key (store ${this.apiKeyEnv} via the credentials seam, or export it in the environment)`
		};
		try {
			const { origin, prefix } = parseBaseUrl(this.baseUrl);
			const url = `${origin}${prefix}/user/balance`;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 15e3);
			let response;
			try {
				response = await fetch(url, {
					method: "GET",
					headers: {
						authorization: `Bearer ${key}`,
						accept: "application/json"
					},
					signal: controller.signal
				});
			} finally {
				clearTimeout(timer);
			}
			if (!response.ok) {
				const body = await response.text().catch(() => "");
				return {
					fetchedAt,
					available: false,
					balances: [],
					error: `Get User Balance failed: HTTP ${response.status}${body ? ` — ${truncate(body, 200)}` : ""}`
				};
			}
			const payload = await response.json();
			const buckets = Array.isArray(payload.balance_infos) ? payload.balance_infos.map((b) => ({
				currency: String(b.currency ?? ""),
				total_balance: String(b.total_balance ?? "0"),
				granted_balance: String(b.granted_balance ?? "0"),
				topped_up_balance: String(b.topped_up_balance ?? "0")
			})).filter((b) => b.currency !== "") : [];
			const total = buckets.length === 1 ? Number(buckets[0].total_balance) : void 0;
			return {
				fetchedAt,
				available: payload.is_available !== false,
				balances: buckets,
				...total === void 0 || Number.isNaN(total) ? {} : {
					total,
					currency: buckets[0].currency
				}
			};
		} catch (error) {
			return {
				fetchedAt,
				available: false,
				balances: [],
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}
	/** Resolve the current API key through the credentials seam or the environment. */
	async resolveApiKey() {
		const credentials = this.ctx.get("credentials");
		if (credentials !== void 0) {
			const hit = await credentials.resolve(this.apiKeyEnv);
			if (hit !== void 0 && hit.value.length > 0) return hit.value;
		}
		const value = this.ctx.get("launchEnvironment")?.get(String(this.apiKeyEnv));
		if (value !== void 0 && value.value.length > 0) return value.value;
		const envFallback = process.env[String(this.apiKeyEnv)];
		if (typeof envFallback === "string" && envFallback.length > 0) return envFallback;
	}
};
/** Bound a provider error body for reporting. */
function truncate(text, max) {
	return text.length <= max ? text : `${text.slice(0, max)}..`;
}
//#endregion
export { PRICING_URL as a, DEFAULT_COST_CONFIG as c, costOfTokens as d, costOfUsage as f, DEFAULT_REFRESH_INTERVAL_SECONDS as i, FLASH_COST_CONFIG as l, DEFAULT_API_KEY_ENV as n, fetchPricing as o, resolveCostConfig as p, DEFAULT_BASE_URL as r, isPeakHour as s, BalanceService as t, PRO_COST_CONFIG as u };
