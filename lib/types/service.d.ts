/**
 * dsh-balance-meter host service — the `balance.*` RPC domain. Resolves the DeepSeek
 * API key through the DSH credentials seam (`ctx.credentials`, ref
 * `DEEPSEEK_API_KEY`) and queries the official Get User Balance endpoint,
 * caching the result so the browser readout can poll without spamming the
 * provider.
 * @module dsh-balance-meter/service
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session } from '@deepseek-ai/dsh-session';
import { type CostConfig } from './cost.ts';
import { type PricingSnapshot } from './pricing.ts';
/** One currency bucket reported by Get User Balance. */
export interface BalanceInfo {
    /** ISO currency code (e.g. `CNY`). */
    currency: string;
    /** Total balance across granted and topped-up amounts. */
    total_balance: string;
    /** Grant (initial) balance, still present in this currency. */
    granted_balance: string;
    /** Topped-up (purchased) balance, still present in this currency. */
    topped_up_balance: string;
}
/** The full Get User Balance response body. */
export interface BalanceResponse {
    /** Whether the account can currently be billed. */
    is_available: boolean;
    /** Per-currency balance buckets. */
    balance_infos: BalanceInfo[];
}
/** Cleaned view served to the browser readout. */
export interface BalanceView {
    /** Query snapshot time (epoch ms). */
    fetchedAt: number;
    /** Whether the account can currently be billed. */
    available: boolean;
    /** Per-currency buckets. */
    balances: BalanceInfo[];
    /** The single summed total across all currencies (when exactly one currency). */
    total?: number;
    /** ISO currency of {@link total}. */
    currency?: string;
    /** Human-readable error when the provider query failed. */
    error?: string;
    /**
     * 供应商已广告、但设置里的模型清单还没有的模型 id（发现新模型）。
     * 由路由层补充：设置里有它才能在选择器里选中，但至少可以先告诉你「有新的了」。
     */
    discovered?: string[];
}
/** Plugin configuration. */
export interface BalanceConfig {
    /** Credential reference (env-style name) storing the DeepSeek API key. */
    apiKeyEnv?: string;
    /** DeepSeek API base URL (override for gateway/compat providers). */
    baseUrl?: string;
    /** Minimum seconds between provider queries (browser poll pacing). */
    refreshIntervalSeconds?: number;
    /**
     * Model pricing mode for the session cost estimate:
     * - `'auto'` (default): detect the model from each session's request header
     *   (`deepseek-v4-flash` → flash, `deepseek-v4-pro` → pro), falling back to
     *   flash when it cannot be resolved;
     * - `'flash'` / `'pro'`: force that preset, ignoring auto-detection.
     * Explicit {@link CostConfig} fields override the resolved preset.
     */
    model?: 'auto' | 'flash' | 'pro';
    /** Per-million-token prices for the session cost estimate. */
    cost?: CostConfig;
    /** Hours between automatic refreshes of the official pricing page. */
    pricingRefreshHours?: number;
    /** Master switch for the plugin (host routes + browser readout). */
    enabled?: boolean;
}
/** DeepSeek API base URL. */
export declare const DEFAULT_BASE_URL = "https://api.deepseek.com";
/** Default credential reference for the DeepSeek API key. */
export declare const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
/** Default provider query pacing. */
export declare const DEFAULT_REFRESH_INTERVAL_SECONDS = 30;
/** Default hours between automatic official-pricing refreshes. */
export declare const DEFAULT_PRICING_REFRESH_HOURS = 6;
/** Official peak-pricing rollout: 2026-08-17 00:00 Beijing time (UTC+8). */
export declare const PEAK_PRICING_START_MS: number;
/** One session's token usage and estimated cost. */
export interface SessionCost {
    /** Uncached input tokens. */
    uncachedInputTokens: number;
    /** Output tokens. */
    outputTokens: number;
    /** Cache-read tokens. */
    cacheReadTokens: number;
    /** Cache-write tokens. */
    cacheWriteTokens: number;
    /** Estimated total cost in the configured currency. */
    cost: number;
    /** Display currency of {@link cost}. */
    currency: string;
    /** Per-bucket cost breakdown. */
    breakdown: {
        input: number;
        cacheRead: number;
        cacheWrite: number;
        output: number;
    };
    /** Pricing preset used for this estimate: `flash`, `pro`, or the fallback configured model. */
    pricingKey: 'flash' | 'pro';
    /** The provider model id the estimate was based on; absent when only the fallback preset applied. */
    model?: string;
}
/** One completed conversation turn's usage and estimated cost. */
export interface PreviousTurnCost {
    /** The completed turn number of the previous conversation (上一轮对话). */
    turn: number;
    /** Uncached input tokens. */
    uncachedInputTokens: number;
    /** Output tokens. */
    outputTokens: number;
    /** Cache-read tokens. */
    cacheReadTokens: number;
    /** Cache-write tokens. */
    cacheWriteTokens: number;
    /** Estimated total cost in the configured currency. */
    cost: number;
    /** Display currency of {@link cost}. */
    currency: string;
    /** Per-bucket cost breakdown. */
    breakdown: {
        input: number;
        cacheRead: number;
        cacheWrite: number;
        output: number;
    };
    /** Pricing preset used for this estimate. */
    pricingKey: 'flash' | 'pro';
    /** The provider model id the estimate was based on, when resolvable. */
    model?: string;
}
/** One conversation turn's usage/cost statistics (steps, timings, tokens). */
export interface TurnUsageStats {
    /** Turn number. */
    turn: number;
    /** Closed steps in this turn. */
    steps: number;
    /** LLM wall time (ms), closed at assistant/message (sessionStats semantics). */
    llmMs: number;
    /** Tool wall time (ms), closed at tool/result. */
    toolMs: number;
    /** Time waiting for the user (approval asked→decided) in ms. */
    waitMs: number;
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** Estimated cost of this turn. */
    cost: number;
    /** 该轮实际使用的模型 id（取自该轮 request/header；无法解析时回退为会话级模型）。 */
    model?: string;
    /** 消费明细：输入/输出 token 与金额（与 chip 同一定价）。 */
    detail?: {
        uncachedInputTokens: number;
        cacheReadTokens: number;
        outputTokens: number;
        uncachedInputCost: number;
        cacheReadCost: number;
        outputCost: number;
        cost: number;
    };
    /** 该轮首 token 用时（TTFT，ms）：取该轮第一个 step 的 step/start→首个 token。 */
    ttftMs?: number;
    /** 该轮输出速度（tok/s）：该轮各 step 的输出 token 之和 ÷ 解码用时之和。 */
    tokensPerSecond?: number;
    /**
     * 该轮模型的**显示名**（活动模型目录里的 name，例如 settings.yaml 里配置的
     * `DeepSeek-V4.1-Flash-Expires-On-0910`）。请求头/路由里只有模型 id，
     * 名字随时可能改，所以由主机端从目录现取，客户端优先显示它。
     */
    modelName?: string;
    /** 等待用户回答提问（ask_user_question）的时长，单位 ms；与工具调用用时分开统计。 */
    askMs?: number;
    /** 该轮总用时（turn/start → turn/end），单位 ms；桌面版客户端拿不到节点时也能显示「本轮用时」。 */
    runMs?: number;
    /** 该轮总 token（未缓存输入 + 缓存读 + 缓存写 + 输出），用于「N tok」标题。 */
    totalTokens?: number;
    /** 该轮的助手消息 id 列表：客户端只有 messageId 时用它反查轮次。 */
    messageIds?: string[];
    /** 工具调用明细：每步的工具名×次数 + 本步金额；subTools 是 run_code 内部真正调用的工具。 */
    stepsDetail?: {
        step: number;
        tools: {
            name: string;
            count: number;
        }[];
        /** run_code 里实际执行的工具（pwsh / read / edit / grep / …）及其次数。 */
        subTools?: {
            name: string;
            count: number;
        }[];
        cost: number;
    }[];
}
/** Full per-turn statistics for one session plus summed totals. */
export interface SessionTurnStats {
    /** Per-turn stats in ascending turn order. */
    turns: TurnUsageStats[];
    /** Summed totals across turns. */
    totals: {
        turns: number;
        steps: number;
        llmMs: number;
        toolMs: number;
        waitMs: number;
        askMs: number;
        uncachedInputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        cost: number;
    };
    /** The still-running (incomplete) turn's stats, or null when every turn has ended. */
    ongoing: TurnUsageStats & {
        cacheHitPercent: number | null;
    } | null;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        balance: BalanceService;
    }
}
/**
 * DeepSeek Get User Balance client. Resolution of the API key re-reads the
 * credentials seam on every query so a changed key reaches the next query
 * without a plugin restart.
 */
