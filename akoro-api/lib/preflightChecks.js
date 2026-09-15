/**
 * lib/preflightChecks.js
 * ─────────────────────────────────────────────────────────────
 * Pure config-posture checks for the SECURITY_CHECKLIST.md §1 blockers.
 * Shared by scripts/preflight-security.mjs (CLI) and the guarded
 * GET /internal/preflight endpoint. No I/O, no process.exit, no secret
 * values in the output — only pass/warn/fail + a non-sensitive hint.
 */

const set = (v) => typeof v === "string" && v.trim().length > 0;
// Obvious placeholder / non-secret values that must never reach prod.
const PLACEHOLDER = /(change[-_ ]?me|changeinproduction|dev-secret|example|placeholder|xxxx+|your[-_ ]?|test[-_ ]?key|localhost|127\.0\.0\.1)/i;

/**
 * runConfigChecks(env) → { ok, summary:{pass,warn,fail}, checks:[{status,label,detail}] }
 * status ∈ 'pass' | 'warn' | 'fail'. `ok` is true when zero checks failed.
 */
export function runConfigChecks(env = process.env) {
  const checks = [];
  const add = (status, label, detail) => checks.push({ status, label, detail: detail || "" });
  const pass = (l, d) => add("pass", l, d);
  const warn = (l, d) => add("warn", l, d);
  const fail = (l, d) => add("fail", l, d);

  const isProd = env.NODE_ENV === "production";
  if (!isProd) warn("NODE_ENV is not 'production'", `got '${env.NODE_ENV ?? "(unset)"}' — set it for the real deploy`);

  // 1. NODE_ENV=production (Secure cookies + no stack-trace leak)
  isProd
    ? pass("NODE_ENV=production", "Secure cookies on, error stacks hidden from clients")
    : fail("NODE_ENV must be 'production'", "dev mode leaks error stacks and weakens cookie flags");

  // 2. CORS allow-list, never '*'
  const cors = env.CORS_ORIGIN;
  if (!set(cors) || cors.trim() === "*") fail("CORS_ORIGIN must be an explicit allow-list", `got '${cors ?? "(unset → defaults to *)"}'`);
  else if (cors.includes("*")) warn("CORS_ORIGIN contains a wildcard", cors);
  else pass("CORS_ORIGIN allow-list set", cors);

  // 3. JWT key — RSA keypair OR a strong, non-default secret
  const rsa = (env.JWT_PRIVATE_KEY || "").includes("BEGIN") && (env.JWT_PUBLIC_KEY || "").includes("BEGIN");
  const secret = env.JWT_SECRET || "";
  if (rsa) pass("JWT uses an RSA keypair", "RS256 keypair set");
  else if (!set(secret) || PLACEHOLDER.test(secret) || secret.length < 32)
    fail("JWT signing key is weak/default/unset", set(secret) ? "use a random ≥32-char JWT_SECRET or an RSA keypair" : "JWT_SECRET unset → falls back to the public dev secret");
  else pass("JWT_SECRET set (HS256)", `${secret.length} chars`);

  // 4. Supabase creds
  (set(env.SUPABASE_URL) && set(env.SUPABASE_SERVICE_KEY))
    ? pass("Supabase URL + service key set")
    : fail("SUPABASE_URL / SUPABASE_SERVICE_KEY missing", "the API cannot reach the database without these");

  // 5. Database URL for migrations
  (set(env.DATABASE_URL) || set(env.MIGRATION_DATABASE_URL))
    ? pass("DATABASE_URL set (migrations)")
    : warn("DATABASE_URL not set", "needed to run `npm run db:migrate` on deploy");

  // 6. Redis (required; must not be localhost in prod)
  const redis = env.REDIS_URL;
  if (!set(redis)) fail("REDIS_URL unset", "defaults to localhost — sessions/limits/sockets break in prod");
  else if (/localhost|127\.0\.0\.1/.test(redis)) fail("REDIS_URL points at localhost", "set the managed Redis URL");
  else pass("REDIS_URL set", redis.replace(/:\/\/[^@]*@/, "://***@"));

  // 7. Demo/seed group OFF in prod
  const groups = (env.DB_DEPLOY_GROUPS || "").trim();
  if (groups === "schema") pass("DB_DEPLOY_GROUPS=schema", "demo/test seeds will not run in prod");
  else if (groups === "") warn("DB_DEPLOY_GROUPS unset", "set to 'schema' so a stray --group=all can't seed demo data");
  else fail(`DB_DEPLOY_GROUPS='${groups}' would seed demo data`, "set to 'schema' for production");

  // 8. Paystack live key + webhook secret
  const psk = env.PAYSTACK_SECRET_KEY || "";
  if (!set(psk)) warn("PAYSTACK_SECRET_KEY unset", "payments + webhook signature verification disabled");
  else if (/sk_test_/.test(psk)) fail("PAYSTACK_SECRET_KEY is a TEST key", "use the live key (sk_live_…) in production");
  else pass("PAYSTACK_SECRET_KEY set", psk.startsWith("sk_live_") ? "live key" : "set");

  // 9. Frontend redirect URLs from env (not hardcoded hosts)
  const urls = { FRONTEND_URL: env.FRONTEND_URL, INSTRUCTOR_URL: env.INSTRUCTOR_URL || env.INSTRUCTOR_FRONTEND_URL, SCHOOL_FRONTEND_URL: env.SCHOOL_FRONTEND_URL, ADMIN_FRONTEND_URL: env.ADMIN_FRONTEND_URL };
  const missing = Object.entries(urls).filter(([, v]) => !set(v)).map(([k]) => k);
  missing.length
    ? warn("Some frontend URLs unset", `${missing.join(", ")} — OAuth/email links fall back to defaults`)
    : pass("Frontend redirect URLs set");

  const summary = {
    pass: checks.filter((c) => c.status === "pass").length,
    warn: checks.filter((c) => c.status === "warn").length,
    fail: checks.filter((c) => c.status === "fail").length,
  };
  return { ok: summary.fail === 0, summary, checks };
}
