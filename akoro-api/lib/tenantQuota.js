/**
 * lib/tenantQuota.js — per-school API quota (hardening plan §3.2).
 *
 * A school is the tenant that can be a noisy neighbor: every learner on
 * <slug>.akoro.app hits the SAME shared API. Quota keying on user or IP
 * can't see that — one classroom is thirty "users" — so attribution is by
 * the school site's Origin header against a host→school cache (school
 * slugs + verified custom domains, refreshed in the background; never a
 * DB query on the request path).
 *
 * Counting is a Redis fixed-window per school per minute. Redis being down
 * fails OPEN: quota is noisy-neighbor protection, not a gate worth breaking
 * the API over.
 *
 * Limits are generous by design — a classroom bursting together lands
 * around ~300 req/min, so the lowest tier starts at 2× that:
 *   pilot 600 / freemium 1200 / premium 3000 requests per minute
 * overridable per school (school_profiles.api_quota_per_min) and per tier
 * (QUOTA_<TIER>_PER_MIN), matching the Admin tier model (school tiers:
 * Pilot, Freemium, Premium; custom tier names fall back to pilot-level).
 */
import Redis        from "ioredis";
import db           from "../db.js";
import { redisConnectionOptions } from "./redisOptions.js";
import { traceRedis }              from "./redisTrace.js";
import { SITE_BASE_DOMAINS }       from "../modules/school/tenant.js";

/** Pure: the requests/minute a school gets. Test-covered. */
export function quotaForSchool(school) {
  const override = Number(school?.api_quota_per_min);
  if (Number.isFinite(override) && override > 0) return Math.floor(override);
  const tier = String(school?.plan_tier || "").toLowerCase();
  const envKey = { pilot: "QUOTA_PILOT_PER_MIN", freemium: "QUOTA_FREEMIUM_PER_MIN", premium: "QUOTA_PREMIUM_PER_MIN" }[tier];
  if (envKey) {
    const v = Number(process.env[envKey]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  const TIER_DEFAULTS = { pilot: 600, freemium: 1200, premium: 3000 };
  return TIER_DEFAULTS[tier] ?? 600;
}

/** Pure: the UTC-minute bucket label for a timestamp. */
export function minuteBucket(d = new Date()) {
  return d.toISOString().slice(0, 16).replace(/[-:]/g, "");
}

/** Pure: seconds until the current window rolls over. */
export function resetSec(d = new Date()) {
  return 60 - d.getUTCSeconds();
}

// ── host → school cache ───────────────────────────────────────────────────────
let hostMap = new Map();
let cacheEverLoaded = false;

export async function refreshQuotaHostCache() {
  const [schools, domains] = await Promise.all([
    db.from("school_profiles").select("id, slug, plan_tier, api_quota_per_min").not("slug", "is", null),
    db.schema("edu").from("school_domains").select("domain, school_id").eq("verified", true),
  ]);
  const byId = new Map((schools || []).map((s) => [s.id, s]));
  const next = new Map();
  for (const s of schools || []) next.set(String(s.slug).toLowerCase(), s);
  for (const d of domains || []) {
    const s = byId.get(d.school_id);
    if (s) next.set(String(d.domain).toLowerCase().replace(/^www\./, ""), s);
  }
  hostMap = next;
  cacheEverLoaded = true;
  return next.size;
}

/** The school for a host, or null. Slug subdomains and verified custom
 *  domains; port and www. handled. Never throws. */
export function schoolForHost(rawHost) {
  const host = String(rawHost || "").toLowerCase().split(":")[0].trim();
  if (!host) return null;
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  const direct = hostMap.get(bare) || hostMap.get(host);
  if (direct) return direct;
  for (const base of SITE_BASE_DOMAINS) {
    if (!bare.endsWith(`.${base}`)) continue;
    const sub = bare.slice(0, -(base.length + 1));
    if (sub && !sub.includes(".")) return hostMap.get(sub) || null;
  }
  return null;
}

/** Test hook: seed the host cache directly. */
export function _setQuotaHostCacheForTests(entries) {
  hostMap = new Map(entries);
  cacheEverLoaded = true;
}

export function quotaCacheReady() {
  return cacheEverLoaded;
}

// ── Redis fixed-window counter ────────────────────────────────────────────────
let redis = null;
let lastRedisErrorLog = 0;

function getRedis() {
  if (!redis) {
    redis = traceRedis(new Redis(process.env.REDIS_URL ?? "redis://localhost:6379",
      redisConnectionOptions({ label: "tenant-quota" })), "tenant-quota");
    redis.on("error", (e) => {
      // One line a minute, not one per request — the counter fails open, the
      // log must not become the flood it is reporting.
      if (Date.now() - lastRedisErrorLog > 60_000) {
        lastRedisErrorLog = Date.now();
        console.error("[quota/redis]", e.message, "(quota fails open while Redis is unreachable)");
      }
    });
  }
  return redis;
}

/**
 * Count one request for a school in its current minute window.
 * Returns { ok, count } — ok:false means the counter could not be reached
 * (caller must ALLOW, not block). `r` and `now` are injectable for tests.
 */
export async function countRequest(school, r = getRedis(), now = new Date()) {
  const key = `quota:school:${school.id}:${minuteBucket(now)}`;
  try {
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, 65);
    return { ok: true, count };
  } catch {
    return { ok: false };
  }
}
