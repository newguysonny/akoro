#!/usr/bin/env node
/**
 * Disposable sandbox permission smoke (§15 permission verification).
 *
 * Default: dry run — prints the plan, performs no HTTP request.
 * Run for real:
 *
 *   node akoro-documentation/scripts/sandbox-permissions-smoke.mjs --confirm
 *
 * It verifies the documented permission model end to end:
 *   - an unauthenticated request to a protected route is refused (401);
 *   - a learner token on an admin-only route is refused (403);
 *   - a record created by learner A is not readable or askable by learner B
 *     (403 or 404 on the by-id surfaces, absent from B's list);
 *   - learner A deletes the record in `finally` and verifies it is gone.
 *
 * It refuses to run against anything except sandbox.akoro.ng.
 */
const BASE = (process.env.SANDBOX_BASE || "https://sandbox.akoro.ng").replace(/\/+$/, "");
const CONFIRM = process.argv.includes("--confirm");
const PORTAL = "student";
const EMAIL_A = process.env.SANDBOX_A_EMAIL || "tester01@demo.akoro.app";
const EMAIL_B = process.env.SANDBOX_B_EMAIL || "tester02@demo.akoro.app";
const PASSWORD = process.env.SANDBOX_PASSWORD || "Password123!";

if (!/^https:\/\/sandbox\.akoro\.ng$/.test(BASE)) {
  console.error(`Refusing to run outside sandbox.akoro.ng (got ${BASE}).`);
  process.exit(1);
}
if (!CONFIRM) {
  console.log("DRY RUN — no HTTP requests.");
  console.log("Would: unauth records probe -> login A + B -> A on admin route -> A creates paste record -> B read/ask probes -> A deletes + verify.");
  console.log("Re-run with --confirm to execute on sandbox.");
  process.exit(0);
}

const headers = (extra = {}) => ({ "X-Akoro-Portal": PORTAL, "Content-Type": "application/json", ...extra });

async function call(path, { method = "GET", token = "", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(token ? { Authorization: `Bearer ${token}` } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  return { status: res.status, headers: res.headers, data, text };
}

function blocked(r) {
  return r.status === 429 || /hibernate-rate-limited/i.test(r.headers.get("x-render-routing") || "");
}

let failures = 0;
function verdict(step, ok, detail) {
  console.log(`${step} ${ok ? "PASS" : "FAIL"} — ${detail}`);
  if (!ok) failures += 1;
}
function fatal(message, r) {
  console.error(`FAIL: ${message}`);
  if (r) console.error(`HTTP ${r.status}: ${String(r.text).slice(0, 300)}`);
  process.exit(1);
}

async function login(email) {
  const r = await call("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  if (blocked(r)) {
    console.error("BLOCKED: sandbox is still hibernate-rate-limited. No writes performed.");
    process.exit(2);
  }
  if (r.status !== 200) fatal(`login failed for ${email}`, r);
  const token = r.data?.data?.accessToken;
  if (!token) fatal(`login for ${email} returned no accessToken`, r);
  return token;
}

// 1. Unauthenticated access to a protected route must be refused.
const unauth = await call("/api/records");
if (blocked(unauth)) {
  console.error("BLOCKED: sandbox is still hibernate-rate-limited. No writes performed.");
  process.exit(2);
}
verdict("1/7 unauthenticated GET /api/records", unauth.status === 401, `HTTP ${unauth.status} (expect 401)`);

// 2. Two learner logins.
const tokenA = await login(EMAIL_A);
const tokenB = await login(EMAIL_B);
console.log(`2/7 logins ok (${EMAIL_A}, ${EMAIL_B})`);

// 3. A learner token must not reach an admin-only route.
const adminProbe = await call("/api/admin/users?limit=1", { token: tokenA });
verdict("3/7 learner GET /api/admin/users", adminProbe.status === 403, `HTTP ${adminProbe.status} (expect 403)`);

// 4. Learner A creates a disposable paste record.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const created = await call("/api/records", {
  method: "POST",
  token: tokenA,
  body: {
    kind: "paste",
    name: `docs-permissions-smoke-${stamp}`,
    content: "Photosynthesis converts sunlight, water and carbon dioxide into glucose and oxygen.",
  },
});
if (blocked(created)) {
  console.error("BLOCKED: sandbox became hibernate-rate-limited during the write. No record created.");
  process.exit(2);
}
if (created.status !== 201) fatal("learner A paste record creation failed", created);
const recordId = created.data?.data?.id;
if (!recordId) fatal("record response had no id", created);
console.log(`4/7 record created by A ${recordId}`);

try {
  // 5. Learner B must not read A's record through the by-id surfaces.
  //    There is no plain GET /api/records/:id; the by-id read surfaces are
  //    /:id/preview and /:id/file.
  const preview = await call(`/api/records/${encodeURIComponent(recordId)}/preview`, { token: tokenB });
  verdict("5/7 learner B GET /records/:id/preview", preview.status === 403 || preview.status === 404,
    `HTTP ${preview.status} (expect 403 or 404)`);
  const file = await call(`/api/records/${encodeURIComponent(recordId)}/file`, { token: tokenB });
  verdict("    learner B GET /records/:id/file", file.status === 403 || file.status === 404,
    `HTTP ${file.status} (expect 403 or 404)`);

  // 6. Learner B must not ask about A's record, and must not see it listed.
  //    NOTE (2026-11-26): this check currently FAILS on the sandbox. Records
  //    are created with `private` unset (DB default false) and
  //    modules/records/access.js deliberately lets any learner ask a
  //    non-private record whose owner is not Premium (the Discover rule) —
  //    so B gets HTTP 200 with a grounded answer quoting A's content. The
  //    documented model (service-ask.js: "the learner's own record") says
  //    refusal; the check stays as the regression gate for that gap. There
  //    is no API to mark a record private (PATCH allows name/progress only).
  const ask = await call("/api/records/ask", {
    method: "POST",
    token: tokenB,
    body: { recordId, question: "What does photosynthesis produce?" },
  });
  verdict("6/7 learner B POST /records/ask on A's record", ask.status === 403 || ask.status === 404,
    `HTTP ${ask.status} (expect 403 or 404 refusal)`);
  const listB = await call("/api/records?limit=200", { token: tokenB });
  if (listB.status === 200) {
    const rows = Array.isArray(listB.data?.data) ? listB.data.data : listB.data?.data?.records || [];
    verdict("    learner B list excludes A's record", !rows.some((row) => row.id === recordId),
      rows.some((row) => row.id === recordId) ? "record VISIBLE to B" : "record absent from B's list");
  } else {
    verdict("    learner B list excludes A's record", false, `list HTTP ${listB.status}`);
  }
} finally {
  // 7. Cleanup: A deletes the record and verifies it is gone.
  const deleted = await call(`/api/records/${encodeURIComponent(recordId)}`, { method: "DELETE", token: tokenA });
  console.log(`7/7 delete by A ${deleted.status === 200 ? "ok" : `HTTP ${deleted.status}`}`);
  const listed = await call("/api/records?limit=200", { token: tokenA });
  if (listed.status === 200) {
    const rows = Array.isArray(listed.data?.data) ? listed.data.data : listed.data?.data?.records || [];
    const stillThere = rows.some((row) => row.id === recordId);
    console.log(`cleanup ${stillThere ? "FAILED — record still listed for A" : "verified"}`);
    if (stillThere) failures += 1;
  }
}

if (failures > 0) {
  console.error(`PERMISSIONS SMOKE: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("PERMISSIONS SMOKE: all checks passed.");
