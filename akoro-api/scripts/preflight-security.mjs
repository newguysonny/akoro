#!/usr/bin/env node
/**
 * preflight-security.mjs
 * ─────────────────────────────────────────────────────────────
 * Deploy gate for the SECURITY_CHECKLIST.md §1 "Must confirm" items.
 * Verifies the PRODUCTION environment/config is safe, then (optionally)
 * probes a running instance to confirm live behaviour.
 *
 * Run it with the PROD env loaded (on the platform, or with the env file):
 *   NODE_ENV=production node scripts/preflight-security.mjs
 *   node scripts/preflight-security.mjs --url=https://api.yourdomain.com
 *
 * Exit code:
 *   0  → all hard blockers passed (safe to ship)
 *   1  → one or more blockers FAILED (do not ship)
 * Warnings (⚠️) never fail the gate — they're advisories.
 *
 * Checks are config-only unless --url is given; nothing here needs the app
 * to import, so it's safe to run in a release/pre-deploy step.
 */

const env = process.env;
const urlArg = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1];

let fail = 0, warn = 0, pass = 0;
const line = (icon, label, detail) => console.log(`${icon}  ${label}${detail ? `  — ${detail}` : ""}`);
const ok   = (l, d) => { pass++; line("✅", l, d); };
const bad  = (l, d) => { fail++; line("❌", l, d); };
const soft = (l, d) => { warn++; line("⚠️ ", l, d); };

const isProd = env.NODE_ENV === "production";
const set    = (v) => typeof v === "string" && v.trim().length > 0;
// Obvious placeholder / non-secret values that must never reach prod.
const PLACEHOLDER = /(change[-_ ]?me|changeinproduction|dev-secret|example|placeholder|xxxx+|your[-_ ]?|test[-_ ]?key|localhost|127\.0\.0\.1)/i;

console.log("\n── Akoro production security preflight ──────────────────────\n");
if (!isProd) soft("NODE_ENV is not 'production'", `got '${env.NODE_ENV ?? "(unset)"}' — checks still run, but set it for the real deploy`);

// ── 1. NODE_ENV=production (Secure cookies + no stack-trace leak) ──────────────
isProd
  ? ok("NODE_ENV=production", "Secure cookies on, error stacks hidden from clients")
  : bad("NODE_ENV must be 'production'", "dev mode leaks error stacks and weakens cookie flags");

// ── 2. CORS allow-list, never '*' ─────────────────────────────────────────────
const cors = env.CORS_ORIGIN;
if (!set(cors) || cors.trim() === "*") {
  bad("CORS_ORIGIN must be an explicit allow-list", `got '${cors ?? "(unset → defaults to *)"}'`);
} else if (cors.includes("*")) {
  soft("CORS_ORIGIN contains a wildcard", cors);
} else {
  ok("CORS_ORIGIN allow-list set", cors);
}

// ── 3. JWT signing key — RSA keypair OR a strong, non-default secret ───────────
const rsa = (env.JWT_PRIVATE_KEY || "").includes("BEGIN") && (env.JWT_PUBLIC_KEY || "").includes("BEGIN");
const secret = env.JWT_SECRET || "";
if (rsa) {
  ok("JWT uses an RSA keypair", "RS256 — JWT_PRIVATE_KEY/JWT_PUBLIC_KEY set");
} else if (!set(secret) || PLACEHOLDER.test(secret) || secret.length < 32) {
  bad("JWT signing key is weak/default/unset", set(secret) ? "set a random ≥32-char JWT_SECRET (or an RSA keypair)" : "JWT_SECRET unset → falls back to the public dev secret");
} else {
  ok("JWT_SECRET set (HS256)", `${secret.length} chars`);
}

// ── 4. Supabase creds ─────────────────────────────────────────────────────────
(set(env.SUPABASE_URL) && set(env.SUPABASE_SERVICE_KEY))
  ? ok("Supabase URL + service key set")
  : bad("SUPABASE_URL / SUPABASE_SERVICE_KEY missing", "the API cannot reach the database without these");

// ── 5. Database URL for migrations ────────────────────────────────────────────
(set(env.DATABASE_URL) || set(env.MIGRATION_DATABASE_URL))
  ? ok("DATABASE_URL set (migrations)")
  : soft("DATABASE_URL not set", "needed to run `npm run db:migrate` on deploy");

