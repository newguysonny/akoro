// Seam tests for the exam-prep service over the in-memory fake db
// (MIGRATION_MATRIX §3.4, §7). Never reaches generateExamPrepAttempt's model
// call: startExamPrepRetest is only driven down paths that throw before it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const svc = await import("./exam-prep-service.js");
const {
  examPrepInput, publicRun, publicAttempt, scoreSubmission, nextRunStatus, getOwnedExamPrepRun,
  submitExamPrepAttempt, startExamPrepRetest, examPrepPolicyFor, listExamPrepRuns, getExamPrepAttemptRow,
  ExamPrepRequestError, ExamPrepConflictError,
} = svc;

function fakeFor(t, seed = {}, options = {}) {
  const fake = installFakeDb(db, seed, options);
  t.after(() => fake.restore());
  return fake;
}

/** Silence the service's console.error for workflow-projection outages. */
function quietErrors(t) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  t.after(() => { console.error = original; });
  return lines;
}

const LEARNER = randomUUID();
const OTHER = randomUUID();

const runRow = (over = {}) => ({
  id: randomUUID(), learner_id: LEARNER, topic: "Quadratic equations", subject: "Mathematics", exam_board: "WAEC",
  question_provenance: "generated", question_count: 3, pass_threshold: 0.7, max_attempts: 3, current_attempt: 1,
  last_score: null, status: "diagnostic_ready", policy_version: "exam-confidence-v1", completed_at: null,
  updated_at: "2026-10-01T00:00:00.000Z", ...over,
});
const attemptRow = (run, over = {}) => ({
  id: randomUUID(), run_id: run.id, attempt_number: run.current_attempt, kind: "diagnostic",
  questions: [
    { id: "q1", question: "1+1?", options: ["1", "2", "3", "4"], objective: "add", difficulty: "easy" },
    { id: "q2", question: "2+2?", options: ["2", "3", "4", "5"], objective: "add", difficulty: "easy" },
    { id: "q3", question: "3+3?", options: ["5", "6", "7", "8"], objective: "add", difficulty: "easy" },
  ],
  answer_key: { q1: 1, q2: 2, q3: 1 }, submitted_at: null, score: null, ...over,
});
const allRight = [{ questionId: "q1", answerIndex: 1 }, { questionId: "q2", answerIndex: 2 }, { questionId: "q3", answerIndex: 1 }];
const allWrong = [{ questionId: "q1", answerIndex: 0 }, { questionId: "q2", answerIndex: 0 }, { questionId: "q3", answerIndex: 0 }];

// ── examPrepInput ───────────────────────────────────────────────────────────

test("examPrepInput: defaults subject/board/count, uppercases board, strips newlines and clips", () => {
  assert.deepEqual(examPrepInput({ topic: "  Cell\nbiology " }), { topic: "Cell biology", subject: "General", examBoard: "WAEC", questionCount: 5 });
  const out = examPrepInput({ topic: "x".repeat(400), subject: "Biology", examBoard: "neco", questionCount: 10 });
  assert.equal(out.topic.length, 180);
  assert.equal(out.examBoard, "NECO");
  assert.equal(out.questionCount, 10);
  assert.equal(examPrepInput({ topic: "abc", questionCount: "3" }).questionCount, 3, "numeric strings are accepted");
});

test("examPrepInput rejects short topics and counts outside 3..10 / non-integers with ExamPrepRequestError", () => {
  for (const body of [
    {}, null, { topic: "ab" }, { topic: "   \n  " },
    { topic: "Algebra", questionCount: 2 }, { topic: "Algebra", questionCount: 11 },
    { topic: "Algebra", questionCount: 4.5 }, { topic: "Algebra", questionCount: "five" },
  ]) {
    assert.throws(() => examPrepInput(body), ExamPrepRequestError, JSON.stringify(body));
  }
});

// ── publicRun / publicAttempt ───────────────────────────────────────────────

test("publicRun: camelCases, coerces numerics, and keeps null lastScore / completedAt", () => {
  const row = runRow({ question_count: "5", pass_threshold: "0.7", max_attempts: "3", current_attempt: "2", last_score: "0.4", learner_id: OTHER });
  const pub = publicRun(row);
  assert.deepEqual(pub, {
    id: row.id, topic: row.topic, subject: row.subject, examBoard: "WAEC", questionProvenance: "generated",
    questionCount: 5, passThreshold: 0.7, maxAttempts: 3, currentAttempt: 2, lastScore: 0.4,
    status: "diagnostic_ready", policyVersion: "exam-confidence-v1", completedAt: null,
  });
  assert.equal(publicRun(runRow()).lastScore, null);
  assert.ok(!("learnerId" in pub) && !("learner_id" in pub), "no learner id in the public shape");
});

