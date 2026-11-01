import { a as PRICING_URL, c as DEFAULT_COST_CONFIG, d as costOfTokens, f as costOfUsage, i as DEFAULT_REFRESH_INTERVAL_SECONDS, l as FLASH_COST_CONFIG, n as DEFAULT_API_KEY_ENV, o as fetchPricing, p as resolveCostConfig, r as DEFAULT_BASE_URL, s as isPeakHour, t as BalanceService, u as PRO_COST_CONFIG } from "./service-BXK16Vke.js";
import { appendFileSync } from "node:fs";
//#region src/routes.ts
/**
* dsh-balance-meter HTTP routes — the browser half talks to the host through plain
* same-origin JSON endpoints (`/api/balance` and `/api/balance/cost`), which
* the host answers by querying the DeepSeek Get User Balance endpoint and the
* session token-usage projection. The client never sees the API key.
* @module dsh-balance-meter/routes
*/
/** Browser-facing base path of the balance API. */
const BALANCE_API_PREFIX = "/api/balance";
/** Write one JSON response. */
function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
/** Require the method or answer 405. */
function requireMethod(req, res, method) {
	if (req.method === method) return true;
	json(res, 405, {
		ok: false,
		error: "method-not-allowed"
	});
	return false;
}
/** Wrap one async balance read as a GET JSON route. */
function getRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			Promise.resolve(run()).then((value) => json(res, 200, value), (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/** Wrap one request-aware JSON route (e.g. the session-cost read). */
function getRequestRoute(path, run) {
	return {
		kind: "exact",
		path,
		handler: (req, res) => {
			if (!requireMethod(req, res, "GET")) return;
			Promise.resolve(run(req)).then((value) => json(res, 200, value), (error) => {
				json(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				});
			});
		}
	};
}
/** Read the `session` query parameter from the request URL. */
function sessionParam(req) {
	const raw = req.url ?? "";
	const q = raw.indexOf("?");
	if (q < 0) return void 0;
	const value = new URLSearchParams(raw.slice(q + 1)).get("session");
	return value === null || value === "" ? void 0 : value;
}
/**
* Build the full balance API route family for one service.
* @param service - the balance service.
* @param resolveSession - resolve a session id to the session (undefined when absent).
*/
function makeBalanceRoutes(service, resolveSession) {
	return [
		getRequestRoute(`${BALANCE_API_PREFIX}/client-report`, async (req) => {
			const query = new URLSearchParams((req.url ?? "").slice((req.url ?? "").indexOf("?") + 1));
			const tag = query.get("tag") ?? "unknown";
			const info = query.get("info") ?? "";
			try {
				appendFileSync("C:/Users/lin/.dsh/balance-client-report.log", (/* @__PURE__ */ new Date()).toISOString() + " | " + tag + " | " + info + "\n");
			} catch {}
			return { ok: true };
		}),
		getRoute(`${BALANCE_API_PREFIX}`, async () => {
			const view = await service.view();
			let discovered = [];
			try {
				discovered = await service.unconfiguredModels();
			} catch {
				discovered = [];
			}
			return discovered.length === 0 ? view : {
				...view,
				discovered
			};
		}),
		getRoute(`${BALANCE_API_PREFIX}/refresh`, () => service.refresh()),
		getRequestRoute(`${BALANCE_API_PREFIX}/turns`, async (req) => {
			const id = sessionParam(req) ?? service.mostRecentSessionId();
			if (id === void 0) return {
				ok: false,
				error: "missing-session"
			};
			const resolved = resolveSession(id);
			if (resolved === void 0) return {
				ok: false,
				error: "unknown-session"
			};
			const stats = service.turnStats(resolved.session);
			let models;
			let providers;
			let modelProviders;
			try {
				const catalog = await service.modelCatalog();
				models = catalog.models;
				providers = catalog.providers;
				modelProviders = catalog.modelProviders;
			} catch {
				models = /* @__PURE__ */ new Map();
				providers = /* @__PURE__ */ new Map();
				modelProviders = /* @__PURE__ */ new Map();
			}
			const turns = stats.turns.map((turn) => {
				if (turn.model === void 0) return turn;
				const name = models.get(turn.model);
				return name === void 0 || name === turn.model ? turn : {
					...turn,
					modelName: name
				};
			});
			return {
				ok: true,
				...stats,
				turns,
				modelNames: Object.fromEntries(models),
				providerNames: Object.fromEntries(providers),
				modelProviders: Object.fromEntries(modelProviders)
			};
		}),
		getRequestRoute(`${BALANCE_API_PREFIX}/cost`, async (req) => {
			const id = sessionParam(req) ?? service.mostRecentSessionId();
			if (id === void 0) return {
				ok: false,
				error: "missing-session"
			};
			const resolved = resolveSession(id);
			if (resolved === void 0) return {
				ok: false,
				error: "unknown-session"
			};
			const previous = service.previousTurnCost(resolved.session);
			return {
				ok: true,
				...resolved.cost,
				previous: previous ?? null,
				pricingBand: service.pricingBand(service.pricingKeyFor(resolved.session))
			};
		})
	];
}
//#endregion
//#region src/index.ts
/** Settings namespace of the balance capability. */
const BALANCE_SETTINGS_NAMESPACE = "balance";
/**
* 默认设置（原先这里导出一份 schemastery schema；仓库内没有任何消费者，
* 为了让宿主端不依赖 @deepseek-ai/schemastery 的运行期解析，改成纯对象描述）。
*/
const BALANCE_SETTINGS_DEFAULTS = {
	apiKeyEnv: DEFAULT_API_KEY_ENV,
	baseUrl: DEFAULT_BASE_URL,
	refreshIntervalSeconds: 30,
	enabled: true
};
/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
const name = "balance";
/** Services required before the balance service can answer. */
const inject = ["webServer", "sessions"];
/** Register the balance service and its API routes on the context. */
function apply(ctx, config = {}) {
	const service = new BalanceService(ctx, config);
	const base = {
		apiKeyEnv: config.apiKeyEnv ?? "DEEPSEEK_API_KEY",
		baseUrl: config.baseUrl ?? "https://api.deepseek.com",
		refreshIntervalSeconds: config.refreshIntervalSeconds ?? 30,
		...config.model === void 0 ? {} : { model: config.model },
		...config.cost === void 0 ? {} : { cost: config.cost },
		enabled: config.enabled ?? true
	};
	const resolveSession = (id) => {
		const session = ctx.get("sessions")?.get(id);
		if (session === void 0) return void 0;
		return {
			session,
			cost: service.sessionCost(session)
		};
	};
	const routes = makeBalanceRoutes(service, resolveSession);
	let disposeRoutes;
	const syncRoutes = () => {
		const enabled = base.enabled ?? true;
		if (disposeRoutes === void 0 && enabled) disposeRoutes = ctx.effect(() => {
			const disposers = routes.map((route) => ctx.webServer.register(route));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, "balance: routes");
		else if (disposeRoutes !== void 0 && !enabled) {
			disposeRoutes();
			disposeRoutes = void 0;
		}
	};
	syncRoutes();
}
//#endregion
export { BALANCE_API_PREFIX, BALANCE_SETTINGS_DEFAULTS, BALANCE_SETTINGS_NAMESPACE, BalanceService, DEFAULT_API_KEY_ENV, DEFAULT_BASE_URL, DEFAULT_COST_CONFIG, DEFAULT_REFRESH_INTERVAL_SECONDS, FLASH_COST_CONFIG, PRICING_URL, PRO_COST_CONFIG, apply, costOfTokens, costOfUsage, fetchPricing, inject, isPeakHour, makeBalanceRoutes, name, resolveCostConfig };
