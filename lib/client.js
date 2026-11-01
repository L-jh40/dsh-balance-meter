window.__ModuleLoader__.load({
	id: "dsh-balance-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		/** Chinese copy. */
		const zh = {
			"balance.total": "余额 {amount} {currency}",
			"balance.cost": "本会话 {amount} {currency}",
			"balance.previous": "本轮 {amount} {currency}",
			"balance.sessionCost": "本会话消耗",
			"balance.previousTurn": "本轮消耗",
			"balance.ongoing": "本轮进行中",
			"balance.balanceLabel": "余额",
			"balance.times": "LLM {llm} · 工具 {tool} · 等待 {wait}",
			"balance.amount": "消耗 {amount} {currency}",
			"balance.llmShort": "LLM {duration}",
			"balance.toolShort": "工具 {duration}",
			"balance.waitShort": "等待 {duration}",
			"balance.cacheHitShort": "缓存命中 {percent}%",
			"balance.available": "可用",
			"balance.unavailable": "不可用",
			"balance.error": "查询失败：{error}",
			"balance.loading": "查询中…",
			"balance.empty": "暂无余额数据",
			"balance.refresh": "刷新",
			"balance.fetchedAt": "更新于 {time}",
			"balance.bandPeak": "高峰",
			"balance.bandOffPeak": "空闲时段",
			"balance.inputMultiplier": "输入价 ×{n}",
			"balance.noOngoing": "暂无进行中的对话",
			"balance.granted": "赠送",
			"balance.toppedUp": "充值",
			"settings.title": "余额",
			"settings.description": "显示 DeepSeek 账户余额与可用状态。",
			"settings.enabled": "启用余额显示",
			"settings.enabledHint": "关闭后隐藏余额并停止轮询。",
			"settings.apiKeyEnv": "API Key 环境变量名",
			"settings.apiKeyEnvHint": "存储 DeepSeek API Key 的凭据引用（默认 DEEPSEEK_API_KEY）。",
			"settings.baseUrl": "API 地址",
			"settings.baseUrlHint": "DeepSeek API 基础地址，一般保持默认。",
			"settings.refreshInterval": "刷新间隔（秒）",
			"settings.refreshIntervalHint": "两次向官方余额接口查询的最小间隔。",
			"settings.inherit": "继承",
			"settings.on": "开",
			"settings.off": "关",
			"settings.overridden": "已覆盖",
			"settings.reset": "恢复默认",
			"settings.readOnly": "当前部署的设置只读。",
			"settings.expand": "展开设置",
			"settings.collapse": "收起设置",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.discard": "放弃",
			"settings.unsaved": "未保存",
			"settings.saveFailed": "部署未接受这些值，已保留供你修改。",
			"settings.invalidNumber": "请输入数字，留空则使用默认值。"
		};
		/** English copy. */
		const en = {
			"balance.total": "Balance {amount} {currency}",
			"balance.cost": "This session {amount} {currency}",
			"balance.previous": "This turn {amount} {currency}",
			"balance.sessionCost": "This session",
			"balance.previousTurn": "This turn",
			"balance.ongoing": "This turn (running)",
			"balance.balanceLabel": "Balance",
			"balance.times": "LLM {llm} · Tools {tool} · Wait {wait}",
			"balance.amount": "Spend {amount} {currency}",
			"balance.llmShort": "LLM {duration}",
			"balance.toolShort": "Tools {duration}",
			"balance.waitShort": "Wait {duration}",
			"balance.cacheHitShort": "Cache hit {percent}%",
			"balance.available": "available",
			"balance.unavailable": "unavailable",
			"balance.error": "Query failed: {error}",
			"balance.loading": "Loading…",
			"balance.empty": "No balance data yet",
			"balance.refresh": "Refresh",
			"balance.fetchedAt": "Updated {time}",
			"balance.bandPeak": "Peak",
			"balance.bandOffPeak": "Off-peak",
			"balance.inputMultiplier": "input ×{n}",
			"balance.noOngoing": "No running turn",
			"balance.granted": "granted",
			"balance.toppedUp": "top-up",
			"settings.title": "Balance",
			"settings.description": "Show the DeepSeek account balance and availability.",
			"settings.enabled": "Enable the balance readout",
			"settings.enabledHint": "When off, the readout hides and polling stops.",
			"settings.apiKeyEnv": "API key env name",
			"settings.apiKeyEnvHint": "The credential reference storing the DeepSeek API key (default DEEPSEEK_API_KEY).",
			"settings.baseUrl": "API base URL",
			"settings.baseUrlHint": "DeepSeek API base URL; keep the default normally.",
			"settings.refreshInterval": "Refresh interval (s)",
			"settings.refreshIntervalHint": "Minimum seconds between official balance queries.",
			"settings.inherit": "Inherit",
			"settings.on": "On",
			"settings.off": "Off",
			"settings.overridden": "Overridden",
			"settings.reset": "Reset to default",
			"settings.readOnly": "This deployment stores settings read-only.",
			"settings.expand": "Show settings",
			"settings.collapse": "Hide settings",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.discard": "Discard",
			"settings.unsaved": "Unsaved",
			"settings.saveFailed": "The deployment did not accept these values; they were left for you to correct.",
			"settings.invalidNumber": "Enter a number, or leave blank to use the default."
		};
		//#endregion
		//#region \0dsh-css:C:\Users\lin\Desktop\工作区域\dsh-plugins\dsh-balance-meter\src\client\balance.module.css.mjs
		const css = ".pURSAq_chip{border:1px solid var(--dsh-color-border,#80808059);background:var(--dsh-color-surface,transparent);height:22px;color:var(--dsh-color-text,inherit);cursor:pointer;white-space:nowrap;border-radius:999px;align-items:center;gap:6px;padding:0 8px;font-size:12px;line-height:1;display:inline-flex;position:relative}.pURSAq_chip:hover,.pURSAq_chipOpen{border-color:var(--dsh-color-accent,#50a0ffb3)}.pURSAq_dot{background:var(--dsh-color-danger,#e5534b);border-radius:50%;flex:none;width:7px;height:7px}.pURSAq_dotOk{background:var(--dsh-color-success,#2da44e);border-radius:50%;flex:none;width:7px;height:7px}.pURSAq_details{z-index:40;border:1px solid var(--dsh-color-border,#80808059);background:var(--dsh-color-surface-elevated,#1f1f1f);min-width:140px;color:var(--dsh-color-text,inherit);border-radius:6px;flex-direction:column;gap:2px;padding:6px 8px;font-size:11px;display:flex;position:absolute;bottom:calc(100% + 6px);left:0;box-shadow:0 4px 12px #0000004d}.pURSAq_row{justify-content:space-between;align-items:center;gap:12px;display:flex}.pURSAq_rowRight{align-items:center;gap:4px;display:inline-flex}.pURSAq_sep{opacity:.45}.pURSAq_cost{opacity:.85}.pURSAq_costRow{border-top:1px solid var(--dsh-color-border,#80808040);justify-content:space-between;align-items:center;gap:12px;margin-top:4px;padding-top:4px;display:flex}.pURSAq_bandRow{border-top:none;border-bottom:1px solid var(--dsh-color-border,#80808040);margin-top:0;margin-bottom:4px;padding-top:0;padding-bottom:4px}html[data-lan-device=phone] .pURSAq_details{width:max-content;min-width:0;max-width:calc(100vw - 16px);left:auto;right:0}";
		const tagId = "dsh-balance-meter/balance.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-balance-meter";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var balance_module_css_default = {
			"bandRow": "pURSAq_bandRow",
			"chip": "pURSAq_chip",
			"chipOpen": "pURSAq_chipOpen",
			"cost": "pURSAq_cost",
			"costRow": "pURSAq_costRow",
			"details": "pURSAq_details",
			"dot": "pURSAq_dot",
			"dotOk": "pURSAq_dotOk",
			"row": "pURSAq_row",
			"rowRight": "pURSAq_rowRight",
			"sep": "pURSAq_sep"
		};
		//#endregion
		//#region src/client/BalanceDockEntry.tsx
		/**
		* The composer dock entry: the DeepSeek account balance + session cost
		* readout, mounted in the composer dock band (`conversation.composer.dock`)
		* beside the official conversation stats line. The chip polls the host
		* `/api/balance` endpoint for the account total and `/api/balance/cost` for
		* the current session's estimated spend; clicking reveals the per-currency
		* balance breakdown and the cost breakdown.
		* @module dsh-balance-meter/client/BalanceDockEntry
		*/
		/**
		* 0.2.0 桌面版的槽位可能不给 `t`（只传它自己声明的 props），这里用插件自带字典兜底，
		* 避免整块 chip 因为 `t` 缺失而抛错消失。
		* @param key - 文案键。
		* @param params - `{name}` 占位符替换表。
		* @returns 该语言下的文案，缺键时回落为键名。
		*/
		function localT(key, params) {
			const dict = zh;
			let text = typeof dict[key] === "string" ? dict[key] : key;
			if (params !== void 0) for (const name of Object.keys(params)) text = text.split("{" + name + "}").join(String(params[name]));
			return text;
		}
		/** Same-origin JSON fetch helper. */
		async function balanceFetch(path) {
			const response = await fetch(path);
			if (!response.ok) throw new Error(`balance ${path} failed: ${response.status}`);
			return await response.json();
		}
		/** The live host API instance (failures surface per call). */
		const balanceApi = {
			view: () => balanceFetch("/api/balance"),
			refresh: () => balanceFetch("/api/balance/refresh"),
			cost: (sessionId) => balanceFetch(sessionId === void 0 ? "/api/balance/cost" : `/api/balance/cost?session=${encodeURIComponent(sessionId)}`),
			turns: (sessionId) => balanceFetch(sessionId === void 0 ? "/api/balance/turns" : `/api/balance/turns?session=${encodeURIComponent(sessionId)}`)
		};
		/** Poll interval for the host snapshot: 5 s — the balance read hits the host
		* 30 s cache window (no external request) and the cost read is a local fold,
		* so a short interval adds negligible load. */
		const POLL_MS = 5e3;
		/** Format a number with up to two decimals (chip readout). */
		function formatAmount(value) {
			if (value === void 0 || Number.isNaN(value)) return "--";
			return value.toLocaleString(void 0, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2
			});
		}
		/** Format a cost with exactly four decimals (details panel: 本会话 / 上一轮). */
		function formatAmountPrecise(value) {
			if (value === void 0 || Number.isNaN(value)) return "--";
			return value.toLocaleString(void 0, {
				minimumFractionDigits: 4,
				maximumFractionDigits: 4
			});
		}
		/** 显示用币种：CNY 统一显示为「元」（其它币种保留原代码）。 */
		function currencyLabel(currency) {
			if (currency === void 0) return "";
			return currency === "CNY" ? "元" : currency;
		}
		/** 4 significant digits with banker's rounding (四舍六入五看单双), no exponent.
		* 0.0000→0, 0.0010→0.001, 0.0001→0.0001, 4.8215→4.822, 48.07→48.07. */
		function formatSig(value) {
			if (value === void 0 || Number.isNaN(value)) return "--";
			if (value === 0) return "0";
			const sign = value < 0 ? "-" : "";
			const v = Math.abs(value);
			const scale = Math.pow(10, 3 - Math.floor(Math.log10(v)));
			const scaled = Number((v * scale).toFixed(9));
			const floor = Math.floor(scaled);
			const frac = scaled - floor;
			const result = (frac > .5 ? floor + 1 : frac < .5 ? floor : floor % 2 === 0 ? floor : floor + 1) / scale;
			return sign + String(Number(result.toPrecision(4)));
		}
		/** Compact duration: 45.2s under a minute, 2m42s from there on. */
		function formatDuration(ms) {
			const s = ms / 1e3;
			if (s < 60) return `${Math.round(s * 10) / 10}s`;
			const whole = Math.round(s);
			return `${Math.floor(whole / 60)}m${whole % 60}s`;
		}
		/** Format an epoch-ms time as HH:MM:SS. */
		function formatTime(epochMs) {
			const d = new Date(epochMs);
			return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
		}
		/**
		* The account balance + session cost chip: polls the host balance snapshot
		* and the current session's cost, rendering the total balance and estimated
		* session spend. Clicking reveals the per-currency and per-bucket breakdown
		* and refreshes.
		* @param props - the composed dock entry props.
		*/
		function BalanceDockEntry(props) {
			const t = typeof props.t === "function" ? props.t : localT;
			try {
				localStorage.setItem("dsh-balance-meter:render", String(typeof props.t) + "@" + (/* @__PURE__ */ new Date()).toISOString());
			} catch {}
			(0, react.useEffect)(() => {
				try {
					const info = [...document.querySelectorAll("[data-slot=\"conversation.composer.dock\"]")].map((slot) => {
						const rect = slot.getBoundingClientRect();
						const style = getComputedStyle(slot);
						const kids = [...slot.children].map((child) => String(child.className ?? child.tagName).slice(0, 70));
						return "rect=" + Math.round(rect.width) + "x" + Math.round(rect.height) + "@" + Math.round(rect.left) + "," + Math.round(rect.top) + " display=" + style.display + " [" + kids.join(" | ") + "]";
					});
					localStorage.setItem("dsh-balance-meter:dom", (info.join(" || ") || "no-slot") + "@" + (/* @__PURE__ */ new Date()).toISOString());
				} catch {}
			}, []);
			const [view, setView] = (0, react.useState)(null);
			const [cost, setCost] = (0, react.useState)(null);
			const [turns, setTurns] = (0, react.useState)(null);
			const [open, setOpen] = (0, react.useState)(0);
			const storeSessionId = typeof props.useSession === "function" ? props.useSession((s) => s?.sessionId) : void 0;
			const sessionId = props.sessionId ?? storeSessionId;
			const pollNow = (0, react.useCallback)(() => {
				let live = true;
				balanceApi.view().then((snapshot) => {
					if (live) setView(snapshot);
				}, () => {
					if (live) setView(null);
				});
				balanceApi.cost(sessionId).then((snapshot) => {
					if (live) setCost(snapshot);
				}, () => {
					if (live) setCost(null);
				});
				balanceApi.turns(sessionId).then((snapshot) => {
					if (live) setTurns(snapshot);
				}, () => {
					if (live) setTurns(null);
				});
				return () => {
					live = false;
				};
			}, [sessionId]);
			(0, react.useEffect)(() => {
				let timer;
				const start = () => {
					if (timer !== void 0) window.clearInterval(timer);
					timer = window.setInterval(pollNow, POLL_MS);
				};
				const stop = () => {
					if (timer !== void 0) {
						window.clearInterval(timer);
						timer = void 0;
					}
				};
				const onVisibility = () => {
					if (document.visibilityState === "visible") {
						pollNow();
						start();
					} else stop();
				};
				const cleanup = pollNow();
				if (document.visibilityState === "visible") start();
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					cleanup();
					stop();
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, [pollNow]);
			const refresh = () => {
				balanceApi.refresh().then((snapshot) => {
					setView(snapshot);
				}, () => {});
			};
			if (view === null || view.error !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: balance_module_css_default.chip,
				onClick: refresh,
				title: view?.error ?? t("balance.error", { error: "connection" }),
				"data-testid": "balance-chip-error",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: balance_module_css_default.dot,
					"aria-hidden": "true"
				}), t("balance.unavailable")]
			});
			const total = view.total;
			const currency = view.currency ?? view.balances[0]?.currency;
			const balanceLabel = total === void 0 || currency === void 0 ? t("balance.empty") : t("balance.total", {
				amount: formatAmount(total),
				currency: currencyLabel(currency)
			});
			const costLabel = cost?.ok === true && cost.cost !== void 0 ? t("balance.cost", {
				amount: formatAmount(cost.cost),
				currency: currencyLabel(cost.currency ?? currency)
			}) : void 0;
			const ongoingData = turns?.ok === true && turns.ongoing !== null && turns.ongoing !== void 0 ? turns.ongoing : void 0;
			const currentLabel = ongoingData?.cost !== void 0 ? t("balance.previous", {
				amount: formatAmount(ongoingData.cost),
				currency: currencyLabel(currency)
			}) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: `${balance_module_css_default.chip} ${open > 0 ? balance_module_css_default.chipOpen : ""}`,
				onClick: () => {
					setOpen((o) => (o + 1) % 3);
					refresh();
					pollNow();
				},
				title: view.fetchedAt > 0 ? t("balance.fetchedAt", { time: formatTime(view.fetchedAt) }) : void 0,
				"data-testid": "balance-chip",
				"aria-expanded": open > 0,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: view.available ? balance_module_css_default.dotOk : balance_module_css_default.dot,
						"aria-hidden": "true"
					}),
					balanceLabel,
					costLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: balance_module_css_default.sep,
						"aria-hidden": "true"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: balance_module_css_default.cost,
						children: costLabel
					})] }),
					currentLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: balance_module_css_default.sep,
						"aria-hidden": "true"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: balance_module_css_default.cost,
						children: currentLabel
					})] }),
					open === 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: balance_module_css_default.details,
						role: "tooltip",
						children: [
							cost?.ok === true && cost.pricingBand !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: `${balance_module_css_default.costRow} ${balance_module_css_default.bandRow}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: cost.pricingBand.band === "peak" ? t("balance.bandPeak") : t("balance.bandOffPeak") }), cost.pricingBand.band === "peak" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: balance_module_css_default.rowRight,
									children: t("balance.inputMultiplier", { n: String(formatSig(cost.pricingBand.inputMultiplier ?? 1)) })
								})]
							}),
							(view.balances ?? []).map((b) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: balance_module_css_default.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("balance.balanceLabel") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: balance_module_css_default.rowRight,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											title: t("balance.granted"),
											children: formatSig(Number(b.granted_balance))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "+" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											title: t("balance.toppedUp"),
											children: formatSig(Number(b.topped_up_balance))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["\xA0", currencyLabel(b.currency)] })
									]
								})]
							}, b.currency)),
							cost?.ok === true && cost.cost !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: balance_module_css_default.costRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("balance.sessionCost") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: balance_module_css_default.rowRight,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatAmountPrecise(cost.cost) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: currencyLabel(cost.currency ?? currency) })]
								})]
							}),
							ongoingData?.cost !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: balance_module_css_default.costRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("balance.previousTurn") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: balance_module_css_default.rowRight,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatAmountPrecise(ongoingData.cost) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: currencyLabel(currency) })]
								})]
							})
						]
					}),
					open === 2 && (ongoingData !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: balance_module_css_default.details,
						role: "tooltip",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: balance_module_css_default.row,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("balance.ongoing") })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: balance_module_css_default.costRow,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: balance_module_css_default.rowRight,
									children: t("balance.times", {
										llm: formatDuration(ongoingData.llmMs ?? 0),
										tool: formatDuration(ongoingData.toolMs ?? 0),
										wait: formatDuration(ongoingData.waitMs ?? 0)
									})
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: balance_module_css_default.costRow,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: balance_module_css_default.rowRight,
									children: [
										ongoingData.cacheHitPercent !== null && ongoingData.cacheHitPercent !== void 0 ? t("balance.cacheHitShort", { percent: String(ongoingData.cacheHitPercent) }) : "",
										ongoingData.cacheHitPercent !== null && ongoingData.cacheHitPercent !== void 0 ? " · " : "",
										t("balance.amount", {
											amount: formatAmountPrecise(ongoingData.cost),
											currency: currencyLabel(cost?.currency ?? currency)
										})
									]
								})
							})
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: balance_module_css_default.details,
						role: "tooltip",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: balance_module_css_default.row,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("balance.noOngoing") })
						})
					}))
				]
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "balance";
		/** Required services: slots for the composer-dock entry, locale for the copy. */
		const inject = [
			"slots",
			"locale",
			"connection"
		];
		/**
		* Register the balance chip into the composer dock band.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-balance-meter: dictionaries");
			ctx.inject(["slots"], (scope) => {
				let disposable;
				let timer;
				let attempts = 0;
				const attempt = () => {
					if (disposable !== void 0) return;
					attempts += 1;
					try {
						disposable = scope.slots.register({
							name: "conversation.composer.dock",
							id: "balance",
							order: 120,
							locale: NS,
							inject: () => ({})
						}, BalanceDockEntry);
						try {
							localStorage.setItem("dsh-balance-meter:beacon", "registered@" + (/* @__PURE__ */ new Date()).toISOString());
						} catch {}
						return;
					} catch {
						if (attempts < 60) timer = setTimeout(attempt, 250);
					}
				};
				scope.effect(() => () => {
					if (timer !== void 0) clearTimeout(timer);
					if (disposable !== void 0) disposable();
				}, "dsh-balance-meter: chip registration");
				attempt();
			});
		}
		//#endregion
		exports.BalanceDockEntry = BalanceDockEntry;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map