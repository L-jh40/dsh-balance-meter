/**
 * The composer dock entry: the DeepSeek account balance + session cost
 * readout, mounted in the composer dock band (`conversation.composer.dock`)
 * beside the official conversation stats line. The chip polls the host
 * `/api/balance` endpoint for the account total and `/api/balance/cost` for
 * the current session's estimated spend; clicking reveals the per-currency
 * balance breakdown and the cost breakdown.
 * @module dsh-balance-meter/client/BalanceDockEntry
 */

import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { BalanceView } from '../service.ts'
import { NS, zh } from './locales.ts'
import css from './balance.module.css'

/**
 * 0.2.0 桌面版的槽位可能不给 `t`（只传它自己声明的 props），这里用插件自带字典兜底，
 * 避免整块 chip 因为 `t` 缺失而抛错消失。
 * @param key - 文案键。
 * @param params - `{name}` 占位符替换表。
 * @returns 该语言下的文案，缺键时回落为键名。
 */
function localT(key: string, params?: Record<string, unknown>): string {
  const dict = zh as Record<string, string>
  let text = typeof dict[key] === 'string' ? dict[key] : key
  if (params !== undefined) {
    for (const name of Object.keys(params)) text = text.split('{' + name + '}').join(String(params[name]))
  }
  return text
}

/** Session cost response (host `/api/balance/cost`). */
interface SessionCostResponse {
  ok: boolean
  error?: string
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cost?: number
  currency?: string
  breakdown?: { input: number; cacheRead: number; cacheWrite: number; output: number }
  /** 上一轮对话（上一个已结束 turn）的消耗；尚未有完成对话轮时为 null。 */
  previous?: { turn?: number; cost?: number; currency?: string } | null
  /** 峰谷计价时段与输入价倍数（host 端按会话实际模型计算）。 */
  pricingBand?: { band: 'peak' | 'offPeak'; inputMultiplier?: number }
}

/** The host balance API as the browser sees it (same-origin JSON endpoints). */
/** Turns response (host `/api/balance/turns`): per-turn stats + ongoing turn. */
interface TurnsResponse {
  ok: boolean
  ongoing?: { turn?: number; steps?: number; llmMs?: number; toolMs?: number; waitMs?: number; cost?: number; cacheHitPercent?: number | null } | null
  totals?: {
    llmMs?: number
    toolMs?: number
    waitMs?: number
    uncachedInputTokens?: number
    outputTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    cost?: number
  } | null
}

interface BalanceHttpApi {
  view(): Promise<BalanceView>
  refresh(): Promise<BalanceView>
  cost(sessionId: string | undefined): Promise<SessionCostResponse>
  turns(sessionId: string | undefined): Promise<TurnsResponse>
}

/** Same-origin JSON fetch helper. */
async function balanceFetch<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`balance ${path} failed: ${response.status}`)
  }
  return (await response.json()) as T
}

/** The live host API instance (failures surface per call). */
const balanceApi: BalanceHttpApi = {
  view: () => balanceFetch('/api/balance'),
  refresh: () => balanceFetch('/api/balance/refresh'),
  cost: (sessionId) => balanceFetch(
    sessionId === undefined
      ? '/api/balance/cost'
      : `/api/balance/cost?session=${encodeURIComponent(sessionId)}`,
  ),
  turns: (sessionId) => balanceFetch(
    sessionId === undefined
      ? '/api/balance/turns'
      : `/api/balance/turns?session=${encodeURIComponent(sessionId)}`,
  ),
}

/** Poll interval for the host snapshot: 5 s — the balance read hits the host
 * 30 s cache window (no external request) and the cost read is a local fold,
 * so a short interval adds negligible load. */
const POLL_MS = 5_000

/** Composed props of the dock entry (runtime + locale). */
export type BalanceDockEntryProps =
  PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<typeof NS>