test("publicAttempt never leaks the answer key or per-question answerIndex", () => {
  const run = runRow();
  const row = attemptRow(run, { questions: attemptRow(run).questions.map((q) => ({ ...q, answerIndex: 3, explanation: "secret" })) });
  const pub = publicAttempt(row);
  const json = JSON.stringify(pub);
  assert.doesNotMatch(json, /answer_key|answerKey|answerIndex|explanation/);
  assert.deepEqual(Object.keys(pub.questions[0]).sort(), ["difficulty", "id", "objective", "options", "question"]);
  assert.equal(pub.attemptNumber, 1);
  assert.equal(pub.submittedAt, null);
  assert.equal(pub.score, null);
  assert.deepEqual(publicAttempt({ attempt_number: "2", kind: "retest", questions: null, score: "0.5" }).questions, []);
});

// ── scoreSubmission / nextRunStatus ────────────────────────────────────────

test("scoreSubmission scores against the key and rejects malformed / duplicate answers", () => {
  const key = { q1: 1, q2: 2, q3: 1 };
  assert.deepEqual(scoreSubmission(key, allRight), { submitted: { q1: 1, q2: 2, q3: 1 }, total: 3, correct: 3, score: 1 });
  assert.equal(scoreSubmission(key, [{ questionId: "q1", answerIndex: 1 }]).score, 0.3333);
  assert.equal(scoreSubmission(key, []).score, 0, "unanswered questions count as wrong");
  assert.throws(() => scoreSubmission(key, [{ questionId: "q1", answerIndex: 4 }]));
  assert.throws(() => scoreSubmission(key, [{ questionId: "q1", answerIndex: 1 }, { questionId: "q1", answerIndex: 2 }]));
  assert.throws(() => scoreSubmission(key, [{ questionId: "", answerIndex: 1 }]));
});

test("nextRunStatus: pass → passed; fail with attempts left → teach_back_required; fail on last → change_approach", () => {
  assert.deepEqual(nextRunStatus({ score: 0.7, passThreshold: 0.7, currentAttempt: 1, maxAttempts: 3 }), { passed: true, capped: false, status: "passed" });
  assert.deepEqual(nextRunStatus({ score: 0.69, passThreshold: 0.7, currentAttempt: 1, maxAttempts: 3 }), { passed: false, capped: false, status: "teach_back_required" });
  assert.deepEqual(nextRunStatus({ score: 0.69, passThreshold: 0.7, currentAttempt: 2, maxAttempts: 3 }), { passed: false, capped: false, status: "teach_back_required" });
  assert.deepEqual(nextRunStatus({ score: 0.69, passThreshold: 0.7, currentAttempt: 3, maxAttempts: 3 }), { passed: false, capped: true, status: "change_approach" });
  assert.equal(nextRunStatus({ score: 1, passThreshold: 0.7, currentAttempt: 3, maxAttempts: 3 }).status, "passed", "passing on the last attempt still passes");
  assert.equal(nextRunStatus({ score: "0.8", passThreshold: "0.7", currentAttempt: "1", maxAttempts: "3" }).status, "passed", "numeric strings from the db");
});

// ── examPrepPolicyFor ───────────────────────────────────────────────────────

test("examPrepPolicyFor: subject-scoped policy, then board-wide '*', then the explicit default", async (t) => {
  const fake = fakeFor(t, { "edu.exam_prep_confidence_policies": [
    { exam_board: "WAEC", subject: "Mathematics", pass_threshold: 0.8, max_attempts: 4, policy_version: "maths-v2" },
    { exam_board: "WAEC", subject: "*", pass_threshold: 0.6, max_attempts: 2, policy_version: "waec-v1" },
  ] });
  assert.equal((await examPrepPolicyFor("WAEC", "Mathematics")).policy_version, "maths-v2");
  assert.equal((await examPrepPolicyFor("WAEC", "Biology")).policy_version, "waec-v1");
  assert.deepEqual(await examPrepPolicyFor("NECO", "Biology"), { pass_threshold: 0.70, max_attempts: 3, policy_version: "exam-confidence-v1" });
  fake.failNext("edu.exam_prep_confidence_policies", "select", { message: "down" });
  await assert.rejects(examPrepPolicyFor("WAEC", "Mathematics"), { message: "down" });
});

// ── getOwnedExamPrepRun ─────────────────────────────────────────────────────

