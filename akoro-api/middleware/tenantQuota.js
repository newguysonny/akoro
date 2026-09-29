/**
 * middleware/tenantQuota.js — enforce the per-school quota (plan §3.2).
 *
 * Mounts globally before the routes. Requests from a SCHOOL site carry that
 * school's Origin (or Referer) — those are counted against the school's
 * tier quota. Everything else (our own apps, server-to-server webhooks,
 * monitors) has no school attribution and passes through untouched.
 *
 * Exempt even when over quota: /health and /api/auth/* — per the plan's
 * priority order, a school past its quota still gets logins and refreshes;
 * the quota throttles workload, not identity.
 *
 * Env: TENANT_QUOTA=off disables the middleware entirely.
 */
import {
  quotaForSchool, resetSec, countRequest, schoolForHost,
  refreshQuotaHostCache, quotaCacheReady,
} from "../lib/tenantQuota.js";

const EXEMPT_PREFIXES = ["/health", "/ready", "/api/auth"];

const hostFromRequest = (req) => {
  const origin = req.headers?.origin;
  if (origin && /^https?:\/\//i.test(origin)) {
    try { return new URL(origin).hostname; } catch { /* fall through */ }
  }
  const referer = req.headers?.referer;
  if (referer && /^https?:\/\//i.test(referer)) {
    try { return new URL(referer).hostname; } catch { /* fall through */ }
  }
  return null;
};

export function createTenantQuotaMiddleware({
  count = countRequest,
  schoolLookup = schoolForHost,
  cacheReady = quotaCacheReady,
} = {}) {
  // Background refresh; never blocks a request on a DB read.
  let refreshing = false;
  const timer = setInterval(async () => {
    if (refreshing) return;
    refreshing = true;
    try { await refreshQuotaHostCache(); }
    catch (e) { console.warn("[quota] host cache refresh failed:", e.message); }
    finally { refreshing = false; }
  }, 60_000);
  timer.unref?.();
  refreshQuotaHostCache().catch(() => {});

  const trippedLog = new Map();   // schoolId → minuteBucket last logged

  return function tenantQuota(req, res, next) {
    if (process.env.TENANT_QUOTA === "off") return next();
    // Until the cache has loaded once we cannot attribute anything — allowing
    // is correct (fail-open), same as when Redis is unreachable.
    if (!cacheReady()) return next();
    if (EXEMPT_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();

    const host = hostFromRequest(req);
    if (!host) return next();
    const school = schoolLookup(host);
    if (!school) return next();

    const limit = quotaForSchool(school);
    count(school).then(({ ok, count } = {}) => {
      // Always tell the client where it stands — a quota you cannot see is
      // a quota you cannot respect.
      res.setHeader("X-Quota-Limit", String(limit));
      if (ok) {
        res.setHeader("X-Quota-Remaining", String(Math.max(0, limit - count)));
        res.setHeader("X-Quota-Reset", String(resetSec()));
        if (count > limit) {
          const bucket = `${school.id}:${Math.floor(Date.now() / 60_000)}`;
          if (trippedLog.get(school.id) !== bucket) {
            trippedLog.set(school.id, bucket);
            console.warn(`[quota] school ${school.id} (${school.slug ?? "?"}) over limit: ${count}/${limit} req/min — 429`);
          }
          res.setHeader("Retry-After", String(resetSec()));
          return res.status(429).json({
            success: false,
            message: "Your school has reached its API limit for this minute — please retry shortly.",
            code: "tenant_quota_exceeded",
          });
        }
      }
      next();
    }).catch(() => next());
  };
}
