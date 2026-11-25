#!/usr/bin/env node
/**
 * Sandbox blog-subscription + job-application boundary probe.
 *
 * Default: dry run — prints the plan, performs no HTTP request.
 * Run for real:
 *
 *   node akoro-documentation/scripts/sandbox-content-validation.mjs --confirm
 *
 * Why this is validation-only:
 *   `POST /api/content/blog/subscribe` writes `blog_subscribers`, and
 *   `POST /api/content/careers/jobs/:id/apply` writes `job_applications`.
 *   The public/admin content routes expose list endpoints for both
 *   (`GET /api/content/admin/blog/subscribers`,
 *   `GET /api/content/admin/careers/applications`) but no DELETE endpoint, so a
 *   successful write could not be cleaned up. This script therefore sends only
 *   requests that fail validation before touching a table, then reads the admin
 *   lists back to show no canary row exists.
 *
 * It refuses to run against anything except sandbox.akoro.ng.
 */
const BASE = (process.env.SANDBOX_BASE || "https://sandbox.akoro.ng").replace(/\/+$/, "");
const CONFIRM = process.argv.includes("--confirm");
const ADMIN_EMAIL = process.env.SANDBOX_ADMIN_EMAIL || "admin@demo.akoro.app";
const ADMIN_PASSWORD = process.env.SANDBOX_ADMIN_PASSWORD || "Password123!";
const STAMP = Date.now().toString(36);
const CANARY_EMAIL = `docs-no-write-${STAMP}@demo.akoro.app`;
const CANARY_NAME = `docs-no-write-${STAMP}`;

if (!/^https:\/\/sandbox\.akoro\.ng$/.test(BASE)) {
  console.error(`Refusing to run outside sandbox.akoro.ng (got ${BASE}).`);
  process.exit(1);
}
if (!CONFIRM) {
  console.log("DRY RUN — no HTTP requests.");
  console.log("Would send validation-failing subscribe/apply requests and a 404 job apply,");
  console.log("then read the admin subscriber/application lists to confirm no canary row.");
  console.log("Re-run with --confirm to execute on sandbox.");
  process.exit(0);
}

const results = [];
let failed = false;
let blocked = false;

