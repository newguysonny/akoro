import assert from "node:assert/strict";
import test from "node:test";

/**
 * D45 / §7.12: Study Prep practice as an Agent Check battle. In-memory store,
 * stubbed check (no battle, no db, no LLM): what the harness charges, what it
 * refuses, how it scores (a guess is not demonstrated), and what the protégé
 * says in chat.
 */
import { createHarness } from "./harness.js";

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

test("practice starts an Agent Check battle: one charge, the topic records it, the protégé posts it in chat", async () => {
  const { store, harness, said, started } = build();
  const s = await activeTopic(harness);
  const r = await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  assert.equal(r.check.battleId, "b1");
  assert.deepEqual(store.charges, [{ learnerId: LEARNER, coins: 2 }]);
  assert.equal(started[0].topic, "Cell Structure");
  assert.equal(started[0].studyPrepTopicId, "t1");
  const t = store.topics.get("t1");
  assert.equal(t.check_battle_id, "b1");
  assert.equal(t.attempts_used, 1);
  assert.equal(said.length, 1);
  assert.equal(said[0].battle.id, "b1");
  assert.match(said[0].text, /only answer from your notes/);
  const next = await harness.sessionNext({ sessionId: s.id, learnerId: LEARNER });
  assert.equal(next.step, "agent_check_running");
});

test("no notes on the topic: nothing to check, nothing charged, go teach", async () => {
  const { store, harness, started } = build({ notes: 0 });
  const s = await activeTopic(harness);
  const r = await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  assert.deepEqual(r.skipped, { reason: "no_notes", next: "teach" });
  assert.equal(store.charges.length, 0);
  assert.equal(started.length, 0);
  assert.ok(store.events.some((e) => e.decision_node === "agent_check_skipped"));
});

test("a check that can't start is refunded and leaves the topic unchanged", async () => {
  const { store, harness } = build({ startFails: true });
  const s = await activeTopic(harness);
  await assert.rejects(() => harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" }));
  assert.equal(store.balance, 100);
  assert.equal(store.refunds.length, 1);
  assert.equal(store.topics.get("t1").check_battle_id, undefined);
});

test("a second check while one is running is refused, uncharged", async () => {
  const { store, harness } = build();
  const s = await activeTopic(harness);
  await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  await assert.rejects(() => harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" }), (e) => e.code === "invalid_state_transition");
  assert.equal(store.charges.length, 1);
});

test("scoring: 4 from notes + 1 guess of 5 passes at 80%; evidence is the agent's; the protégé reports", async () => {
  const { store, harness, said } = build();
  const s = await activeTopic(harness);
  await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  const done = await harness.completeAgentCheck({ battleId: "b1" });
  assert.equal(done.outcome, "understood");
  assert.equal(store.topics.get("t1").status, "understood");
  assert.equal(store.evidence[0].source, "agent_recall");
  const scored = store.events.find((e) => e.event_type === "engine_result");
  assert.equal(scored.facts.source, "agent_recall");
  assert.match(said[1].text, /I answered 4 of 5 from your notes/);
  assert.match(said[1].text, /guess on 1/);
  assert.doesNotMatch(said[1].text, /you mastered/i);
});

test("a correct guess is not demonstrated: 3 right + 2 guessed (both lucky) is 60% — a retest is offered", async () => {
  const { store, harness, said } = build({ perQuestion: ["correct", "correct", "correct", "guessed", "guessed"] });
  const s = await activeTopic(harness);
  await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  const done = await harness.completeAgentCheck({ battleId: "b1" });
  assert.equal(done.outcome, "retest_offered");
  assert.equal(store.topics.get("t1").status, "active", "the topic stays active for the retest");
  assert.match(said[1].text, /Teach me what I missed/);
  const next = await harness.sessionNext({ sessionId: s.id, learnerId: LEARNER });
  assert.equal(next.step, "awaiting_submission_or_teach_back");
});

test("a check is scored once, and only the topic's current check", async () => {
  const { store, harness } = build();
  const s = await activeTopic(harness);
  await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  assert.ok(await harness.completeAgentCheck({ battleId: "b1" }));
  assert.equal(await harness.completeAgentCheck({ battleId: "b1" }), null, "already scored");
  assert.equal(await harness.completeAgentCheck({ battleId: "b-old" }), null, "not this topic's check");
  assert.equal(store.evidence.length, 1);
});

test("a retest needs the teach-back, and spends it", async () => {
  const { store, harness } = build({ perQuestion: ["correct", "wrong", "wrong", "unknown", "unknown"] });
  const s = await activeTopic(harness);
  await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "diagnostic" });
  await harness.completeAgentCheck({ battleId: "b1" });
  await assert.rejects(() => harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "retest" }), (e) => e.code === "teach_back_gate");
  await harness.confirmTeachBack({ sessionId: s.id, learnerId: LEARNER, topicId: "t1" });
  const r = await harness.startTopicPractice({ sessionId: s.id, learnerId: LEARNER, topicId: "t1", mode: "retest" });
  assert.equal(r.check.battleId, "b2");
  assert.equal(store.topics.get("t1").learner_confirmed_ready, false);
  assert.equal(store.charges.length, 2);
});
