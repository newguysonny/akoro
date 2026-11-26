#!/usr/bin/env node
/**
 * Disposable sandbox Study Prep workflow probe (§15 workflow verification).
 *
 * Default: dry run — prints the plan, performs no HTTP request.
 * Run for real:
 *
 *   node akoro-documentation/scripts/sandbox-study-prep-smoke.mjs --confirm
 *
 * It executes the documented workflow's core steps minimally
 * (13-examples/workflows/study-prep.md):
 *   1. GET  /api/adaptive/study-prep/sessions        — active session or null
 *   2. POST /api/adaptive/study-prep/sessions        — create (201, planning)
 *   3. GET  /api/adaptive/study-prep/sessions/:id    — read back
 *   4. POST /api/adaptive/study-prep/sessions/:id/cancel — cleanup
 *   5. GET  /api/adaptive/study-prep/sessions        — verify none active
 *
 * Study Prep is gated by AKORO_STUDY_PREP_ENABLED. If the sandbox answers
 * 409 study_prep_disabled, that is the verdict: the script reports DISABLED
 * and exits 2 without creating anything. It never tries to enable the flag.
 * If the learner already has an active session, the script reports it and
 * creates nothing (the workflow forbids a second active session).
 *
 * It refuses to run against anything except sandbox.akoro.ng.
 */
const BASE = (process.env.SANDBOX_BASE || "https://sandbox.akoro.ng").replace(/\/+$/, "");
const CONFIRM = process.argv.includes("--confirm");
const PORTAL = "student";
const EMAIL = process.env.SANDBOX_DEMO_EMAIL || "tester01@demo.akoro.app";
const PASSWORD = process.env.SANDBOX_PASSWORD || "Password123!";

if (!/^https:\/\/sandbox\.akoro\.ng$/.test(BASE)) {
  console.error(`Refusing to run outside sandbox.akoro.ng (got ${BASE}).`);
  process.exit(1);
}
if (!CONFIRM) {
  console.log("DRY RUN — no HTTP requests.");
  console.log("Would: login demo learner -> GET study-prep sessions -> create -> read back -> cancel -> verify none active.");
  console.log("Re-run with --confirm to execute on sandbox.");
  process.exit(0);
}

const headers = (extra = {}) => ({ "X-Akoro-Portal": PORTAL, "Content-Type": "application/json", ...extra });

async function call(path, { method = "GET", token = "", body, timeout = 90_000 } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(token ? { Authorization: `Bearer ${token}` } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  return { status: res.status, headers: res.headers, data, text };
}

function blocked(r) {
  return r.status === 429 || /hibernate-rate-limited/i.test(r.headers.get("x-render-routing") || "");
}
function isDisabled(r) {
  return r.status === 409 && /study_prep_disabled/.test(String(r.text));
}
function fail(message, r) {
  console.error(`FAIL: ${message}`);
  if (r) console.error(`HTTP ${r.status}: ${String(r.text).slice(0, 300)}`);
  process.exit(1);
}

const login = await call("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
if (blocked(login)) {
  console.error("BLOCKED: sandbox is still hibernate-rate-limited. No writes performed.");
  process.exit(2);
}
if (login.status !== 200) fail("demo login failed", login);
const token = login.data?.data?.accessToken;
if (!token) fail("login returned no accessToken", login);
console.log(`login ok (${EMAIL})`);

// 1. Is the feature on, and is there already an active session?
const before = await call("/api/adaptive/study-prep/sessions", { token });
if (isDisabled(before)) {
  console.log(`VERDICT: DISABLED — GET /api/adaptive/study-prep/sessions -> HTTP 409 study_prep_disabled (AKORO_STUDY_PREP_ENABLED is off for this learner on the sandbox). Nothing created.`);
  process.exit(2);
}
if (blocked(before)) {
  console.error("BLOCKED: sandbox became hibernate-rate-limited. Nothing created.");
  process.exit(2);
}
if (before.status !== 200) fail("GET study-prep sessions failed", before);
const existing = before.data?.session || before.data?.data?.session || null;
console.log(`1/5 GET sessions -> HTTP 200, active session: ${existing ? existing.id : "none"}`);
if (existing) {
  console.log(`VERDICT: ENABLED but an active session already exists (${existing.id}); the workflow forbids a second active session, so no create was attempted and nothing was changed.`);
  process.exit(0);
}

// 2. Create a disposable planning session (documented payload).
const created = await call("/api/adaptive/study-prep/sessions", {
  method: "POST",
  token,
  timeout: 240_000, // create runs one planning agent step
  body: {
    goal: "docs-smoke disposable study-prep probe — please ignore",
    subject: "Biology",
    classLevel: "JSS1",
    examBoard: "WAEC",
  },
});
if (isDisabled(created)) {
  console.log("VERDICT: DISABLED — POST /api/adaptive/study-prep/sessions -> HTTP 409 study_prep_disabled. Nothing created.");
  process.exit(2);
}
if (blocked(created)) {
  console.error("BLOCKED: sandbox became hibernate-rate-limited during create.");
  process.exit(2);
}
if (created.status !== 201) fail("study-prep session creation failed", created);
const session = created.data?.session || created.data?.data?.session || created.data?.data || created.data;
const sessionId = session?.id;
if (!sessionId) fail("create response had no session id", created);
console.log(`2/5 POST sessions -> HTTP 201, session ${sessionId} (status: ${session.status || "planning"})`);

try {
  // 3. Read it back.
  const read = await call(`/api/adaptive/study-prep/sessions/${encodeURIComponent(sessionId)}`, { token });
  if (read.status !== 200) fail("GET session by id failed", read);
  console.log(`3/5 GET sessions/:id -> HTTP 200`);
} finally {
  // 4. Cleanup: cancel the disposable session (no DELETE route exists).
  const cancelled = await call(`/api/adaptive/study-prep/sessions/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    token,
    body: {},
  });
  console.log(`4/5 POST sessions/:id/cancel -> HTTP ${cancelled.status}${cancelled.status === 200 ? "" : ` (${String(cancelled.text).slice(0, 200)})`}`);
  if (cancelled.status !== 200) {
    console.error(`RESIDUE: session ${sessionId} could not be cancelled and may still be active on the sandbox.`);
    process.exit(1);
  }
}

// 5. Verify no active session remains.
const after = await call("/api/adaptive/study-prep/sessions", { token });
const remaining = after.data?.session || after.data?.data?.session || null;
console.log(`5/5 GET sessions -> HTTP ${after.status}, active session: ${remaining ? remaining.id : "none"}`);
if (remaining) {
  console.error(`RESIDUE: session ${remaining.id} is still active after cancel.`);
  process.exit(1);
}
console.log("STUDY-PREP SMOKE: create -> read -> cancel verified; no residue.");
