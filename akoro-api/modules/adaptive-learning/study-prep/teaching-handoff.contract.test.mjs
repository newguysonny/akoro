// Study Prep → Teaching → Study Prep (Phase 6, 2026-10-20): a missed Agent
// Check offers a teaching session on its gaps; a tap — or a minute — sets it
// up on the dashboard; the live session reports its parts; its end unlocks the
// retest. The real engine on the in-memory store; Study Prep's side is faked.
import assert from "node:assert/strict";
import test from "node:test";
import { createWorkflowEngine } from "../../workflows/engine.js";
import { memoryWorkflowStore } from "../../workflows/store.js";
import { workflowDefinition } from "../../workflows/registry.js";
import "./workflow.js";
import { HANDOFF_AUTO_APPROVE_MS, handoffFromCheck, OPEN_TEACHING_STATES, teachingOutcome, teachingProgress, teachingWorkflow } from "../teaching-session/workflow.js";
import { makeTeachingHandoff, START_TEACHING_TOOL } from "./teaching-handoff.js";

const L = "learner-1";
const T0 = Date.parse("2026-10-20T10:00:00Z");

function world() {
  const store = memoryWorkflowStore();
  let clock = T0;
  const calls = { confirm: [], wake: [], wakeMessages: [] };
  let handoff = null;
  const engine = createWorkflowEngine({
    store, publish: () => {}, now: () => new Date(clock).toISOString(),
    controllerOf: (type) => (type === "study_prep" ? handoff.controller : null),
  });
  const all = async () => [...(await store.listInstances(L))];
  handoff = makeTeachingHandoff({
    engine, now: () => new Date(clock).toISOString(), log: { warn() {} },
    findOpen: async (parentId, topicId) => (await all()).find((i) => i.workflow_type === "teaching" && i.source_workflow_id === parentId && i.source_topic_id === topicId && !["completed", "cancelled", "abandoned"].includes(i.status)) || null,
    listDueProposals: async (nowIso) => (await all()).filter((i) => i.workflow_type === "teaching" && i.state === "proposed" && Date.parse(i.created_at) <= Date.parse(nowIso) - HANDOFF_AUTO_APPROVE_MS),
    studyPrep: {
      openWake: async (args) => { calls.wakeMessages.push(args); },
      confirmTeachBack: async (args) => { calls.confirm.push(args); return { ok: true }; },
      wake: (args) => { calls.wake.push(args); },
      createSessionRow: async (args) => { calls.rows = [...(calls.rows || []), args]; return `row-${(calls.rows || []).length}`; },
    },
  });
  return { store, engine, handoff, calls, tick: (ms) => { clock += ms; }, parentEvents: async (id) => store.listEvents(id) };
}

async function studyPrepParent(engine) {
  const { instance } = await engine.create({ workflowType: "study_prep", learnerId: L, state: "topic_active", idempotencyKey: "study_prep:s1", metadata: { studyPrepSessionId: "s1", subject: "Biology" } });
  return instance;
}
const session = (parent) => ({ id: "s1", learner_id: L, workflow_id: parent.id, subject: "Biology" });
const topic = { id: "t1", label: "Osmosis", attemptsUsed: 1 };

test("the teaching workflow: offered → on the dashboard → teaching ↔ changing tack → assessed → done", () => {
  assert.equal(workflowDefinition("teaching"), teachingWorkflow, "registered with the engine");
  assert.equal(teachingWorkflow.initial, "proposed");
  assert.equal(teachingWorkflow.statusOf.scheduled, "waiting_learner");
  assert.deepEqual(OPEN_TEACHING_STATES, ["scheduled", "teaching_active", "adapt_strategy"]);
  assert.deepEqual(teachingWorkflow.transitions.completed, []);
  assert.ok(teachingWorkflow.transitions.adapt_strategy.includes("teaching_active"));
});

test("only a below-the-mark check with tries left is handed over, with at most four gaps", () => {
  assert.equal(handoffFromCheck({ outcome: "understood", topic }), null);
  assert.equal(handoffFromCheck({ outcome: "capped_out", topic }), null);
  const h = handoffFromCheck({ outcome: "retest_offered", topic, gaps: ["a", "b", "a", "c", "d", "e"] });
  assert.deepEqual(h, { topic: "Osmosis", focus: ["a", "b", "c", "d"] });
});