export declare class BalanceService {
    private readonly apiKeyEnv;
    private readonly baseUrl;
    private readonly refreshIntervalMs;
    private readonly model;
    /** Explicit per-million price overrides from `config.cost`, applied on top of any model preset. */
    private readonly userCostOverrides;
    private pricingSnapshot;
    private pricingTimer;
    private cached;
    private cachedAt;
    private inflight;
    private enabled;
    /** 宿主上下文：用于惰性解析 credentials / sessions 服务（不继承 cordis Service，避免依赖 @deepseek-ai/cordis 运行时解析）。 */
    private readonly ctx;
    constructor(ctx: Context, config?: BalanceConfig);
    /** Whether the balance service answers queries while enabled. */
    isEnabled(): boolean;
    /** Master switch: stop answering fresh provider queries (cache may still read). */
    setEnabled(enabled: boolean): void;
    /**
     * RPC: most recent balance + usage view. A healthy (error-free) cached view
     * is returned while still fresh; an erroneous view is never reused as fresh,
     * so the next poll re-queries the provider and the readout recovers
     * automatically once the underlying condition clears (without a manual
     * click). Concurrent queries are deduped.
     */
    view(): Promise<BalanceView>;
    /** RPC: force a fresh provider query (bypasses the cache window). */
    refresh(): Promise<BalanceView>;
    /**
     * RPC: current session token usage + estimated cost. Reads the official
     * `tokenUsage` projection (registered by dsh-token-meter) through the
     * session-projection registry and applies per-million prices for the model
     * actually driving this session (read from the session's request header),
     * falling back to the configured `model` preset when the live model cannot
     * be resolved. Returns zeroed values when the projection is unavailable.
     * @param session - the session whose usage is read.
     */
    sessionCost(session: Session): SessionCost;
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
    previousTurnCost(session: Session): PreviousTurnCost | undefined;
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
    turnStats(session: Session): SessionTurnStats;
    /** The billing buckets of one session, zeroed when the projection is unavailable. */
    private usageOf;
    /** Price one usage record into the full cost snapshot shared by live and cold sessions. */
    private costFromBuckets;
    /**
     * Resolve the pricing preset (and the raw model id, when known) for this
     * session. An explicit configured `model` (`flash`/`pro`) wins over
     * auto-detection; otherwise (`auto`) the session's request header model id is
     * mapped to a preset, falling back to flash when no header exists or the id
     * is not a known DeepSeek family.
     * @param session - the session whose model to resolve.
     */
    private resolveModelForSession;
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
    modelCatalog(): Promise<{
        models: Map<string, string>;
        providers: Map<string, string>;
        modelProviders: Map<string, string>;
    }>;
    /**
     * 最近活跃的会话 id（按会话日志文件的修改时间挑最新的那个）。
     * 0.2.0 桌面版的客户端不一定拿得到 sessionId，客户端不带 session 参数时用它兜底，
     * 这样「本轮金额 / 用时 / 提供方」在桌面版也能显示。
     * @returns 会话 id；一个都读不到时 undefined。
     */
    mostRecentSessionId(): string | undefined;
    /**
     * 活动模型目录的 id → 显示名映射（见 {@link modelCatalog}）。
     * @returns 模型 id 到显示名的映射；目录不可用时为空 Map。
     */
    modelNames(): Promise<Map<string, string>>;
    /**
     * 提供方 id → 显示名映射（例如 deepseek-official → DeepSeek）。
     * @returns 提供方 id 到显示名的映射；目录不可用时为空 Map。
     */
    providerNames(): Promise<Map<string, string>>;
    /** 目录名缓存（见 {@link modelCatalog}）。 */
    private modelNamesCache;
    /** 新模型发现缓存（见 {@link discoveredModels}）。 */
    private discoveredCache;
    /**
     * 供应商自己广告的模型 id 列表（`GET {baseUrl}/models`，OpenAI 兼容）。
     * 用来发现「还没写进设置」的新模型：设置里那份清单决定选择器里有什么，
     * 这个接口决定供应商现在到底提供了什么。结果缓存 6 小时，点击余额即刷新。
     * @returns 供应商广告的模型 id（失败时为空数组）。
     */
    discoveredModels(): Promise<string[]>;
    /**
     * 供应商广告、但设置里还没有的模型 id（「发现新模型」）。
     * @returns 未配置的模型 id 列表，按字母序；没有新模型时为空数组。
     */
    unconfiguredModels(): Promise<string[]>;
    private effectiveCostConfig;
    /** One preset field, with any explicit user override applied. */
    private applyOverride;
    /** The built-in preset prices for one model. */
    private modelCost;
    /**
     * Re-fetch the official pricing page and update the effective cost config.
     * Failures keep the previous snapshot (or the built-in preset) and record
     * the error so the client can surface it.
     */
    refreshPricing(): Promise<void>;
    /** Current pricing snapshot (for diagnostics / client display). */
    pricingInfo(): PricingSnapshot | undefined;
    /** The pricing preset (flash / pro) in effect for one session. */
    pricingKeyFor(session: Session): 'flash' | 'pro';
    /**
     * Current pricing band + input multiplier for one model (client display).
     * Band is 'peak' only during a Beijing peak window (Mon-Fri 09:00-12:00 /
     * 14:00-18:00, weekends are NOT peak) AND the official peak table gives an
     * input multiplier > 1; otherwise 'offPeak' (multiplier 1).
     * @param pricingKey - the model preset to price for (`flash` or `pro`).
     */
    pricingBand(pricingKey?: 'flash' | 'pro'): {
        band: 'peak' | 'offPeak';
        inputMultiplier: number;
    };
    private query;
    /** Resolve the current API key through the credentials seam or the environment. */
    private resolveApiKey;
}
//# sourceMappingURL=service.d.ts.map