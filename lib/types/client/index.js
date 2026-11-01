/**
 * dsh-balance-meter browser half — registers the DeepSeek account balance chip into
 * the composer dock band (`conversation.composer.dock`, the same seat the
 * official conversation stats line uses) and reads the host's same-origin
 * `/api/balance` JSON endpoints: poll the host snapshot (~30 s), refresh on
 * demand. The chip shows the account total balance and availability; while
 * the host reports no usable balance (disabled, missing key, or provider
 * error) it renders a compact unavailable state with a manual refresh action.
 * @module dsh-balance-meter/client
 */
import { BalanceDockEntry } from "./BalanceDockEntry.js";
import { en, zh } from "./locales.js";
export { BalanceDockEntry } from "./BalanceDockEntry.js";
/** Dictionary namespace owned by this plugin. */
const NS = 'balance';
/** Required services: slots for the composer-dock entry, locale for the copy. */
export const inject = ['slots', 'locale', 'connection'];
/**
 * Register the balance chip into the composer dock band.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-balance-meter: dictionaries');
    /*
     * 只依赖 slots：0.2.0 起客户端不再提供 "conversation" 服务（ui-conversation 改用
     * uiSession.provide），继续 inject 它会永远等不到回调，chip 就完全不会注册。
     * 槽位声明可能晚于本插件，因此沿用 250ms 重试（与 statsline 同一策略）。
     */
    ctx.inject(['slots'], (scope) => {
        let disposable;
        let timer;
        let attempts = 0;
        const attempt = () => {
            if (disposable !== undefined)
                return;
            attempts += 1;
            try {
                disposable = scope.slots.register({
                    name: 'conversation.composer.dock',
                    id: 'balance',
                    order: 120,
                    locale: NS,
                    inject: () => ({}),
                }, BalanceDockEntry);
                try {
                    localStorage.setItem('dsh-balance-meter:beacon', 'registered@' + new Date().toISOString());
                }
                catch {
                    /* 浏览器禁用 localStorage 时忽略 */
                }
                return;
            }
            catch {
                if (attempts < 60)
                    timer = setTimeout(attempt, 250);
            }
        };
        scope.effect(() => () => {
            if (timer !== undefined)
                clearTimeout(timer);
            if (disposable !== undefined)
                disposable();
        }, 'dsh-balance-meter: chip registration');
        attempt();
    });
}
