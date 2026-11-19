/**
 * Grand Plan Phase 18, items 3 and 6, in Agent Chat: the loop guard's
 * reminders on repeated calls, per-tool time limits ending in a `timeout`
 * observation the recovery rule handles, and asked-or-inferred on every
 * change (an inferred change with no rule is refused; the basis rides on the
 * executions and on the self-tooling / proactive / V4 rows). The loop runs for
 * real against a scripted fake model (no network), with stub tools.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
process.env.GOOGLE_CLIENT_ID ||= "test";
process.env.GOOGLE_CLIENT_SECRET ||= "test";
process.env.AKORO_BACKGROUND_JOBS_ENABLED = "false";
process.env.AGENT_EPISODES = "off";
{ const real = globalThis.setInterval; globalThis.setInterval = (...a) => { const t = real(...a); t?.unref?.(); return t; }; }

// A local server speaking the OpenAI streaming format; each request gets the next scripted turn.
const http = await import("node:http");
let script = [];
let served = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    // The intent step (a JSON reading before the benchmark's loop) gets a fixed answer and doesn't use up the script.
    if (/"response_format"/.test(body)) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ id: "i", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify({ want: "the learner's request", kind: "question", multiStep: false, missing: [] }) } }] }));
    }
    const turn =script[Math.min(served++, script.length - 1)] || { content: "" };
    const chunk = (delta) => `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (turn.content) res.write(chunk({ role: "assistant", content: turn.content }));
    (turn.tool_calls || []).forEach((c, i) => res.write(chunk({ tool_calls: [{ index: i, id: `call_${served}_${i}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments) } }] })));
    res.write(`data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: turn.tool_calls ? "tool_calls" : "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
server.unref();
process.env.FAKE_AGENT_KEY = "test";
process.env.AI_MODELS = JSON.stringify([{ id: "p18-fake", provider: "openai_compatible", apiModel: "p18-fake", baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKeyEnv: "FAKE_AGENT_KEY", price: { in: 0, out: 0 }, caps: { tools: true, stream: true } }]);

const chat = await import("../chat.js");
const { chatToolTimeLimit, runWithinLimit, timeoutResult, CHAT_TOOL_FAMILY_LIMITS_MS } = await import("./toolLimits.js");
const { shouldRetry, recoveryHint } = await import("./toolRecovery.js");
const { toolObservation } = await import("../../../utils/toolObservation.js");
const { runDry } = await import("../../../lib/dryRunContext.js");
const { withActionBasis, NO_RULE_CODE } = await import("../../agent-runtime/index.js");
const { scoreRun, longestRepeat } = await import("../../../lib/evals/benchmark.js");
const { benchmarkScenarios } = await import("../../../lib/evals/benchmark/scenarios.js");

const LEARNER = "00000000-0000-4000-8000-0000000018aa";
const tools = chat.getLearnerChatTools().map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

async function turn(turns, { callTool, ...rest }) {
  script = turns; served = 0;
  return chat.runAgentToolLoop({
    systemContent: "You are a test agent.", messages: [{ role: "user", content: "Is my study prep done?" }], studentId: LEARNER,
    tools, role: "student", model: "p18-fake", streamText: true, trace: null, callTool, meta: { __feature: "eval", __payer: "platform" }, ...rest,
  });
}
const toolMessages = (out) => out.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));

/* ── item 3: the loop guard in the chat loop ─────────────────────────────── */

test("chat: the 2nd identical call gets a reminder, the 4th a firm one naming the tool and the count", async () => {
  let calls = 0;
  const callTool = async () => { calls += 1; return { running: [{ kind: "study_prep", status: "generating_practice" }] }; };
  const same = { tool_calls: [{ name: "get_running_work", arguments: {} }] };
  const out = await turn([same, same, same, same, { content: "It's still running — 2 of 5 topics done." }], { callTool });
  assert.equal(calls, 4);
  const obs = toolMessages(out);
  assert.equal(obs[0].reminder, undefined);
  assert.match(obs[1].reminder, /same arguments, so the answer will not change/);
  assert.match(obs[2].reminder, /same arguments/);
  assert.match(obs[3].reminder, /get_running_work has now been called 4 times in a row with the same arguments \(\{\}\)/);
  assert.deepEqual(out.toolExecutions.map((x) => x.repeated ?? null), [null, 2, 3, 4]);
  assert.equal(out.finalText, "It's still running — 2 of 5 topics done.");
});