test("progress: a part done or a phase change is a milestone; MASTERY finishes the last part; a drift is flagged", () => {
  assert.deepEqual(teachingProgress({ subtopicIdx: 0, totalSubtopics: 2, currentPhase: "PHASE_1" }), { part: 1, of: 2, done: 0, phase: "PHASE_1", mastery: false, milestone: false, drift: false });
  const p = teachingProgress({ subtopicIdx: 1, totalSubtopics: 2, currentPhase: "PHASE_1" }, { done: 0 });
  assert.equal(p.done, 1); assert.equal(p.milestone, true);
  assert.equal(teachingProgress({ subtopicIdx: 1, totalSubtopics: 2, currentPhase: "MASTERY", phaseChanged: true }, { done: 1 }).done, 2);
  assert.equal(teachingProgress({ type: "drift_warning", subtopicIdx: 0, totalSubtopics: 2 }).drift, true);
  assert.deepEqual(teachingOutcome({ totalTurns: 0 }).taught, false);
});

test("a missed check offers the session; nothing tapped for a minute sets it up by itself, once, with the tool row and the dashboard line", async () => {
  const w = world();
  const parent = await studyPrepParent(w.engine);
  const offered = await w.handoff.propose({ session: session(parent), topic, outcome: "retest_offered", gaps: ["Why water moves in", "Plasmolysis"] });
  assert.equal(offered.state, "proposed");
  assert.deepEqual(offered.focus, ["Why water moves in", "Plasmolysis"]);
  assert.equal(offered.autoApproveAt, new Date(T0 + HANDOFF_AUTO_APPROVE_MS).toISOString());
  const again = await w.handoff.propose({ session: session(parent), topic: { ...topic, attemptsUsed: 2 }, outcome: "retest_offered", gaps: ["x"] });
  assert.equal(again.workflowId, offered.workflowId, "one open session per topic");
  assert.equal((await w.handoff.listOpen(L)).length, 0, "an offer is not on the dashboard yet");

  assert.deepEqual(await w.handoff.autoApproveDue({ nowMs: T0 + 30_000 }), { approved: 0 }, "not before the minute");
  w.tick(HANDOFF_AUTO_APPROVE_MS + 1);
  assert.deepEqual(await w.handoff.autoApproveDue({ nowMs: T0 + HANDOFF_AUTO_APPROVE_MS + 1 }), { approved: 1 });
  assert.deepEqual(await w.handoff.autoApproveDue({ nowMs: T0 + HANDOFF_AUTO_APPROVE_MS + 20_000 }), { approved: 0 }, "once");
  const dash = await w.handoff.listOpen(L);
  assert.equal(dash.length, 1);
  assert.equal(dash[0].state, "scheduled");
  assert.equal(dash[0].from.kind, "study_prep");

  const events = await w.parentEvents(parent.id);
  const types = events.map((e) => e.event_type);
  assert.ok(types.includes("learner.action_required"), "the card is asked first");
  const tool = events.find((e) => e.event_type === "tool.completed");
  assert.equal(tool.payload.tool, START_TEACHING_TOOL);
  assert.equal(tool.payload.resultLine, "On your dashboard");
  assert.ok(types.includes("workflow.handoff_created"));
  assert.match(events.find((e) => e.event_type === "activity").payload.message, /on your dashboard.*why water moves in and plasmolysis/i);
  const started = events.find((e) => e.event_type === "operation.started");
  assert.equal(started.payload.trigger, "teaching_created");
  assert.equal(w.calls.wakeMessages[0].label, "The teaching session was set up");
  assert.ok(events.every((e) => e.visibility === "learner"), "the card and the chat can read all of it");
});