test("getOwnedExamPrepRun: a real randomUUID is looked up (regression: valid UUIDs were rejected)", async (t) => {
  const run = runRow();
  const fake = fakeFor(t, { "edu.learner_exam_prep_runs": [run] });
  const found = await getOwnedExamPrepRun(run.id, LEARNER);
  assert.equal(found?.id, run.id);
  assert.equal((await getOwnedExamPrepRun(run.id.toUpperCase(), LEARNER)), null, "case-insensitive id passes validation (fake eq is exact, so no row)");
  assert.ok(fake.calls.filter((c) => c.table === "edu.learner_exam_prep_runs").length === 2, "both well-formed ids reached the db");
});

test("getOwnedExamPrepRun: another learner's run → null; malformed ids → null without a query", async (t) => {
  const run = runRow();
  const fake = fakeFor(t, { "edu.learner_exam_prep_runs": [run] });
  assert.equal(await getOwnedExamPrepRun(run.id, OTHER), null);
  const before = fake.calls.length;
  for (const bad of ["", "not-a-uuid", `${run.id}0`, run.id.slice(0, -1), `${run.id}\n`, null, undefined, "' or 1=1 --"]) {
    assert.equal(await getOwnedExamPrepRun(bad, LEARNER), null, String(bad));
  }
  assert.equal(fake.calls.length, before, "malformed ids never reach the db");
});

test("getOwnedExamPrepRun surfaces db errors", async (t) => {
  const fake = fakeFor(t, { "edu.learner_exam_prep_runs": [] });
  fake.failNext("edu.learner_exam_prep_runs", "select", { message: "boom" });
  await assert.rejects(getOwnedExamPrepRun(randomUUID(), LEARNER), { message: "boom" });
});

// ── submitExamPrepAttempt ───────────────────────────────────────────────────

function seedRun(t, runOver = {}, attemptOver = {}, extra = {}) {
  const run = runRow(runOver);
  const attempt = attemptRow(run, attemptOver);
  const fake = fakeFor(t, {
    "edu.learner_exam_prep_runs": [run], "edu.learner_exam_prep_attempts": [attempt], ...extra,
  });
  return { run, attempt, fake };
}

test("submit: unknown run / other learner → { notFound: true }", async (t) => {
  const { run } = seedRun(t);
  assert.deepEqual(await submitExamPrepAttempt({ learnerId: OTHER, runId: run.id, answers: allRight }), { notFound: true });
  assert.deepEqual(await submitExamPrepAttempt({ learnerId: LEARNER, runId: randomUUID(), answers: allRight }), { notFound: true });
});

test("submit: a pass scores, marks the attempt submitted, and moves the run to passed with completed_at", async (t) => {
  quietErrors(t);
  const { run, fake } = seedRun(t);
  const out = await submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: allRight });
  assert.equal(out.passed, true);
  assert.equal(out.nextStatus, "passed");
  assert.deepEqual([out.correct, out.total, out.score], [3, 3, 1]);
  assert.equal(out.run.status, "passed");
  assert.ok(out.run.completed_at);
  const [stored] = fake.rows("edu.learner_exam_prep_attempts");
  assert.ok(stored.submitted_at);
  assert.equal(stored.score, 1);
  assert.deepEqual(stored.submitted_answers, { q1: 1, q2: 2, q3: 1 });
  assert.equal(fake.rows("edu.learner_exam_prep_runs")[0].last_score, 1);
});

test("submit: a fail with attempts left → teach_back_required; on the last attempt → change_approach", async (t) => {
  quietErrors(t);
  const { run, fake } = seedRun(t);
  const out = await submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: allWrong });
  assert.equal(out.nextStatus, "teach_back_required");
  assert.equal(out.run.completed_at, null);
  assert.equal(fake.rows("edu.learner_exam_prep_runs")[0].status, "teach_back_required");

  const last = runRow({ current_attempt: 3, status: "retest_ready" });
  const lastAttempt = attemptRow(last, { kind: "retest" });
  fake.rows("edu.learner_exam_prep_runs").push(last);
  fake.rows("edu.learner_exam_prep_attempts").push(lastAttempt);
  const capped = await submitExamPrepAttempt({ learnerId: LEARNER, runId: last.id, answers: allWrong });
  assert.equal(capped.nextStatus, "change_approach");
  assert.equal(fake.rows("edu.learner_exam_prep_runs").find((r) => r.id === last.id).status, "change_approach");
});