// ── 6. Redis (required; must not be localhost in prod) ─────────────────────────
const redis = env.REDIS_URL;
if (!set(redis)) bad("REDIS_URL unset", "defaults to localhost — sessions/limits/sockets will break in prod");
else if (/localhost|127\.0\.0\.1/.test(redis)) bad("REDIS_URL points at localhost", redis);
else ok("REDIS_URL set", redis.replace(/:\/\/[^@]*@/, "://***@"));

// ── 7. Demo/seed group OFF in prod ────────────────────────────────────────────
const groups = (env.DB_DEPLOY_GROUPS || "").trim();
if (groups === "schema") ok("DB_DEPLOY_GROUPS=schema", "demo/test seeds will not run in prod");
else if (groups === "" ) soft("DB_DEPLOY_GROUPS unset", "set it to 'schema' so a stray --group=all can't seed demo data into prod");
else bad(`DB_DEPLOY_GROUPS='${groups}' would seed demo data`, "set to 'schema' for production");

// ── 8. Paystack live key + webhook secret ─────────────────────────────────────
const psk = env.PAYSTACK_SECRET_KEY || "";
if (!set(psk)) soft("PAYSTACK_SECRET_KEY unset", "payments + webhook signature verification disabled");
else if (/sk_test_/.test(psk)) bad("PAYSTACK_SECRET_KEY is a TEST key", "use the live key (sk_live_…) in production");
else ok("PAYSTACK_SECRET_KEY set", psk.startsWith("sk_live_") ? "live key" : "set");

// ── 9. Frontend redirect URLs from env (not hardcoded hosts) ──────────────────
const urls = { FRONTEND_URL: env.FRONTEND_URL, INSTRUCTOR_URL: env.INSTRUCTOR_URL || env.INSTRUCTOR_FRONTEND_URL, SCHOOL_FRONTEND_URL: env.SCHOOL_FRONTEND_URL, ADMIN_FRONTEND_URL: env.ADMIN_FRONTEND_URL };
const missingUrls = Object.entries(urls).filter(([, v]) => !set(v)).map(([k]) => k);
missingUrls.length
  ? soft("Some frontend URLs unset", `${missingUrls.join(", ")} — OAuth/email links fall back to defaults`)
  : ok("Frontend redirect URLs set");

// ── Optional: probe a running instance ────────────────────────────────────────
async function probe(base) {
  console.log(`\n── Live probe: ${base} ──────────────────────────────────────\n`);
  const root = base.replace(/\/+$/, "");
  // a) health
  try {
    const r = await fetch(`${root}/health`, { redirect: "manual" });
    r.ok ? ok("GET /health responds", `${r.status}`) : soft("GET /health non-200", `${r.status}`);
  } catch (e) { bad("GET /health unreachable", e.message); }

  // b) protected route rejects anonymous access
  try {
    const r = await fetch(`${root}/api/auth/me`, { headers: { "X-Akoro-Portal": "school" } });
    r.status === 401 ? ok("Protected route returns 401 when unauthenticated") : bad("Protected route did not return 401", `got ${r.status}`);
  } catch (e) { soft("Could not probe protected route", e.message); }

  // c) HTTPS
  root.startsWith("https://") ? ok("API served over HTTPS") : bad("API not over HTTPS", root);

  // d) security headers present (helmet) + no stack leak
  try {
    const r = await fetch(`${root}/health`);
    const h = r.headers;
    (h.get("x-frame-options") || h.get("x-content-type-options") || h.get("x-dns-prefetch-control"))
      ? ok("Security headers present (helmet)")
      : soft("Expected helmet headers not seen", "check helmet is applied");
  } catch { /* covered by (a) */ }

  // e) CORS does not echo a foreign origin
  try {
    const evil = "https://evil.example.com";
    const r = await fetch(`${root}/health`, { headers: { Origin: evil } });
    const acao = r.headers.get("access-control-allow-origin");
    (acao === evil || acao === "*")
      ? bad("CORS reflects an untrusted origin", `access-control-allow-origin: ${acao}`)
      : ok("CORS does not reflect an untrusted origin", acao ? `ACAO: ${acao}` : "no ACAO for foreign origin");
  } catch (e) { soft("Could not probe CORS", e.message); }
}

const done = () => {
  console.log(`\n────────────────────────────────────────────────────────────`);
  console.log(`  ${pass} passed · ${warn} warning(s) · ${fail} blocker(s) failed`);
  if (fail) { console.log(`  ❌ NOT ready to ship — fix the blockers above.\n`); process.exit(1); }
  console.log(`  ✅ Config blockers are GREEN.${warn ? " Review warnings before launch." : ""}\n`);
  process.exit(0);
};

if (urlArg) probe(urlArg).then(done); else done();