test("chat: different arguments are a new run; the ledger is not counted", async () => {
  const callTool = async () => ({ results: [] });
  const out = await turn([
    { tool_calls: [{ name: "search_my_library", arguments: { query: "osmosis" } }] },
    { tool_calls: [{ name: "search_my_library", arguments: { query: "osmosis notes" } }] },
    { tool_calls: [{ name: "search_my_library", arguments: { query: "osmosis notes" } }] },
    { content: "Nothing in your Library on that." },
  ], { callTool });
  const obs = toolMessages(out);
  assert.equal(obs[0].reminder, undefined);
  assert.equal(obs[1].reminder, undefined);
  assert.match(obs[2].reminder, /same arguments/);
});

/* ── item 3: time limits in the chat loop ────────────────────────────────── */

test("chat tool limits: declared per tool, else the family's", () => {
  assert.equal(chatToolTimeLimit("get_running_work"), CHAT_TOOL_FAMILY_LIMITS_MS.read);
  assert.equal(chatToolTimeLimit("create_task", { sideEffecting: true }), CHAT_TOOL_FAMILY_LIMITS_MS.change);
  assert.equal(chatToolTimeLimit("prepare_activity", { sideEffecting: true }), CHAT_TOOL_FAMILY_LIMITS_MS.model);
  assert.equal(chatToolTimeLimit("create_tool", { sideEffecting: true }), 300_000);
  for (const t of chat.getLearnerChatTools()) assert.ok(chatToolTimeLimit(t.name, { sideEffecting: chat.isSideEffecting(t.name, {}) }) > 0, t.name);
});

test("a time-out is a failure the recovery rule handles: a read is retried, a change is not", async () => {
  const r = await runWithinLimit(() => new Promise(() => {}), "get_running_work", { limitMs: 20 });
  assert.deepEqual(Object.keys(r).sort(), ["code", "error", "success", "timedOut"]);
  assert.equal(r.code, "timeout");
  assert.equal(shouldRetry("get_running_work", r), true);
  assert.equal(shouldRetry("create_task", timeoutResult(new Error("create_task did not finish within 90 s (timed out).")), { sideEffecting: true }), false, "it may still finish: never sent twice");
  const env = toolObservation({ action: "get_running_work", result: r });
  assert.equal(env.success, false);
  assert.equal(env.error_code, "timeout");
  assert.match(recoveryHint("get_running_work", r, { retried: true }).next, /get_running_work failed twice/);
  assert.equal(await runWithinLimit(async () => ({ ok: 1 }), "x", { limitMs: 50 }).then((x) => x.ok), 1);
});

test("chat: a stuck read times out, is tried once more, and the agent reads a `timeout` observation", async () => {
  let calls = 0;
  const callTool = () => { calls += 1; return new Promise(() => {}); };
  const started = Date.now();
  const out = await turn([
    { tool_calls: [{ name: "get_running_work", arguments: {} }] },
    { content: "I couldn't check just now — it took too long." },
  ], { callTool, toolLimitMs: 40 });
  assert.ok(Date.now() - started < 5_000, "the turn never stalls");
  assert.equal(calls, 2, "one automatic retry for a read");
  const [obs] = toolMessages(out);
  assert.equal(obs.success, false);
  assert.equal(obs.error_code, "timeout");
  assert.equal(obs.result.retried, true);
  assert.match(obs.result.recovery, /failed twice/);
});

test("chat: a stuck change times out once and is not repeated", async () => {
  let calls = 0;
  const callTool = () => { calls += 1; return new Promise(() => {}); };
  const out = await turn([
    { tool_calls: [{ name: "create_task", arguments: { title: "Revise osmosis" } }] },
    { content: "That didn't go through in time — check your tasks before I try again." },
  ], { callTool, toolLimitMs: 40 });
  assert.equal(calls, 1);
  assert.equal(toolMessages(out)[0].error_code, "timeout");
});

