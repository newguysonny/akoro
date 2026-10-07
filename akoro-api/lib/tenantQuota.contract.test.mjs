// lib/tenantQuota.contract.test.mjs
//
// Per-school quota contract (hardening plan §3.2):
//   - Attribution is by school-site Origin (slug subdomain or verified
//     custom domain) via the host cache — never a DB query per request.
//   - Limits differ by tier (pilot 600 / freemium 1200 / premium 3000 per
//     minute — generous vs a ~300/min classroom burst), with per-school
//     and env overrides.
//   - Counting fails OPEN (Redis down must not lock a school out), and auth
//     + health are exempt even when a school is over quota.
//
// db.js exits without Supabase env — set dummies BEFORE importing.
process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "dummy";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "dummy";

import test from "node:test";
import assert from "node:assert/strict";

const {
  quotaForSchool, minuteBucket, resetSec, countRequest,
  schoolForHost, _setQuotaHostCacheForTests, buildHostMap,
} = await import("./tenantQuota.js");
const { createTenantQuotaMiddleware } = await import("../middleware/tenantQuota.js");

const mkRes = () => {
  const out = { headers: {}, statusCode: null, body: null, sent: false };
  out.setHeader = (k, v) => { out.headers[k.toLowerCase()] = String(v); };
  out.status = (c) => { out.statusCode = c; return out; };
  out.json = (b) => { out.body = b; out.sent = true; return out; };
  return out;
};
const tick = () => new Promise((r) => setImmediate(r));

test("quota differs by tier, generously, with override precedence", () => {
  assert.equal(quotaForSchool({ plan_tier: "pilot" }), 600);
  assert.equal(quotaForSchool({ plan_tier: "freemium" }), 1200);
  assert.equal(quotaForSchool({ plan_tier: "premium" }), 3000);
  // Unknown/custom tier names (admin can add them) fall back to pilot-level.
  assert.equal(quotaForSchool({ plan_tier: "enterprise-custom" }), 600);
  assert.equal(quotaForSchool({}), 600);

  // Per-school override beats the tier.
  assert.equal(quotaForSchool({ plan_tier: "pilot", api_quota_per_min: 5000 }), 5000);
  // A non-positive override is ignored, not weaponised into a lockout.
  assert.equal(quotaForSchool({ plan_tier: "premium", api_quota_per_min: 0 }), 3000);

  // Env knob beats the tier default, never the per-school override.
  process.env.QUOTA_FREEMIUM_PER_MIN = "1500";
  try {
    assert.equal(quotaForSchool({ plan_tier: "freemium" }), 1500);
    assert.equal(quotaForSchool({ plan_tier: "freemium", api_quota_per_min: 900 }), 900);
  } finally { delete process.env.QUOTA_FREEMIUM_PER_MIN; }
});

test("window bucket and reset math", () => {
  assert.equal(minuteBucket(new Date("2026-09-29T18:32:45.123Z")), "20260929T1832");
  assert.equal(resetSec(new Date("2026-09-29T18:32:45Z")), 15);
  assert.equal(resetSec(new Date("2026-09-29T18:32:00Z")), 60);
});

test("countRequest counts in a window and fails OPEN when Redis is down", async () => {
  const store = new Map();
  const fakeRedis = {
    incr: async (k) => { store.set(k, (store.get(k) || 0) + 1); return store.get(k); },
    expire: async (k, s) => { store.set(`${k}:ttl`, s); return 1; },
  };
  const school = { id: "s1" };
  const a = await countRequest(school, fakeRedis, new Date("2026-09-29T18:32:10Z"));
  const b = await countRequest(school, fakeRedis, new Date("2026-09-29T18:32:50Z"));
  assert.deepEqual([a.ok, a.count, b.count], [true, 1, 2]);
  assert.equal(store.get("quota:school:s1:20260929T1832:ttl"), 65, "TTL set on first hit of a window");

  const c = await countRequest(school, fakeRedis, new Date("2026-09-29T18:33:05Z"));
  assert.equal(c.count, 1, "a new minute starts a fresh window");

  const dead = { incr: async () => { throw new Error("connection refused"); } };
  const d = await countRequest(school, dead);
  assert.deepEqual(d, { ok: false }, "counter failure must report not-ok so the caller can allow");
});

