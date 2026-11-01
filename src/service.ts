/**
 * dsh-balance-meter host service — the `balance.*` RPC domain. Resolves the DeepSeek
 * API key through the DSH credentials seam (`ctx.credentials`, ref
 * `DEEPSEEK_API_KEY`) and queries the official Get User Balance endpoint,
 * caching the result so the browser readout can poll without spamming the
 * provider.
 * @module dsh-balance-meter/service
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter'
import {
  resolveCostConfig,
  costOfUsage,
  costOfTokens,
  FLASH_COST_CONFIG,
  PRO_COST_CONFIG,
  type CostConfig,
} from './cost.ts'
import { fetchPricing, isPeakHour, type PricingSnapshot } from './pricing.ts'

/** 提问类工具（等人回答）的名字匹配：其时长单列，不并入工具调用用时。 */
const ASK_TOOL_PATTERN = /ask|question/i

import { readdirSync, statSync } from 'node:fs'

/** 模型显示名目录的缓存时长（毫秒）。 */
const MODEL_NAMES_TTL_MS = 300_000

/** 供应商 /models 新模型发现结果的缓存时长（毫秒，默认 6 小时）。 */
const MODEL_DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000

/** One currency bucket reported by Get User Balance. */
export interface BalanceInfo {
  /** ISO currency code (e.g. `CNY`). */
  currency: string
  /** Total balance across granted and topped-up amounts. */
  total_balance: string
  /** Grant (initial) balance, still present in this currency. */
  granted_balance: string
  /** Topped-up (purchased) balance, still present in this currency. */
  topped_up_balance: string
}

/** The full Get User Balance response body. */
export interface BalanceResponse {
  /** Whether the account can currently be billed. */
  is_available: boolean
  /** Per-currency balance buckets. */
  balance_infos: BalanceInfo[]
}

/** Cleaned view served to the browser readout. */
export interface BalanceView {
  /** Query snapshot time (epoch ms). */
  fetchedAt: number
  /** Whether the account can currently be billed. */
  available: boolean
  /** Per-currency buckets. */
  balances: BalanceInfo[]
  /** The single summed total across all currencies (when exactly one currency). */
  total?: number
  /** ISO currency of {@link total}. */
  currency?: string
  /** Human-readable error when the provider query failed. */
  error?: string
  /**
   * 供应商已广告、但设置里的模型清单还没有的模型 id（发现新模型）。
   * 由路由层补充：设置里有它才能在选择器里选中，但至少可以先告诉你「有新的了」。
   */
  discovered?: string[]
}

/** Plugin configuration. */
export interface BalanceConfig {
  /** Credential reference (env-style name) storing the DeepSeek API key. */
  apiKeyEnv?: string
  /** DeepSeek API base URL (override for gateway/compat providers). */
  baseUrl?: string
  /** Minimum seconds between provider queries (browser poll pacing). */
  refreshIntervalSeconds?: number
  /**
   * Model pricing mode for the session cost estimate:
   * - `'auto'` (default): detect the model from each session's request header
   *   (`deepseek-v4-flash` → flash, `deepseek-v4-pro` → pro), falling back to
   *   flash when it cannot be resolved;
   * - `'flash'` / `'pro'`: force that preset, ignoring auto-detection.
   * Explicit {@link CostConfig} fields override the resolved preset.
   */
  model?: 'auto' | 'flash' | 'pro'
  /** Per-million-token prices for the session cost estimate. */
  cost?: CostConfig
  /** Hours between automatic refreshes of the official pricing page. */
  pricingRefreshHours?: number
  /** Master switch for the plugin (host routes + browser readout). */
  enabled?: boolean
}

/** DeepSeek API base URL. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
/** Default credential reference for the DeepSeek API key. */
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
/** Default provider query pacing. */
export const DEFAULT_REFRESH_INTERVAL_SECONDS = 30
/** Default hours between automatic official-pricing refreshes. */
export const DEFAULT_PRICING_REFRESH_HOURS = 6
/** Official peak-pricing rollout: 2026-08-17 00:00 Beijing time (UTC+8). */
export const PEAK_PRICING_START_MS = Date.UTC(2026, 7, 16, 16, 0, 0)
/** SSRF / length guard for the base URL. */
const MAX_BASE_URL_LENGTH = 256

/** One session's token usage and estimated cost. */
export interface SessionCost {
  /** Uncached input tokens. */
  uncachedInputTokens: number
  /** Output tokens. */
  outputTokens: number
  /** Cache-read tokens. */
  cacheReadTokens: number
  /** Cache-write tokens. */
  cacheWriteTokens: number
  /** Estimated total cost in the configured currency. */
  cost: number
  /** Display currency of {@link cost}. */
  currency: string
  /** Per-bucket cost breakdown. */
  breakdown: { input: number; cacheRead: number; cacheWrite: number; output: number }
  /** Pricing preset used for this estimate: `flash`, `pro`, or the fallback configured model. */
  pricingKey: 'flash' | 'pro'
  /** The provider model id the estimate was based on; absent when only the fallback preset applied. */
  model?: string
}

/** One completed conversation turn's usage and estimated cost. */
export interface PreviousTurnCost {
  /** The completed turn number of the previous conversation (上一轮对话). */
  turn: number
  /** Uncached input tokens. */
  uncachedInputTokens: number
  /** Output tokens. */
  outputTokens: number
  /** Cache-read tokens. */
  cacheReadTokens: number
  /** Cache-write tokens. */
  cacheWriteTokens: number
  /** Estimated total cost in the configured currency. */
  cost: number
  /** Display currency of {@link cost}. */
  currency: string
  /** Per-bucket cost breakdown. */
  breakdown: { input: number; cacheRead: number; cacheWrite: number; output: number }
  /** Pricing preset used for this estimate. */
  pricingKey: 'flash' | 'pro'
  /** The provider model id the estimate was based on, when resolvable. */
  model?: string
}

