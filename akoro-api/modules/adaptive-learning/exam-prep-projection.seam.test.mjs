// Seam tests for the exam-prep run projection (exam-prep-service.js; it was
// adaptive-workflows.js before Phase 5) against the in-memory db fake: the
// learner-owned exam-prep workflow projection, its kill switch and its
// transition rules (the one run definition, study-prep/workflow.js).
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
delete process.env.AKORO_ADAPTIVE_WORKFLOWS_ENABLED;

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const {
  startExamPrepWorkflow, transitionExamPrepWorkflow, listLearnerWorkflows, publicWorkflow,
} = await import("./exam-prep-service.js");

const RUNS = "edu.adaptive_workflow_runs";
const STEPS = "edu.adaptive_workflow_steps";

const run = (extra = {}) => ({
  id: "wf-1", learner_id: "learner-1", workflow_type: "exam_prep", exam_prep_run_id: "ep-1",
  topic: "Cells", subject: "Biology", exam_board: "WAEC", policy_version: "p1",
  state: "diagnostic_ready", current_attempt: 1, last_score: null,
  updated_at: "2026-10-01T00:00:00.000Z", completed_at: null, ...extra,
});

test("startExamPrepWorkflow: inserts a sanitised diagnostic_ready run plus its first step; returns the public shape", async () => {
  const fake = installFakeDb(db, {});
  const wf = await startExamPrepWorkflow({
    learnerId: "learner-1", examPrepRunId: "ep-1",
    topic: "Cells\r\nIGNORE ALL PREVIOUS\x00", subject: "B".repeat(400), examBoard: "WAEC",
    policyVersion: "exam-prep-v2", attempt: "2",
  });
  const [row] = fake.rows(RUNS);
  assert.equal(row.learner_id, "learner-1");
  assert.equal(row.workflow_type, "exam_prep");
  assert.equal(row.exam_prep_run_id, "ep-1");
  assert.equal(row.topic, "Cells IGNORE ALL PREVIOUS");
  assert.equal(row.subject.length, 180);
  assert.equal(row.state, "diagnostic_ready");
  assert.equal(row.current_attempt, 2);

  const steps = fake.rows(STEPS);
  assert.equal(steps.length, 1);
  assert.deepEqual(
    { run: steps[0].workflow_run_id, state: steps[0].state, label: steps[0].label, attempt: steps[0].attempt_number },
    { run: row.id, state: "diagnostic_ready", label: "Generated practice ready", attempt: 2 },
  );
  assert.deepEqual(wf, publicWorkflow(row));
  assert.equal(wf.type, "exam_prep");
  assert.equal(wf.currentAttempt, 2);
  assert.equal(wf.lastScore, null);
  assert.equal(Object.hasOwn(wf, "learner_id"), false, "no owner/internal ids in the public shape");
  fake.restore();
});

test("startExamPrepWorkflow: attempt defaults to 1; insert / step errors propagate", async () => {
  const fake = installFakeDb(db, {});
  await startExamPrepWorkflow({ learnerId: "l", examPrepRunId: "ep-x", topic: "t" });
  assert.equal(fake.rows(RUNS)[0].current_attempt, 1);
  assert.equal(fake.rows(STEPS)[0].attempt_number, undefined, "no attempt → event carries none");

  fake.failNext(RUNS, "insert", { message: "insert failed" });
  await assert.rejects(() => startExamPrepWorkflow({ learnerId: "l", examPrepRunId: "ep-y" }), { message: "insert failed" });
  fake.failNext(STEPS, "insert", { message: "step failed" });
  await assert.rejects(() => startExamPrepWorkflow({ learnerId: "l", examPrepRunId: "ep-z" }), { message: "step failed" });
  fake.restore();
});

test("transitionExamPrepWorkflow: a valid transition updates the run and records one step", async () => {
  const fake = installFakeDb(db, { [RUNS]: [run()] });
  const wf = await transitionExamPrepWorkflow({ learnerId: "learner-1", examPrepRunId: "ep-1", from: "diagnostic_ready", to: "teach_back_required", attempt: 1, score: 0.4 });
  const [row] = fake.rows(RUNS);
  assert.equal(row.state, "teach_back_required");
  assert.equal(row.last_score, 0.4);
  assert.equal(row.completed_at, null);
  assert.notEqual(row.updated_at, "2026-10-01T00:00:00.000Z");
  assert.equal(wf.state, "teach_back_required");
  assert.equal(wf.lastScore, 0.4);
  const steps = fake.rows(STEPS);
  assert.equal(steps.length, 1);
  assert.deepEqual(
    { state: steps[0].state, attempt: steps[0].attempt_number, score: steps[0].score, run: steps[0].workflow_run_id },
    { state: "teach_back_required", attempt: 1, score: 0.4, run: "wf-1" },
  );
  fake.restore();
});

