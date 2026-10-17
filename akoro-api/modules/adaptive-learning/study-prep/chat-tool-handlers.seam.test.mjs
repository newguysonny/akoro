// Seam tests for the study-prep chat read tool over the in-memory fake db
// (the real store + harness run against the fake).
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const { getStudyPrepSessionSummary } = await import("./chat-tool-handlers.js");

const L = "learner-1";
const S = "edu.study_prep_sessions";

function fakeFor(t, seed = {}, options = {}) {
  const fake = installFakeDb(db, seed, options);
  t.after(() => fake.restore());
  return fake;
}

const session = (id, status, updated_at, extra = {}) => ({
  id, learner_id: L, status, updated_at, goal: `Goal ${id}`, subject: "Basic Science", class_level: "JSS1",
  exam_board: "WAEC", plan: null, estimate: null, paused_reason: null, ...extra,
});

test("no active session → enabled, empty list, and an offer message", async (t) => {
  fakeFor(t, { [S]: [session("ended", "completed", "2026-01-01")] });
  const out = await getStudyPrepSessionSummary(L);
  assert.equal(out.enabled, true);
  assert.deepEqual(out.sessions, []);
  assert.match(out.message, /No study-prep session yet/);
});

test("summarises the active session: status, plan, topics, estimate and the last two narratives (sanitised, ≤240)", async (t) => {
  fakeFor(t, {
    [S]: [session("s1", "paused", "2026-02-01", { paused_reason: "insufficient_balance", plan: [{ syllabusTopicId: "matter" }], estimate: { totalCoins: 12 } })],
    "edu.study_prep_topics": [
      { id: "t2", session_id: "s1", position: 2, label: "Energy", status: "queued", attempts_used: 0 },
      { id: "t1", session_id: "s1", position: 1, label: "Matter", status: "active", attempts_used: 1, exam_prep_run_id: "run" },
    ],
    "edu.study_prep_events": [
      { session_id: "s1", sequence: 0, event_type: "observation", narrative: null },
      { session_id: "s1", sequence: 1, event_type: "harness_decision", narrative: "First" },
      { session_id: "s1", sequence: 2, event_type: "harness_decision", narrative: "Second\nline" },
      { session_id: "s1", sequence: 3, event_type: "harness_decision", narrative: "z".repeat(400) },
    ],
  });
  const out = await getStudyPrepSessionSummary(L);
  assert.deepEqual(Object.keys(out), ["enabled", "sessions"]);
  assert.equal(out.sessions.length, 1);
  assert.deepEqual(out.sessions[0], {
    sessionId: "s1", status: "paused", goal: "Goal s1", subject: "Basic Science", pausedReason: "insufficient_balance",
    plan: [{ syllabusTopicId: "matter" }],
    topics: [{ label: "Matter", status: "active" }, { label: "Energy", status: "queued" }],
    estimate: { totalCoins: 12 },
    recentNarrative: ["Second line", "z".repeat(240)],
  });
});

test("bounded: at most 3 active sessions, newest first; ended and other learners' sessions excluded", async (t) => {
  fakeFor(t, {
    [S]: [
      session("a", "planning", "2026-01-01"),
      session("b", "topic_active", "2026-04-01"),
      session("c", "awaiting_confirmation", "2026-03-01"),
      session("d", "paused", "2026-02-01"),
      session("done", "completed", "2026-09-01"),
      { ...session("theirs", "planning", "2026-10-01"), learner_id: "other" },
    ],
  });
  const out = await getStudyPrepSessionSummary(L);
  assert.deepEqual(out.sessions.map((s) => s.sessionId), ["b", "c", "d"]);
  assert.ok(out.sessions.every((s) => Array.isArray(s.topics) && Array.isArray(s.recentNarrative)));
});

test("a db error on the active-session lookup is thrown, not reported as 'no session'", async (t) => {
  const fake = fakeFor(t, { [S]: [] });
  fake.failNext(S, "select", { message: "db down" });
  await assert.rejects(getStudyPrepSessionSummary(L), { message: "db down" });
});

test("recentNarrative reflects the latest events once a session has more than 5", async (t) => {
  fakeFor(t, {
    [S]: [session("s1", "topic_active", "2026-02-01")],
    "edu.study_prep_events": Array.from({ length: 10 }, (_, i) => ({ session_id: "s1", sequence: i, event_type: "harness_decision", narrative: `n${i}` })),
  });
  const out = await getStudyPrepSessionSummary(L);
  assert.deepEqual(out.sessions[0].recentNarrative, ["n8", "n9"]);
});