/** The billing buckets a cost estimate is built from (the `tokenUsage` projection view). */
interface CostBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** All-zero billing buckets, used when no projection value is available. */
const ZERO_BUCKETS: CostBuckets = {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

/** Narrow a provider usage record to billing buckets (token-meter semantics). */
function turnBucketsFrom(usage: unknown): CostBuckets {
  const u = (usage ?? {}) as { inputTokens?: unknown; outputTokens?: unknown; cacheReadTokens?: unknown; cacheWriteTokens?: unknown }
  const num = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
  return {
    uncachedInputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    cacheReadTokens: num(u.cacheReadTokens),
    cacheWriteTokens: num(u.cacheWriteTokens),
  }
}

/** Add a step's latest buckets to a turn total, REPLACING the step's earlier value (token-meter semantics). */
function addReplacingBuckets(totals: CostBuckets, previous: CostBuckets | undefined, next: CostBuckets): CostBuckets {
  return {
    uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
    outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
    cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
  }
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
function sessionEvents(session: Session): readonly SessionEvent[] {
  const modern = session as unknown as { snapshotEvents?: () => readonly SessionEvent[] }
  if (typeof modern.snapshotEvents === 'function') return modern.snapshotEvents()
  return (session as unknown as { events: readonly SessionEvent[] }).events
}

/** 官方 isTokenDelta：哪些 chunk 算「一个 token」（文本/推理增量、带内容或名字的工具调用增量）。 */
function isTokenDelta(chunk: unknown): boolean {
  const c = chunk as { type?: unknown; text?: unknown; argumentsDelta?: unknown; name?: unknown } | undefined
  switch (c?.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return c.text !== ''
    case 'tool-call-delta':
      return c.argumentsDelta !== '' || c.name !== undefined
    default:
      return false
  }
}

/** 官方 firstRunMemberTime：在压缩 run 内按 dt 累加时间，返回第一个满足条件的成员时间。 */
function firstRunMemberTime(run: { type?: unknown; time0?: unknown; dt?: unknown; texts?: unknown; args?: unknown }, predicate: (fragment: string) => boolean): number | undefined {
  const fragments = (run.type === 'tool-call-chunks' ? run.args : run.texts) as unknown
  if (!Array.isArray(fragments)) return undefined
  const dt = Array.isArray(run.dt) ? (run.dt as number[]) : []
  let time = typeof run.time0 === 'number' ? run.time0 : undefined
  for (let index = 0; index < fragments.length; index += 1) {
    if (index > 0) time = (time ?? 0) + (typeof dt[index - 1] === 'number' ? dt[index - 1] : 0)
    if (typeof fragments[index] === 'string' && predicate(fragments[index] as string)) return time
  }
  return undefined
}

/**
 * 官方 assistantStreamFirstTokenTime 的等价实现：从一条 assistant 事件的压缩 stream 里
 * 读出第一个 token 的时间。DSH 0.1.5 的会话日志把流式增量压缩进 assistant/message 的
 * `stream`（本会话日志里没有 assistant/chunk 事件），所以首 token 只能这样取。
 * @param stream - assistant 事件的压缩 stream 记录。
 * @returns 第一个 token 的时间，取不到时 undefined。
 */
function assistantStreamFirstTokenTime(stream: unknown): number | undefined {
  if (!Array.isArray(stream)) return undefined
  for (const record of stream as { type?: unknown; time?: unknown; chunk?: unknown; time0?: unknown; dt?: unknown; texts?: unknown; args?: unknown; name?: unknown }[]) {
    if (record === null || typeof record !== 'object') continue
    const time = record.type === 'chunk'
      ? (isTokenDelta(record.chunk) && typeof record.time === 'number' ? record.time : undefined)
      : (record.type === 'tool-call-chunks' && record.name !== undefined && typeof record.time0 === 'number'
        ? record.time0
        : firstRunMemberTime(record, (fragment) => fragment !== ''))
    if (time !== undefined) return time
  }
  return undefined
}

/** One conversation turn's usage/cost statistics (steps, timings, tokens). */
export interface TurnUsageStats {
  /** Turn number. */
  turn: number
  /** Closed steps in this turn. */
  steps: number
  /** LLM wall time (ms), closed at assistant/message (sessionStats semantics). */
  llmMs: number
  /** Tool wall time (ms), closed at tool/result. */
  toolMs: number
  /** Time waiting for the user (approval asked→decided) in ms. */
  waitMs: number
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Estimated cost of this turn. */
  cost: number
  /** 该轮实际使用的模型 id（取自该轮 request/header；无法解析时回退为会话级模型）。 */
  model?: string
  /** 消费明细：输入/输出 token 与金额（与 chip 同一定价）。 */
  detail?: {
    uncachedInputTokens: number
    cacheReadTokens: number
    outputTokens: number
    uncachedInputCost: number
    cacheReadCost: number
    outputCost: number
    cost: number
  }
  /** 该轮首 token 用时（TTFT，ms）：取该轮第一个 step 的 step/start→首个 token。 */
  ttftMs?: number
  /** 该轮输出速度（tok/s）：该轮各 step 的输出 token 之和 ÷ 解码用时之和。 */
  tokensPerSecond?: number
  /**
   * 该轮模型的**显示名**（活动模型目录里的 name，例如 settings.yaml 里配置的
   * `DeepSeek-V4.1-Flash-Expires-On-0910`）。请求头/路由里只有模型 id，
   * 名字随时可能改，所以由主机端从目录现取，客户端优先显示它。
   */
  modelName?: string
  /** 等待用户回答提问（ask_user_question）的时长，单位 ms；与工具调用用时分开统计。 */
  askMs?: number
  /** 该轮总用时（turn/start → turn/end），单位 ms；桌面版客户端拿不到节点时也能显示「本轮用时」。 */
  runMs?: number
  /** 该轮总 token（未缓存输入 + 缓存读 + 缓存写 + 输出），用于「N tok」标题。 */
  totalTokens?: number
  /** 该轮的助手消息 id 列表：客户端只有 messageId 时用它反查轮次。 */
  messageIds?: string[]
  /** 工具调用明细：每步的工具名×次数 + 本步金额；subTools 是 run_code 内部真正调用的工具。 */
  stepsDetail?: {
    step: number
    tools: { name: string; count: number }[]
    /** run_code 里实际执行的工具（pwsh / read / edit / grep / …）及其次数。 */
    subTools?: { name: string; count: number }[]
    /** 本步的 token 分桶（客户端据此标「缓存未命中」、按 token 归因）。 */
    uncachedInputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    outputTokens?: number
    cost: number
  }[]
}

/** Full per-turn statistics for one session plus summed totals. */
export interface SessionTurnStats {
  /** Per-turn stats in ascending turn order. */
  turns: TurnUsageStats[]
  /** Summed totals across turns. */
  totals: {
    turns: number
    steps: number
    llmMs: number
    toolMs: number
    waitMs: number
    askMs: number
    uncachedInputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    cost: number
  }
  /** The still-running (incomplete) turn's stats, or null when every turn has ended. */
  ongoing: TurnUsageStats & { cacheHitPercent: number | null } | null
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    balance: BalanceService
  }
}

/** Parse a base URL into a safe `{ origin, pathPrefix }` pair. */
function parseBaseUrl(raw: string): { origin: string; prefix: string } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`dsh-balance-meter: invalid baseUrl "${raw}"`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`dsh-balance-meter: baseUrl must be http(s), got "${url.protocol}"`)
  }
  let prefix = url.pathname.replace(/\/+$/, '')
  let origin = url.origin
  return { origin, prefix }
}