/* ── item 6: asked or inferred in Agent Chat ─────────────────────────────── */

test("chat: a person's turn is explicit, and every change says so", async () => {
  const callTool = async () => ({ success: true, taskId: "t1", title: "Revise osmosis" });
  const out = await turn([
    { tool_calls: [{ name: "create_task", arguments: { title: "Revise osmosis" } }, { name: "get_running_work", arguments: {} }] },
    { content: "Added." },
  ], { callTool });
  const [change, readCall] = out.toolExecutions;
  assert.deepEqual([change.basis, change.rule], ["explicit", null]);
  assert.equal(readCall.basis, undefined, "reads carry no basis");
});

test("chat: an inferred turn with no rule has its change refused (the tool never runs); with a rule it runs", async () => {
  let calls = 0;
  const callTool = async () => { calls += 1; return { success: true }; };
  const step = [{ tool_calls: [{ name: "create_task", arguments: { title: "Revise osmosis" } }] }, { content: "ok" }];
  let out = await turn(step, { callTool, basis: { basis: "inferred" } });
  assert.equal(calls, 0);
  const [obs] = toolMessages(out);
  assert.equal(obs.success, false);
  assert.equal(obs.result.code, NO_RULE_CODE);
  assert.equal(obs.error_code, "not_allowed");
  out = await turn(step, { callTool, basis: { basis: "inferred", rule: "proactive:task" } });
  assert.equal(calls, 1);
  assert.deepEqual([out.toolExecutions[0].basis, out.toolExecutions[0].rule], ["inferred", "proactive:task"]);
});

test("executeChatTool: explicit by default, inherits the work's basis, refuses an unruled inferred change", async () => {
  assert.deepEqual(chat.chatToolBasis({}), { basis: "explicit", rule: null });
  assert.deepEqual(chat.chatToolBasis({ basis: "inferred", rule: "consent:autonomy" }), { basis: "inferred", rule: "consent:autonomy" });
  const refused = await chat.executeChatTool("create_task", { title: "x" }, LEARNER, { basis: "inferred" });
  assert.equal(refused.success, false);
  assert.equal(refused.code, NO_RULE_CODE);
  // DRY: what would be done, without a database — reached only once the basis passes.
  const dry = await runDry(() => chat.executeChatTool("create_task", { title: "x" }, LEARNER, { basis: "inferred", rule: "proactive:task" }));
  assert.equal(dry.dryRun, true);
  const inherited = await withActionBasis({ basis: "inferred", rule: null }, () => runDry(() => chat.executeChatTool("create_task", { title: "x" }, LEARNER)));
  assert.equal(inherited.code, NO_RULE_CODE, "a call inside unruled inferred work is refused too");
  const ok = await withActionBasis({ basis: "inferred", rule: "approved_request:r1" }, () => runDry(() => chat.executeChatTool("create_task", { title: "x" }, LEARNER)));
  assert.equal(ok.dryRun, true);
});

