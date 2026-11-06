// Seam tests for the study-prep read tools over the in-memory fake db.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const {
  getLearnerState, getLearnerHistory, getRelevantMemory, getPrerequisites, resolveSyllabusTool, makeSessionStateReader,
} = await import("./read-tools.js");

const L = "learner-1";

function fakeFor(t, seed = {}, options = {}) {
  const fake = installFakeDb(db, seed, options);
  t.after(() => fake.restore());
  return fake;
}

// ── learner.get_state ──────────────────────────────────────────────────────

test("getLearnerState merges concept mastery (0-1) and knowledge_confidence (0-100 → 0-1), keeping the max per topic", async (t) => {
  fakeFor(t, {
    "edu.learner_concept_state": [
      { learner_id: L, mastery: 0.41234, concept: { title: "States of Matter", subject: "Basic Science", topic_key: "states-of-matter" } },
      { learner_id: L, mastery: 0.9, concept: [{ title: "Living Things", subject: "Basic Science JSS1", topic_key: null }] }, // embed as array
      { learner_id: L, mastery: 1.7, concept: { title: "Energy", subject: "Basic Science", topic_key: "Energy Forms" } }, // off the 0–1 scale: refused (Phase 10 scale guard)
      { learner_id: L, mastery: 0.3, misconception_active: true, concept: { title: "Evaporation", subject: "Basic Science", topic_key: "evaporation" } },
      { learner_id: L, mastery: 0.99, concept: { title: "Fractions", subject: "Mathematics", topic_key: "fractions" } }, // other subject
      { learner_id: L, mastery: 0.5, concept: null },
      { learner_id: "someone-else", mastery: 1, concept: { title: "Secret", subject: "Basic Science", topic_key: "secret" } },
    ],
    "edu.knowledge_confidence": [
      { student_id: L, subject: "Basic Science", topic: "States of Matter", confidence: 80, misconceptions: ["a", "b", "c", "d"], last_assessed: "2026-02-01" },
      { student_id: L, subject: "Basic Science", topic: "Living Things", confidence: 20, misconceptions: null, last_assessed: "2026-01-01" },
      { student_id: L, subject: "Mathematics", topic: "Fractions", confidence: 100, misconceptions: ["m"], last_assessed: "2026-03-01" },
    ],
  });
  const out = await getLearnerState({ learnerId: L, subject: "Basic Science" });
  // Phase 10: an off-scale mastery (1.7) is refused by the scale guard instead of
  // being clamped to a perfect 1; the learner model's active misconceptions come first.
  assert.deepEqual(out.topics, { "states-of-matter": 0.8, "living-things": 0.9, evaporation: 0.3 });
  assert.deepEqual(out.misconceptions, ["Evaporation", "a", "b", "c"]);
  assert.match(out.scale, /0-1/);
});

test("getLearnerState: topicIds narrows the result; misconceptions are capped at 8", async (t) => {
  fakeFor(t, {
    "edu.learner_concept_state": [],
    "edu.knowledge_confidence": Array.from({ length: 5 }, (_, i) => ({
      student_id: L, subject: "Basic Science", topic: `Topic ${i}`, confidence: 10 * i, misconceptions: ["x", "y", "z"], last_assessed: `2026-0${i + 1}-01`,
    })),
  });
  const out = await getLearnerState({ learnerId: L, subject: "basic", topicIds: ["topic-1", "topic-4", "missing"] });
  assert.deepEqual(out.topics, { "topic-1": 0.1, "topic-4": 0.4 });
  assert.equal(out.misconceptions.length, 8);
});

test("getLearnerState: a db error propagates", async (t) => {
  const fake = fakeFor(t);
  fake.failNext("edu.learner_concept_state", "select", { message: "state down" });
  await assert.rejects(getLearnerState({ learnerId: L, subject: "x" }), { message: "state down" });
  fake.failNext("edu.knowledge_confidence", "select", { message: "kc down" });
  await assert.rejects(getLearnerState({ learnerId: L, subject: "x" }), { message: "kc down" });
});

// ── learner.get_history ────────────────────────────────────────────────────

