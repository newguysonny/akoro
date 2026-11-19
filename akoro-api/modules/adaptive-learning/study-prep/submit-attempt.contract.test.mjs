// Phase 5: the single-transaction submit (edu.study_prep_submit_attempt).
//   · the SQL function's contract, as source (the house pattern for SQL):
//     one transaction, locks, the idempotent branch, the submit-status guard,
//     the §8.3 outcome, service_role only, registered in the manifest;
//   · exam-prep-service.submitStudyPrepAttempt against the fake db: the
//     Engine scores, the rpc gets exactly the score, duplicates never reach it;
//   · the in-memory twin (submit-attempt.testkit.mjs) the harness tests use:
//     double submit → one score.
// The function itself was also run against a scratch Postgres 16 while this
// was built (migration applied twice; owner check, first submit, double
// submit, stale attempt, retest pass, CHECK refusing an unknown state).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const { submitStudyPrepAttempt, submitExamPrepAttempt } = await import("../exam-prep/exam-prep-service.js");
const { memorySubmitAttempt } = await import("./submit-attempt.testkit.mjs");
const { TOPIC_STATES } = await import("./state-machine.js");

const SQL = readFileSync(new URL("../../../migrations/2026-study-prep-topic-states.sql", import.meta.url), "utf8");
const MANIFEST = JSON.parse(readFileSync(new URL("../../../migrations/manifest.json", import.meta.url), "utf8"));
const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION edu.study_prep_submit_attempt"));

test("the migration is registered (schema group) and idempotent", () => {
  assert.ok(MANIFEST.schema.includes("2026-study-prep-topic-states.sql"));
  assert.ok(MANIFEST.schema.indexOf("2026-study-prep-topic-states.sql") > MANIFEST.schema.indexOf("2026-study-prep-agent-check.sql"));
  assert.match(SQL, /ADD COLUMN IF NOT EXISTS teaching_workflow_id uuid/);
  assert.match(SQL, /CREATE INDEX IF NOT EXISTS/);
  assert.match(SQL, /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conrelid = 'edu\.study_prep_topics'::regclass AND conname = 'study_prep_topics_state_check'\)/);
});

test("the CHECK names exactly the §8.3 topic states", () => {
  const list = /study_prep_topics_state_check CHECK \(status IN \(([^)]*)\)\)/.exec(SQL)?.[1];
  assert.ok(list, "the state CHECK is defined");
  const states = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...states].sort(), [...TOPIC_STATES].sort());
});

test("the submit function: owned, locked, idempotent, guarded, one outcome", () => {
  assert.match(fn, /p_learner_id uuid,\s+p_session_id uuid,\s+p_topic_id\s+uuid,\s+p_run_id\s+uuid,\s+p_attempt_id uuid,\s+p_submitted\s+jsonb,\s+p_correct\s+integer,\s+p_total\s+integer,\s+p_score\s+numeric/);
  assert.match(fn, /LANGUAGE plpgsql/);
  // ownership through the session, rows locked for the write
  assert.match(fn, /s\.learner_id = p_learner_id\s+FOR UPDATE OF t/);
  assert.equal((fn.match(/FOR UPDATE/g) || []).length, 3, "topic, run and attempt are locked");
  // idempotent branch BEFORE any write: an already-scored attempt changes nothing
  const dup = fn.indexOf("IF v_attempt.submitted_at IS NOT NULL");
  const firstWrite = fn.indexOf("UPDATE edu.learner_exam_prep_attempts");
  assert.ok(dup > -1 && dup < firstWrite);
  assert.match(fn.slice(dup, firstWrite), /'applied', false, 'duplicate', true/);
  // the submit-status guard
  assert.match(fn, /v_topic\.status NOT IN \('diagnostic', 'retest'\)/);
  assert.match(fn, /v_run\.status NOT IN \('diagnostic_ready', 'retest_ready'\)/);
  // §8.3 outcome from the run's own pass mark and cap
  assert.match(fn, /v_passed := p_score >= v_run\.pass_threshold/);
  assert.match(fn, /CASE WHEN v_passed THEN 'understood' WHEN v_capped THEN 'capped_out' ELSE 'intervention_required' END/);
  // all three writes in the one function body (one transaction)
  for (const table of ["edu.learner_exam_prep_attempts", "edu.learner_exam_prep_runs", "edu.study_prep_topics"]) {
    assert.ok(fn.slice(firstWrite).includes(`UPDATE ${table}`), `writes ${table}`);
  }
  // no evidence here: recordLearningEvent runs after commit
  assert.doesNotMatch(fn, /learner_concept|evidence/i);
});

test("the function is for the service role only", () => {
  assert.match(SQL, /REVOKE ALL ON FUNCTION edu\.study_prep_submit_attempt\([^)]*\) FROM PUBLIC/);
  const grants = SQL.match(/GRANT EXECUTE ON FUNCTION edu\.study_prep_submit_attempt\([^)]*\) TO [a-z_, ]+;/g) || [];
  assert.equal(grants.length, 1);
  assert.match(grants[0], /TO service_role;$/);
});

// ── exam-prep-service.submitStudyPrepAttempt ────────────────────────────────

const LEARNER = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const TOPIC = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const KEY = { q1: 1, q2: 2, q3: 1 };
const seed = (attempt = {}) => ({
  "edu.learner_exam_prep_runs": [{ id: RUN, learner_id: LEARNER, study_prep_topic_id: TOPIC, status: "diagnostic_ready", current_attempt: 1, max_attempts: 3, pass_threshold: 0.7 }],
  "edu.learner_exam_prep_attempts": [{ id: "a1", run_id: RUN, attempt_number: 1, answer_key: KEY, submitted_at: null, score: null, ...attempt }],
});

