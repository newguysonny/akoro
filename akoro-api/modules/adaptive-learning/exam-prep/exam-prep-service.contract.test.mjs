import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Study-Prep Master Plan §4.8.1–4.8.2: the exam-prep service is extracted
 * from the router and the submit race is fixed. The service imports db.js
 * (which refuses to boot without env), so behavioural pieces that are pure
 * are asserted against the Education Engine (db-free) and the write
 * discipline is asserted as a source contract — the house pattern for
 * db-backed modules.
 */

const service = await readFile(new URL("./exam-prep-service.js", import.meta.url), "utf8");
const router = await readFile(new URL("./exam-prep-confidence.js", import.meta.url), "utf8");
const engine = await import("../study-prep/education-engine.js");

test("the router is a thin envelope over the extracted service", () => {
  assert.match(router, /from "\.\/exam-prep-service\.js"/);
  assert.match(router, /startExamPrepRun\(/);
  assert.match(router, /submitExamPrepAttempt\(/);
  assert.match(router, /startExamPrepRetest\(/);
  // No business logic left in the router: it must not build prompts or rows.
  assert.doesNotMatch(router, /openai\.chat\.completions\.create/);
  assert.doesNotMatch(router, /answer_key/);
});

test("the service owns generation and run lifecycle on top of the engine", () => {
  assert.match(service, /export async function startExamPrepRun/);
  assert.match(service, /export async function submitExamPrepAttempt/);
  assert.match(service, /export async function startExamPrepRetest/);
  assert.match(service, /from "\.\.\/study-prep\/education-engine\.js"/);
  // Study-prep linkage lands with the session tables (Phase 2).
  assert.match(service, /study_prep_topic_id/);
});

test("the submit race is fixed: conditional attempt write first, winner checked, then status-guarded run update", () => {
  const submit = service.slice(service.indexOf("export async function submitExamPrepAttempt"));
  const attemptWriteAt = submit.indexOf(".is(\"submitted_at\", null).select(\"id\").maybeSingle()");
  const runWriteAt = submit.indexOf(".eq(\"status\", run.status).select(\"*\").maybeSingle()");
  assert.ok(attemptWriteAt > -1, "attempt write is conditional on submitted_at IS NULL");
  assert.ok(runWriteAt > -1, "run update is guarded by the expected status");
  assert.ok(attemptWriteAt < runWriteAt, "the attempt conditional write happens before the run update");
  // The winner of the attempt write is checked; losers surface a stable code.
  assert.match(submit, /if \(!attemptWrite\.data\)/);
  assert.match(submit, /attempt_already_submitted/);
});

test("the retest keeps the hard teach-back gate", () => {
  const retest = service.slice(service.indexOf("export async function startExamPrepRetest"));
  assert.match(retest, /learnerConfirmedReady !== true/);
  assert.match(retest, /kind: "retest"/);
});

test("threshold routing is deterministic: pass / cap / retest band", () => {
  assert.deepEqual(
    engine.applyThreshold({ score: 0.8, passThreshold: 0.7, attemptsUsed: 1, maxAttempts: 3 }),
    { passed: true, capped: false, attemptsRemaining: 2 },
  );
  assert.deepEqual(
    engine.applyThreshold({ score: 0.6, passThreshold: 0.7, attemptsUsed: 2, maxAttempts: 3 }),
    { passed: false, capped: false, attemptsRemaining: 1 },
  );
  assert.deepEqual(
    engine.applyThreshold({ score: 0.6, passThreshold: 0.7, attemptsUsed: 3, maxAttempts: 3 }),
    { passed: false, capped: true, attemptsRemaining: 0 },
  );
  // Cram mode (max_attempts = 1) caps on the first miss.
  assert.deepEqual(
    engine.applyThreshold({ score: 0.5, passThreshold: 0.7, attemptsUsed: 1, maxAttempts: 1 }),
    { passed: false, capped: true, attemptsRemaining: 0 },
  );
});

test("answer-key scoring counts only key matches and rejects duplicates/invalid options", () => {
  const key = { q1: 1, q2: 0, q3: 2 };
  const result = engine.scoreAttempt(key, [
    { questionId: "q1", answerIndex: 1 }, { questionId: "q2", answerIndex: 0 }, { questionId: "q3", answerIndex: 3 },
  ]);
  assert.equal(result.correct, 2);
  assert.equal(result.total, 3);
  assert.equal(result.score, Math.round((2 / 3) * 10_000) / 10_000);
  assert.throws(() => engine.scoreAttempt(key, [{ questionId: "q1", answerIndex: 1 }, { questionId: "q1", answerIndex: 0 }]), /invalid_answers/);
  assert.throws(() => engine.scoreAttempt(key, [{ questionId: "q1", answerIndex: 9 }]), /invalid_answers/);
});

test("mastery write-back is bounded, deterministic and uses the knowledge_confidence fallback", () => {
  // knowledge_confidence 42 → 0.42 baseline, a 1.0 pass lifts it but stays ≤ 1
  const first = engine.masteryWriteBack({ knowledgeConfidence: 42, score: 1, passed: true, attemptsUsed: 1 });
  assert.equal(first.previous, 0.42);
  assert.ok(first.next > 0.42 && first.next <= 1);
  // A second failed attempt decays toward the observed score, never below 0
  const second = engine.masteryWriteBack({ currentMastery: first.next, score: 0.2, passed: false, attemptsUsed: 2 });
  assert.ok(second.next < first.next && second.next >= 0);
  // No prior evidence at all: the attempt itself is the first evidence
  const cold = engine.masteryWriteBack({ score: 0.6, passed: false, attemptsUsed: 1 });
  assert.equal(cold.previous, null);
  assert.equal(cold.next, 0.6);
});

test("estimateSessionCost prices practice plus ROUNDED per-loop LLM cost", () => {
  const estimate = engine.estimateSessionCost({ topicCount: 6 });
  assert.equal(estimate.practiceCoins, 6 * 2 * 2);
  assert.ok(estimate.loopCoins > 0, "the planning + per-topic loop cost is priced in");
  assert.equal(estimate.totalCoins, estimate.practiceCoins + estimate.loopCoins);
  assert.equal(estimate.maxIterationsPerStep, 6);
  // The 12-topic cap bounds the estimate
  assert.equal(engine.estimateSessionCost({ topicCount: 99 }).practiceCoins, 12 * 2 * 2);
});

// Strategy Library v3 (§7.7.2, D40): the Study Prep column of the one library.
test("the strategy library is the v3 Study Prep set and nothing else", () => {
  assert.deepEqual(engine.STRATEGY_LIBRARY, ["teach_back", "different_analogy", "interleave", "space_out", "escalate_human", "peer_help", "contrast_pairs", "prerequisite_review", "vocabulary_focus", "worked_examples", "varied_formats", "easy_wins_first", "chunk_plan", "make_concrete", "schedule_plan", "offline_pack", "format_practice", "self_check", "goal_clarify"]);
  assert.equal(engine.isPermittedStrategy("retrieval_practice"), false, "review and practice only");
  assert.equal(engine.isPermittedStrategy("worked_example"), false, "a legacy alias is not a library id here");
  assert.equal(engine.isPermittedStrategy("teach_back"), true);
  assert.equal(engine.isPermittedStrategy("drop_the_topic"), false);
  assert.equal(engine.isPermittedStrategy(null), false);
});