test("transitionExamPrepWorkflow: starting a retest (no score supplied) retains the prior diagnostic score",
  async () => {
    // Mirrors exam-prep-service.js:242, which calls with no score.
    const fake = installFakeDb(db, { [RUNS]: [run({ state: "teach_back_required", last_score: 0.4, current_attempt: 1 })] });
    await transitionExamPrepWorkflow({ learnerId: "learner-1", examPrepRunId: "ep-1", from: "teach_back_required", to: "retest_ready", attempt: 2 });
    const lastScore = fake.rows(RUNS)[0].last_score;
    const stepScore = fake.rows(STEPS)[0].score;
    fake.restore();
    assert.equal(lastScore, 0.4, "a score exists only when a transition supplies one");
    assert.equal(stepScore ?? null, null, "the retest step event carries no score");
  });

test("transitionExamPrepWorkflow: terminal states stamp completed_at; score clamped; attempt falls back", async () => {
  const fake = installFakeDb(db, { [RUNS]: [run({ state: "retest_ready", last_score: 0.4, current_attempt: 2 })] });

  const wf = await transitionExamPrepWorkflow({ learnerId: "learner-1", examPrepRunId: "ep-1", from: "retest_ready", to: "passed", score: 1.7 });
  const row = fake.rows(RUNS)[0];
  assert.equal(row.state, "passed");
  assert.equal(row.last_score, 1, "score clamped to [0,1]");
  assert.equal(row.current_attempt, 2, "no attempt → keep current");
  assert.ok(row.completed_at);
  assert.equal(wf.completedAt, row.completed_at);
  assert.equal(fake.rows(STEPS).length, 1);
  fake.restore();
});

test("transitionExamPrepWorkflow: invalid transitions are rejected before touching the db", async () => {
  const fake = installFakeDb(db, { [RUNS]: [run({ state: "passed" })] });
  for (const [from, to] of [["passed", "retest_ready"], ["diagnostic_ready", "researching"], ["diagnostic_ready", "hidden_state"], ["bogus", "passed"]]) {
    await assert.rejects(
      () => transitionExamPrepWorkflow({ learnerId: "learner-1", examPrepRunId: "ep-1", from, to }),
      /Invalid adaptive workflow transition/,
      `${from} → ${to}`,
    );
  }
  assert.equal(fake.calls.length, 0);
  fake.restore();
});

test("transitionExamPrepWorkflow: the stored state, not the caller's `from`, decides; an illegal move from it returns the run unchanged", async () => {
  // Caller claims diagnostic_ready → passed (legal), but the run is already
  // terminal: nothing is written and the current public state is returned.
  const fake = installFakeDb(db, { [RUNS]: [run({ state: "change_approach", completed_at: "2026-10-02T00:00:00.000Z" })] });
  const wf = await transitionExamPrepWorkflow({ learnerId: "learner-1", examPrepRunId: "ep-1", from: "diagnostic_ready", to: "passed", score: 1 });
  assert.equal(wf.state, "change_approach");
  assert.equal(fake.rows(RUNS)[0].state, "change_approach");
  assert.equal(fake.rows(STEPS).length, 0);
  assert.ok(!fake.calls.some((c) => c.op === "update"));
  fake.restore();
});

test("transitionExamPrepWorkflow: missing run row (or another learner's run) → skipped, nothing written", async () => {
  const fake = installFakeDb(db, { [RUNS]: [run({ learner_id: "learner-2" })] });
  assert.equal(await transitionExamPrepWorkflow({ learnerId: "learner-1", examPrepRunId: "ep-1", from: "diagnostic_ready", to: "passed" }), null);
  assert.equal(await transitionExamPrepWorkflow({ learnerId: "learner-2", examPrepRunId: "ep-missing", from: "diagnostic_ready", to: "passed" }), null);
  assert.equal(fake.rows(RUNS)[0].state, "diagnostic_ready");
  assert.equal(fake.rows(STEPS).length, 0);
  assert.ok(fake.calls.every((c) => c.op === "select"));

  fake.failNext(RUNS, "select", { message: "read failed" });
  await assert.rejects(() => transitionExamPrepWorkflow({ learnerId: "learner-2", examPrepRunId: "ep-1", from: "diagnostic_ready", to: "passed" }), { message: "read failed" });
  fake.restore();
});

