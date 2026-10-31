/**
 * Grand Plan Phase 17, phase 1 — one agent contract for the three loops, and
 * the trajectory recorder (training/SPEC.md §2, §3, §9).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { CONTRACT, ERROR_CODES, classifyError, contractObservation } = await import("./contract.js");
const { createEpisodeRecorder, computeChecks, verdictOf } = await import("./episode.js");
const { anonymiseEpisode, scrubText } = await import("./anonymise.js");
const { episodeMode, saveEpisode, recordsRealTraffic } = await import("./store.js");
const { toolObservation } = await import("../../utils/toolObservation.js");
const { observationFor } = await import("../agent-runtime/loop.js");

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

/* ── The error codes ────────────────────────────────────────────────────── */

test("failures are classified into the contract's codes", () => {
  const cases = [
    ["The search timed out", "timeout"], ["Service unavailable (503)", "unavailable"], ["due_at must be in the future", "invalid_arguments"],
    ["Only admins can do that", "not_allowed"], ["Not enough coins to start this", "insufficient_balance"], ["Session not found", "not_found"],
    ["The session has already started", "state_conflict"], ["Which subject is the test in?", "missing_information"], ["Something odd", "unknown"],
  ];
  for (const [text, code] of cases) assert.equal(classifyError(text).code, code, text);
  assert.equal(classifyError({ code: "decision_timeout" }).code, "timeout", "the workflow loop's own codes map across");
  assert.equal(classifyError({ code: "unknown_action" }).code, "invalid_arguments");
  assert.equal(classifyError({ confirmation: { confirmationId: "c1" } }).code, "needs_confirmation");
  assert.equal(ERROR_CODES.timeout.retryable, true);
  assert.equal(ERROR_CODES.not_allowed.retryable, false);
});

test("all three loops speak it: chat and tasks through the envelope, workflows beside their own code", () => {
  const ok = toolObservation({ action: "list_tasks", result: { tasks: [] }, requestId: "req_1" });
  assert.equal("error_code" in ok, false, "a success keeps its exact old shape");
  const bad = toolObservation({ action: "create_task", result: { error: "due_at must be in the future" } });
  assert.equal(bad.error_code, "invalid_arguments");
  assert.equal(bad.retryable, false);
  const wf = observationFor({ ok: false, error: { code: "decision_timeout", message: "late" } });
  assert.equal(wf.code, "decision_timeout", "the workflow keeps its own code");
  assert.equal(wf.error_code, "timeout");
  assert.equal(contractObservation({ success: false, action: "x", error: "Forbidden" }).error_code, "not_allowed");
});