test("submit: single writer — a second submit of the same attempt → attempt_already_submitted, no rescoring", async (t) => {
  quietErrors(t);
  const { run, fake } = seedRun(t, { status: "retest_ready", current_attempt: 2 }, { kind: "retest" });
  const first = await submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: allWrong });
  assert.equal(first.nextStatus, "teach_back_required");
  // Put the run back in a submittable state so only the attempt guard can stop it.
  fake.rows("edu.learner_exam_prep_runs")[0].status = "retest_ready";
  await assert.rejects(
    submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: allRight }),
    (e) => e instanceof ExamPrepConflictError && e.code === "attempt_already_submitted",
  );
  assert.equal(fake.rows("edu.learner_exam_prep_attempts")[0].score, 0, "first score stands");
});

test("submit: concurrent double-submit — exactly one winner, the loser gets attempt_already_submitted", async (t) => {
  quietErrors(t);
  const { run, fake } = seedRun(t);
  const results = await Promise.allSettled([
    submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: allRight }),
    submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: allWrong }),
  ]);
  const won = results.filter((r) => r.status === "fulfilled");
  const lost = results.filter((r) => r.status === "rejected");
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason.code, "attempt_already_submitted");
  const attemptWrites = fake.calls.filter((c) => c.table === "edu.learner_exam_prep_attempts" && c.op === "update").length;
  const runWrites = fake.calls.filter((c) => c.table === "edu.learner_exam_prep_runs" && c.op === "update").length;
  assert.equal(runWrites, 1, `only the attempt winner updates the run (attempt updates: ${attemptWrites})`);
  assert.equal(fake.rows("edu.learner_exam_prep_attempts")[0].score, won[0].value.score);
});

test("submit: run not in a submittable status → ExamPrepConflictError attempt_not_ready", async (t) => {
  for (const status of ["teach_back_required", "passed", "change_approach", "cancelled"]) {
    const { run, fake } = seedRun(t, { status });
    await assert.rejects(
      submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: allRight }),
      (e) => e instanceof ExamPrepConflictError && e.code === "attempt_not_ready", status,
    );
    fake.restore();
  }
});

test("submit: invalid answers → ExamPrepRequestError and nothing is written", async (t) => {
  const { run, fake } = seedRun(t);
  await assert.rejects(
    submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: [{ questionId: "q1", answerIndex: 9 }] }),
    ExamPrepRequestError,
  );
  assert.equal(fake.calls.filter((c) => c.op === "update").length, 0);
  assert.equal(fake.rows("edu.learner_exam_prep_attempts")[0].submitted_at, null);
});

test("submit: the run update is status-guarded — a concurrent transition is not clobbered", async (t) => {
  quietErrors(t);
  const { run, fake } = seedRun(t);
  // Another writer moves the run on between our read and our guarded update:
  // simulate by flipping status as soon as the attempt write lands.
  const originalSchema = db.schema;
  db.schema = (schema) => {
    const s = originalSchema(schema);
    return {
      ...s,
      from: (table) => {
        const q = s.from(table);
        if (table !== "learner_exam_prep_runs") return q;
        const origUpdate = q.update.bind(q);
        q.update = (patch) => { fake.rows("edu.learner_exam_prep_runs")[0].status = "cancelled"; return origUpdate(patch); };
        return q;
      },
    };
  };
  t.after(() => { db.schema = originalSchema; });
  const out = await submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: allRight });
  assert.equal(fake.rows("edu.learner_exam_prep_runs")[0].status, "cancelled", "the concurrent winner keeps its state");
  assert.equal(out.nextStatus, "passed", "the caller still learns its own outcome");
});

test("submit: a workflow projection failure does not fail the submit", async (t) => {
  const errors = quietErrors(t);
  const { run, fake } = seedRun(t);
  fake.failNext("edu.adaptive_workflow_runs", "select", { message: "workflow projection down" });
  const out = await submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: allRight });
  assert.equal(out.passed, true);
  assert.equal(out.workflow, null);
  assert.equal(fake.rows("edu.learner_exam_prep_runs")[0].status, "passed");
  assert.ok(errors.some((l) => /workflow-transition/.test(l) && /projection down/.test(l)), "the outage is logged");
});

