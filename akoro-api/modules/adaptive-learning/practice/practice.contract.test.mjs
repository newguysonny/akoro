/**
 * Phase 9 (§11): the proctored assessment as a `practice` workflow. The agent picks the next move
 * (next question / one probe / a hint within policy), with a fallback to the generated order; the
 * score, the verdict and the evidence are code's; terminated/flagged runs write no evidence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { createWorkflowEngine } = await import("../../workflows/engine.js");
const { memoryWorkflowStore } = await import("../../workflows/store.js");
const W = await import("./workflow.js");
const { conductPracticeTurn, validatePracticeDecision, practiceDecisionState } = await import("./controller.js");
const { makePracticeRun } = await import("./service.js");
const { SergeantProctor } = await import("../agents/sargeant/proctor.js");
await import("../study-prep/agent-check-run.js");

/** A Sergeant whose model calls are scripted: judge returns the next score. */
function sergeant(scores = [], n = 3) {
  const p = new SergeantProctor({ topic: "Photosynthesis", subject: "Biology" });
  p.questions = Array.from({ length: n }, (_, i) => ({ q: `Q${i + 1}`, objective: `obj${i + 1}`, difficulty: "medium" }));
  const queue = [...scores];
  p.judge = async function (answer) {
    const rec = this.record();
    const probing = !!rec.pendingProbe;
    const score = queue.shift() ?? 80;
    rec.attempts++;
    if (probing) { rec.probe = score; rec.pendingProbe = null; } else rec.judged = rec.judged == null ? score : Math.max(rec.judged, score);
    this.answers.push({ qIndex: this.index, answer, eval: { score, correct: score >= 70, feedback: "fb" } });
    return { score, correct: score >= 70, feedback: "fb", probing };
  };
  p._generateHint = async () => "Think about light.";
  p.probe = async function () { const rec = this.record(); rec.probes++; rec.pendingProbe = "Why?"; return "Why?"; };
  return p;
}
const picks = (...tools) => { const q = [...tools]; return async () => { const t = q.shift(); return t === undefined ? null : typeof t === "string" ? { tool: t, args: {} } : t; }; };

test("the policy: hint deductions, the verdict in code, evidence only for a clean run, what's next", () => {
  assert.equal(W.questionScore({ judged: 80, hints: 1 }), 65);
  assert.equal(W.questionScore({ judged: 60, probe: 90 }), 75);
  assert.equal(W.questionScore({ judged: 90, probe: 20 }), 90, "a weak probe never lowers the first answer");
  assert.equal(W.assessmentScore([{ judged: 100 }, { judged: 40 }, { judged: null }]), 70);
  assert.equal(W.computeVerdict({ score: 85, cheatProbability: 0.1 }), "pass");
  assert.equal(W.computeVerdict({ score: 85, cheatProbability: 0.5 }), "flagged", "a passing score under doubtful integrity is flagged");
  assert.equal(W.computeVerdict({ score: 40, cheatProbability: 0.9 }), "terminated");
  assert.equal(W.computeVerdict({ score: 95, terminated: true }), "terminated");
  assert.equal(W.computeVerdict({ score: 69 }), "fail");
  assert.equal(W.evidenceAllowed("flagged"), false);
  assert.equal(W.recommendNext({ verdict: "fail", score: 30 }), "teaching");
  assert.equal(W.recommendNext({ verdict: "fail", score: 60 }), "retrieval_practice");
  assert.equal(W.recommendNext({ verdict: "terminated", score: 10 }), "none");
  const o = W.practiceOutcome({ score: 80, verdict: "flagged", cheatProbability: 0.5, questions: [{ judged: 80 }], topic: "T" });
  assert.deepEqual([o.passed, o.conceptEvidence.length, o.recommendedNextAction], [false, 0, "none"]);
});

test("one practice definition serves the Agent Check (running) and the proctored run", () => {
  assert.ok(W.practiceWorkflow.states.includes("running") && W.practiceWorkflow.states.includes("in_progress"));
  assert.deepEqual(W.PRACTICE_TRANSITIONS.terminated, [], "terminated can never be reversed");
  assert.ok(!W.PRACTICE_TRANSITIONS.terminated.length && !W.PRACTICE_TRANSITIONS.in_progress.includes("completed"), "completion goes through scoring and evaluation");
});

test("the agent's hint: given within policy, the question stays; a second hint is refused → fallback to the next question", async () => {
  const p = sergeant([40, 50, 80]);
  const t1 = await conductPracticeTurn({ proctor: p, answer: "idk", decide: picks("assessment_give_hint") });
  assert.equal(t1.hint, "Think about light.");
  assert.equal(t1.advanced, false);
  assert.equal(p.index, 0);
  const t2 = await conductPracticeTurn({ proctor: p, answer: "light?", decide: picks("assessment_give_hint", "assessment_give_hint", "assessment_give_hint") });
  assert.equal(t2.hint, null);
  assert.equal(t2.advanced, true);
  assert.equal(t2.agent.fallback, true);
  assert.deepEqual(t2.agent.picks.map((x) => x.error), ["hint_limit_question", "hint_limit_question", "hint_limit_question"]);
  assert.equal(p.scoredRecords()[0].hints, 1);
  assert.equal(W.questionScore(p.scoredRecords()[0]), 35, "the better attempt (50) minus the hint");
});

