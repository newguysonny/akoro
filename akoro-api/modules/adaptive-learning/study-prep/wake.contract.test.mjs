import assert from "node:assert/strict";
import test from "node:test";

/**
 * The agent after the plan is ready (wakes, 2026-10-19): when the next Agent
 * Check starts by itself, the approved estimate, what code settles after a
 * wake, and that a wake ends by waiting (never pausing the session).
 */
import { createHarness } from "./harness.js";
import { runAgentStep } from "./agent-loop.js";
import { makeEvent } from "./events.js";
import { AUTO_START_MS, WAKE_DECISIONS, WAKE_TRIGGERS, autoStartFor, checkBudget, settleStep, spentOnChecks, wakeGoal } from "./wake.js";
import { studyPrepResultLine, workflowEventFor } from "./workflow.js";

class Store {
  constructor({ balance = 100 } = {}) { Object.assign(this, { sessions: new Map(), topics: new Map(), events: [], seq: 0, balance, charges: [], refunds: [], evidence: [] }); }
  async findActiveSession() { return null; }
  async createSession(row) { const s = { id: "s1", tool_calls_used: 0, ...row }; this.sessions.set(s.id, s); return s; }
  async getSession(id) { return this.sessions.get(id) || null; }
  async updateSessionConditional(id, st, patch) { const r = this.sessions.get(id); if (!r || r.status !== st) return null; Object.assign(r, patch); return r; }
  async getTopics(sid) { return [...this.topics.values()].filter((t) => t.session_id === sid); }
  async getTopicById(id) { return this.topics.get(id) || null; }
  async createTopics(sid, plan) {
    const rows = plan.map((p, i) => ({ id: `t${i + 1}`, session_id: sid, syllabus_topic_id: p.syllabusTopicId, position: i + 1, label: p.label,
      status: i === 0 ? "active" : "queued", attempts_used: 0, learner_confirmed_ready: false, exam_prep_run_id: null }));
    rows.forEach((r) => this.topics.set(r.id, r)); return rows;
  }
  async updateTopicConditional(id, st, patch) { const r = this.topics.get(id); if (!r || r.status !== st) return null; Object.assign(r, patch); return r; }
  async claimCheckScore(id, battleId, result, at) { const r = this.topics.get(id); if (!r || r.check_battle_id !== battleId || r.check_scored_at) return null; Object.assign(r, { check_scored_at: at, check_result: result }); return r; }
  async appendEvents(sid, rows) { return rows.map((r) => { this.seq += 1; const e = { ...r, session_id: sid, sequence: this.seq }; this.events.push(e); return e; }); }
  async listEvents(sid) { return this.events.filter((e) => e.session_id === sid); }
  async chargeCoins({ learnerId, coins }) { if (this.balance < coins) { const e = new Error("no"); e.code = "insufficient_balance"; throw e; } this.balance -= coins; this.charges.push({ learnerId, coins }); return { charged: coins, applied: [{ took: coins }] }; }
  async refundCoins({ charge }) { this.balance += charge.charged; this.refunds.push(charge); return 0; }
  async recordMasteryEvidence(e) { this.evidence.push(e); return "c1"; }
}

const syllabus = { resolveTopics: async () => [{ id: "cells", label: "Cell Structure" }, { id: "osmosis", label: "Osmosis" }], prerequisiteEdges: async () => [] };
const topicWorkflow = { policyFor: async () => ({ pass_threshold: 0.7, max_attempts: 3 }) };
const LEARNER = "learner-1";

function build({ notes = 3, balance = 100, perQuestion = null, startFails = false } = {}) {
  const store = new Store({ balance });
  const said = [];
  const started = [];
  const agentCheck = {
    coverage: async () => ({ notes, strength: notes === 0 ? "none" : notes < 3 ? "thin" : "good" }),
    start: async (args) => { if (startFails) throw new Error("no questions"); started.push(args); return { battleId: `b${started.length}`, placed: 5, title: "Agent Check" }; },
    results: async (battleId) => {
      const pq = perQuestion || ["correct", "correct", "correct", "correct", "guessed"];
      const correct = pq.filter((o) => o === "correct").length;
      return { battleId, studyPrepTopicId: "t1", total: pq.length, correct, guessed: pq.filter((o) => o === "guessed").length,
        wrong: pq.filter((o) => o === "wrong").length, unknown: pq.filter((o) => o === "unknown").length, score: correct / pq.length,
        perQuestion: pq.map((outcome, i) => ({ order: i + 1, outcome, ...(outcome === "correct" ? {} : { gap: `gap ${i + 1}` }) })),
        gaps: pq.map((o, i) => (o === "correct" ? null : `gap ${i + 1}`)).filter(Boolean) };
    },
  };
  const protege = { say: async (m) => { said.push(m); } };
  const harness = createHarness({ store, topicWorkflow, syllabus, agentCheck, protege, now: () => "2026-10-17T12:00:00Z" });
  return { store, harness, said, started };
}