test("schoolForHost resolves slugs, subdomains, custom domains — and nothing else", () => {
  _setQuotaHostCacheForTests([
    ["greentree", { id: "s1", slug: "greentree", plan_tier: "premium" }],
    ["greenschool.edu.ng", { id: "s2", slug: "edge", plan_tier: "freemium" }],
  ]);
  assert.equal(schoolForHost("greentree.akoro.name.ng")?.id, "s1", "slug subdomain");
  assert.equal(schoolForHost("www.greentree.akoro.name.ng")?.id, "s1", "www stripped");
  assert.equal(schoolForHost("greentree.akoro.name.ng:3000")?.id, "s1", "port handled");
  assert.equal(schoolForHost("greenschool.edu.ng")?.id, "s2", "verified custom domain");
  assert.equal(schoolForHost("www.greenschool.edu.ng")?.id, "s2");
  // Not a school: our own apps and unknown hosts carry no tenant.
  assert.equal(schoolForHost("akoro.name.ng"), null);
  assert.equal(schoolForHost("api.akoro.name.ng"), null);
  assert.equal(schoolForHost("unknown-school.akoro.name.ng"), null);
  assert.equal(schoolForHost(""), null);
  assert.equal(schoolForHost(null), null);
});

test("middleware: school traffic is counted and gets X-Quota headers", async () => {
  const school = { id: "s1", slug: "greentree", plan_tier: "freemium" };
  let result = { ok: true, count: 5 };
  const mw = createTenantQuotaMiddleware({
    count: async () => result,
    schoolLookup: () => school,
    cacheReady: () => true,
  });
  const req = { headers: { origin: "https://greentree.akoro.name.ng" }, path: "/api/adaptive/chat/agent" };
  const res = mkRes();
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  await tick();
  assert.ok(nexted, "under limit → next()");
  assert.equal(res.headers["x-quota-limit"], "1200");
  assert.equal(res.headers["x-quota-remaining"], "1195");
  assert.ok(Number(res.headers["x-quota-reset"]) > 0);

  result = { ok: true, count: 1201 };
  const res2 = mkRes();
  let nexted2 = false;
  mw(req, res2, () => { nexted2 = true; });
  await tick();
  assert.ok(!nexted2, "over limit → blocked, not nexted");
  assert.equal(res2.statusCode, 429);
  assert.equal(res2.body.code, "tenant_quota_exceeded");
  assert.ok(Number(res2.headers["retry-after"]) > 0, "429 carries Retry-After");
  assert.equal(res2.headers["x-quota-remaining"], "0");
});

test("middleware: auth and health are exempt even over quota", async () => {
  const school = { id: "s1", slug: "greentree", plan_tier: "pilot" };
  const mw = createTenantQuotaMiddleware({
    count: async () => ({ ok: true, count: 9_999 }),
    schoolLookup: () => school,
    cacheReady: () => true,
  });
  for (const path of ["/health", "/ready", "/api/auth/login", "/api/auth/refresh"]) {
    const res = mkRes();
    let nexted = false;
    mw({ headers: { origin: "https://greentree.akoro.name.ng" }, path }, res, () => { nexted = true; });
    await tick();
    assert.ok(nexted, `${path} must stay reachable for an over-quota school`);
  }
});