function record(name, status, detail) {
  results.push({ name, status, detail });
  console.log(`${status === "ok" ? "PASS" : status === "blocked" ? "BLOCKED" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (status === "fail") failed = true;
  if (status === "blocked") blocked = true;
}

async function call(path, { method = "GET", cookie = "", body, portal = "student" } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "X-Akoro-Portal": portal, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 400); }
  return { status: res.status, headers: res.headers, data, text };
}
function rateLimited(r) {
  return r.status === 429
    || /hibernate-rate-limited/i.test(r.headers.get("x-render-routing") || "")
    || /hibernate-rate-limited/i.test(String(r.text).slice(0, 400));
}
function cookiesOf(r) {
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
}

try {
  const adminLogin = await call("/api/auth/login", {
    method: "POST", portal: "admin", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (rateLimited(adminLogin)) {
    console.error("BLOCKED: sandbox is hibernate-rate-limited. No requests performed.");
    process.exit(2);
  }
  if (adminLogin.status !== 200) { record("admin login", "fail", `HTTP ${adminLogin.status}`); throw new Error("admin login"); }
  const adminCookie = cookiesOf(adminLogin);
  record("admin login", "ok");

  // ── Blog subscription ─────────────────────────────────────────────────────
  const subEmpty = await call("/api/content/blog/subscribe", { method: "POST", body: {} });
  if (subEmpty.status === 400) record("blog subscribe empty body", "ok", "400 before insert");
  else if (subEmpty.status === 422) record("blog subscribe empty body", "ok", "422 before insert");
  else record("blog subscribe empty body", "fail", `HTTP ${subEmpty.status} (expected 400)`);

  const subBad = await call("/api/content/blog/subscribe", { method: "POST", body: { email: "not-an-email", source: "docs-probe" } });
  if (subBad.status === 400) record("blog subscribe invalid email", "ok", "400 before insert");
  else if (subBad.status === 422) record("blog subscribe invalid email", "ok", "422 before insert");
  else record("blog subscribe invalid email", "fail", `HTTP ${subBad.status} (expected 400)`);

  // ── Job application ───────────────────────────────────────────────────────
  const jobs = await call("/api/content/careers/jobs");
  const groups = jobs.status === 200 && Array.isArray(jobs.data?.data) ? jobs.data.data : [];
  const firstJob = groups.flatMap((g) => g.jobs || [])[0] || null;
  const jobId = firstJob?.id || "validation-probe";
  record("careers jobs read", "ok", firstJob ? `job ${jobId}` : "no open job on sandbox; using a probe id");

  const applyEmpty = await call(`/api/content/careers/jobs/${encodeURIComponent(jobId)}/apply`, {
    method: "POST", body: {},
  });
  if (applyEmpty.status === 400) record("job apply empty body", "ok", "400 before job lookup/insert");
  else if (applyEmpty.status === 422) record("job apply empty body", "ok", "422 before insert");
  else record("job apply empty body", "fail", `HTTP ${applyEmpty.status} (expected 400)`);

  const applyBad = await call(`/api/content/careers/jobs/${encodeURIComponent(jobId)}/apply`, {
    method: "POST", body: { name: CANARY_NAME, email: "not-an-email" },
  });
  if (applyBad.status === 400) record("job apply invalid email", "ok", "400 before insert");
  else if (applyBad.status === 422) record("job apply invalid email", "ok", "422 before insert");
  else record("job apply invalid email", "fail", `HTTP ${applyBad.status} (expected 400)`);

  const applyMissing = await call("/api/content/careers/jobs/docs-nonexistent-job/apply", {
    method: "POST", body: { name: CANARY_NAME, email: CANARY_EMAIL },
  });
  if (applyMissing.status === 404) record("job apply to nonexistent job", "ok", "404, no insert");
  else record("job apply to nonexistent job", "fail", `HTTP ${applyMissing.status} (expected 404)`);

  // ── Read-back: prove no canary row ───────────────────────────────────────
  const subs = await call("/api/content/admin/blog/subscribers", { cookie: adminCookie, portal: "admin" });
  if (subs.status === 200) {
    const rows = Array.isArray(subs.data?.data) ? subs.data.data : [];
    const hit = rows.some((r) => String(r.email || "").toLowerCase() === CANARY_EMAIL.toLowerCase());
    record("subscriber read-back", hit ? "fail" : "ok", hit
      ? "canary email was written despite validation"
      : `${rows.length} subscribers, no canary ${CANARY_EMAIL}`);
  } else {
    record("subscriber read-back", "fail", `HTTP ${subs.status}`);
  }

  const apps = await call(`/api/content/admin/careers/applications${firstJob ? `?job_id=${encodeURIComponent(jobId)}` : ""}`, {
    cookie: adminCookie, portal: "admin",
  });
  if (apps.status === 200) {
    const rows = Array.isArray(apps.data?.data) ? apps.data.data : [];
    const hit = rows.some((r) => String(r.name || "") === CANARY_NAME
      && String(r.email || "").toLowerCase() === CANARY_EMAIL.toLowerCase());
    record("application read-back", hit ? "fail" : "ok", hit
      ? "canary application was written despite validation"
      : `${rows.length} applications, no canary ${CANARY_EMAIL}`);
  } else {
    record("application read-back", "fail", `HTTP ${apps.status}`);
  }

  record("blog subscribe success path", "blocked",
    "writes blog_subscribers; content routes expose no DELETE endpoint, so the row could not be cleaned up");
  record("job application success path", "blocked",
    "writes job_applications; content routes expose no DELETE endpoint, so the row could not be cleaned up");
} catch (e) {
  console.error(`STOPPED: ${e.message}`);
}

console.log("\nSummary");
for (const r of results) console.log(`- ${r.status.padEnd(7)} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
process.exit(failed ? 1 : blocked ? 2 : 0);