test("a tap approves at once; the dashboard opens it; parts are reported; the end unlocks the retest and wakes the agent", async () => {
  const w = world();
  const parent = await studyPrepParent(w.engine);
  const offered = await w.handoff.propose({ session: session(parent), topic, outcome: "retest_offered", gaps: ["Why water moves in", "Plasmolysis"] });
  assert.equal(await w.handoff.approve({ workflowId: offered.workflowId, learnerId: "someone-else" }), null, "only the learner's own");
  const approved = await w.handoff.approve({ workflowId: offered.workflowId, learnerId: L });
  assert.equal(approved.state, "scheduled");
  assert.equal((await w.handoff.approve({ workflowId: offered.workflowId, learnerId: L })).state, "scheduled", "idempotent");
  assert.equal(w.calls.wakeMessages[0].label, "You approved the teaching session");

  const bound = await w.handoff.bind({ workflowId: offered.workflowId, learnerId: L, liveSessionId: "fresh_x_1" });
  assert.equal(bound.state, "teaching_active");
  assert.deepEqual(bound.focus, ["Why water moves in", "Plasmolysis"], "the modal teaches exactly the gaps");
  // start_teaching_session made a row in the dashboard's own sessions list; the modal opens it by id.
  assert.deepEqual(w.calls.rows, [{ learnerId: L, workflowId: offered.workflowId, topic: "Osmosis", subject: "Biology", focus: ["Why water moves in", "Plasmolysis"] }]);
  assert.equal(approved.adaptiveSessionId, "row-1");
  assert.equal((await w.handoff.forSessionRow({ learnerId: L, adaptiveSessionId: "row-1" })).workflowId, offered.workflowId);
  assert.equal(await w.handoff.forSessionRow({ learnerId: "someone-else", adaptiveSessionId: "row-1" }), null);

  assert.equal((await w.handoff.progress({ workflowId: offered.workflowId, result: { subtopicIdx: 0, totalSubtopics: 2, currentPhase: "PHASE_1" } })).milestone, false);
  assert.equal((await w.handoff.progress({ workflowId: offered.workflowId, result: { type: "drift_warning", subtopicIdx: 0, totalSubtopics: 2, currentPhase: "PHASE_1" } })).drift, true);
  assert.equal((await w.engine.get(offered.workflowId)).state, "adapt_strategy");
  await w.handoff.progress({ workflowId: offered.workflowId, result: { subtopicIdx: 1, totalSubtopics: 2, currentPhase: "PHASE_1" } });
  assert.equal((await w.engine.get(offered.workflowId)).state, "teaching_active", "back on track");
  const parentEvents = await w.parentEvents(parent.id);
  const progressed = parentEvents.filter((e) => e.event_type === "teaching.phase_changed").map((e) => e.payload.narrative);
  assert.deepEqual(progressed, ["You started teaching Osmosis", "Teaching Osmosis: 1 of 2 parts taught"]);
  // Each is its own run in the chat (the card only re-reads its tracking line): a message, a tool row, what it means.
  assert.deepEqual(w.calls.wakeMessages.map((m) => m.trigger), ["teaching_created", "teaching_started", "teaching_progress"]);
  const said = parentEvents.filter((e) => e.event_type === "activity").map((e) => e.payload.message);
  assert.ok(said.includes("I'm following along. First: why water moves in."), said);
  assert.ok(said.includes("You've taught me why water moves in. Next: plasmolysis."), said);
  assert.ok(parentEvents.filter((e) => e.event_type === "tool.completed").some((e) => e.payload.tool === "teaching.track_session" && e.payload.resultLine === "Why water moves in"));
  // The last part: the end is the learner's call.
  await w.handoff.progress({ workflowId: offered.workflowId, result: { subtopicIdx: 1, totalSubtopics: 2, currentPhase: "MASTERY", phaseChanged: true } });
  assert.match((await w.parentEvents(parent.id)).filter((e) => e.event_type === "activity").pop().payload.message, /That's every part — plasmolysis too\. End the session when you're ready/);

  assert.deepEqual((await w.handoff.finish({ workflowId: offered.workflowId, endResult: { totalTurns: 0 } })).ignored, "nothing_taught", "an empty session stays open");
  assert.equal(w.calls.confirm.length, 0);
  const done = await w.handoff.finish({ workflowId: offered.workflowId, endResult: { totalTurns: 6, learnerEvidenceScore: 72 }, notesAdded: 6 });
  assert.equal(done.view.state, "completed");
  assert.deepEqual(w.calls.confirm, [{ sessionId: "s1", learnerId: L, topicId: "t1" }], "the retest unlocks");
  assert.equal(w.calls.wake[0].trigger, "teaching_done");
  assert.equal(w.calls.wake[0].facts.notesAdded, 6);
  assert.match((await w.parentEvents(parent.id)).find((e) => e.event_type === "workflow.handoff_completed").payload.narrative, /You finished teaching Osmosis · 2 of 2 parts/);
  assert.equal((await w.handoff.listOpen(L)).length, 0);
});

test("the topic moving on (or taught elsewhere) closes its session; a closed one can't be opened", async () => {
  const w = world();
  const parent = await studyPrepParent(w.engine);
  const offered = await w.handoff.propose({ session: session(parent), topic, outcome: "retest_offered", gaps: ["Plasmolysis"] });
  await w.handoff.approve({ workflowId: offered.workflowId, learnerId: L });
  const closed = await w.handoff.cancelFor({ parentId: parent.id, topicId: "t1", reason: "taught_elsewhere" });
  assert.equal(closed.status, "cancelled");
  assert.equal(await w.handoff.bind({ workflowId: offered.workflowId, learnerId: L, liveSessionId: "x" }), null);
  assert.equal(await w.handoff.cancelFor({ parentId: parent.id, topicId: "t1" }), null);
  assert.equal(await w.handoff.propose({ session: { ...session(parent), workflow_id: null }, topic, outcome: "retest_offered", gaps: ["x"] }), null, "no Study Prep workflow → the old teach-back tap");
});