test("a probe: one follow-up on the same question, answered next turn; never two", async () => {
  const p = sergeant([75, 90]);
  const t1 = await conductPracticeTurn({ proctor: p, answer: "thin", decide: picks("assessment_probe") });
  assert.equal(t1.probe, "Why?");
  assert.equal(t1.advanced, false);
  const t2 = await conductPracticeTurn({ proctor: p, answer: "because", decide: picks("assessment_probe", "assessment_ask_next") });
  assert.equal(t2.eval.probing, true);
  assert.equal(t2.agent.picks[0].error, "already_probed");
  assert.equal(t2.agent.chosen, "assessment_ask_next");
  assert.equal(t2.agent.fallback, false);
  assert.equal(p.scoredRecords()[0].probe, 90);
  assert.equal(p.index, 1);
});

test("a slow or broken agent never stalls the exam: the next question in the generated order", async () => {
  const p = sergeant([60]);
  const slow = () => new Promise((r) => setTimeout(() => r({ tool: "assessment_give_hint" }), 200));
  const t = await conductPracticeTurn({ proctor: p, answer: "a", decide: slow, policy: { ...W.PRACTICE_POLICY, DECISION_TIMEOUT_MS: 20 } });
  assert.equal(t.advanced, true);
  assert.equal(t.agent.reason, "timeout");
  const p2 = sergeant([60]);
  const t2 = await conductPracticeTurn({ proctor: p2, answer: "a", decide: async () => { throw new Error("boom"); } });
  assert.equal(t2.agent.reason, "decision_error");
  assert.equal(p2.index, 1);
});

test("the agent sees no integrity signals or totals, and can't hint a strong answer", () => {
  const p = sergeant([]);
  const s = practiceDecisionState({ proctor: p, judgement: { score: 90, correct: true, feedback: "good" } });
  assert.ok(!("cheatProbability" in s) && !JSON.stringify(s).includes("cheat"));
  assert.equal(validatePracticeDecision({ tool: "assessment_give_hint" }, s).error, "hint_not_needed");
  assert.equal(validatePracticeDecision({ tool: "assessment_end_exam" }, s).error, "unknown_tool");
});

function run() {
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store, publish: () => {} });
  const evidence = [];
  return { engine, store, evidence, svc: makePracticeRun({ engine, evidence: async (a) => { evidence.push(a); } }) };
}

test("the run: preparing → in_progress ⇄ paused → scoring → evaluated → completed, outcome + evidence", async () => {
  const { engine, svc, evidence } = run();
  const id = await svc.begin({ learnerId: "L1", topic: "Photosynthesis", subject: "Biology", totalQuestions: 3, assessmentId: "assess_1" });
  assert.equal((await engine.get(id)).state, "in_progress");
  assert.equal(await svc.begin({ learnerId: "L1", topic: "Photosynthesis", assessmentId: "assess_1" }), id, "one run per assessment");
  await svc.pause(id);
  assert.equal((await engine.get(id)).state, "paused");
  await svc.turn(id, { agent: { chosen: "assessment_ask_next", picks: [] }, progress: { index: 1, total: 3 } });
  const outcome = await svc.finish(id, { learnerId: "L1", topic: "Photosynthesis", subject: "Biology", summary: { assessmentScore: 80, verdict: "pass", cheatProbability: 0.1, records: [{ judged: 80, objective: "light" }] } });
  const wf = await engine.get(id);
  assert.equal(wf.state, "completed");
  assert.equal(wf.metadata.outcome.verdict, "pass");
  assert.equal(outcome.recommendedNextAction, "none");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].source, "proctored_assessment");
  assert.equal(evidence[0].score, 0.8);
  const types = (await engine.events(id)).map((e) => e.event_type);
  assert.ok(types.includes("practice.turn") && types.includes("practice.evaluated") && types.includes("outcome"));
});

test("terminated and flagged runs record an outcome but write no evidence; an ended run is abandoned", async () => {
  const { engine, svc, evidence } = run();
  const a = await svc.begin({ learnerId: "L1", topic: "T", assessmentId: "a" });
  await svc.finish(a, { learnerId: "L1", topic: "T", summary: { assessmentScore: 90, verdict: "terminated", cheatProbability: 0.9, records: [] }, terminated: true });
  assert.equal((await engine.get(a)).state, "terminated");
  const b = await svc.begin({ learnerId: "L1", topic: "T", assessmentId: "b" });
  const ob = await svc.finish(b, { learnerId: "L1", topic: "T", summary: { assessmentScore: 90, verdict: "flagged", cheatProbability: 0.5, records: [{ judged: 90 }] } });
  assert.equal((await engine.get(b)).state, "completed");
  assert.equal(ob.conceptEvidence.length, 0);
  assert.equal(evidence.length, 0);
  const c = await svc.begin({ learnerId: "L1", topic: "T", assessmentId: "c" });
  await svc.abandon(c, "ended");
  assert.equal((await engine.get(c)).state, "abandoned");
});

test("the gateway uses the controller and the code verdict (no evaluateAnswer, no forced verdict)", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../assessmentGateway.js", import.meta.url), "utf8");
  assert.ok(src.includes("conductPracticeTurn(") && !src.includes("evaluateAnswer(") && !src.includes("forcedVerdict"));
  const proctor = await readFile(new URL("../agents/sargeant/proctor.js", import.meta.url), "utf8");
  assert.ok(proctor.includes("computeVerdict(") && proctor.includes('__role: "assessor"'));
});