async function activeTopic(harness) {
  const s = await harness.createSession({ learnerId: LEARNER, goal: "Pass BIO 111", subject: "Biology" });
  await harness.proposePlan({ sessionId: s.id, learnerId: LEARNER, topicIds: ["cells", "osmosis"], intent: "In order." });
  await harness.confirmPlan({ sessionId: s.id, learnerId: LEARNER });
  return s;
}


const topicRow = (patch = {}) => ({ id: "t1", status: "active", attemptsUsed: 0, checkBattleId: null, checkScoredAt: null, examPrepRunId: null,
  checkMode: null, learnerConfirmedReady: false, updatedAt: "2026-10-19T10:00:00.000Z", ...patch });
const running = { status: "topic_active", estimate: { practiceCoins: 8, totalCoins: 11 } };

test("a first check starts by itself a minute after its topic started", () => {
  const due = autoStartFor(topicRow(), running, { spent: 0, maxAttempts: 3 });
  assert.equal(due.mode, "diagnostic");
  assert.equal(Date.parse(due.at) - Date.parse("2026-10-19T10:00:00.000Z"), AUTO_START_MS);
  assert.equal(AUTO_START_MS, 60_000);
});

test("a retest starts by itself a minute after the teach-back (retries too)", () => {
  const due = autoStartFor(topicRow({ checkBattleId: "b1", checkScoredAt: "x", attemptsUsed: 1, learnerConfirmedReady: true, updatedAt: "2026-10-19T10:05:00.000Z" }), running, { spent: 2, maxAttempts: 3 });
  assert.equal(due.mode, "retest");
  assert.equal(due.at, "2026-10-19T10:06:00.000Z");
});

test("no auto-start while a check runs, after a marked check without a teach-back, with no notes, or past the cap", () => {
  assert.equal(autoStartFor(topicRow({ checkBattleId: "b1" }), running, { maxAttempts: 3 }), null, "running");
  assert.equal(autoStartFor(topicRow({ checkBattleId: "b1", checkScoredAt: "x", attemptsUsed: 1 }), running, { maxAttempts: 3 }), null, "waits for the teach-back");
  assert.equal(autoStartFor(topicRow({ checkMode: "skipped" }), running, { maxAttempts: 3 }), null, "nothing to check yet");
  assert.equal(autoStartFor(topicRow({ checkBattleId: "b1", checkScoredAt: "x", attemptsUsed: 3, learnerConfirmedReady: true }), running, { maxAttempts: 3 }), null, "out of tries");
  assert.equal(autoStartFor(topicRow(), { ...running, status: "paused" }, { maxAttempts: 3 }), null, "only a running session");
  assert.equal(autoStartFor(topicRow({ status: "queued" }), running, { maxAttempts: 3 }), null, "only the active topic");
});

test("past the approved estimate it never starts by itself — the learner is asked", () => {
  const due = autoStartFor(topicRow(), running, { spent: 10, maxAttempts: 3 });
  assert.equal(due.blocked, "over_estimate");
  // The whole approved total (checks and the agent's own turns), plus any "Approve N more".
  assert.deepEqual(checkBudget(running, 6), { approved: 11, spent: 6, left: 5, next: 2, withinEstimate: true, wakeDecisions: 1 });
  assert.equal(checkBudget(running, 10).withinEstimate, false);
  assert.equal(checkBudget({ estimate: { totalCoins: 11, extraCoins: 10 } }, 10).withinEstimate, true, "approved more");
  assert.equal(checkBudget(running, 0).wakeDecisions, 3, "11 coins pay for 3 decisions of ~3");
  assert.equal(checkBudget({ estimate: { totalCoins: 40 } }, 0).wakeDecisions, 4, "never more than 4");
  assert.equal(checkBudget(running, 9).wakeDecisions, 0, "nothing left: the agent asks first");
});

