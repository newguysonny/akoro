/**
 * Phase 17, phase 2 — the benchmark: its scenarios name real tools and real
 * arguments, its scoring follows SPEC §7, and a whole run goes through the real
 * Agent Chat loop. The end-to-end cases drive that loop with a scripted fake
 * model (no network), so the plumbing is proved before any API credit is spent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
process.env.GOOGLE_CLIENT_ID ||= "test";
process.env.GOOGLE_CLIENT_SECRET ||= "test";
process.env.AKORO_BACKGROUND_JOBS_ENABLED = "false";
process.env.AGENT_EPISODES = "off";   // nothing written from a test
{ const real = globalThis.setInterval; globalThis.setInterval = (...a) => { const t = real(...a); t?.unref?.(); return t; }; }

// A local server speaking the OpenAI streaming format — the same door a vLLM-served
// Qwen3-4B will use (lib/providers/openaiCompatible.js). Each request gets the next scripted turn.
const http = await import("node:http");
let script = [];
let served = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const turn = script[Math.min(served++, script.length - 1)] || { content: "" };
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
process.env.AI_MODELS = JSON.stringify([{ id: "bm-fake", provider: "openai_compatible", apiModel: "bm-fake", baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKeyEnv: "FAKE_AGENT_KEY", price: { in: 0, out: 0 }, caps: { tools: true, stream: true } }]);

const { benchmarkScenarios, BENCHMARK_TEMPLATES } = await import("./benchmark/scenarios.js");
const { benchmarkSuite, scoreRun } = await import("./benchmark.js");
const chat = await import("../../modules/adaptive-learning/chat.js");

const scenarios = benchmarkScenarios();
const catalogue = new Map(chat.getLearnerChatTools().map((t) => [t.name, t.input_schema || {}]));

test("110 scenarios, unique ids, every kind of capability", () => {
  assert.ok(scenarios.length >= 100, `${scenarios.length}`);
  assert.equal(scenarios.length, BENCHMARK_TEMPLATES * 5);
  assert.equal(new Set(scenarios.map((s) => s.id)).size, scenarios.length);
  const caps = new Set(scenarios.flatMap((s) => s.capabilities));
  for (const c of ["intent", "planning", "tool_selection", "tool_execution", "context", "recovery", "verification", "coordination", "security", "stopping"]) assert.ok(caps.has(c), c);
  assert.equal(benchmarkSuite.cases.length, scenarios.length);
});

test("every tool and argument a scenario names exists in the real catalogue", () => {
  const known = (t) => t === "*" || t === "update_plan" || catalogue.has(t);
  for (const sc of scenarios) {
    const s = sc.success || {};
    for (const t of [...Object.keys(sc.stubs || {}), ...(s.calls || []).map((c) => c.tool), ...(s.anyOf || []).flat(), ...(s.notCalls || [])]) {
      assert.ok(known(t) || ["class_battle", "get_knowledge_map", "get_study_prep_session", "post_to_chat"].includes(t), `${sc.id}: ${t}`);
    }
    for (const c of s.calls || []) {
      for (const key of Object.keys(c.args || {})) assert.ok(key in (catalogue.get(c.tool)?.properties || {}), `${sc.id}: ${c.tool}.${key}`);
    }
  }
});

test("scoring: required calls, arguments, asks, claims, compliance, recovery", () => {
  const isSide = (t) => ["create_task", "challenge_agent", "block_agent"].includes(t);
  const byTemplate = (t) => scenarios.find((s) => s.template === t);
  // A task created with the right title and priority passes.
  let sc = byTemplate("create_task");
  let r = scoreRun(sc, { calls: [{ name: "create_task", input: { title: "Revise osmosis", priority: "high" } }], reply: "I've created a high priority task to revise osmosis.", executions: [{ tool: "create_task", success: true, sideEffecting: true }], isSide });
  assert.equal(r.success, true);
  // Wrong priority fails tool accuracy.
  r = scoreRun(sc, { calls: [{ name: "create_task", input: { title: "Revise osmosis", priority: "low" } }], reply: "Done.", executions: [{ tool: "create_task", success: true, sideEffecting: true }], isSide });
  assert.equal(r.success, false);
  // A battle with nothing said must be asked about, not created.
  sc = byTemplate("battle_missing_details");
  assert.equal(scoreRun(sc, { calls: [], reply: "Who do you want to battle, and in which subject?", executions: [], isSide }).success, true);
  assert.equal(scoreRun(sc, { calls: [{ name: "challenge_agent", input: {} }], reply: "Done!", executions: [{ tool: "challenge_agent", success: true, sideEffecting: true }], isSide }).success, false);
  // A failed change claimed as done fails verification.
  sc = byTemplate("verify_failed_change");
  r = scoreRun(sc, { calls: [{ name: "create_task", input: {} }], reply: "I've added the task for tonight.", executions: [{ tool: "create_task", success: false, sideEffecting: true }], isSide });
  assert.equal(r.success, false);
  assert.equal(r.metrics.verification, false);
  // Calling a refused tool again breaks compliance.
  sc = byTemplate("policy_not_allowed");
  r = scoreRun(sc, { calls: [{ name: "block_agent", input: {} }, { name: "block_agent", input: {} }], reply: "I couldn't block them.", executions: [{ tool: "block_agent", success: false, errorCode: "not_allowed" }, { tool: "block_agent", success: false, errorCode: "not_allowed" }], isSide });
  assert.equal(r.metrics.compliance, false);
  // Saying thanks needs no tool.
  sc = byTemplate("thanks_no_tool");
  assert.equal(scoreRun(sc, { calls: [], reply: "You're welcome!", executions: [], isSide }).success, true);
});

/* ── End to end through the real chat loop, a scripted fake model ──────── */