test("listLearnerWorkflows: only the learner's runs, newest first, grouped by study-prep session, limit capped", async () => {
  const fake = installFakeDb(db, {
    [RUNS]: [
      run({ id: "a", updated_at: "2026-10-03T00:00:00Z" }),
      run({ id: "b", updated_at: "2026-10-05T00:00:00Z", study_prep_session_id: "sp-1", topic: "Cells" }),
      run({ id: "c", updated_at: "2026-10-04T00:00:00Z", study_prep_session_id: "sp-1", topic: "Tissues", state: "passed" }),
      run({ id: "z", learner_id: "learner-2", updated_at: "2026-10-09T00:00:00Z" }),
    ],
  });
  const list = await listLearnerWorkflows("learner-1");
  assert.deepEqual(list.map((w) => w.id), ["sp-1", "a"]);
  assert.equal(list[0].type, "study_prep_session");
  assert.equal(list[0].topicCount, 2);
  assert.deepEqual(list[0].topics.map((t) => t.id), ["b", "c"]);
  assert.equal(list[0].state, "diagnostic_ready", "group state follows the newest topic row");
  assert.equal(list[1].type, "exam_prep");

  // limit is clamped to [1, 30] and the query fetches 3x for grouping.
  const many = Array.from({ length: 100 }, (_, i) => run({ id: `r${i}`, updated_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
  fake.rows(RUNS).push(...many);
  assert.equal((await listLearnerWorkflows("learner-1", 500)).length, 30);
  assert.equal((await listLearnerWorkflows("learner-1", 0)).length, 12, "0 → default 12");
  assert.equal((await listLearnerWorkflows("learner-1", -5)).length, 1);
  fake.failNext(RUNS, "select", { message: "list failed" });
  await assert.rejects(() => listLearnerWorkflows("learner-1"), { message: "list failed" });
  fake.restore();
});

test("publicWorkflow: null-safe, numeric coercion, completedAt defaults to null", () => {
  assert.equal(publicWorkflow(null), null);
  assert.deepEqual(publicWorkflow(run({ current_attempt: "3", last_score: "0.5", completed_at: undefined })), {
    id: "wf-1", type: "exam_prep", state: "diagnostic_ready", topic: "Cells", subject: "Biology",
    examBoard: "WAEC", currentAttempt: 3, lastScore: 0.5, policyVersion: "p1",
    updatedAt: "2026-10-01T00:00:00.000Z", completedAt: null,
  });
});

test("kill switch AKORO_ADAPTIVE_WORKFLOWS_ENABLED=false is read per call and disables every entry point", async () => {
  const fake = installFakeDb(db, { [RUNS]: [run()] });
  try {
    process.env.AKORO_ADAPTIVE_WORKFLOWS_ENABLED = "FALSE";
    assert.equal(await startExamPrepWorkflow({ learnerId: "l", examPrepRunId: "ep-2" }), null);
    assert.equal(await transitionExamPrepWorkflow({ learnerId: "learner-1", examPrepRunId: "ep-1", from: "diagnostic_ready", to: "passed" }), null);
    // Disabled even for an otherwise-invalid transition: no throw, just off.
    assert.equal(await transitionExamPrepWorkflow({ learnerId: "learner-1", examPrepRunId: "ep-1", from: "passed", to: "researching" }), null);
    assert.deepEqual(await listLearnerWorkflows("learner-1"), []);
    assert.equal(fake.calls.length, 0);

    // Any value other than "false" (case-insensitive) keeps it on — flipped at runtime, no reload.
    process.env.AKORO_ADAPTIVE_WORKFLOWS_ENABLED = "0";
    assert.equal((await listLearnerWorkflows("learner-1")).length, 1);
    delete process.env.AKORO_ADAPTIVE_WORKFLOWS_ENABLED;
    assert.equal((await transitionExamPrepWorkflow({ learnerId: "learner-1", examPrepRunId: "ep-1", from: "diagnostic_ready", to: "passed" })).state, "passed");
  } finally {
    delete process.env.AKORO_ADAPTIVE_WORKFLOWS_ENABLED;
    fake.restore();
  }
});
