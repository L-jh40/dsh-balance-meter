/**
 * dsh-balance-meter HTTP routes — the browser half talks to the host through plain
 * same-origin JSON endpoints (`/api/balance` and `/api/balance/cost`), which
 * the host answers by querying the DeepSeek Get User Balance endpoint and the
 * session token-usage projection. The client never sees the API key.
 * @module dsh-balance-meter/routes
 */
import { appendFileSync } from 'node:fs';
/** Browser-facing base path of the balance API. */
export const BALANCE_API_PREFIX = '/api/balance';
/** Write one JSON response. */
function json(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}
/** Require the method or answer 405. */
function requireMethod(req, res, method) {
    if (req.method === method)
        return true;
    json(res, 405, { ok: false, error: 'method-not-allowed' });
    return false;
}
/** Wrap one async balance read as a GET JSON route. */
function getRoute(path, run) {
    return {
        kind: 'exact',
        path,
        handler: (req, res) => {
            if (!requireMethod(req, res, 'GET'))
                return;
            Promise.resolve(run()).then((value) => json(res, 200, value), (error) => {
                json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            });
        },
    };
}
/** Wrap one request-aware JSON route (e.g. the session-cost read). */
function getRequestRoute(path, run) {
    return {
        kind: 'exact',
        path,
        handler: (req, res) => {
            if (!requireMethod(req, res, 'GET'))
                return;
            Promise.resolve(run(req)).then((value) => json(res, 200, value), (error) => {
                json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            });
        },
    };
}
/** Read the `session` query parameter from the request URL. */
function sessionParam(req) {
    const raw = req.url ?? '';
    const q = raw.indexOf('?');
    if (q < 0)
        return undefined;
    const params = new URLSearchParams(raw.slice(q + 1));
    const value = params.get('session');
    return value === null || value === '' ? undefined : value;
}
/**
 * Build the full balance API route family for one service.
 * @param service - the balance service.
 * @param resolveSession - resolve a session id to the session (undefined when absent).
 */
export function makeBalanceRoutes(service, resolveSession) {
    return [
        /*
         * 浏览器端自报家门：把「客户端代码版本 + 现场 DOM 情况」写到文件里，
         * 这样即使拿不到浏览器控制台，也能确认页面里到底跑的是哪一版插件。
         */
        getRequestRoute(`${BALANCE_API_PREFIX}/client-report`, async (req) => {
            const query = new URLSearchParams((req.url ?? '').slice((req.url ?? '').indexOf('?') + 1));
            const tag = query.get('tag') ?? 'unknown';
            const info = query.get('info') ?? '';
            try {
                appendFileSync('C:/Users/lin/.dsh/balance-client-report.log', new Date().toISOString() + ' | ' + tag + ' | ' + info + '\n');
            }
            catch {
                // 落盘失败不影响插件
            }
            return { ok: true };
        }),
        getRoute(`${BALANCE_API_PREFIX}`, async () => {
            const view = await service.view();
            // 顺带回报「供应商有、设置里还没有」的新模型（点击刷新会一并重取）。
            let discovered = [];
            try {
                discovered = await service.unconfiguredModels();
            }
            catch {
                discovered = [];
            }
            return discovered.length === 0 ? view : { ...view, discovered };
        }),
        getRoute(`${BALANCE_API_PREFIX}/refresh`, () => service.refresh()),
        getRequestRoute(`${BALANCE_API_PREFIX}/turns`, async (req) => {
            // 客户端（0.2.0 桌面版）拿不到 sessionId 时不带参数，这里回落到最近活跃的会话。
            const id = sessionParam(req) ?? service.mostRecentSessionId();
            if (id === undefined)
                return { ok: false, error: 'missing-session' };
            const resolved = resolveSession(id);
            if (resolved === undefined)
                return { ok: false, error: 'unknown-session' };
            const stats = service.turnStats(resolved.session);
            // 模型/提供方补上「活动目录里的显示名」：路由里记的只是 id，名字改过也不会失真。
            let models;
            let providers;
            let modelProviders;
            try {
                const catalog = await service.modelCatalog();
                models = catalog.models;
                providers = catalog.providers;
                modelProviders = catalog.modelProviders;
            }
            catch {
                models = new Map();
                providers = new Map();
                modelProviders = new Map();
            }
            const turns = stats.turns.map((turn) => {
                if (turn.model === undefined)
                    return turn;
                const name = models.get(turn.model);
                return name === undefined || name === turn.model ? turn : { ...turn, modelName: name };
            });
            return {
                ok: true,
                ...stats,
                turns,
                modelNames: Object.fromEntries(models),
                providerNames: Object.fromEntries(providers),
                modelProviders: Object.fromEntries(modelProviders),
            };
        }),
        getRequestRoute(`${BALANCE_API_PREFIX}/cost`, async (req) => {
            const id = sessionParam(req) ?? service.mostRecentSessionId();
            if (id === undefined)
                return { ok: false, error: 'missing-session' };
            const resolved = resolveSession(id);
            if (resolved === undefined)
                return { ok: false, error: 'unknown-session' };
            // “上一场”= 当前会话内上一个已结束对话轮（turn）的消耗，由 host 端
            // 从会话事件流按 turn 统计（token-meter 语义），浏览器只拿结果。
            const previous = service.previousTurnCost(resolved.session);
            return { ok: true, ...resolved.cost, previous: previous ?? null, pricingBand: service.pricingBand(service.pricingKeyFor(resolved.session)) };
        }),
    ];
}
