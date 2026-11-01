import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The composer dock entry: the DeepSeek account balance + session cost
 * readout, mounted in the composer dock band (`conversation.composer.dock`)
 * beside the official conversation stats line. The chip polls the host
 * `/api/balance` endpoint for the account total and `/api/balance/cost` for
 * the current session's estimated spend; clicking reveals the per-currency
 * balance breakdown and the cost breakdown.
 * @module dsh-balance-meter/client/BalanceDockEntry
 */
import { useCallback, useEffect, useState } from 'react';
import { zh } from "./locales.js";
import css from './balance.module.css';
/**
 * 0.2.0 桌面版的槽位可能不给 `t`（只传它自己声明的 props），这里用插件自带字典兜底，
 * 避免整块 chip 因为 `t` 缺失而抛错消失。
 * @param key - 文案键。
 * @param params - `{name}` 占位符替换表。
 * @returns 该语言下的文案，缺键时回落为键名。
 */
function localT(key, params) {
    const dict = zh;
    let text = typeof dict[key] === 'string' ? dict[key] : key;
    if (params !== undefined) {
        for (const name of Object.keys(params))
            text = text.split('{' + name + '}').join(String(params[name]));
    }
    return text;
}
/** Same-origin JSON fetch helper. */
async function balanceFetch(path) {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`balance ${path} failed: ${response.status}`);
    }
    return (await response.json());
}
/** The live host API instance (failures surface per call). */
const balanceApi = {
    view: () => balanceFetch('/api/balance'),
    refresh: () => balanceFetch('/api/balance/refresh'),
    cost: (sessionId) => balanceFetch(sessionId === undefined
        ? '/api/balance/cost'
        : `/api/balance/cost?session=${encodeURIComponent(sessionId)}`),
    turns: (sessionId) => balanceFetch(sessionId === undefined
        ? '/api/balance/turns'
        : `/api/balance/turns?session=${encodeURIComponent(sessionId)}`),
};
/** Poll interval for the host snapshot: 5 s — the balance read hits the host
 * 30 s cache window (no external request) and the cost read is a local fold,
 * so a short interval adds negligible load. */
