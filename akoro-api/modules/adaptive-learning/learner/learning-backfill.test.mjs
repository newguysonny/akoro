import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { teachingSessionEvents, examPrepRunEvents, backfillLearningEvidence, LIVE_RECORDING_SINCE } = await import("./learning-backfill.js");

const SESSION = {
  id: "sess-1", student_id: "learner-a", topic: "Photosynthesis", subject: "Biology",
  subtopics: ["Chlorophyll", { name: "Light reaction" }, "Glucose"],
  teaching_evidence: { concepts: [
    { attempts: 3, unresolvedMisconception: true, masteryStatus: "developing", learnerMastery: 0.4 },
    { attempts: 2, unresolvedMisconception: false, masteryStatus: "verified", learnerMastery: 0.85 },
    { attempts: 0, unresolvedMisconception: true, masteryStatus: "introduced" },
  ] },
  updated_at: "2026-10-01T10:00:00Z", completed_at: "2026-10-01T09:30:00Z",
};

test("teaching backfill: an unresolved misconception and a verified part, with deterministic refs", () => {
  const events = teachingSessionEvents(SESSION);
  assert.equal(events.length, 2, "an untouched part (0 attempts) is skipped");
  const [mis, ver] = events;
  assert.equal(mis.kind, "misconception_detected");
  assert.equal(mis.source, "backfill");
  assert.equal(mis.checked, true);
  assert.equal(mis.sessionRef, "backfill:teaching:sess-1");
  assert.equal(mis.turnRef, "p0:misconception_detected");
  assert.deepEqual(mis.topics, ["Chlorophyll", "Photosynthesis"], "the part first, then the topic");
  assert.equal(mis.observedAt, "2026-10-01T09:30:00Z");
  assert.equal(ver.kind, "demonstrated_understanding");
  assert.equal(ver.checked, false, "ledger only: history, it doesn't move today's state");
  assert.equal(ver.turnRef, "p1:verified");
  assert.deepEqual(ver.topics, ["Light reaction", "Photosynthesis"]);
  assert.equal(ver.quality, 0.85);
  assert.deepEqual(teachingSessionEvents(SESSION), events, "pure: the same row maps the same way");
  assert.deepEqual(teachingSessionEvents({ ...SESSION, teaching_evidence: {} }), []);
  assert.deepEqual(teachingSessionEvents({ ...SESSION, student_id: null }), []);
});

test("exam-prep backfill: each scored attempt, against the run's pass mark", () => {
  const run = { id: "run-1", learner_id: "learner-a", topic: "Osmosis", subject: "Biology", pass_threshold: 0.7, last_score: 0.8 };
  const events = examPrepRunEvents(run, [
    { attempt_number: 2, kind: "retest", score: 0.8, submitted_at: "2026-10-02T00:00:00Z" },
    { attempt_number: 1, kind: "diagnostic", score: 0.4, submitted_at: "2026-10-01T00:00:00Z" },
    { attempt_number: 3, kind: "retest", score: null },
  ]);
  assert.deepEqual(events.map((e) => [e.turnRef, e.kind, e.quality]), [["a1:attempt", "partial_understanding", 0.4], ["a2:attempt", "assessment_result", 0.8]]);
  assert.ok(events.every((e) => e.sessionRef === "backfill:exam-prep:run-1" && e.source === "backfill" && e.checked === false));
  assert.deepEqual(examPrepRunEvents(run, []).map((e) => e.turnRef), ["last:attempt"], "no attempts kept: the run's last score");
  assert.deepEqual(examPrepRunEvents({ ...run, last_score: null }, []), []);
});

/** A tiny stand-in for the Supabase query builder over two tables. */
function fakeClient(tables) {
  const calls = [];
  const builder = (name) => {
    let rows = [...(tables[name] || [])];
    const q = {
      select() { return q; },
      eq(col, v) { rows = rows.filter((r) => r[col] === v); return q; },
      in(col, vs) { rows = rows.filter((r) => vs.includes(r[col])); return q; },
      lt(col, v) { rows = rows.filter((r) => String(r[col]) < v); return q; },
      order() { return q; },
      range(a, b) { calls.push(name); return Promise.resolve({ data: rows.slice(a, b + 1), error: null }); },
      then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej); },
    };
    return q;
  };
  return { calls, schema: () => ({ from: builder }) };
}

test("the runner is idempotent: a second run records nothing new (refs are derived, the recorder dedupes)", async () => {
  const client = fakeClient({
    adaptive_sessions: [SESSION, { ...SESSION, id: "sess-new", updated_at: "2026-11-07T00:00:00Z" }],
    learner_exam_prep_runs: [{ id: "run-1", learner_id: "learner-a", topic: "Osmosis", subject: "Biology", pass_threshold: 0.7, updated_at: "2026-09-01T00:00:00Z" }],
    learner_exam_prep_attempts: [{ run_id: "run-1", attempt_number: 1, kind: "diagnostic", score: 0.9 }],
  });
  const ledger = new Set();
  const record = async ({ learnerId, sessionRef, turnRef, topic }) => {
    if (topic === "Chlorophyll") return { recorded: false, reason: "no_approved_concept" };   // falls back to the topic
    const key = `${learnerId}|${sessionRef}|${turnRef}|${topic}`;
    if (!ledger.has(key)) ledger.add(key);
    return { recorded: true };
  };
  const first = await backfillLearningEvidence({ client, record });
  assert.equal(first.sessions, 1, "a session updated after live recording began is left to the live recorder");
  assert.equal(first.runs, 1);
  assert.equal(first.events, 3);
  const size = ledger.size;
  assert.equal(size, 3);
  assert.ok([...ledger].some((k) => k.endsWith("p0:misconception_detected|Photosynthesis")), "no concept for the part → the topic");
  await backfillLearningEvidence({ client, record });
  assert.equal(ledger.size, size, "re-running adds nothing");
  const dry = await backfillLearningEvidence({ client, record: async () => { throw new Error("must not write"); }, dryRun: true });
  assert.equal(dry.events, 3);
  assert.equal(dry.recorded, 0);
  const only = await backfillLearningEvidence({ client, record, sessionIds: ["sess-new"], before: null });
  assert.equal(only.sessions, 1);
  assert.equal(only.runs, 0, "explicit sessions only: no exam-prep sweep");
  assert.ok(LIVE_RECORDING_SINCE.startsWith("2026-11-06"));
});