test("the coins spent on checks come from the session's own events", () => {
  const events = [
    { decision_node: "agent_check_started", facts: { coins: 2 } }, { decision_node: "plan_confirmed", facts: { coinsCharged: 0 } },
    { decisionNode: "agent_check_started", facts: { coins: 2 } }, { decision_node: "agent_check_skipped", facts: {} },
  ];
  assert.equal(spentOnChecks(events), 4);
});

test("after a wake: code moves on to the next topic, or ends the session, only when nothing is active", () => {
  assert.equal(settleStep({ session: { status: "topic_active" }, topics: [{ status: "active" }, { status: "queued" }] }), null);
  assert.equal(settleStep({ session: { status: "topic_active" }, topics: [{ status: "understood" }, { status: "queued" }] }), "advance");
  assert.equal(settleStep({ session: { status: "topic_active" }, topics: [{ status: "understood" }, { status: "deferred" }] }), "conclude");
  assert.equal(settleStep({ session: { status: "completed" }, topics: [] }), null);
});

test("every wake has a goal that names its 4-decision budget", () => {
  assert.equal(WAKE_DECISIONS, 4);
  for (const trigger of ["plan_confirmed", "plan_adjusted", "topic_started", "check_scored", "teach_back", "over_estimate"]) {
    assert.ok(WAKE_TRIGGERS.includes(trigger), trigger);
    assert.match(wakeGoal(trigger, { topic: "Cells" }), /4 decisions/);
  }
  assert.match(wakeGoal("check_scored", { topic: "Cells" }), /Topic: Cells/);
});

test("the harness: an automatic start stays inside the estimate; the learner's own tap may go on", async () => {
  const { store, harness } = build();
  const s = await activeTopic(harness);   // 2 topics → the estimate's total is approved
  const approved = store.sessions.get(s.id).estimate.totalCoins;
  store.events.push(...Array.from({ length: Math.ceil(approved / 2) }, (_, i) => i).map(() => ({ session_id: s.id, decision_node: "agent_check_started", facts: { coins: 2 } })));
  const refused = await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic", withinEstimateOnly: true }).catch((e) => e);
  assert.equal(refused.code, "over_estimate");
  assert.equal(store.charges.length, 0, "nothing charged");
  const tapped = await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  assert.ok(tapped.check?.battleId, "the learner's tap goes on");
});

test("the harness: no notes marks the topic skipped, so it doesn't auto-start every minute", async () => {
  const { store, harness } = build({ notes: 0 });
  const s = await activeTopic(harness);
  await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  assert.equal(store.topics.get("t1").check_mode, "skipped");
  const notes = await harness.topicNotes({ sessionId: s.id, learnerId: LEARNER });
  assert.deepEqual(notes, { topic: "Cell Structure", notes: 0, strength: "none" });
});