/**
 * DeepSeek Get User Balance client. Resolution of the API key re-reads the
 * credentials seam on every query so a changed key reaches the next query
 * without a plugin restart.
 */
export class BalanceService {
  private readonly apiKeyEnv: CredentialRef
  private readonly baseUrl: string
  private readonly refreshIntervalMs: number
  private readonly model: 'auto' | 'flash' | 'pro'
  /** Explicit per-million price overrides from `config.cost`, applied on top of any model preset. */
  private readonly userCostOverrides: CostConfig | undefined
  private pricingSnapshot: PricingSnapshot | undefined
  private pricingTimer: NodeJS.Timeout | undefined
  private cached: BalanceView | undefined
  private cachedAt = 0
  private inflight: Promise<BalanceView> | undefined
  private enabled: boolean

  /** 宿主上下文：用于惰性解析 credentials / sessions 服务（不继承 cordis Service，避免依赖 @deepseek-ai/cordis 运行时解析）。 */
  private readonly ctx: Context

  constructor(ctx: Context, config: BalanceConfig = {}) {
    this.ctx = ctx
    this.apiKeyEnv = (config.apiKeyEnv ?? DEFAULT_API_KEY_ENV) as CredentialRef
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    this.refreshIntervalMs = Math.max(0, (config.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS) * 1_000)
    this.model = config.model ?? 'auto'
    this.userCostOverrides = config.cost
    this.enabled = config.enabled ?? true
    // Refresh pricing once at boot, then on a slow cadence (6h) so a price
    // change or the peak-pricing rollout is picked up without a restart.
    void this.refreshPricing()
    const cadenceMs = (config.pricingRefreshHours ?? DEFAULT_PRICING_REFRESH_HOURS) * 3_600_000
    this.pricingTimer = setInterval(() => { void this.refreshPricing() }, cadenceMs)
    this.pricingTimer.unref?.()
  }

  /** Whether the balance service answers queries while enabled. */
  isEnabled(): boolean {
    return this.enabled
  }