const POLL_MS = 5_000;
/** Format a number with up to two decimals (chip readout). */
function formatAmount(value) {
    if (value === undefined || Number.isNaN(value))
        return '--';
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Format a cost with exactly four decimals (details panel: 本会话 / 上一轮). */
function formatAmountPrecise(value) {
    if (value === undefined || Number.isNaN(value))
        return '--';
    return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}
/** 显示用币种：CNY 统一显示为「元」（其它币种保留原代码）。 */
function currencyLabel(currency) {
    if (currency === undefined)
        return '';
    return currency === 'CNY' ? '元' : currency;
}
/** 4 significant digits with banker's rounding (四舍六入五看单双), no exponent.
 * 0.0000→0, 0.0010→0.001, 0.0001→0.0001, 4.8215→4.822, 48.07→48.07. */
function formatSig(value) {
    if (value === undefined || Number.isNaN(value))
        return '--';
    if (value === 0)
        return '0';
    const sign = value < 0 ? '-' : '';
    const v = Math.abs(value);
    const exp = Math.floor(Math.log10(v));
    const scale = Math.pow(10, 3 - exp);
    // 先消浮点噪声（如 4821.499999…→4821.5），再按“五看单双”舍入
    const scaled = Number((v * scale).toFixed(9));
    const floor = Math.floor(scaled);
    const frac = scaled - floor;
    const rounded = frac > 0.5 ? floor + 1 : frac < 0.5 ? floor : (floor % 2 === 0 ? floor : floor + 1);
    const result = rounded / scale;
    return sign + String(Number(result.toPrecision(4)));
}
/** Compact duration: 45.2s under a minute, 2m42s from there on. */
function formatDuration(ms) {
    const s = ms / 1e3;
    if (s < 60)
        return `${Math.round(s * 10) / 10}s`;
    const whole = Math.round(s);
    return `${Math.floor(whole / 60)}m${whole % 60}s`;
}
/** Format an epoch-ms time as HH:MM:SS. */
function formatTime(epochMs) {
    const d = new Date(epochMs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}
/**
 * The account balance + session cost chip: polls the host balance snapshot
 * and the current session's cost, rendering the total balance and estimated
 * session spend. Clicking reveals the per-currency and per-bucket breakdown
 * and refreshes.
 * @param props - the composed dock entry props.
 */
export function BalanceDockEntry(props) {
    /* t 兜底 + 渲染诊断（宿主侧读 localStorage 就能知道 chip 到底有没有渲染） */
    const t = typeof props.t === 'function' ? props.t : localT;
    try {
        localStorage.setItem('dsh-balance-meter:render', String(typeof props.t) + '@' + new Date().toISOString());
    }
    catch {
        /* 无 localStorage 时忽略 */
    }
    /* DOM 诊断：chip 是否挂上、可见、同一行里还有谁（宿主侧读 localStorage 即可） */
    useEffect(() => {
        try {
            const slots = [...document.querySelectorAll('[data-slot="conversation.composer.dock"]')];
            const info = slots.map((slot) => {
                const rect = slot.getBoundingClientRect();
                const style = getComputedStyle(slot);
                const kids = [...slot.children].map((child) => String(child.className ?? child.tagName).slice(0, 70));
                return 'rect=' + Math.round(rect.width) + 'x' + Math.round(rect.height) + '@' + Math.round(rect.left) + ',' + Math.round(rect.top) + ' display=' + style.display + ' [' + kids.join(' | ') + ']';
            });
            localStorage.setItem('dsh-balance-meter:dom', (info.join(' || ') || 'no-slot') + '@' + new Date().toISOString());
        }
        catch {
            /* 忽略诊断失败 */
        }
    }, []);
    const [view, setView] = useState(null);
    const [cost, setCost] = useState(null);
    const [turns, setTurns] = useState(null);
    // 0 = 收起, 1 = 详情, 2 = 详情+本轮概览（再次点击回到收起）
    const [open, setOpen] = useState(0);
    /* 0.2.0 桌面版槽位不给 sessionId，但提供 useSession 会话 store（官方同款）。 */
    const storeSessionId = typeof props.useSession === 'function' ? props.useSession((s) => s?.sessionId) : undefined;
    const sessionId = props.sessionId ?? storeSessionId;
    const pollNow = useCallback(() => {
        let live = true;
        balanceApi.view().then((snapshot) => {
            if (live)
                setView(snapshot);
        }, () => {
            if (live)
                setView(null);
        });
        balanceApi.cost(sessionId).then((snapshot) => {
            if (live)
                setCost(snapshot);
        }, () => {
            if (live)
                setCost(null);
        });
        balanceApi.turns(sessionId).then((snapshot) => {
            if (live)
                setTurns(snapshot);
        }, () => {
            if (live)
                setTurns(null);
        });
        return () => { live = false; };
    }, [sessionId]);
    useEffect(() => {
        // 可见时每 POLL_MS 轮询；隐藏时暂停（避免浏览器后台节流造成"无周期"），
        // 回到前台立即刷新并恢复定时。
        let timer;
        const start = () => {
            if (timer !== undefined)
                window.clearInterval(timer);
            timer = window.setInterval(pollNow, POLL_MS);
        };
        const stop = () => {
            if (timer !== undefined) {
                window.clearInterval(timer);
                timer = undefined;
            }
        };
        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                pollNow();
                start();
            }
            else {
                stop();
            }
        };
        const cleanup = pollNow();
        if (document.visibilityState === 'visible')
            start();
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            cleanup();
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [pollNow]);
    const refresh = () => {
        balanceApi.refresh().then((snapshot) => {
            setView(snapshot);
        }, () => {
            // Ignore transport errors on manual refresh; the next poll resyncs.
        });
    };
    if (view === null || view.error !== undefined) {
        return (_jsxs("button", { type: "button", className: css.chip, onClick: refresh, title: view?.error ?? t('balance.error', { error: 'connection' }), "data-testid": "balance-chip-error", children: [_jsx("span", { className: css.dot, "aria-hidden": "true" }), t('balance.unavailable')] }));
    }
    const total = view.total;
    const currency = view.currency ?? view.balances[0]?.currency;
    const balanceLabel = total === undefined || currency === undefined
        ? t('balance.empty')
        : t('balance.total', { amount: formatAmount(total), currency: currencyLabel(currency) });
    const costLabel = cost?.ok === true && cost.cost !== undefined
        ? t('balance.cost', { amount: formatAmount(cost.cost), currency: currencyLabel(cost.currency ?? currency) })
        : undefined;
    const previousCost = cost?.ok === true && cost.previous !== null && cost.previous !== undefined
        ? cost.previous
        : undefined;
    const previousLabel = previousCost?.cost !== undefined
        ? t('balance.previous', { amount: formatAmount(previousCost.cost), currency: currencyLabel(previousCost.currency ?? currency) })
        : undefined;
    // 本轮（进行中的对话）：第二次点击展开显示，不复用第一层内容
    const ongoingData = turns?.ok === true && turns.ongoing !== null && turns.ongoing !== undefined ? turns.ongoing : undefined;
    return (_jsxs("button", { type: "button", className: `${css.chip} ${open > 0 ? css.chipOpen : ''}`, onClick: () => {
            setOpen(o => (o + 1) % 3);
            // 点击后立即更新：余额强制重新查询（绕过 host 缓存窗口）+ 成本/概览重拉
            refresh();
            pollNow();
        }, title: view.fetchedAt > 0 ? t('balance.fetchedAt', { time: formatTime(view.fetchedAt) }) : undefined, "data-testid": "balance-chip", "aria-expanded": open > 0, children: [_jsx("span", { className: view.available ? css.dotOk : css.dot, "aria-hidden": "true" }), balanceLabel, costLabel !== undefined && (_jsxs(_Fragment, { children: [_jsx("span", { className: css.sep, "aria-hidden": "true" }), _jsx("span", { className: css.cost, children: costLabel })] })), previousLabel !== undefined && (_jsxs(_Fragment, { children: [_jsx("span", { className: css.sep, "aria-hidden": "true" }), _jsx("span", { className: css.cost, children: previousLabel })] })), open === 1 && (_jsxs("span", { className: css.details, role: "tooltip", children: [cost?.ok === true && cost.pricingBand !== undefined && (_jsxs("span", { className: `${css.costRow} ${css.bandRow}`, children: [_jsx("span", { children: cost.pricingBand.band === 'peak' ? t('balance.bandPeak') : t('balance.bandOffPeak') }), cost.pricingBand.band === 'peak' && (_jsx("span", { className: css.rowRight, children: t('balance.inputMultiplier', { n: String(formatSig(cost.pricingBand.inputMultiplier ?? 1)) }) }))] })), (view.balances ?? []).map((b) => (_jsxs("span", { className: css.row, children: [_jsx("span", { children: t('balance.balanceLabel') }), _jsxs("span", { className: css.rowRight, children: [_jsx("span", { title: t('balance.granted'), children: formatSig(Number(b.granted_balance)) }), _jsx("span", { children: "+" }), _jsx("span", { title: t('balance.toppedUp'), children: formatSig(Number(b.topped_up_balance)) }), _jsxs("span", { children: ["\u00A0", currencyLabel(b.currency)] })] })] }, b.currency))), cost?.ok === true && cost.cost !== undefined && (_jsxs("span", { className: css.costRow, children: [_jsx("span", { children: t('balance.sessionCost') }), _jsxs("span", { className: css.rowRight, children: [_jsx("span", { children: formatAmountPrecise(cost.cost) }), _jsx("span", { children: currencyLabel(cost.currency ?? currency) })] })] })), previousCost?.cost !== undefined && (_jsxs("span", { className: css.costRow, children: [_jsx("span", { children: t('balance.previousTurn') }), _jsxs("span", { className: css.rowRight, children: [_jsx("span", { children: formatAmountPrecise(previousCost.cost) }), _jsx("span", { children: currencyLabel(previousCost.currency ?? currency) })] })] }))] })), open === 2 && (ongoingData !== undefined ? (_jsxs("span", { className: css.details, role: "tooltip", children: [_jsx("span", { className: css.row, children: _jsx("span", { children: t('balance.ongoing') }) }), _jsx("span", { className: css.costRow, children: _jsx("span", { className: css.rowRight, children: t('balance.times', {
                                llm: formatDuration(ongoingData.llmMs ?? 0),
                                tool: formatDuration(ongoingData.toolMs ?? 0),
                                wait: formatDuration(ongoingData.waitMs ?? 0),
                            }) }) }), _jsx("span", { className: css.costRow, children: _jsxs("span", { className: css.rowRight, children: [ongoingData.cacheHitPercent !== null && ongoingData.cacheHitPercent !== undefined
                                    ? t('balance.cacheHitShort', { percent: String(ongoingData.cacheHitPercent) }) : '', ongoingData.cacheHitPercent !== null && ongoingData.cacheHitPercent !== undefined ? ' · ' : '', t('balance.amount', { amount: formatAmountPrecise(ongoingData.cost), currency: currencyLabel(cost?.currency ?? currency) })] }) })] })) : (_jsx("span", { className: css.details, role: "tooltip", children: _jsx("span", { className: css.row, children: _jsx("span", { children: t('balance.noOngoing') }) }) })))] }));
}