test("the harness: the learner can reorder the plan; the order is re-checked against prerequisites", async () => {
  const store = new Store();
  const harness = createHarness({ store, topicWorkflow, now: () => "2026-10-19T12:00:00Z", syllabus: {
    resolveTopics: async () => [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
    prerequisiteEdges: async () => [{ before: "a", after: "b", beforeLabel: "A", afterLabel: "B" }],
  } });
  const s = await harness.createSession({ learnerId: LEARNER, goal: "Exam", subject: "Science" });
  await harness.proposePlan({ sessionId: s.id, learnerId: LEARNER, topicIds: ["a", "b", "c"] });
  const moved = await harness.adjustPlan({ sessionId: s.id, learnerId: LEARNER, order: ["c", "a", "b"] });
  assert.deepEqual(moved.plan.map((t) => t.syllabusTopicId), ["c", "a", "b"]);
  const refused = await harness.adjustPlan({ sessionId: s.id, learnerId: LEARNER, order: ["b", "a", "c"] }).catch((e) => e);
  assert.equal(refused.code, "prerequisite_violation");
  const dropped = await harness.adjustPlan({ sessionId: s.id, learnerId: LEARNER, dropTopicIds: ["c"], order: ["a", "b"] });
  assert.equal(dropped.plan.length, 2);
});

test("a wake ends by waiting for the learner — never a pause at its cap", async () => {
  const events = [];
  const store = { appendEvents: async (_id, rows) => { events.push(...rows); return rows; }, getSession: async () => ({ id: "s1", status: "topic_active" }) };
  let paused = false;
  const harness = { pause: async () => { paused = true; } };
  const registry = { catalogue: [], validate: () => ({ ok: true }), execute: async (name) => (name === "wait_for_learner" ? { waiting: true } : { notes: 2 }) };
  const plan = [{ tool: "topic.get_notes", intent: "See the notes.", message: "You have 2 notes on Cells." }, { tool: "wait_for_learner", action: "wait_for_learner", intent: "Their turn.", message: "The check starts in a minute." }];
  const said = [];
  const step = await runAgentStep({
    sessionId: "s1", goal: "wake", store, harness, registry, contextSetName: "teaching", maxIterations: WAKE_DECISIONS,
    agent: { next: async ({ iteration }) => plan[iteration - 1] },
    terminalActions: ["advance_topic", "defer_topic", "conclude_session", "propose_plan", "wait_for_learner"], finalActions: ["wait_for_learner"], pauseOnCap: false,
    onMessage: async ({ text }) => { said.push(text); },
  });
  assert.equal(step.ended, "terminal");
  assert.equal(step.terminal, "wait_for_learner");
  assert.equal(step.iterations, 2);
  assert.deepEqual(said, ["You have 2 notes on Cells.", "The check starts in a minute."]);

  const stuck = await runAgentStep({
    sessionId: "s1", goal: "wake", store, harness, registry: { ...registry, validate: () => ({ ok: false, code: "x", message: "no" }) }, contextSetName: "teaching",
    maxIterations: WAKE_DECISIONS, agent: { next: async () => ({ tool: "wait_for_learner", intent: "x" }) },
    terminalActions: ["wait_for_learner"], finalActions: ["wait_for_learner"], pauseOnCap: false,
  });
  assert.equal(stuck.ended, "agent_loop_cap");
  assert.equal(paused, false, "a wake never pauses the session");
});

test("the stream: waiting is not a step; a wake's reads say what they found", () => {
  const wait = workflowEventFor(makeEvent({ sequence: 1, eventType: "agent_tool_call", origin: "agent_stated_intent", tool: "wait_for_learner", agentIntent: "Their turn." }));
  assert.equal(wait.visibility, "developer");
  const notes = workflowEventFor(makeEvent({ sequence: 2, eventType: "agent_tool_call", origin: "agent_stated_intent", tool: "topic.get_notes", agentIntent: "See the notes." }));
  assert.equal(notes.visibility, "learner");
  assert.equal(studyPrepResultLine("topic.get_notes", { ok: true, result: { notes: 2 } }), "2 notes");
  assert.equal(studyPrepResultLine("topic.get_notes", { ok: true, result: { notes: 0 } }), "No notes on it yet");
  assert.equal(studyPrepResultLine("session.get_state", { ok: true, result: { topics: [{ label: "Cells", status: "active", lastCheck: { correct: 3, total: 5 } }] } }), "Cells: 3 of 5 on the last check");
  assert.equal(studyPrepResultLine("defer_topic", { ok: true, result: { topic: { label: "Cells" } } }), "Cells set aside for later");
});

test("no notes is found (and said) once: a second try is quiet", async () => {
  const { store, harness } = build({ notes: 0 });
  const s = await activeTopic(harness);
  const first = await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  const second = await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  assert.equal(first.skipped.already, undefined);
  assert.equal(second.skipped.already, true);
  assert.equal(store.events.filter((e) => e.decision_node === "agent_check_skipped").length, 1);
});

test("approve more: the learner lets the plan go past its coins, once per tap, and it is recorded", async () => {
  const { store, harness } = build();
  const s = await activeTopic(harness);
  const before = (await harness.budgetFor(store.sessions.get(s.id))).approved;
  const r = await harness.approveMoreCoins({ sessionId: s.id, learnerId: LEARNER });
  assert.equal(r.coins.approved, before + 10);
  assert.ok(store.events.some((e) => e.decision_node === "coins_approved"));
  const planning = new Store();
  const h2 = createHarness({ store: planning, topicWorkflow, syllabus, now: () => "x" });
  const s2 = await h2.createSession({ learnerId: LEARNER, goal: "g", subject: "Biology" });
  assert.equal((await h2.approveMoreCoins({ sessionId: s2.id, learnerId: LEARNER }).catch((e) => e)).code, "invalid_state_transition", "only a running plan");
});