test("getLearnerHistory: newest first, bounded, sanitised and shaped", async (t) => {
  fakeFor(t, {
    "edu.learner_exam_prep_runs": [
      { learner_id: L, subject: "Basic Science", topic: "Old\nTopic", status: "passed", last_score: 0.66666, max_attempts: 3, current_attempt: 2, updated_at: "2026-01-01" },
      { learner_id: L, subject: "Basic Science", topic: "x".repeat(400), status: "active", last_score: null, max_attempts: null, current_attempt: null, updated_at: "2026-02-01" },
      { learner_id: L, subject: "Mathematics", topic: "Fractions", status: "passed", last_score: 1, updated_at: "2026-03-01" },
      { learner_id: "other", subject: "Basic Science", topic: "Theirs", status: "passed", updated_at: "2026-04-01" },
    ],
  });
  const { runs } = await getLearnerHistory({ learnerId: L, subject: "Basic Science" });
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0], { topic: "x".repeat(180), status: "active", score: null, attempts: "1 of 3", at: "2026-02-01" });
  assert.deepEqual(runs[1], { topic: "Old Topic", status: "passed", score: 0.6667, attempts: "2 of 3", at: "2026-01-01" });
});

test("getLearnerHistory: limit clamped to 1..20", async (t) => {
  fakeFor(t, {
    "edu.learner_exam_prep_runs": Array.from({ length: 30 }, (_, i) => ({ learner_id: L, subject: "Basic Science", topic: `t${i}`, status: "passed", updated_at: String(i).padStart(3, "0") })),
  });
  assert.equal((await getLearnerHistory({ learnerId: L, subject: "Basic Science" })).runs.length, 10);
  assert.equal((await getLearnerHistory({ learnerId: L, subject: "Basic Science", limit: 999 })).runs.length, 20);
  assert.equal((await getLearnerHistory({ learnerId: L, subject: "Basic Science", limit: -1 })).runs.length, 1);
});

// ── learner.get_relevant_memory ────────────────────────────────────────────

test("getRelevantMemory: this learner's evidence, newest first, bounded and shaped", async (t) => {
  fakeFor(t, {
    "edu.concept_catalog": [{ id: "c1", subject: "Basic Science" }, { id: "c2", subject: "Basic Science" }],
    "edu.learner_concept_evidence": [
      { learner_id: L, observation_kind: "assessment_result", response_quality: 0.123456, evidence_summary: "Older\r\nsummary", observed_at: "2026-01-01", concept_id: "c1" },
      { learner_id: L, observation_kind: "partial_understanding", response_quality: null, evidence_summary: "y".repeat(500), observed_at: "2026-02-01", concept_id: "c2" },
      { learner_id: "other", observation_kind: "assessment_result", response_quality: 1, evidence_summary: "theirs", observed_at: "2026-03-01", concept_id: "c1" },
    ],
  });
  const { memories } = await getRelevantMemory({ learnerId: L, subject: "Basic Science" });
  assert.deepEqual(memories, [
    { kind: "partial_understanding", quality: 0, summary: "y".repeat(240), at: "2026-02-01" },
    { kind: "assessment_result", quality: 0.1235, summary: "Older summary", at: "2026-01-01" },
  ]);
  assert.equal((await getRelevantMemory({ learnerId: L, limit: 1 })).memories.length, 1);
});

test("getRelevantMemory only returns memories for the requested subject", async (t) => {
  fakeFor(t, {
    "edu.concept_catalog": [{ id: "c-bs", subject: "Basic Science" }, { id: "c-m", subject: "Mathematics" }],
    "edu.learner_concept_evidence": [
      { learner_id: L, observation_kind: "assessment_result", response_quality: 1, evidence_summary: "science", observed_at: "2026-01-01", concept_id: "c-bs" },
      { learner_id: L, observation_kind: "assessment_result", response_quality: 1, evidence_summary: "maths", observed_at: "2026-02-01", concept_id: "c-m" },
    ],
  });
  const { memories } = await getRelevantMemory({ learnerId: L, subject: "Basic Science" });
  assert.deepEqual(memories.map((m) => m.summary), ["science"]);
});

