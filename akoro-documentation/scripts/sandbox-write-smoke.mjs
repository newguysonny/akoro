#!/usr/bin/env node
/**
 * Disposable sandbox write-path smoke.
 *
 * Default: dry run — prints the plan, performs no HTTP request.
 * Run for real:
 *
 *   node akoro-documentation/scripts/sandbox-write-smoke.mjs --confirm
 *
 * It creates one paste record, waits for extraction, asks one grounded
 * question, then deletes the record and verifies it is gone. It refuses to run
 * against anything except sandbox.akoro.ng.
 */
const BASE = (process.env.SANDBOX_BASE || "https://sandbox.akoro.ng").replace(/\/+$/, "");
const CONFIRM = process.argv.includes("--confirm");
const PORTAL = "student";
const EMAIL = process.env.SANDBOX_DEMO_EMAIL || "stu.jss11@demo.akoro.app";
const PASSWORD = process.env.SANDBOX_DEMO_PASSWORD || "Priya2026";

if (!/^https:\/\/sandbox\.akoro\.ng$/.test(BASE)) {
  console.error(`Refusing to run outside sandbox.akoro.ng (got ${BASE}).`);
  process.exit(1);
}
if (!CONFIRM) {
  console.log("DRY RUN — no HTTP requests.");
  console.log("Would: login demo learner -> create paste record -> poll extraction -> ask -> delete -> verify.");
  console.log("Re-run with --confirm to execute on sandbox.");
  process.exit(0);
}

const headers = (extra = {}) => ({ "X-Akoro-Portal": PORTAL, "Content-Type": "application/json", ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = "GET", cookie = "", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(cookie ? { Cookie: cookie } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  return { status: res.status, headers: res.headers, data, text };
}

function blocked(r) {
  return r.status === 429 || /hibernate-rate-limited/i.test(r.headers.get("x-render-routing") || "");
}
function cookiesOf(r) {
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
}
function fail(message, r) {
  console.error(`FAIL: ${message}`);
  if (r) console.error(`HTTP ${r.status}: ${String(r.text).slice(0, 300)}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const name = `docs-smoke-${stamp}`;

const login = await call("/api/auth/login", {
  method: "POST",
  body: { email: EMAIL, password: PASSWORD },
});
if (blocked(login)) {
  console.error("BLOCKED: sandbox is still hibernate-rate-limited. No writes performed.");
  process.exit(2);
}
if (login.status !== 200) fail("demo login failed", login);
const cookie = cookiesOf(login);
if (!cookie) fail("login returned no session cookie", login);
console.log("1/5 login ok");

const created = await call("/api/records", {
  method: "POST",
  cookie,
  body: {
    kind: "paste",
    name,
    content: "The mitochondrion produces ATP through oxidative phosphorylation. The nucleus stores DNA.",
  },
});
if (blocked(created)) {
  console.error("BLOCKED: sandbox became hibernate-rate-limited during the write. No record created.");
  process.exit(2);
}
if (created.status !== 201) fail("paste record creation failed", created);
const recordId = created.data?.data?.id;
if (!recordId) fail("record response had no id", created);
console.log(`2/5 record created ${recordId}`);

try {
  let extracted = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await call(`/api/records/extract/status?recordId=${encodeURIComponent(recordId)}`, { cookie });
    if (blocked(status)) {
      console.error("BLOCKED during extraction polling; cleanup will still run.");
      break;
    }
    if (status.status === 200) {
      const data = status.data?.data || {};
      if (data.done || data.status === "done" || data.running === false) { extracted = true; break; }
    }
    await sleep(2000);
  }
  console.log(`3/5 extraction ${extracted ? "done" : "not confirmed"}`);

  const asked = await call("/api/records/ask", {
    method: "POST",
    cookie,
    body: { recordId, question: "What produces ATP in the cell?" },
  });
  if (blocked(asked)) {
    console.error("BLOCKED during ask; cleanup will still run.");
  } else if (asked.status !== 200) {
    console.error(`ask failed with HTTP ${asked.status}; cleanup will still run.`);
  } else {
    const answer = asked.data?.data?.answer || "";
    const citations = asked.data?.data?.citations || [];
    console.log(`4/5 ask ${answer ? "answered" : "empty"} (${citations.length} citations)`);
  }
} finally {
  const deleted = await call(`/api/records/${encodeURIComponent(recordId)}`, { method: "DELETE", cookie });
  console.log(`5/5 delete ${deleted.status === 200 ? "ok" : `HTTP ${deleted.status}`}`);
  const listed = await call("/api/records?limit=200", { cookie });
  if (listed.status === 200) {
    const rows = Array.isArray(listed.data?.data) ? listed.data.data : listed.data?.data?.records || [];
    const stillThere = rows.some((row) => row.id === recordId);
    console.log(`cleanup ${stillThere ? "FAILED — record still listed" : "verified"}`);
    if (stillThere) process.exit(1);
  }
}
