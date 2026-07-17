#!/usr/bin/env node
/**
 * scripts/smoke-tasks.mjs
 * End-to-end smoke test for the learner task system. Run this against a LIVE
 * environment (real Redis + Anthropic + Supabase) to confirm that when a user
 * creates a task, the worker runs the tool and delivers an output.
 *
 * It logs in as a learner, creates one task per learner intent, waits for the
 * agent run to finish, and asserts each produced an output of the expected
 * type. Prints a per-tool PASS/FAIL table and exits non-zero if any fail — so
 * it works both by hand and in CI.
 *
 * Usage:
 *   node scripts/smoke-tasks.mjs
 *
 * Env (all optional — defaults target the demo seed data):
 *   SMOKE_API_URL     API base URL              (default http://localhost:4000)
 *   SMOKE_EMAIL       learner email             (default stu.jss11@demo.akoro.app)
 *   SMOKE_PASSWORD    learner password          (default Priya2026)
 *   SMOKE_OPPONENT_ID a real peer user id → also runs the challenge_peer tool
 *   SMOKE_TIMEOUT_MS  per-task wait budget      (default 120000)
 *   SMOKE_POLL_MS     poll interval             (default 3000)
 */

const API      = (process.env.SMOKE_API_URL  || "http://localhost:4000").replace(/\/$/, "");
const EMAIL    = process.env.SMOKE_EMAIL      || "stu.jss11@demo.akoro.app";
const PASSWORD = process.env.SMOKE_PASSWORD   || "Priya2026";
const TIMEOUT  = parseInt(process.env.SMOKE_TIMEOUT_MS || "120000", 10);
const POLL     = parseInt(process.env.SMOKE_POLL_MS     || "3000", 10);
const OPPONENT = process.env.SMOKE_OPPONENT_ID || null;

// ── tiny cookie jar over fetch ────────────────────────────────────────────────
let cookies = "";
function absorb(res) {
  const jar = {};
  for (const c of cookies.split("; ").filter(Boolean)) { const [k, ...v] = c.split("="); jar[k] = v.join("="); }
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";"); const [k, ...v] = pair.split("=");
    if (k) jar[k.trim()] = v.join("=");
  }
  cookies = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}
async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookies ? { Cookie: cookies } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  absorb(res);
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── intents to exercise ───────────────────────────────────────────────────────
const CASES = [
  { key: "quiz_me",            title: "Quiz me on Algebra",                       expect: "quiz" },
  { key: "explain_concept",    title: "Explain photosynthesis to me",            expect: "explanation" },
  { key: "create_study_plan",  title: "Create a study plan for Biology",         expect: "study_plan" },
  { key: "set_study_reminder", title: "Remind me to revise chapter 5 tonight",   expect: "reminder" },
];
if (OPPONENT) {
  CASES.push({
    key: "challenge_peer",
    title: `Challenge my friend to a battle on Fractions`,
    expect: "battle",
    body: { description: `opponentId: ${OPPONENT}` },
  });
}

async function runCase(c) {
  const started = Date.now();
  const created = await req("POST", "/api/tasks", { title: c.title, priority: "medium", ...(c.body ?? {}) });
  const taskId = created.json?.task?.id;
  if (!taskId) return { ...c, ok: false, detail: `create failed (HTTP ${created.status}): ${created.json?.error ?? "no task id"}` };

  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    await sleep(POLL);
    const outs = await req("GET", `/api/tasks/${taskId}/outputs`);
    const outputs = outs.json?.outputs ?? [];
    if (outputs.length) {
      const types = outputs.map((o) => o.output_type);
      const ok = types.includes(c.expect);
      return { ...c, ok, taskId, secs: ((Date.now() - started) / 1000).toFixed(1),
               detail: ok ? `output_type=${c.expect}` : `got [${types.join(", ")}], expected ${c.expect}` };
    }
    const t = await req("GET", `/api/tasks/${taskId}`);
    if (t.json?.task?.status === "failed") return { ...c, ok: false, taskId, detail: "task status=failed" };
  }
  return { ...c, ok: false, taskId, detail: `timed out after ${TIMEOUT / 1000}s (no outputs)` };
}

(async () => {
  console.log(`\n▶  Task smoke test → ${API}  (as ${EMAIL})\n`);

  const login = await req("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (login.status !== 200 || !cookies) {
    console.error(`✖  Login failed (HTTP ${login.status}): ${login.json?.message ?? "no cookie set"}`);
    process.exit(2);
  }
  if (login.json?.data?.twoFactorRequired) { console.error("✖  Account has 2FA enabled — use a non-2FA test user."); process.exit(2); }

  // Ensure an agent exists (auto-created by GET) so task creation can resolve it.
  const agent = await req("GET", "/api/user/agent");
  const agentName = agent.json?.data?.agent_name ?? agent.json?.agent_name ?? "(unknown)";
  console.log(`✓  Logged in. Agent: ${agentName}\n`);

  const results = [];
  for (const c of CASES) {
    process.stdout.write(`   … ${c.key.padEnd(18)} `);
    const r = await runCase(c);
    results.push(r);
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.secs ? r.secs + "s  " : ""}${r.detail}`);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${"─".repeat(52)}`);
  console.log(`  ${passed}/${results.length} tools produced the expected output`);
  console.log(`${"─".repeat(52)}\n`);
  if (!OPPONENT) console.log("  (set SMOKE_OPPONENT_ID=<peer user id> to also test challenge_peer)\n");

  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error("✖  Smoke test crashed:", e.message); process.exit(2); });