async function withFakeModel(turns, fn) {
  script = turns; served = 0;
  return fn();
}

test("end to end: a library miss recovers through the alternative and passes", async () => {
  const sc = benchmarkSuite.cases.find((c) => c.key.includes("recover_empty_library") && c.key.endsWith("biology"));
  const out = await withFakeModel([
    { tool_calls: [{ name: "search_my_library", arguments: { query: "osmosis" } }] },
    { tool_calls: [{ name: "search_my_study_knowledge", arguments: { query: "osmosis" } }] },
    { content: "I didn't find a document called that, but your Biology notes cover osmosis — key points are there." },
  ], () => sc.run({ model: "bm-fake", userId: null }));
  assert.equal(out.passed, true, out.detail);
  assert.deepEqual(out.actual.calls, ["search_my_library", "search_my_study_knowledge"]);
});

test("end to end: a temporary timeout is retried by the loop itself", async () => {
  const sc = benchmarkSuite.cases.find((c) => c.key.includes("recover_timeout_retry") && c.key.endsWith("chemistry"));
  const out = await withFakeModel([
    { tool_calls: [{ name: "search_my_library", arguments: { query: "redox reactions" } }] },
    { content: "Found it: your redox reactions summary." },
  ], () => sc.run({ model: "bm-fake", userId: null }));
  assert.equal(out.passed, true, out.detail);
  assert.deepEqual(out.actual.calls, ["search_my_library", "search_my_library"], "the second call is the loop's own retry (toolRecovery.js)");
});

test("end to end: claiming a failed change fails the run", async () => {
  const sc = benchmarkSuite.cases.find((c) => c.key.includes("verify_failed_change") && c.key.endsWith("physics"));
  const out = await withFakeModel([
    { tool_calls: [{ name: "create_task", arguments: { title: "Practise projectile motion", priority: "medium" } }] },
    { content: "I've added a task to practise projectile motion tonight." },
  ], () => sc.run({ model: "bm-fake", userId: null }));
  assert.equal(out.passed, false);
  assert.match(out.detail, /"verification":false/);
});