test("the rows: self-tooling builds and change cards, proactive proposals, V4 runs carry the basis", async () => {
  assert.match(read("../../self-tooling/pipeline.js"), /insert\(\{ \.\.\.row, \.\.\.basisColumns\(currentActionBasis\(\) \|\| \{ basis: "explicit" \}\) \}\)/);
  assert.equal((read("../../self-tooling/confirmations.js").match(/\.\.\.basisColumns\(currentActionBasis\(\) \|\| \{ basis: "explicit" \}\)/g) || []).length, 2);
  assert.match(read("../../self-tooling/escalation.js"), /withActionBasis\(\{ basis: "inferred", rule: RULES\.request\(claimed\.id\) \}, \(\) => createTool\(/);
  for (const f of ["../../autonomy/cycle.js", "../../autonomy/instructorCycle.js"]) assert.match(read(f), /basisColumns\(\{ basis: "inferred", rule: RULES\.proactive\(p\.kind\) \}\)/, f);
  assert.match(read("../../verify/realUser.js"), /\.\.\.basisColumns\(\{ basis: "explicit" \}\)/);
  assert.match(read("../../verify/realUser.js"), /\.\.\.basisOfRow\(r, \{ basis: "explicit" \}\)/);
  const sql = read("../../../migrations/2026-agent-action-basis.sql");
  for (const t of ["self_tool_events", "agent_tool_write_confirmations", "agent_proposals", "verify_real_user_runs"]) assert.match(sql, new RegExp(`ALTER TABLE edu\\.${t}\\s+ADD COLUMN IF NOT EXISTS basis`), t);
  const manifest = JSON.parse(read("../../../migrations/manifest.json"));
  assert.ok(manifest.schema.includes("2026-agent-action-basis.sql"));

  const { auditRow } = await import("../../self-tooling/index.js");
  assert.deepEqual(auditRow({ id: "e", user_id: "u", goal: "g", outcome: "created", created_at: "t", basis: "inferred", basis_rule: "approved_request:r" }, "build"),
    { kind: "build", id: "e", userId: "u", goal: "g", outcome: "created", toolId: null, reason: null, createdAt: "t", basis: "inferred", rule: "approved_request:r" });
  assert.equal(auditRow({ id: "c", principal_id: "u", tool_name: "selftool:tasks.delete", status: "pending", created_at: "t", basis: "explicit" }, "change").tool, "tasks.delete");

  const { proposalMeta, proposalBasis } = await import("../../autonomy/index.js");
  assert.deepEqual(proposalBasis({ kind: "task" }), { basis: "inferred", rule: "proactive:task" });
  assert.equal(proposalBasis({}).rule, null, "no kind, no rule: never delivered");
  assert.equal(proposalMeta({ id: "p", kind: "goal", title: "T" }).rule, "proactive:goal");
  assert.match(read("../../autonomy/deliver.js"), /const refused = basisRefusal\(proposalBasis\(p\), \{ action: "proactive delivery" \}\);/);
  const { mergeInbox } = await import("../../agent-proposals/index.js");
  const [item] = mergeInbox({ proposals: [{ id: "p", kind: "task", title: "Revise", created_at: "t" }] });
  assert.deepEqual([item.basis, item.rule], ["inferred", "proactive:task"]);
});

test("the admin API: the self-tooling audit route", () => {
  assert.match(read("../../admin/agent-tools.js"), /router\.get\("\/self-tooling\/audit", adminOnly,/);
});

/* ── item 3: the benchmark's repeating stub ──────────────────────────────── */

test("benchmark: a repeat_guard case per subject, scored on back-to-back repeats", () => {
  const cases = benchmarkScenarios().filter((s) => s.template === "repeat_guard");
  assert.equal(cases.length, 5);
  assert.equal(cases[0].success.maxRepeats, 3);
  assert.equal(longestRepeat([{ name: "a", input: { x: 1 } }, { name: "update_plan", input: {} }, { name: "a", input: { x: 1 } }, { name: "a", input: { x: 2 } }]), 2);
  const isSide = () => false;
  const exec = (n) => Array.from({ length: n }, () => ({ tool: "get_running_work", success: true }));
  const calls = (n) => Array.from({ length: n }, () => ({ name: "get_running_work", input: {} }));
  assert.equal(scoreRun(cases[0], { calls: calls(2), reply: "It's still running: 2 of 5 topics.", executions: exec(2), isSide }).success, true);
  const looped = scoreRun(cases[0], { calls: calls(5), reply: "It's still running.", executions: exec(5), isSide });
  assert.equal(looped.success, false);
  assert.equal(looped.checks.noRepeat, false);
});

test("benchmark end to end: the repeating stub, the guard's reminder, and a pass", async () => {
  const { benchmarkSuite } = await import("../../../lib/evals/benchmark.js");
  const sc = benchmarkSuite.cases.find((c) => c.key.includes("repeat_guard") && c.key.endsWith("biology"));
  script = [
    { tool_calls: [{ name: "get_running_work", arguments: {} }] },
    { tool_calls: [{ name: "get_running_work", arguments: {} }] },
    { content: "Your Biology study prep is still running — 2 of 5 topics so far. I'll stop checking; ask me again later." },
  ];
  served = 0;
  const out = await sc.run({ model: "p18-fake", userId: null });
  assert.equal(out.passed, true, out.detail);
  assert.deepEqual(out.actual.calls, ["get_running_work", "get_running_work"]);
});