test("submit: an existing workflow projection is transitioned alongside the run", async (t) => {
  quietErrors(t);
  const run = runRow();
  const fake = fakeFor(t, {
    "edu.learner_exam_prep_runs": [run], "edu.learner_exam_prep_attempts": [attemptRow(run)],
    "edu.adaptive_workflow_runs": [{ id: randomUUID(), learner_id: LEARNER, exam_prep_run_id: run.id, workflow_type: "exam_prep", state: "diagnostic_ready", current_attempt: 1, last_score: null }],
  });
  const prev = process.env.AKORO_ADAPTIVE_WORKFLOWS_ENABLED;
  delete process.env.AKORO_ADAPTIVE_WORKFLOWS_ENABLED;
  t.after(() => { if (prev !== undefined) process.env.AKORO_ADAPTIVE_WORKFLOWS_ENABLED = prev; });
  const out = await submitExamPrepAttempt({ learnerId: LEARNER, runId: run.id, answers: allWrong });
  assert.equal(fake.rows("edu.adaptive_workflow_runs")[0].state, "teach_back_required");
  assert.equal(fake.rows("edu.adaptive_workflow_steps").length, 1);
  assert.ok(out.workflow);
});

// ── startExamPrepRetest preconditions (all throw before the model call) ────

test("retest: unknown / foreign run → { notFound: true }", async (t) => {
  const { run } = seedRun(t, { status: "teach_back_required" });
  assert.deepEqual(await startExamPrepRetest({ learnerId: OTHER, runId: run.id, learnerConfirmedReady: true }), { notFound: true });
  assert.deepEqual(await startExamPrepRetest({ learnerId: LEARNER, runId: "nope", learnerConfirmedReady: true }), { notFound: true });
});

test("retest: wrong status → ExamPrepConflictError retest_not_available", async (t) => {
  for (const status of ["diagnostic_ready", "retest_ready", "passed", "change_approach"]) {
    const { run, fake } = seedRun(t, { status });
    await assert.rejects(
      startExamPrepRetest({ learnerId: LEARNER, runId: run.id, learnerConfirmedReady: true }),
      (e) => e instanceof ExamPrepConflictError && e.code === "retest_not_available", status,
    );
    fake.restore();
  }
});

test("retest: attempt cap reached → ExamPrepConflictError even when the learner confirms", async (t) => {
  const { run, fake } = seedRun(t, { status: "teach_back_required", current_attempt: 3, max_attempts: 3 });
  await assert.rejects(
    startExamPrepRetest({ learnerId: LEARNER, runId: run.id, learnerConfirmedReady: true }),
    (e) => e instanceof ExamPrepConflictError && e.code === "retest_not_available",
  );
  assert.equal(fake.calls.filter((c) => c.op !== "select").length, 0, "nothing written");
});

test("retest: learnerConfirmedReady must be exactly true (teach-back gate) → ExamPrepRequestError", async (t) => {
  const { run, fake } = seedRun(t, { status: "teach_back_required", current_attempt: 1 });
  for (const value of [undefined, false, "true", 1, null, {}]) {
    await assert.rejects(
      startExamPrepRetest({ learnerId: LEARNER, runId: run.id, learnerConfirmedReady: value }),
      ExamPrepRequestError, String(value),
    );
  }
  assert.equal(fake.calls.filter((c) => c.op !== "select").length, 0, "nothing written, no attempt generated");
});

// ── list / attempt row ─────────────────────────────────────────────────────

test("listExamPrepRuns: own runs only, newest first, limit clamped to 1..50", async (t) => {
  const rows = Array.from({ length: 60 }, (_, i) => runRow({ updated_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
  fakeFor(t, { "edu.learner_exam_prep_runs": [...rows, runRow({ learner_id: OTHER })] });
  const list = await listExamPrepRuns(LEARNER, 3);
  assert.equal(list.length, 3);
  assert.equal(list[0].updated_at, rows[59].updated_at);
  assert.ok(list.every((r) => r.learner_id === LEARNER));
  assert.equal((await listExamPrepRuns(LEARNER, 999)).length, 50);
  assert.equal((await listExamPrepRuns(LEARNER, "junk")).length, 10);
  assert.equal((await listExamPrepRuns(LEARNER, -5)).length, 1);
});

test("getExamPrepAttemptRow: notFound for foreign run, notReady until submitted, then the row", async (t) => {
  const { run, attempt, fake } = seedRun(t);
  assert.deepEqual(await getExamPrepAttemptRow(OTHER, run.id, 1), { notFound: true });
  assert.equal((await getExamPrepAttemptRow(LEARNER, run.id, 1)).notReady, true);
  assert.equal((await getExamPrepAttemptRow(LEARNER, run.id, 2)).notReady, true);
  fake.rows("edu.learner_exam_prep_attempts")[0].submitted_at = new Date().toISOString();
  assert.equal((await getExamPrepAttemptRow(LEARNER, run.id, "1")).attempt.id, attempt.id);
});