test("submitStudyPrepAttempt: the Engine scores; the rpc gets the score and writes the rest", async (t) => {
  const fake = installFakeDb(db, seed(), { rpc: { study_prep_submit_attempt: (args) => ({ data: { ok: true, applied: true, score: args.p_score, passed: false, capped: false, run_status: "teach_back_required", topic: { id: TOPIC, status: "intervention_required" } } }) } });
  t.after(() => fake.restore());
  const out = await submitStudyPrepAttempt({ learnerId: LEARNER, sessionId: SESSION, topicId: TOPIC, runId: RUN, answers: [{ questionId: "q1", answerIndex: 1 }, { questionId: "q2", answerIndex: 0 }, { questionId: "q3", answerIndex: 0 }] });
  assert.equal(fake.rpcCalls.length, 1);
  const args = fake.rpcCalls[0].args;
  assert.deepEqual({ ...args, p_submitted: undefined }, { p_learner_id: LEARNER, p_session_id: SESSION, p_topic_id: TOPIC, p_run_id: RUN, p_attempt_id: "a1", p_submitted: undefined, p_correct: 1, p_total: 3, p_score: 0.3333 });
  assert.deepEqual(args.p_submitted, { q1: 1, q2: 0, q3: 0 });
  assert.equal(JSON.stringify(args).includes("answer_key"), false, "the key never leaves the server");
  assert.deepEqual([out.ok, out.applied, out.passed, out.topic.status], [true, true, false, "intervention_required"]);
  assert.equal(fake.rows("edu.learner_exam_prep_attempts")[0].submitted_at, null, "no write outside the transaction");
});

test("submitStudyPrepAttempt: an already-submitted attempt is a duplicate — the rpc is never called", async (t) => {
  const fake = installFakeDb(db, seed({ submitted_at: "2026-11-01T00:00:00Z", score: 0.6667 }), { rpc: { study_prep_submit_attempt: () => { throw new Error("must not be called"); } } });
  t.after(() => fake.restore());
  const out = await submitStudyPrepAttempt({ learnerId: LEARNER, sessionId: SESSION, topicId: TOPIC, runId: RUN, answers: [] });
  assert.deepEqual(out, { ok: true, applied: false, duplicate: true, code: "attempt_already_submitted", score: 0.6667 });
  assert.equal(fake.rpcCalls.length, 0);
});

test("submitStudyPrepAttempt: another topic's run, a foreign learner or a not_found rpc → notFound; bad answers throw before the rpc", async (t) => {
  const fake = installFakeDb(db, seed(), { rpc: { study_prep_submit_attempt: () => ({ data: { ok: false, code: "not_found" } }) } });
  t.after(() => fake.restore());
  const base = { learnerId: LEARNER, sessionId: SESSION, topicId: TOPIC, runId: RUN };
  assert.deepEqual(await submitStudyPrepAttempt({ ...base, topicId: "55555555-5555-4555-8555-555555555555", answers: [] }), { notFound: true });
  assert.deepEqual(await submitStudyPrepAttempt({ ...base, learnerId: "66666666-6666-4666-8666-666666666666", answers: [] }), { notFound: true });
  await assert.rejects(() => submitStudyPrepAttempt({ ...base, answers: [{ questionId: "q1", answerIndex: 9 }] }), /invalid_answers/);
  assert.equal(fake.rpcCalls.length, 0);
  assert.deepEqual(await submitStudyPrepAttempt({ ...base, answers: [{ questionId: "q1", answerIndex: 1 }] }), { notFound: true });
});

test("one source of state: the standalone submit refuses a Study Prep run", async (t) => {
  const fake = installFakeDb(db, seed());
  t.after(() => fake.restore());
  await assert.rejects(() => submitExamPrepAttempt({ learnerId: LEARNER, runId: RUN, answers: [{ questionId: "q1", answerIndex: 1 }] }), (e) => e.code === "attempt_not_ready");
  assert.equal(fake.rows("edu.learner_exam_prep_attempts")[0].submitted_at, null);
});

// ── the in-memory twin ─────────────────────────────────────────────────────

test("twin: double submit → one score, one outcome; a topic not checking takes no answers", async () => {
  const topics = new Map([["t1", { id: "t1", session_id: "s1", status: "diagnostic", attempts_used: 1, exam_prep_run_id: "r1" }]]);
  const sessions = new Map([["s1", { id: "s1", learner_id: "L" }]]);
  const runs = new Map([["r1", { id: "r1", status: "diagnostic_ready", current_attempt: 1, max_attempts: 3, pass_threshold: 0.7 }]]);
  const submit = memorySubmitAttempt({ store: { topics, sessions }, runs, key: { q1: 1, q2: 0 } });
  const args = { learnerId: "L", sessionId: "s1", topicId: "t1", runId: "r1" };
  const [a, b] = await Promise.all([
    submit({ ...args, answers: [{ questionId: "q1", answerIndex: 1 }, { questionId: "q2", answerIndex: 0 }] }),
    submit({ ...args, answers: [{ questionId: "q1", answerIndex: 0 }, { questionId: "q2", answerIndex: 1 }] }),
  ]);
  assert.equal([a, b].filter((r) => r.applied).length, 1, "exactly one submit applies");
  const dup = [a, b].find((r) => !r.applied);
  assert.equal(dup.duplicate, true);
  assert.equal(dup.score, 1, "the duplicate reports the recorded score");
  assert.equal(topics.get("t1").status, "understood");
  assert.equal(runs.get("r1").status, "passed");
  assert.deepEqual(await submit({ ...args, learnerId: "other", answers: [] }), { notFound: true });
});
