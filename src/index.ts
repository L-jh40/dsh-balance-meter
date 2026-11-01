/**
 * dsh-balance-meter host half — mounts the balance service and its HTTP routes.
 * The browser half (the `./client` entry) reads the DeepSeek account balance
 * and the current session's estimated cost through the same-origin
 * `/api/balance` JSON endpoints. Install via
 * `dsh plugin --profile web add link:<dsh-web-ui>/packages/dsh-balance-meter`; the
 * cordis.patch.yml inserts this plugin row.
 * @module dsh-balance-meter
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  BalanceService,
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  type BalanceConfig,
} from './service.ts'
import { BALANCE_API_PREFIX, makeBalanceRoutes } from './routes.ts'

export { BalanceService } from './service.ts'
export type { BalanceConfig, BalanceInfo, BalanceResponse, BalanceView, PreviousTurnCost, SessionTurnStats, SessionCost, TurnUsageStats } from './service.ts'
export { BALANCE_API_PREFIX, makeBalanceRoutes } from './routes.ts'
export {
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_REFRESH_INTERVAL_SECONDS,
} from './service.ts'
export { resolveCostConfig, costOfUsage, costOfTokens, DEFAULT_COST_CONFIG, FLASH_COST_CONFIG, PRO_COST_CONFIG } from './cost.ts'
export type { CostBreakdown, CostConfig } from './cost.ts'
export { fetchPricing, isPeakHour, PRICING_URL } from './pricing.ts'
export type { ParsedPrices, PricingSnapshot } from './pricing.ts'

/** Settings namespace of the balance capability. */
export const BALANCE_SETTINGS_NAMESPACE = 'balance'

/**
 * 默认设置（原先这里导出一份 schemastery schema；仓库内没有任何消费者，
 * 为了让宿主端不依赖 @deepseek-ai/schemastery 的运行期解析，改成纯对象描述）。
 */
export const BALANCE_SETTINGS_DEFAULTS = {
  apiKeyEnv: DEFAULT_API_KEY_ENV,
  baseUrl: DEFAULT_BASE_URL,
  refreshIntervalSeconds: DEFAULT_REFRESH_INTERVAL_SECONDS,
  enabled: true,
} as const

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'balance'

/** Services required before the balance service can answer. */
export const inject = ['webServer', 'sessions']

/** Register the balance service and its API routes on the context. */
export function apply(ctx: Context, config: BalanceConfig = {}): void {
  const service = new BalanceService(ctx, config)

  const base: BalanceConfig = {
    apiKeyEnv: config.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    refreshIntervalSeconds: config.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS,
    ...(config.model === undefined ? {} : { model: config.model }),
    ...(config.cost === undefined ? {} : { cost: config.cost }),
    enabled: config.enabled ?? true,
  }
  // Resolve a session id to its cost snapshot. The sessions store is a
  // service in the inject list; the projection registry is read lazily inside
  // the service so a missing registry degrades to zeroed cost.
  const resolveSession = (id: string): { session: unknown; cost: ReturnType<BalanceService['sessionCost']> } | undefined => {
    const sessions = ctx.get('sessions') as { get(sid: string): { id: string } | undefined } | undefined
    const session = sessions?.get(id)
    if (session === undefined) return undefined
    return { session, cost: service.sessionCost(session as never) }
  }

  // The routes are registered while the plugin is enabled; toggling the
  // setting off makes the balance API disappear until it is re-enabled.
  const routes = makeBalanceRoutes(service, resolveSession)
  let disposeRoutes: (() => void) | undefined
  const syncRoutes = (): void => {
    const enabled = base.enabled ?? true
    if (disposeRoutes === undefined && enabled) {
      disposeRoutes = ctx.effect(
        () => {
          const disposers = routes.map((route) => ctx.webServer.register(route))
          return () => { for (const dispose of disposers) dispose() }
        },
        'balance: routes',
      )
    } else if (disposeRoutes !== undefined && !enabled) {
      disposeRoutes()
      disposeRoutes = undefined
    }
  }

  // NOTE: DSH 0.1.5 removed the host settings-section API
  // (`installSettingsSection`), so the optional settings card is dropped and
  // the plugin runs on its composition defaults.
  syncRoutes()
}