/** Format a number with up to two decimals (chip readout). */
function formatAmount(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '--'
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Format a cost with exactly four decimals (details panel: 本会话 / 上一轮). */
function formatAmountPrecise(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '--'
  return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

/** 显示用币种：CNY 统一显示为「元」（其它币种保留原代码）。 */
function currencyLabel(currency: string | undefined): string {
  if (currency === undefined) return ''
  return currency === 'CNY' ? '元' : currency
}

/** 4 significant digits with banker's rounding (四舍六入五看单双), no exponent.
 * 0.0000→0, 0.0010→0.001, 0.0001→0.0001, 4.8215→4.822, 48.07→48.07. */
function formatSig(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '--'
  if (value === 0) return '0'
  const sign = value < 0 ? '-' : ''
  const v = Math.abs(value)
  const exp = Math.floor(Math.log10(v))
  const scale = Math.pow(10, 3 - exp)
  // 先消浮点噪声（如 4821.499999…→4821.5），再按“五看单双”舍入
  const scaled = Number((v * scale).toFixed(9))
  const floor = Math.floor(scaled)
  const frac = scaled - floor
  const rounded = frac > 0.5 ? floor + 1 : frac < 0.5 ? floor : (floor % 2 === 0 ? floor : floor + 1)
  const result = rounded / scale
  return sign + String(Number(result.toPrecision(4)))
}

/** Compact duration: 45.2s under a minute, 2m42s from there on. */
function formatDuration(ms: number): string {
  const s = ms / 1e3
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Format an epoch-ms time as HH:MM:SS. */
function formatTime(epochMs: number): string {
  const d = new Date(epochMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/**
 * The account balance + session cost chip: polls the host balance snapshot
 * and the current session's cost, rendering the total balance and estimated
 * session spend. Clicking reveals the per-currency and per-bucket breakdown
 * and refreshes.
 * @param props - the composed dock entry props.
 */
export function BalanceDockEntry(props: BalanceDockEntryProps): React.ReactElement {
  /* t 兜底 + 渲染诊断（宿主侧读 localStorage 就能知道 chip 到底有没有渲染） */
  const t = typeof props.t === 'function' ? props.t : localT
  try {
    localStorage.setItem('dsh-balance-meter:render', String(typeof props.t) + '@' + new Date().toISOString())
  } catch {
    /* 无 localStorage 时忽略 */
  }
  /* DOM 诊断：chip 是否挂上、可见、同一行里还有谁（宿主侧读 localStorage 即可） */
  useEffect(() => {
    try {
      const slots = [...document.querySelectorAll('[data-slot="conversation.composer.dock"]')]
      const info = slots.map((slot) => {
        const rect = slot.getBoundingClientRect()
        const style = getComputedStyle(slot)
        const kids = [...slot.children].map((child) => String(child.className ?? child.tagName).slice(0, 70))
        return 'rect=' + Math.round(rect.width) + 'x' + Math.round(rect.height) + '@' + Math.round(rect.left) + ',' + Math.round(rect.top) + ' display=' + style.display + ' [' + kids.join(' | ') + ']'
      })
      localStorage.setItem('dsh-balance-meter:dom', (info.join(' || ') || 'no-slot') + '@' + new Date().toISOString())
    } catch {
      /* 忽略诊断失败 */
    }
  }, [])
  const [view, setView] = useState<BalanceView | null>(null)
  const [cost, setCost] = useState<SessionCostResponse | null>(null)
  const [turns, setTurns] = useState<TurnsResponse | null>(null)
  // 0 = 收起, 1 = 详情, 2 = 详情+本轮概览（再次点击回到收起）
  const [open, setOpen] = useState(0)
  /* 0.2.0 桌面版槽位不给 sessionId，但提供 useSession 会话 store（官方同款）。 */
  const storeSessionId = typeof props.useSession === 'function' ? props.useSession((s: { sessionId?: string } | undefined) => s?.sessionId) : undefined
  const sessionId = props.sessionId ?? storeSessionId

  const pollNow = useCallback(() => {
    let live = true
    balanceApi.view().then((snapshot) => {
      if (live) setView(snapshot)
    }, () => {
      if (live) setView(null)
    })
    balanceApi.cost(sessionId).then((snapshot) => {
      if (live) setCost(snapshot)
    }, () => {
      if (live) setCost(null)
    })
    balanceApi.turns(sessionId).then((snapshot) => {
      if (live) setTurns(snapshot)
    }, () => {
      if (live) setTurns(null)
    })
    return () => { live = false }
  }, [sessionId])

  useEffect(() => {
    // 可见时每 POLL_MS 轮询；隐藏时暂停（避免浏览器后台节流造成"无周期"），
    // 回到前台立即刷新并恢复定时。
    let timer: number | undefined
    const start = (): void => {
      if (timer !== undefined) window.clearInterval(timer)
      timer = window.setInterval(pollNow, POLL_MS)
    }
    const stop = (): void => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        pollNow()
        start()
      } else {
        stop()
      }
    }
    const cleanup = pollNow()
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cleanup()
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pollNow])

  const refresh = (): void => {
    balanceApi.refresh().then((snapshot) => {
      setView(snapshot)
    }, () => {
      // Ignore transport errors on manual refresh; the next poll resyncs.
    })
  }

  if (view === null || view.error !== undefined) {
    return (
      <button
        type="button"
        className={css.chip}
        onClick={refresh}
        title={view?.error ?? t('balance.error', { error: 'connection' })}
        data-testid="balance-chip-error"
      >
        <span className={css.dot} aria-hidden="true" />
        {t('balance.unavailable')}
      </button>
    )
  }

  const total = view.total
  const currency = view.currency ?? view.balances[0]?.currency
  const balanceLabel = total === undefined || currency === undefined
    ? t('balance.empty')
    : t('balance.total', { amount: formatAmount(total), currency: currencyLabel(currency) })
  const costLabel = cost?.ok === true && cost.cost !== undefined
    ? t('balance.cost', { amount: formatAmount(cost.cost), currency: currencyLabel(cost.currency ?? currency) })
    : undefined
  /*
   * 本轮：主机端 /turns 的 ongoing 就是「最近一轮」——还在进行时它跟着实时增长，
   * 空闲时它就是刚结束的那一轮。所以这一项不再用 /cost 的「上一轮（已结束）」，
   * 对话进行中也能一路涨到当前值（客户端 5s 轮询）。
   */
  const ongoingData = turns?.ok === true && turns.ongoing !== null && turns.ongoing !== undefined ? turns.ongoing : undefined
  const currentLabel = ongoingData?.cost !== undefined
    ? t('balance.previous', { amount: formatAmount(ongoingData.cost), currency: currencyLabel(currency) })
    : undefined

  return (
    <button
      type="button"
      className={`${css.chip} ${open > 0 ? css.chipOpen : ''}`}
      onClick={() => {
        setOpen(o => (o + 1) % 3)
        // 点击后立即更新：余额强制重新查询（绕过 host 缓存窗口）+ 成本/概览重拉
        refresh()
        pollNow()
      }}
      title={view.fetchedAt > 0 ? t('balance.fetchedAt', { time: formatTime(view.fetchedAt) }) : undefined}
      data-testid="balance-chip"
      aria-expanded={open > 0}
    >
      <span className={view.available ? css.dotOk : css.dot} aria-hidden="true" />
      {balanceLabel}
      {costLabel !== undefined && (
        <>
          <span className={css.sep} aria-hidden="true" />
          <span className={css.cost}>{costLabel}</span>
        </>
      )}
      {currentLabel !== undefined && (
        <>
          <span className={css.sep} aria-hidden="true" />
          <span className={css.cost}>{currentLabel}</span>
        </>
      )}
      {open === 1 && (
        <span className={css.details} role="tooltip">
          {cost?.ok === true && cost.pricingBand !== undefined && (
            <span className={`${css.costRow} ${css.bandRow}`}>
              <span>{cost.pricingBand.band === 'peak' ? t('balance.bandPeak') : t('balance.bandOffPeak')}</span>
              {cost.pricingBand.band === 'peak' && (
                <span className={css.rowRight}>
                  {t('balance.inputMultiplier', { n: String(formatSig(cost.pricingBand.inputMultiplier ?? 1)) })}
                </span>
              )}
            </span>
          )}
          {(view.balances ?? []).map((b) => (
            <span key={b.currency} className={css.row}>
              <span>{t('balance.balanceLabel')}</span>
              <span className={css.rowRight}>
                <span title={t('balance.granted')}>{formatSig(Number(b.granted_balance))}</span>
                <span>+</span>
                <span title={t('balance.toppedUp')}>{formatSig(Number(b.topped_up_balance))}</span>
                <span>&nbsp;{currencyLabel(b.currency)}</span>
              </span>
            </span>
          ))}
          {cost?.ok === true && cost.cost !== undefined && (
            <span className={css.costRow}>
              <span>{t('balance.sessionCost')}</span>
              <span className={css.rowRight}>
                <span>{formatAmountPrecise(cost.cost)}</span>
                <span>{currencyLabel(cost.currency ?? currency)}</span>
              </span>
            </span>
          )}
          {ongoingData?.cost !== undefined && (
            <span className={css.costRow}>
              <span>{t('balance.previousTurn')}</span>
              <span className={css.rowRight}>
                <span>{formatAmountPrecise(ongoingData.cost)}</span>
                <span>{currencyLabel(currency)}</span>
              </span>
            </span>
          )}
        </span>
      )}
      {open === 2 && (ongoingData !== undefined ? (
        <span className={css.details} role="tooltip">
          <span className={css.row}>
            <span>{t('balance.ongoing')}</span>
          </span>
          <span className={css.costRow}>
            <span className={css.rowRight}>
              {t('balance.times', {
                llm: formatDuration(ongoingData.llmMs ?? 0),
                tool: formatDuration(ongoingData.toolMs ?? 0),
                wait: formatDuration(ongoingData.waitMs ?? 0),
              })}
            </span>
          </span>
          <span className={css.costRow}>
            <span className={css.rowRight}>
              {ongoingData.cacheHitPercent !== null && ongoingData.cacheHitPercent !== undefined
                ? t('balance.cacheHitShort', { percent: String(ongoingData.cacheHitPercent) }) : ''}
              {ongoingData.cacheHitPercent !== null && ongoingData.cacheHitPercent !== undefined ? ' · ' : ''}
              {t('balance.amount', { amount: formatAmountPrecise(ongoingData.cost), currency: currencyLabel(cost?.currency ?? currency) })}
            </span>
          </span>
        </span>
      ) : (
        <span className={css.details} role="tooltip">
          <span className={css.row}>
            <span>{t('balance.noOngoing')}</span>
          </span>
        </span>
      ))}
    </button>
  )
}