  /** Master switch: stop answering fresh provider queries (cache may still read). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * RPC: most recent balance + usage view. A healthy (error-free) cached view
   * is returned while still fresh; an erroneous view is never reused as fresh,
   * so the next poll re-queries the provider and the readout recovers
   * automatically once the underlying condition clears (without a manual
   * click). Concurrent queries are deduped.
   */
  async view(): Promise<BalanceView> {
    if (!this.enabled) return { fetchedAt: Date.now(), available: false, balances: [], error: 'disabled' }
    const now = Date.now()
    const cached = this.cached
    if (cached !== undefined && cached.error === undefined && now - this.cachedAt < this.refreshIntervalMs && this.refreshIntervalMs > 0) {
      return cached
    }
    if (this.inflight !== undefined) return this.inflight
    this.inflight = this.query().then((view) => {
      this.cached = view
      this.cachedAt = Date.now()
      return view
    }).finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  /** RPC: force a fresh provider query (bypasses the cache window). */
  async refresh(): Promise<BalanceView> {
    // 点击一次 = 余额 + 官方价格 + 模型目录/名称 + 供应商新模型 一起刷新。
    this.modelNamesCache = undefined
    this.discoveredCache = undefined
    const view = await this.query()
    this.cached = view
    this.cachedAt = Date.now()
    return view
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
  sessionCost(session: Session): SessionCost {
    const { model, pricingKey } = this.resolveModelForSession(session)
    return this.costFromBuckets(this.usageOf(session), pricingKey, model)
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
  previousTurnCost(session: Session): PreviousTurnCost | undefined {
    // per-turn fold: totals + per-step latest buckets (replace semantics).
    const perTurn = new Map<number, { totals: CostBuckets; last: Map<number, CostBuckets> }>()
    let lastCompletedTurn: number | undefined
    for (const event of sessionEvents(session)) {
      if (event.type === 'turn/end') {
        const turn = event.data.turn
        if (typeof turn === 'number') lastCompletedTurn = turn
        continue
      }
      const data = event.data as { turn?: number; step?: number; chunk?: { type?: string; usage?: unknown }; usage?: unknown } | undefined
      let usage: unknown
      if (event.type === 'assistant/chunk' && data?.chunk?.type === 'usage') {
        usage = data.chunk.usage
      } else if (event.type === 'assistant/message' && data?.usage !== undefined) {
        usage = data.usage
      } else continue
      if (typeof data?.turn !== 'number' || typeof data?.step !== 'number') continue
      const buckets = turnBucketsFrom(usage)
      let cell = perTurn.get(data.turn)
      if (cell === undefined) {
        cell = { totals: ZERO_BUCKETS, last: new Map() }
        perTurn.set(data.turn, cell)
      }
      const previous = cell.last.get(data.step)
      cell.last.set(data.step, buckets)
      cell.totals = addReplacingBuckets(cell.totals, previous, buckets)
    }
    if (lastCompletedTurn === undefined) return undefined
    const usage = perTurn.get(lastCompletedTurn)?.totals
    if (usage === undefined) return undefined
    const { model, pricingKey } = this.resolveModelForSession(session)
    const cost = this.costFromBuckets(usage, pricingKey, model)
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
      ...(cost.model === undefined ? {} : { model: cost.model }),
    }
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
  turnStats(session: Session): SessionTurnStats {
    interface Cell {
      steps: number
      llmMs: number
      toolMs: number
      waitMs: number
      totals: CostBuckets
      lastStep: Map<number, CostBuckets>
      /** 该轮首个 step 的 TTFT；null = 尚未取到。 */
      ttftMs: number | null
      /** 解码用时/输出 token（用于 TPS），与官方 deriveTurnMetrics 同口径。 */
      decodeMs: number
      decodeTokens: number
      sampled: boolean
      /** 等待用户回答提问（ask_user_question 工具）的时长，不并入工具调用用时。 */
      askMs: number
      /** 该轮 turn/start 的时间（用于算本轮总用时，桌面版客户端拿不到节点时也够用）。 */
      startedAt?: number
      /** 该轮 turn/end 的时间。 */
      endedAt?: number
    }
    const cells = new Map<number, Cell>()
    let openStep: { turn: number; step: number; startTime: number; firstTokenTime: number | null } | null = null
    const pendingCalls = new Map<string, { turn: number; time: number; ask: boolean }>()
    /** rootCallId → { turn, step }：把 run_code 内部的子工具调用挂回它所属的那一步。 */
    const rootCalls = new Map<string, { turn: number; step: number }>()
    /** 每轮每步的子工具名计数（tool/ptc-dispatch-start，即 run_code 内部真正调用的工具）。 */
    const subToolsByTurnStep = new Map<number, Map<number, Map<string, number>>>()
    const pendingApprovals = new Map<string, { time: number }>()
    const toolsByTurnStep = new Map<number, Map<number, Map<string, number>>>()
    // 每轮实际使用的模型：request/header 事件本身不带 turn/step 坐标，
    // 因此归入折叠到该事件时仍处于打开状态的那一轮。
    const modelByTurn = new Map<number, string>()
    /** 每轮的助手消息 id 列表（轮次从 DOM/节点都拿不到时的反查依据）。 */
    const messageIdsByTurn = new Map<number, string[]>()
    let lastTurn = 0
    let lastEndedTurn = 0
    const cellFor = (turn: number): Cell => {
      let cell = cells.get(turn)
      if (cell === undefined) {
        cell = { steps: 0, llmMs: 0, toolMs: 0, waitMs: 0, totals: ZERO_BUCKETS, lastStep: new Map(), ttftMs: null, decodeMs: 0, decodeTokens: 0, sampled: false, askMs: 0 }
        cells.set(turn, cell)
      }
      return cell
    }
    const addUsage = (cell: Cell, step: number, usage: unknown): void => {
      const buckets = turnBucketsFrom(usage)
      const previous = cell.lastStep.get(step)
      cell.lastStep.set(step, buckets)
      cell.totals = addReplacingBuckets(cell.totals, previous, buckets)
    }
    // approval/* are declaration-merged extension events, so visit the log
    // through a wide shape instead of the closed discriminant union.
    for (const raw of sessionEvents(session)) {
      const event = raw as { type: string; seq: number; time: number; data?: { turn?: number; step?: number; callId?: string; rootCallId?: string; parentCallId?: string; subCallId?: string; id?: string; name?: string; header?: { config?: { model?: string } }; message?: { source?: { callId?: string }; id?: string }; chunk?: { type?: string; usage?: unknown; text?: unknown; argumentsDelta?: unknown }; usage?: unknown; stream?: unknown } }
      const data = event.data
      if (typeof data?.turn === 'number') lastTurn = data.turn
      const turn: number = typeof data?.turn === 'number' ? data.turn : (openStep?.turn ?? lastTurn)
      switch (event.type) {
        case 'step/start':
          openStep = { turn, step: data?.step ?? 0, startTime: event.time, firstTokenTime: null }
          break
        case 'assistant/chunk':
          if (openStep !== null && openStep.turn === turn && openStep.step === data?.step) {
            if (data?.chunk?.type === 'usage' && data.chunk.usage !== undefined) addUsage(cellFor(turn), openStep.step, data.chunk.usage)
            // 流式日志里若存在 chunk 事件，首个 token 增量即首 token 时间。
            if (openStep.firstTokenTime === null && isTokenDelta(data?.chunk)) openStep.firstTokenTime = event.time
          }
          break
        case 'assistant/message': {
          // 记下每轮的助手消息 id：桌面版客户端只有 messageId、没有（可靠的）turn，用它反查这一轮。
          const messageId = data?.message?.id
          if (typeof messageId === 'string' && messageId.length > 0) {
            const list = messageIdsByTurn.get(turn)
            if (list === undefined) messageIdsByTurn.set(turn, [messageId])
            else if (!list.includes(messageId)) list.push(messageId)
          }
          const open = openStep
          if (open !== null && open.turn === turn && open.step === data?.step) {
            const cell = cellFor(open.turn)
            cell.llmMs += Math.max(0, event.time - open.startTime)
            // 首 token：优先流式 chunk，其次事件自带的压缩 stream（0.1.5 是后者）。
            const firstToken = open.firstTokenTime ?? assistantStreamFirstTokenTime(data?.stream) ?? null
            if (firstToken !== null) {
              if (cell.ttftMs === null) cell.ttftMs = Math.max(0, firstToken - open.startTime)
              const outputTokens = turnBucketsFrom(data?.usage).outputTokens
              if (outputTokens > 0) {
                cell.decodeMs += Math.max(0, event.time - firstToken)
                cell.decodeTokens += outputTokens
                cell.sampled = true
              }
            }
            openStep = null
          }
          if (data?.usage !== undefined && typeof data.step === 'number') addUsage(cellFor(turn), data.step, data.usage)
          break
        }
        case 'tool/call': {
          const callId = data?.callId ?? String(event.seq)
          const callName = typeof data?.name === 'string' ? data.name : ''
          // 提问类工具（ask_user_question）的时长是「等人回答」，不能算进工具调用用时。
          const isAsk = ASK_TOOL_PATTERN.test(callName)
          pendingCalls.set(callId, { turn, time: event.time, ask: isAsk })
          if (typeof data?.step === 'number') rootCalls.set(callId, { turn, step: data.step })
          if (typeof data?.step === 'number' && callName.length > 0) {
            let byTurn = toolsByTurnStep.get(turn)
            if (byTurn === undefined) { byTurn = new Map(); toolsByTurnStep.set(turn, byTurn) }
            let byStep = byTurn.get(data.step)
            if (byStep === undefined) { byStep = new Map(); byTurn.set(data.step, byStep) }
            byStep.set(callName, (byStep.get(callName) ?? 0) + 1)
          }
          break
        }
        // run_code 内部真正调用的工具（pwsh / read / edit / …）逐个上报为 ptc-dispatch。
        case 'tool/ptc-dispatch-start':
        case 'tool/ptc-dispatch': {
          const rootCallId = data?.rootCallId
          const subName = data?.name
          if (typeof rootCallId !== 'string' || typeof subName !== 'string' || subName.length === 0) break
          const owner = rootCalls.get(rootCallId)
          if (owner === undefined) break
          let subByTurn = subToolsByTurnStep.get(owner.turn)
          if (subByTurn === undefined) { subByTurn = new Map(); subToolsByTurnStep.set(owner.turn, subByTurn) }
          let subByStep = subByTurn.get(owner.step)
          if (subByStep === undefined) { subByStep = new Map(); subByTurn.set(owner.step, subByStep) }
          // start 与 dispatch 都会到；只在 start 上计数，避免同一次子调用算两遍。
          if (event.type === 'tool/ptc-dispatch-start') subByStep.set(subName, (subByStep.get(subName) ?? 0) + 1)
          break
        }
        case 'tool/result': {
          const callId = data?.message?.source?.callId
          if (callId !== undefined) {
            const dispatched = pendingCalls.get(callId)
            if (dispatched !== undefined) {
              const span = Math.max(0, event.time - dispatched.time)
              if (dispatched.ask) cellFor(dispatched.turn).askMs += span
              else cellFor(dispatched.turn).toolMs += span
              pendingCalls.delete(callId)
            }
          }
          break
        }
        case 'request/header': {
          const headerModel = data?.header?.config?.model
          if (typeof headerModel === 'string' && headerModel.length > 0 && typeof turn === 'number') modelByTurn.set(turn, headerModel)
          break
        }
        case 'step/end':
          cellFor(turn).steps += 1
          break
        case 'turn/start':
          if (typeof data?.turn === 'number') {
            const cell = cellFor(data.turn)
            if (cell.startedAt === undefined) cell.startedAt = event.time
          }
          break
        case 'turn/end':
          if (typeof data?.turn === 'number') {
            cellFor(data.turn).endedAt = event.time
            if (data.turn > lastEndedTurn) lastEndedTurn = data.turn
          }
          break
        case 'approval/asked':
          pendingApprovals.set(data?.id ?? String(event.seq), { time: event.time })
          break
        case 'approval/decided': {
          const id = data?.id ?? String(event.seq)
          const asked = pendingApprovals.get(id)
          if (asked !== undefined) {
            cellFor(turn).waitMs += Math.max(0, event.time - asked.time)
            pendingApprovals.delete(id)
          }
          break
        }
      }
    }
    const { model, pricingKey } = this.resolveModelForSession(session)
    const config = this.effectiveCostConfig(pricingKey)
    const turns = [...cells.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([turn, cell]) => {
        const cost = this.costFromBuckets(cell.totals, pricingKey, model)
        const stepsDetail = [...cell.lastStep.entries()]
          .map(([step, buckets]) => {
            const toolsMap = toolsByTurnStep.get(turn)?.get(step)
            const tools = toolsMap === undefined ? [] : [...toolsMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
            // run_code 内部真正调用的工具（pwsh / read / edit / …），层级上属于本步的工具。
            const subMap = subToolsByTurnStep.get(turn)?.get(step)
            const subTools = subMap === undefined ? [] : [...subMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
            return {
              step,
              tools,
              ...(subTools.length === 0 ? {} : { subTools }),
              // 每步 token 分桶：数据本来就在 buckets 里，以前只是没外露。
              uncachedInputTokens: buckets.uncachedInputTokens,
              cacheReadTokens: buckets.cacheReadTokens,
              cacheWriteTokens: buckets.cacheWriteTokens,
              outputTokens: buckets.outputTokens,
              cost: costOfUsage({
                inputTokens: buckets.uncachedInputTokens,
                outputTokens: buckets.outputTokens,
                cacheReadTokens: buckets.cacheReadTokens,
                cacheWriteTokens: buckets.cacheWriteTokens,
              }, config),
            }
          })
          .filter((entry) => entry.tools.length > 0 || entry.cost > 0)
        const turnModel = modelByTurn.get(turn)
        return {
          turn,
          ...(turnModel === undefined && model === undefined ? {} : { model: turnModel ?? model }),
          steps: cell.steps,
          ...(cell.startedAt === undefined || cell.endedAt === undefined ? {} : { runMs: Math.max(0, cell.endedAt - cell.startedAt) }),
          ...(messageIdsByTurn.get(turn) === undefined ? {} : { messageIds: messageIdsByTurn.get(turn) }),
          totalTokens: cell.totals.uncachedInputTokens + cell.totals.cacheReadTokens + cell.totals.cacheWriteTokens + cell.totals.outputTokens,
          llmMs: cell.llmMs,
          toolMs: cell.toolMs,
          waitMs: cell.waitMs,
          ...(cell.askMs > 0 ? { askMs: cell.askMs } : {}),
          ...(cell.ttftMs === null ? {} : { ttftMs: cell.ttftMs }),
          ...(cell.sampled && cell.decodeMs > 0 ? { tokensPerSecond: cell.decodeTokens / (cell.decodeMs / 1e3) } : {}),
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
            cost: cost.cost,
          },
          stepsDetail,
        }
      })
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
      cost: acc.cost + t.cost,
    }), { turns: 0, steps: 0, llmMs: 0, toolMs: 0, waitMs: 0, askMs: 0, uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 })
    // The latest turn with activity (still running, or the most recent ended
    // turn when idle) — the "本轮" the user just sent / is sending.
    const ongoingTurn = [...cells.keys()].reduce((max, t) => Math.max(max, t), 0)
    const ongoingCell = ongoingTurn > 0 ? cells.get(ongoingTurn) : undefined
    let ongoing: SessionTurnStats['ongoing'] = null
    if (ongoingCell !== undefined) {
      const cost = this.costFromBuckets(ongoingCell.totals, pricingKey, model)
      const billed = ongoingCell.totals.uncachedInputTokens + ongoingCell.totals.cacheReadTokens + ongoingCell.totals.cacheWriteTokens
      const ongoingModel = modelByTurn.get(ongoingTurn) ?? model
      ongoing = {
        turn: ongoingTurn,
        ...(ongoingModel === undefined ? {} : { model: ongoingModel }),
        steps: ongoingCell.steps,
        llmMs: ongoingCell.llmMs,
        toolMs: ongoingCell.toolMs,
        waitMs: ongoingCell.waitMs,
        uncachedInputTokens: ongoingCell.totals.uncachedInputTokens,
        outputTokens: ongoingCell.totals.outputTokens,
        cacheReadTokens: ongoingCell.totals.cacheReadTokens,
        cacheWriteTokens: ongoingCell.totals.cacheWriteTokens,
        cost: cost.cost,
        cacheHitPercent: billed === 0 ? null : Math.round(ongoingCell.totals.cacheReadTokens / billed * 10000) / 100,
      }
    }
    return { turns, totals, ongoing }
  }

  /** The billing buckets of one session, zeroed when the projection is unavailable. */
  private usageOf(session: Session): CostBuckets {
    const registry = this.ctx.get('sessionProjections') as
      | { snapshot(s: Session): { values: Partial<Record<string, unknown>> } }
      | undefined
    let usage: TokenUsageProjection | undefined
    if (registry !== undefined) {
      const value = registry.snapshot(session).values.tokenUsage
      if (value !== null && typeof value === 'object') usage = value as TokenUsageProjection
    }
    return usage ?? ZERO_BUCKETS
  }

  /** Price one usage record into the full cost snapshot shared by live and cold sessions. */
  private costFromBuckets(buckets: CostBuckets, pricingKey: 'flash' | 'pro', model?: string): SessionCost {
    const config = this.effectiveCostConfig(pricingKey)
    const cost = costOfUsage({
      inputTokens: buckets.uncachedInputTokens,
      outputTokens: buckets.outputTokens,
      cacheReadTokens: buckets.cacheReadTokens,
      cacheWriteTokens: buckets.cacheWriteTokens,
    }, config)
    return {
      ...buckets,
      cost,
      currency: config.currency,
      pricingKey,
      ...(model === undefined ? {} : { model }),
      breakdown: {
        input: costOfTokens(buckets.uncachedInputTokens, config.inputPerMillion),
        cacheRead: costOfTokens(buckets.cacheReadTokens, config.cacheReadPerMillion),
        cacheWrite: costOfTokens(buckets.cacheWriteTokens, config.cacheWritePerMillion),
        output: costOfTokens(buckets.outputTokens, config.outputPerMillion),
      },
    }
  }

  /**
   * Resolve the pricing preset (and the raw model id, when known) for this
   * session. An explicit configured `model` (`flash`/`pro`) wins over
   * auto-detection; otherwise (`auto`) the session's request header model id is
   * mapped to a preset, falling back to flash when no header exists or the id
   * is not a known DeepSeek family.
   * @param session - the session whose model to resolve.
   */
  private resolveModelForSession(session: Session): { model?: string; pricingKey: 'flash' | 'pro' } {
    if (this.model !== 'auto') return { pricingKey: this.model }
    const header = typeof session.requestHeader === 'function' ? session.requestHeader() : undefined
    const modelId = header?.config?.model
    if (typeof modelId === 'string' && modelId.length > 0) {
      const lower = modelId.toLowerCase()
      if (lower.includes('pro')) return { model: modelId, pricingKey: 'pro' }
      if (lower.includes('flash')) return { model: modelId, pricingKey: 'flash' }
    }
    return { pricingKey: 'flash' }
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
  async modelCatalog(): Promise<{ models: Map<string, string>; providers: Map<string, string>; modelProviders: Map<string, string> }> {
    const now = Date.now()
    const cached = this.modelNamesCache
    if (cached !== undefined && now - cached.at < MODEL_NAMES_TTL_MS) return cached.value
    const models = new Map<string, string>()
    const providers = new Map<string, string>()
    /** 模型 id → 提供方 id：0.2.0 桌面版客户端拿不到每轮的 provider，用目录反查。 */
    const modelProviders = new Map<string, string>()
    const llm = this.ctx.get('llm') as
      | {
          listProviders?: () => { id?: unknown; name?: unknown }[]
          listModels?: (provider: string) => Promise<{ id?: unknown; name?: unknown }[]>
        }
      | undefined
    if (llm !== undefined && typeof llm.listProviders === 'function' && typeof llm.listModels === 'function') {
      let roster: { id?: unknown; name?: unknown }[] = []
      try {
        roster = llm.listProviders()
      } catch {
        roster = []
      }
      for (const provider of roster) {
        if (typeof provider?.id !== 'string' || provider.id.length === 0) continue
        providers.set(provider.id, typeof provider.name === 'string' && provider.name.length > 0 ? provider.name : provider.id)
        try {
          const list = await llm.listModels(provider.id)
          for (const model of list) {
            if (typeof model?.id !== 'string' || model.id.length === 0) continue
            models.set(model.id, typeof model.name === 'string' && model.name.length > 0 ? model.name : model.id)
            modelProviders.set(model.id, provider.id)
          }
        } catch {
          // 单个提供方目录不可用不影响其它提供方，也不影响金额计算。
        }
      }
    }
    const value = { models, providers, modelProviders }
    this.modelNamesCache = { at: now, value }
    return value
  }

  /**
   * 最近活跃的会话 id（按会话日志文件的修改时间挑最新的那个）。
   * 0.2.0 桌面版的客户端不一定拿得到 sessionId，客户端不带 session 参数时用它兜底，
   * 这样「本轮金额 / 用时 / 提供方」在桌面版也能显示。
   * @returns 会话 id；一个都读不到时 undefined。
   */
  mostRecentSessionId(): string | undefined {
    try {
      const home = (process.env.DSH_HOME ?? 'C:\\Users\\lin\\.dsh').replace(/\\/g, '/')
      const root = home + '/sessions'
      let best: { id: string; at: number } | undefined
      for (const slug of readdirSync(root)) {
        for (const id of readdirSync(root + '/' + slug)) {
          try {
            for (const file of readdirSync(root + '/' + slug + '/' + id)) {
              if (!file.startsWith('session.v')) continue
              const at = statSync(root + '/' + slug + '/' + id + '/' + file).mtimeMs
              if (best === undefined || at > best.at) best = { id, at }
            }
          } catch {
            // 单个会话目录读不到就跳过
          }
        }
      }
      return best?.id
    } catch {
      return undefined
    }
  }

  /**
   * 活动模型目录的 id → 显示名映射（见 {@link modelCatalog}）。
   * @returns 模型 id 到显示名的映射；目录不可用时为空 Map。
   */
  async modelNames(): Promise<Map<string, string>> {
    return (await this.modelCatalog()).models
  }

  /**
   * 提供方 id → 显示名映射（例如 deepseek-official → DeepSeek）。
   * @returns 提供方 id 到显示名的映射；目录不可用时为空 Map。
   */
  async providerNames(): Promise<Map<string, string>> {
    return (await this.modelCatalog()).providers
  }

  /** 目录名缓存（见 {@link modelCatalog}）。 */
  private modelNamesCache: { at: number; value: { models: Map<string, string>; providers: Map<string, string>; modelProviders: Map<string, string> } } | undefined

  /** 新模型发现缓存（见 {@link discoveredModels}）。 */
  private discoveredCache: { at: number; value: string[] } | undefined

  /**
   * 供应商自己广告的模型 id 列表（`GET {baseUrl}/models`，OpenAI 兼容）。
   * 用来发现「还没写进设置」的新模型：设置里那份清单决定选择器里有什么，
   * 这个接口决定供应商现在到底提供了什么。结果缓存 6 小时，点击余额即刷新。
   * @returns 供应商广告的模型 id（失败时为空数组）。
   */
  async discoveredModels(): Promise<string[]> {
    const now = Date.now()
    const cached = this.discoveredCache
    if (cached !== undefined && now - cached.at < MODEL_DISCOVERY_TTL_MS) return cached.value
    let ids: string[] = []
    try {
      const key = await this.resolveApiKey()
      if (key !== undefined && key.length > 0) {
        const { origin, prefix } = parseBaseUrl(this.baseUrl)
        const response = await fetch(`${origin}${prefix}/models`, {
          headers: { authorization: `Bearer ${key}` },
        })
        if (response.ok) {
          const body = (await response.json()) as { data?: unknown }
          const rows = Array.isArray(body.data) ? body.data : []
          ids = rows
            .map((row) => (row !== null && typeof row === 'object' ? (row as { id?: unknown }).id : undefined))
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        }
      }
    } catch {
      ids = []
    }
    this.discoveredCache = { at: now, value: ids }
    return ids
  }

  /**
   * 供应商广告、但设置里还没有的模型 id（「发现新模型」）。
   * @returns 未配置的模型 id 列表，按字母序；没有新模型时为空数组。
   */
  async unconfiguredModels(): Promise<string[]> {
    const [discovered, catalog] = await Promise.all([this.discoveredModels(), this.modelCatalog()])
    return discovered.filter((id) => !catalog.models.has(id)).sort()
  }

  private effectiveCostConfig(pricingKey: 'flash' | 'pro' = 'flash'): ReturnType<typeof resolveCostConfig> {
    const snapshot = this.pricingSnapshot
    if (snapshot !== undefined && snapshot.error === undefined) {
      const prices = snapshot.current[pricingKey]
      let cacheRead = prices.cacheReadPerMillion
      let input = prices.inputPerMillion
      let output = prices.outputPerMillion
      // The peak-pricing table only takes effect after the official rollout
      // date (2026-08-17 00:00 Beijing). Before that, the current single
      // prices remain authoritative even though the page already lists the
      // upcoming table.
      const peak = snapshot.peak?.[pricingKey]
      if (peak !== undefined && Date.now() >= PEAK_PRICING_START_MS) {
        const band = isPeakHour() ? peak.peak : peak.offPeak
        cacheRead = band.cacheReadPerMillion
        input = band.inputPerMillion
        output = band.outputPerMillion
      }
      return resolveCostConfig({
        inputPerMillion: input,
        cacheReadPerMillion: cacheRead,
        outputPerMillion: output,
        currency: this.userCostOverrides?.currency ?? this.modelCost(pricingKey).currency,
      })
    }
    return resolveCostConfig({
      inputPerMillion: this.applyOverride(pricingKey, 'inputPerMillion'),
      cacheReadPerMillion: this.applyOverride(pricingKey, 'cacheReadPerMillion'),
      cacheWritePerMillion: pricingKey === 'pro' ? PRO_COST_CONFIG.cacheWritePerMillion : FLASH_COST_CONFIG.cacheWritePerMillion,
      outputPerMillion: this.applyOverride(pricingKey, 'outputPerMillion'),
      currency: this.userCostOverrides?.currency ?? this.modelCost(pricingKey).currency,
    })
  }

  /** One preset field, with any explicit user override applied. */
  private applyOverride(
    pricingKey: 'flash' | 'pro',
    field: 'inputPerMillion' | 'cacheReadPerMillion' | 'outputPerMillion',
  ): number {
    const override = this.userCostOverrides?.[field]
    if (typeof override === 'number') return override
    return this.modelCost(pricingKey)[field]
  }

  /** The built-in preset prices for one model. */
  private modelCost(pricingKey: 'flash' | 'pro'): Required<CostConfig> {
    return pricingKey === 'pro' ? PRO_COST_CONFIG : FLASH_COST_CONFIG
  }

  /**
   * Re-fetch the official pricing page and update the effective cost config.
   * Failures keep the previous snapshot (or the built-in preset) and record
   * the error so the client can surface it.
   */
  async refreshPricing(): Promise<void> {
    this.pricingSnapshot = await fetchPricing()
  }

  /** Current pricing snapshot (for diagnostics / client display). */
  pricingInfo(): PricingSnapshot | undefined {
    return this.pricingSnapshot
  }

  /** The pricing preset (flash / pro) in effect for one session. */
  pricingKeyFor(session: Session): 'flash' | 'pro' {
    return this.resolveModelForSession(session).pricingKey
  }

  /**
   * Current pricing band + input multiplier for one model (client display).
   * Band is 'peak' only during a Beijing peak window (Mon-Fri 09:00-12:00 /
   * 14:00-18:00, weekends are NOT peak) AND the official peak table gives an
   * input multiplier > 1; otherwise 'offPeak' (multiplier 1).
   * @param pricingKey - the model preset to price for (`flash` or `pro`).
   */
  pricingBand(pricingKey: 'flash' | 'pro' = 'pro'): { band: 'peak' | 'offPeak'; inputMultiplier: number } {
    let inputMultiplier = 1
    const snapshot = this.pricingSnapshot
    if (snapshot !== undefined && snapshot.error === undefined && snapshot.peak !== undefined) {
      const p = snapshot.peak[pricingKey]
      if (p !== undefined && p.offPeak.inputPerMillion > 0) {
        inputMultiplier = p.peak.inputPerMillion / p.offPeak.inputPerMillion
      }
    }
    const peakWindow = Date.now() >= PEAK_PRICING_START_MS && isPeakHour()
    const band = peakWindow && inputMultiplier > 1 ? 'peak' : 'offPeak'
    return { band, inputMultiplier: band === 'peak' ? inputMultiplier : 1 }
  }

  private async query(): Promise<BalanceView> {
    const key = await this.resolveApiKey()
    const fetchedAt = Date.now()
    if (key === undefined) {
      return {
        fetchedAt,
        available: false,
        balances: [],
        error: `no API key (store ${this.apiKeyEnv} via the credentials seam, or export it in the environment)`,
      }
    }
    try {
      const { origin, prefix } = parseBaseUrl(this.baseUrl)
      const url = `${origin}${prefix}/user/balance`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      let response: Response
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            authorization: `Bearer ${key}`,
            accept: 'application/json',
          },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        return {
          fetchedAt,
          available: false,
          balances: [],
          error: `Get User Balance failed: HTTP ${response.status}${body ? ` — ${truncate(body, 200)}` : ''}`,
        }
      }
      const payload = await response.json() as Partial<BalanceResponse>
      const buckets: BalanceInfo[] = Array.isArray(payload.balance_infos)
        ? payload.balance_infos.map((b) => ({
          currency: String(b.currency ?? ''),
          total_balance: String(b.total_balance ?? '0'),
          granted_balance: String(b.granted_balance ?? '0'),
          topped_up_balance: String(b.topped_up_balance ?? '0'),
        })).filter((b) => b.currency !== '')
        : []
      const total = buckets.length === 1
        ? Number(buckets[0]!.total_balance)
        : undefined
      return {
        fetchedAt,
        available: payload.is_available !== false,
        balances: buckets,
        ...(total === undefined || Number.isNaN(total) ? {} : { total, currency: buckets[0]!.currency }),
      }
    } catch (error) {
      return {
        fetchedAt,
        available: false,
        balances: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** Resolve the current API key through the credentials seam or the environment. */
  private async resolveApiKey(): Promise<string | undefined> {
    const credentials = this.ctx.get('credentials') as { resolve(ref: CredentialRef): Promise<{ value: string } | undefined> } | undefined
    if (credentials !== undefined) {
      const hit = await credentials.resolve(this.apiKeyEnv)
      if (hit !== undefined && hit.value.length > 0) return hit.value
    }
    const ambient = this.ctx.get('launchEnvironment') as
      | { get(name: string): { value: string } | undefined }
      | undefined
    const value = ambient?.get(String(this.apiKeyEnv))
    if (value !== undefined && value.value.length > 0) return value.value
    const envFallback = (process.env as Record<string, string | undefined>)[String(this.apiKeyEnv)]
    if (typeof envFallback === 'string' && envFallback.length > 0) return envFallback
    return undefined
  }
}

/** Bound a provider error body for reporting. */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}..`
}
