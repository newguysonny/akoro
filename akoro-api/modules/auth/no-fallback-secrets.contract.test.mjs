/**
 * Phase 15 item 5 (audit F17, F1): no hard-coded fallback secrets. A missing
 * key stops that feature — or, for the JWT key in production, the server —
 * instead of signing with a value that is in the repository
 * ("akoro-dev-secret-change-in-production", "akoro-dev-secret",
 * "akoro-oauth-state").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const API = fileURLToPath(new URL("../../", import.meta.url));
const files = execFileSync("git", ["ls-files", "*.js", "*.mjs", "*.cjs"], { cwd: API, encoding: "utf8" })
  .split("\n").filter((f) => f && !/\.test\.mjs$/.test(f) && !f.startsWith("modules/verify/scenarios/"));

// Dev scripts that never run in the server: a probe token that is expired anyway, a local stub key.
const ALLOWED = new Set([
  'scripts/boot-smoke.mjs:    process.env.JWT_SECRET || "dummy",',
  "scripts/golden-path/gp-voice.mjs:process.env.OPENAI_API_KEY   = process.env.OPENAI_API_KEY || 'sk-test-local';",
]);

test("no SECRET/KEY/TOKEN env var falls back to a literal value in server code", () => {
  const hits = [];
  const re = /(SECRET|_KEY|TOKEN|PASSWORD)[A-Z_]*\s*(\?\?|\|\|)\s*(["'`])[^"'`]+\3/;
  for (const f of files) {
    readFileSync(new URL(f, `file://${API}`), "utf8").split("\n").forEach((line) => {
      if (re.test(line) && !ALLOWED.has(`${f}:${line}`)) hits.push(`${f}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("the known default values are gone from server code", () => {
  for (const f of files) {
    if (f === "lib/preflightChecks.js") continue;   // its placeholder detector names them on purpose
    const src = readFileSync(new URL(f, `file://${API}`), "utf8");
    assert.doesNotMatch(src, /akoro-dev-secret|akoro-oauth-state/, f);
  }
});

const childEnv = (extra) => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_SERVICE_KEY: "test",
    AKORO_BACKGROUND_JOBS_ENABLED: "false", GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test", ...extra };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  return env;
};
const runChild = (code, extra) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: API, env: childEnv(extra), encoding: "utf8", timeout: 30_000 });

test("with no JWT key nothing is signed, and a token signed with the old default does not sign in", () => {
  const code = `
    import jwt from "jsonwebtoken";
    const auth = await import("./modules/auth/routes.js");
    const { peekAccessToken } = await import("./lib/tokenPeek.js");
    const out = {};
    try { auth.signInternalAccess({ id: "u1", role: "student" }); out.signed = true; } catch { out.signed = false; }
    try { auth.signCourseInvite({ teacherId: "t1", courseIds: ["c1"] }); out.invite = true; } catch { out.invite = false; }
    const forged = jwt.sign({ sub: "u1", role: "admin", iss: "https://api.akoro.app", aud: "https://akoro.app" }, "akoro-dev-secret-change-in-production", { algorithm: "HS256", expiresIn: 60 });
    out.peek = peekAccessToken({ headers: { authorization: "Bearer " + forged }, cookies: {} });
    out.status = await new Promise((resolve) => {
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { resolve(this.statusCode); return this; }, setHeader() {}, cookie() {}, clearCookie() {} };
      Promise.resolve(auth.authenticateToken({ headers: { authorization: "Bearer " + forged }, cookies: {}, get: () => undefined }, res, () => resolve("next"))).catch(() => resolve("threw"));
    });
    console.log("RESULT" + JSON.stringify(out));
    process.exit(0);`;
  const r = runChild(code, { JWT_SECRET: undefined, JWT_PRIVATE_KEY: undefined, JWT_PUBLIC_KEY: undefined, NODE_ENV: "development" });
  const line = (r.stdout || "").split("\n").find((l) => l.startsWith("RESULT"));
  assert.ok(line, `child ran: ${r.stderr}`);
  const out = JSON.parse(line.slice(6));
  assert.equal(out.signed, false, "no access token can be signed");
  assert.equal(out.invite, false, "no invite can be signed");
  assert.equal(out.peek, null, "the rate-limit peek trusts nothing");
  assert.equal(out.status, 401, "the old default secret does not sign in");
  assert.match(r.stderr, /No JWT key/, "it says so at boot");
});

test("in production, config refuses to boot with no JWT key and boots with either kind", () => {
  const code = `await import("./config/index.js"); console.log("BOOTED"); process.exit(0);`;
  const base = { NODE_ENV: "production", REDIS_URL: "redis://cache.internal:6379", JWT_PRIVATE_KEY: undefined, JWT_PUBLIC_KEY: undefined };
  const none = runChild(code, { ...base, JWT_SECRET: undefined });
  assert.equal(none.status, 1, `exit 1 with no key (stdout: ${none.stdout})`);
  assert.match(none.stderr, /Missing required env vars in production: .*JWT/);
  assert.doesNotMatch(none.stdout, /BOOTED/);
  const hs = runChild(code, { ...base, JWT_SECRET: "x".repeat(40) });
  assert.match(hs.stdout, /BOOTED/, hs.stderr);
  const rsa = runChild(code, { ...base, JWT_SECRET: undefined, JWT_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----x", JWT_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----y" });
  assert.match(rsa.stdout, /BOOTED/, rsa.stderr);
});

test("OAuth account connection is off without a state key, never signed with a default", () => {
  const meet = readFileSync(new URL("../courses/meeting-integration.js", import.meta.url), "utf8");
  assert.match(meet, /const STATE_SECRET\s+= process\.env\.OAUTH_STATE_SECRET \|\| process\.env\.COOKIE_SECRET \|\| null;/);
  assert.match(meet, /if \(!STATE_SECRET\) return res\.status\(503\)/);
  const social = readFileSync(new URL("../school/socialOAuth.js", import.meta.url), "utf8");
  assert.match(social, /const STATE_SECRET = process\.env\.OAUTH_STATE_SECRET \|\| process\.env\.COOKIE_SECRET \|\| null;/);
  assert.match(social, /!cfg\.clientSecret\(\) \|\| !STATE_SECRET\) return res\.redirect\(backTo\(provider, "social_error=not_configured"\)\)/);
});

test("preflight names the keys that have no default", async () => {
  const { runConfigChecks } = await import("../../lib/preflightChecks.js");
  const labels = runConfigChecks({ NODE_ENV: "production" }).checks.map((c) => `${c.status}:${c.label}`);
  assert.ok(labels.includes("fail:JWT signing key is weak/default/unset"));
  assert.ok(labels.includes("warn:INTERNAL_SECRET unset"));
  assert.ok(labels.includes("warn:OAUTH_STATE_SECRET unset"));
});
