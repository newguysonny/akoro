// The Agent Check as its own workflow (2026-10-20): its battle is in Battles,
// its run streams in the Study Prep chat — the card, each marked question, the
// result — and a retest is a new battle with its own workflow and card.
import assert from "node:assert/strict";
import test from "node:test";
import { createWorkflowEngine } from "../../workflows/index.js";
import { memoryWorkflowStore } from "../../workflows/index.js";
import { narrate } from "../../workflows/index.js";
import "./workflow.js";
import { agentCheckWorkflow, CHECK_QUESTION_TOOL, checkView, makeAgentCheckRun, markedRow, questionRow, START_CHECK_TOOL } from "./agent-check-run.js";

const L = "learner-1";
function world() {
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store, publish: () => {} });
  const messages = [];
  const run = makeAgentCheckRun({
    engine, log: { warn() {} },
    findByBattle: async (battleId) => (await store.listInstances(L)).find((i) => i.workflow_type === "practice" && i.metadata?.battleId === battleId) || null,
    studyPrep: { openWake: async (m) => { messages.push(m); } },
  });
  return { store, engine, run, messages };
}
async function parent(engine) {
  return (await engine.create({ workflowType: "study_prep", learnerId: L, state: "topic_active", idempotencyKey: "study_prep:s1", metadata: { studyPrepSessionId: "s1" } })).instance;
}
const session = (p) => ({ id: "s1", learner_id: L, workflow_id: p.id, subject: "Biology" });
const topic = { id: "t1", label: "Osmosis" };

test("the workflow: running → completed | stopped | abandoned", () => {
  assert.equal(agentCheckWorkflow.type, "practice");
  assert.deepEqual(agentCheckWorkflow.transitions.running, ["completed", "stopped", "abandoned"]);
  assert.equal(agentCheckWorkflow.statusOf.stopped, "cancelled");
});

test("rows: each marked question and the result in plain words", () => {
  assert.equal(questionRow({ order: 1, total: 5, outcome: "correct", note: "osmosis" }).headline, "Q1 of 5 · answered from your notes");
  assert.equal(questionRow({ order: 2, total: 5, outcome: "guessed", gap: "plasmolysis" }).resultLine, "Nothing in your notes on plasmolysis");
  assert.equal(questionRow({ order: 3, total: 5, outcome: "guessed_right" }).ok, false, "a lucky guess isn't a pass");
  assert.equal(questionRow({ order: 4, total: 5, outcome: "wrong" }).headline, "Q4 of 5 · answered wrong");
  assert.equal(markedRow({ correct: 2, total: 5, outcome: "retest_offered", thresholdPercentage: 80 }).headline, "Marked: 2 of 5 · below the pass mark (80%)");
  assert.equal(markedRow({ correct: 5, total: 5, outcome: "understood" }).headline, "Marked: 5 of 5 · passed");
});

test("a check: its card on the run's message, a row per question in that run, the result closes it", async () => {
  const w = world();
  const p = await parent(w.engine);
  const view = await w.run.started({ session: session(p), topic, battleId: "b1", mode: "diagnostic", questions: 5, auto: true });
  assert.equal(view.state, "running");
  assert.equal(w.messages[0].label, "The Agent Check started by itself");
  assert.deepEqual(w.messages[0].extraMeta.agentCheck, { workflowId: view.workflowId, battleId: "b1", topic: "Osmosis", mode: "diagnostic", total: 5, title: "Agent Check: Osmosis" });
  assert.equal((await w.run.started({ session: session(p), topic, battleId: "b1", questions: 5 })).workflowId, view.workflowId, "once per battle");

  await w.run.question({ battleId: "b1", order: 1, total: 5, outcome: "correct", note: "osmosis" });
  await w.run.question({ battleId: "b1", order: 2, total: 5, outcome: "guessed", gap: "plasmolysis" });
  assert.equal(checkView(await w.engine.get(view.workflowId)).answered, 2);
  const done = await w.run.scored({ battleId: "b1", result: { correct: 2, total: 5, guessed: 1, gaps: ["plasmolysis"] }, outcome: "retest_offered", thresholdPercentage: 80 });
  assert.equal(done.state, "completed");
  assert.equal(done.result.outcome, "retest_offered");
  assert.equal(await w.run.question({ battleId: "b1", order: 3, total: 5, outcome: "wrong" }), null, "nothing after it's marked");

  const events = await w.store.listEvents(p.id);
  const kinds = events.map((e) => e.event_type);
  assert.equal(kinds[0], "operation.started");
  assert.equal(kinds[kinds.length - 1], "operation.completed", "the run is closed by the result");
  const rows = events.filter((e) => e.event_type === "tool.completed").map((e) => narrate({ type: e.event_type, payload: e.payload }).headline);
  assert.deepEqual(rows, ["Agent Check created: Osmosis", "Q1 of 5 · answered from your notes", "Q2 of 5 · guessed", "Marked: 2 of 5 · below the pass mark (80%)"]);
  assert.ok(events.filter((e) => e.payload?.tool === CHECK_QUESTION_TOOL).every((e) => e.payload.runId === "check:b1"), "each row names its run (it lands there even if another turn starts)");
  assert.ok(events.some((e) => e.payload?.tool === START_CHECK_TOOL && e.payload.resultLine === "In Battles · 5 questions · 2 coins"));
  assert.ok(events.every((e) => e.visibility === "learner"));
  assert.equal(events.find((e) => e.event_type === "tool.completed" && e.payload?.headline === "Q2 of 5 · guessed").payload.ok, false, "a guess is a miss, shown as one");
});

test("a retest is a new battle: a new workflow and a new card; a stopped check closes its run", async () => {
  const w = world();
  const p = await parent(w.engine);
  const first = await w.run.started({ session: session(p), topic, battleId: "b1", questions: 5 });
  await w.run.scored({ battleId: "b1", result: { correct: 2, total: 5 }, outcome: "retest_offered" });
  const retest = await w.run.started({ session: session(p), topic, battleId: "b2", mode: "retest", questions: 5 });
  assert.notEqual(retest.workflowId, first.workflowId);
  assert.equal(w.messages[1].extraMeta.agentCheck.title, "Retest: Osmosis");
  assert.equal(w.messages[1].label, "You started the retest");
  const stopped = await w.run.stopped({ battleId: "b2" });
  assert.equal(stopped.state, "stopped");
  assert.equal((await w.engine.get(retest.workflowId)).status, "cancelled");
  assert.equal(await w.run.started({ session: { ...session(p), workflow_id: null }, topic, battleId: "b3" }), null, "no Study Prep workflow → the protégé's message as before");
});