test("middleware: unattributed and uncountable traffic passes", async () => {
  const school = { id: "s1", slug: "greentree", plan_tier: "premium" };
  let counted = 0;
  const mw = createTenantQuotaMiddleware({
    count: async () => { counted += 1; return { ok: true, count: 1 }; },
    schoolLookup: () => school,
    cacheReady: () => true,
  });

  // No Origin (our apps' server-side calls, webhooks, monitors) → not counted.
  let nexted = false;
  mw({ headers: {}, path: "/api/anything" }, mkRes(), () => { nexted = true; });
  await tick();
  assert.ok(nexted); assert.equal(counted, 0);

  // Referer fallback still attributes school-site traffic.
  mw({ headers: { referer: "https://greentree.akoro.name.ng/dashboard" }, path: "/api/x" }, mkRes(), () => {});
  await tick();
  assert.equal(counted, 1, "referer counts as attribution when origin is absent");

  // Redis down → fail open.
  const broken = createTenantQuotaMiddleware({
    count: async () => ({ ok: false }),
    schoolLookup: () => school,
    cacheReady: () => true,
  });
  let passed = false;
  const res = mkRes();
  broken({ headers: { origin: "https://greentree.akoro.name.ng" }, path: "/api/x" }, res, () => { passed = true; });
  await tick();
  assert.ok(passed, "counter failure must fail open");
  assert.equal(res.headers["x-quota-limit"], "3000", "limit is still communicated");
  assert.equal(res.headers["x-quota-remaining"], undefined, "but an uncounted window reports no remaining");
});

test("middleware: cache not yet loaded → allow (fail-open at boot)", async () => {
  const mw = createTenantQuotaMiddleware({
    count: async () => { throw new Error("must not be called"); },
    schoolLookup: () => null,
    cacheReady: () => false,
  });
  let nexted = false;
  mw({ headers: { origin: "https://greentree.akoro.name.ng" }, path: "/api/x" }, mkRes(), () => { nexted = true; });
  await tick();
  assert.ok(nexted);
});

test("buildHostMap: REAL supabase shape { data, error } — the production regression", () => {
  // Production failed with "(schools || []).map is not a function" because the
  // response OBJECT was treated as the row array, so the quota host cache never
  // loaded and enforcement silently failed open. These responses are shaped
  // exactly like supabase-js resolves (data/error/count/status fields).
  const schoolsRes = {
    data: [
      { id: "s1", slug: "Greentree", plan_tier: "pilot",   api_quota_per_min: null },
      { id: "s2", slug: "hillview",  plan_tier: "premium", api_quota_per_min: 999 },
    ],
    error: null, count: 2, status: 200, statusText: "OK",
  };
  const domainsRes = {
    data: [
      { domain: "www.Greentree.edu.ng", school_id: "s1" },
      { domain: "orphan.example.com",   school_id: "sX" },
    ],
    error: null, count: 2, status: 200, statusText: "OK",
  };
  const m = buildHostMap(schoolsRes, domainsRes);
  assert.equal(m.size, 3, "two slugs + one joined custom domain");
  assert.equal(m.get("greentree").plan_tier, "pilot", "slug keys are lowercased");
  assert.equal(m.get("greentree.edu.ng").id, "s1", "custom domain joins by school id, www. stripped");
  assert.equal(m.get("hillview").api_quota_per_min, 999, "per-school override survives the map");
  assert.ok(!m.has("orphan.example.com"), "a domain with no matching school must not leak in");
  assert.ok(!m.has("www.greentree.edu.ng"), "the www. form is not a separate entry");

  // A plain ARRAY must fail loudly — that is the bug's original camouflage.
  assert.throws(() => buildHostMap([{ id: "s1", slug: "x" }], { data: [] }),
    /supabase \{ data, error \} object, not rows/);
});

test("buildHostMap: query error throws (stale map beats empty map); null data is empty", () => {
  assert.throws(() => buildHostMap({ data: null, error: new Error("relation missing") }, { data: [] }),
    /relation missing/);
  assert.throws(() => buildHostMap({ data: [] }, { data: null, error: new Error("jwt expired") }),
    /jwt expired/);
  assert.equal(buildHostMap({ data: null, error: null }, { data: null, error: null }).size, 0,
    "no rows and no error → empty map, not a crash");
});