// ── concept.get_prerequisites / syllabus.resolve ───────────────────────────

test("getPrerequisites wraps prerequisiteEdges as { edges }", async (t) => {
  fakeFor(t, {
    "edu.concept_edges": [{ from_concept_id: "a", to_concept_id: "b", relation: "prerequisite_for", status: "approved" }],
    "edu.concept_catalog": [
      { id: "a", title: "Matter", subject: "Basic Science", topic_key: null, status: "approved" },
      { id: "b", title: "Heat", subject: "Basic Science", topic_key: null, status: "approved" },
    ],
  });
  assert.deepEqual(await getPrerequisites({ subject: "Basic Science" }), {
    edges: [{ before: "matter", after: "heat", beforeLabel: "Matter", afterLabel: "Heat" }],
  });
  assert.deepEqual(await getPrerequisites({ subject: "Physics" }), { edges: [] });
});

test("resolveSyllabusTool: found:true with id/label topics when a syllabus exists", async (t) => {
  fakeFor(t, {
    "edu.syllabus_subjects": [{ id: "s1", name: "Basic Science JSS1", exam: "WASSCE", created_at: "1" }],
    "edu.syllabus_topics": [{ id: "t1", subject_id: "s1", title: "States of Matter", sort_order: 1 }],
  });
  assert.deepEqual(await resolveSyllabusTool({ subject: "Basic Science", classLevel: "JSS1", exam: "WAEC" }), {
    subject: "Basic Science", classLevel: "JSS1", found: true, topics: [{ id: "states-of-matter", label: "States of Matter" }],
  });
});

test("resolveSyllabusTool: found:false with an empty list and a next step when nothing exists", async (t) => {
  fakeFor(t);
  const out = await resolveSyllabusTool({ subject: "Basic Science", classLevel: "JSS1", exam: "WAEC" });
  assert.equal(out.found, false);
  assert.deepEqual(out.topics, []);
  assert.equal(out.subject, "Basic Science");
  assert.equal(out.classLevel, "JSS1");
  assert.match(out.next, /syllabus\.generate/);
});

// ── session.get_state ──────────────────────────────────────────────────────

test("makeSessionStateReader projects the harness view (session, topics, recent events) and asks for 20 events", async () => {
  const calls = [];
  const harness = {
    async getSessionView(args) {
      calls.push(args);
      return {
        session: { id: "s1", status: "topic_active", goal: "Pass", subject: "Basic Science", pausedReason: null, toolCallsUsed: 3, plan: ["secret"], estimate: { totalCoins: 9 } },
        topics: [{ id: "t1", label: "Matter", syllabusTopicId: "matter", position: 1, status: "active", attemptsUsed: 1, learnerConfirmedReady: false, examPrepRunId: "run-1" }],
        events: [
          { sequence: 0, event_type: "observation", facts: { secret: true } },
          { sequence: 1, event_type: "agent_action", action: "propose_plan", narrative: "Planning" },
        ],
      };
    },
  };
  const read = makeSessionStateReader(harness);
  const out = await read({ learnerId: L, sessionId: "s1" });
  assert.deepEqual(calls, [{ sessionId: "s1", learnerId: L, eventLimit: 20 }]);
  assert.deepEqual(out, {
    session: { id: "s1", status: "topic_active", goal: "Pass", subject: "Basic Science", pausedReason: null, toolCallsUsed: 3 },
    topics: [{ id: "t1", label: "Matter", syllabusTopicId: "matter", position: 1, status: "active", attemptsUsed: 1, learnerConfirmedReady: false }],
    recentEvents: [
      { sequence: 0, eventType: "observation", action: null, narrative: null },
      { sequence: 1, eventType: "agent_action", action: "propose_plan", narrative: "Planning" },
    ],
  });
});

test("makeSessionStateReader propagates a harness rejection", async () => {
  const read = makeSessionStateReader({ getSessionView: async () => { throw Object.assign(new Error("not found"), { code: "session_not_found" }); } });
  await assert.rejects(read({ learnerId: L, sessionId: "nope" }), { code: "session_not_found" });
});
