/**
 * lib/r2Cors.js — will R2 take a PUT straight from this page's site (CORS)?
 * A browser upload to a presigned R2 URL is cross-origin: without a CORS rule
 * on the bucket for the app's origin, R2 refuses the preflight and the upload
 * fails in the browser even though the URL is valid (2026-10-19: the bucket
 * had no CORS rule). Asked with the same preflight a browser sends, cached
 * per origin for 10 minutes. No origin (a server or a gate calling) → yes.
 */
export const CORS_OK_MS = 10 * 60 * 1000;

export function makeOriginCheck({ enabled, url, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
  const byOrigin = new Map();   // origin → { ok, until }
  return async function acceptsOrigin(origin, { fetch: f = fetchImpl } = {}) {
    if (!origin || !enabled()) return true;
    const hit = byOrigin.get(origin);
    if (hit && now() < hit.until) return hit.ok;
    let ok = false;
    try {
      const res = await f(url(), {
        method: "OPTIONS", signal: AbortSignal.timeout(5000),
        headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
      });
      const allow = res.headers.get("access-control-allow-origin");
      ok = res.ok && (allow === "*" || allow === origin);
    } catch { ok = false; }
    if (!ok) log.warn?.(`[records/storage] R2 has no CORS rule for ${origin} — browser uploads from it go to the fallback (≤ 5 MB) until one is added`);
    byOrigin.set(origin, { ok, until: now() + CORS_OK_MS });
    return ok;
  };
}
