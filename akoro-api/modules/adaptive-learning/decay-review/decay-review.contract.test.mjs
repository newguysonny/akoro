/**
 * Phase 8 (§10): a Decay Review — a short check decides retained / decayed in code; decayed → retrieval
 * practice (hint ladder, server-scored) → retest; a failed retest → re-teaching → the last retest (2 at
 * most); every outcome reinforces only the concepts the review reached and resolves the alert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { createWorkflowEngine } = await import("../../workflows/index.js");
const { memoryWorkflowStore } = await import("../../workflows/index.js");
await import("./workflow.js");
const { makeDecayReview } = await import("./service.js");
const { recallOutcome, nextHintLevel, evaluateRetention, conceptOutcomes, DECAY_POLICY } = await import("./workflow.js");

const L = "learner-1";
function world({ scores = [] } = {}) {
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store, publish: () => {} });
  const calls = { checks: [], reinforce: [], actioned: [], judged: [] };
  const results = new Map();
  let n = 0;
  const svc = makeDecayReview({
    engine, log: { warn() {} },
    decay: {
      session: async () => ({ subject: "Biology", confidence: 0.3, concepts: [{ concept: "Osmosis", confidence: 0.2 }, { concept: "Diffusion", confidence: 0.5 }], fadedConcepts: [{ concept: "Osmosis" }] }),
      reinforce: async (...a) => { calls.reinforce.push(a); return { confidenceBefore: 0.3, confidenceAfter: 0.5, nextReviewDue: "2026-11-09" }; },
      markRead: async () => true,
      markActioned: async (...a) => { calls.actioned.push(a); },
    },
    checks: {
      start: async (args) => { const battleId = `b${++n}`; calls.checks.push({ ...args, battleId }); results.set(battleId, scores.shift()); return { battleId }; },
      results: async (battleId) => {
        const s = results.get(battleId) ?? 0;
        return { score: s, correct: Math.round(s * 3), total: 3, gaps: s < 0.7 ? ["Osmosis"] : [], perQuestion: [{ outcome: s >= 0.7 ? "correct" : "wrong", gap: "Osmosis", fromNote: "Osmosis" }] };
      },
    },
    recall: {
      question: async ({ concept }) => ({ question: `What is ${concept}?`, concept, hints: ["Think water", "Water moves across a membrane"], key: "Water moving from high to low water concentration across a membrane" }),
      judge: async (args) => { calls.judged.push(args); return { verdict: /membrane/i.test(args.answer) ? "correct" : "incorrect", feedback: "ok" }; },
    },
    agentOf: async () => "agent-1",
    findByBattle: async (battleId) => (await store.listInstances(L)).find((i) => i.metadata?.check?.battleId === battleId || i.metadata?.retest?.battleId === battleId) || null,
  });
  return { svc, store, calls };
}

test("retained: a good short check completes, reinforces and resolves the alert", async () => {
  const w = world({ scores: [1] });
  const v = await w.svc.start({ learnerId: L, topic: "Osmosis", subject: "Biology", notificationId: "n1" });
  assert.equal(v.state, "diagnostic");
  assert.equal(w.calls.checks[0].mode, "retention_check");
  assert.equal(w.calls.checks[0].total, DECAY_POLICY.CHECK_QUESTIONS);
  assert.equal((await w.svc.start({ learnerId: L, topic: "osmosis" })).workflowId, v.workflowId, "one open review per topic");
  const done = await w.svc.onCheckEnded("b1");
  assert.equal(done.state, "completed");
  assert.equal(done.outcome.retained, true);
  assert.equal(w.calls.reinforce.length, 1);
  assert.deepEqual(w.calls.actioned[0], ["n1", v.workflowId, L], "the alert is resolved");
});

test("decayed → recall rounds with the hint ladder → retest passes", async () => {
  const w = world({ scores: [0, 1] });
  const v = await w.svc.start({ learnerId: L, topic: "Osmosis" });
  let r = await w.svc.onCheckEnded("b1");
  assert.equal(r.state, "intervention");
  assert.equal(r.retrieval.round, 1);
  assert.equal(r.retrieval.current.hints.length, 0, "no hint until asked");
  assert.equal(JSON.stringify(r).includes("high to low"), false, "the answer key never reaches the learner");
  r = await w.svc.hint({ workflowId: v.workflowId, learnerId: L });
  assert.deepEqual(r.retrieval.current.hints, ["Think water"]);
  r = await w.svc.hint({ workflowId: v.workflowId, learnerId: L });
  r = await w.svc.hint({ workflowId: v.workflowId, learnerId: L });
  assert.equal(r.retrieval.current.hintLevel, 2, "the ladder stops at partial");
  let a = await w.svc.answer({ workflowId: v.workflowId, learnerId: L, answer: "water crosses a membrane" });
  assert.equal(a.result.outcome, "partial", "right with hints counts as partial");
  a = await w.svc.answer({ workflowId: v.workflowId, learnerId: L, answer: "no idea" });
  assert.equal(a.result.outcome, "incorrect");
  a = await w.svc.answer({ workflowId: v.workflowId, learnerId: L, answer: "across a membrane" });
  assert.equal(a.view.state, "retest", "after 3 rounds: the retest");
  assert.equal(w.calls.checks[1].mode, "retest");
  const done = await w.svc.onCheckEnded("b2");
  assert.equal(done.state, "completed");
  assert.equal(done.outcome.retained, true);
  assert.equal(done.outcome.strategyUsed, "retrieval_practice");
  assert.ok(done.outcome.evidence.some((e) => e.kind === "retrieval_failure") && done.outcome.evidence.some((e) => e.kind === "retrieval_success"));
});

test("a failed retest → re-teaching → the last retest; failing it completes not retained", async () => {
  const w = world({ scores: [0, 0, 0] });
  const v = await w.svc.start({ learnerId: L, topic: "Osmosis" });
  await w.svc.onCheckEnded("b1");
  for (let i = 0; i < 3; i++) await w.svc.answer({ workflowId: v.workflowId, learnerId: L, answer: "?" });
  let r = await w.svc.onCheckEnded("b2");
  assert.equal(r.state, "intervention");
  assert.equal(r.teaching.needed, true, "recall wasn't enough: re-teach it");
  r = await w.svc.teachingDone({ workflowId: v.workflowId, learnerId: L });
  assert.equal(r.state, "retest");
  assert.equal(r.retests, 2);
  r = await w.svc.onCheckEnded("b3");
  assert.equal(r.state, "completed");
  assert.equal(r.outcome.retained, false, "the cap: 2 retests");
  assert.equal(w.calls.reinforce.length, 1, "what it reached is still recorded");
  await assert.rejects(() => w.svc.view({ workflowId: v.workflowId, learnerId: "someone-else" }), /not found/i);
});

test("rules: retention, recall outcomes, the ladder, per-concept outcomes", () => {
  assert.equal(evaluateRetention({ score: 0.7 }), "retained");
  assert.equal(evaluateRetention({ score: 0.66 }), "decayed");
  assert.equal(recallOutcome({ verdict: "correct", hintLevel: 0 }), "correct");
  assert.equal(recallOutcome({ verdict: "correct", hintLevel: 1 }), "partial");
  assert.equal(recallOutcome({ verdict: "partial", hintLevel: 2 }), "incorrect");
  assert.equal(nextHintLevel(2), null);
  assert.deepEqual(conceptOutcomes({ concepts: [{ concept: "Osmosis" }, { concept: "Diffusion" }], check: { score: 0, perQuestion: [{ outcome: "wrong", gap: "Osmosis" }] }, recalls: [{ concept: "Osmosis", outcome: "partial" }] }), { Osmosis: "partial" }, "a concept the review never reached is left out");
});