test("the loops record: chat (decision + observation), tasks (recorder), workflows (episode)", () => {
  const chat = read("../adaptive-learning/chat.js");
  assert.match(chat, /recorder\.decision\(\{ tool_calls: calls\.map/);
  assert.match(chat, /recorder\?\.observation\(observation\);/);
  assert.match(chat, /const runTool = callTool \|\| \(\(name, input\) => executeChatTool\(name, input, studentId, \{ conversationId, role \}\)\);/, "the benchmark's one seam");
  const tasks = read("../tasks/lib/agentLoop.js");
  assert.match(tasks, /recorder\.decision\(tc\.length \? \{ tool_calls: tc \} : \{ reply: msg\.content \?\? "" \}\);/);
  assert.match(tasks, /recorder\?\.observation\(observation\);/);
  const wf = read("../agent-runtime/loop.js");
  assert.match(wf, /episode\?\.decision\(\{ tool_calls: \[\{ name: requested, arguments: step\.args \|\| \{\} \}\]/);
  assert.match(wf, /episode\?\.observation\(/);
});

/* ── The recorder and its verdict ───────────────────────────────────────── */

test("an episode: decisions and observations in order, a code-computed pass", () => {
  const rec = createEpisodeRecorder({ surface: "agent_chat", source: "synthetic", tools: [{ type: "function", function: { name: "create_task", description: "d", parameters: {} } }], messages: [{ role: "user", content: "Add a task for Friday" }] });
  rec.decision({ tool_calls: [{ name: "create_task", arguments: { title: "Revise" } }], intent: "make the task" });
  rec.observation(toolObservation({ action: "create_task", result: { success: true, taskId: "t1" } }));
  rec.decision({ reply: "I've created a revision task for Friday." });
  const ep = rec.finish({ sideEffecting: (t) => t === "create_task", success: true, capabilities: ["tool_execution", "nonsense"] });
  assert.equal(ep.contract, CONTRACT);
  assert.equal(ep.turn_input.tools[0].name, "create_task");
  assert.deepEqual(ep.capabilities, ["tool_execution"]);
  assert.equal(ep.steps.length, 2);
  assert.equal(ep.steps[0].observation.action, "create_task");
  assert.equal(ep.outcome.verdict, "pass");
});

test("a claim with nothing behind it, a retry after not_allowed, and a doubled change all fail", () => {
  const steps = (calls, reply) => [...calls, { decision: { reply } }];
  let checks = computeChecks({ steps: steps([], "I've created your task."), sideEffecting: () => true });
  assert.deepEqual(verdictOf(checks), { verdict: "fail", failure_class: "unbacked_claim" });
  checks = computeChecks({ steps: steps([
    { decision: { tool_calls: [{ name: "block_agent", arguments: {} }] }, observation: { action: "block_agent", success: false, error_code: "not_allowed" } },
    { decision: { tool_calls: [{ name: "block_agent", arguments: {} }] }, observation: { action: "block_agent", success: false, error_code: "not_allowed" } },
  ], "I couldn't do that.") });
  assert.equal(verdictOf(checks).failure_class, "policy_violation");
  const call = { decision: { tool_calls: [{ name: "class_battle", arguments: { topic: "fractions" } }] }, observation: { action: "class_battle", success: true } };
  checks = computeChecks({ steps: steps([call, call], "Done."), sideEffecting: (t) => t === "class_battle" });
  assert.equal(checks.no_repeated_side_effect, false);
});

/* ── Anonymisation ──────────────────────────────────────────────────────── */

test("anonymised before storage: names, contacts and ids replaced; identifying keys redacted", () => {
  assert.equal(scrubText("I'm Amara, amara@example.com, 08031234567, @amara_j", { names: ["Amara"] }), "I'm <NAME>, <EMAIL>, <PHONE>, <USERNAME>");
  const ep = {
    turn_input: { surface: "agent_chat", system: "secret doctrine", messages: [{ role: "user", content: "Hi I'm Amara, set a task" }], state: {} },
    steps: [{ decision: { tool_calls: [{ name: "create_task", arguments: { title: "Revise" } }] }, observation: { action: "create_task", success: true, result: { taskId: "3f2a9c1e-1b2c-4d5e-8f90-123456789abc", user_id: "u1" } } }],
    meta: { ms: 10, created_at: "2026-10-31", scenario: "x" },
  };
  const out = anonymiseEpisode(ep, { names: ["Amara"] });
  assert.equal(out.source, "real");
  assert.equal(out.turn_input.system, "<SYSTEM>");
  assert.match(out.turn_input.messages[0].content, /<NAME>/);
  assert.equal(out.steps[0].observation.result.taskId, "<ID>");
  assert.equal(out.steps[0].observation.result.user_id, "<REDACTED>");
});

test("an episode touching a sensitive topic is never kept", () => {
  const ep = { turn_input: { messages: [{ role: "user", content: "I've been feeling depressed and can't study" }] }, steps: [] };
  assert.equal(anonymiseEpisode(ep), null);
});

/* ── Storage modes ──────────────────────────────────────────────────────── */

test("modes: synthetic by default; real traffic only in consented or all; an opt-out always wins", async () => {
  assert.equal(episodeMode({}), "synthetic");
  assert.equal(episodeMode({ AGENT_EPISODES: "all" }), "all");
  assert.equal(episodeMode({ AGENT_EPISODES: "nonsense" }), "synthetic");
  assert.equal(await saveEpisode({ source: "real", turn_input: {}, steps: [] }, { env: { AGENT_EPISODES: "synthetic" } }), "skipped");
  assert.equal(await saveEpisode({ source: "synthetic" }, { env: { AGENT_EPISODES: "off" } }), "skipped");
  assert.equal(await recordsRealTraffic("u1", { AGENT_EPISODES: "synthetic" }), false, "no lookup, no recorder");
  const store = read("./store.js");
  assert.match(store, /if \(data\?\.agent_training_opt_out === true\) return false;   \/\/ an opt-out always wins/);
  assert.match(store, /return mode === "all" \? true : data\?\.agent_training_consent === true;/);
});

test("the opt-out is in the learner's settings and the migration", () => {
  const routes = read("../autonomy/learnerRoutes.js");
  assert.match(routes, /improveAgent: user\?\.agent_training_opt_out !== true/);
  assert.match(routes, /update\(\{ agent_training_opt_out: !b\.improveAgent \}\)/);
  const ui = read("../../../akoro-learner/src/pages/settings/autonomySection.jsx");
  assert.match(ui, /Help improve Akoro's study agent/);
  const sql = read("../../migrations/2026-agent-episodes.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS edu\.agent_episodes/);
  assert.match(sql, /agent_training_opt_out boolean NOT NULL DEFAULT false/);
  assert.match(sql, /REVOKE ALL ON edu\.agent_episodes FROM anon, authenticated/);
  assert.match(read("../../migrations/manifest.json"), /"2026-agent-episodes\.sql"/);
});
