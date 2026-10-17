// Seam tests for teaching-session/lifecycle.js against the in-memory db fake.
// Covers the edu.adaptive_sessions row lifecycle (create / ensure / read /
// append / complete) and the exactly-once ranking XP award on completion.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
// ranking/routes.js (imported lazily by completeSessionRecord) registers a
// 15-minute cron on import unless the jobs gate says no — keep the loop free.
process.env.AKORO_BACKGROUND_JOBS_ENABLED = "false";

// ranking/routes.js → auth/routes.js builds a passport GoogleStrategy at import
// (throws without a client id, which completeSessionRecord would swallow as
// "ranking module unavailable") and starts an un-unref'd 60s DenyList sweep
// (auth/routes.js:424) that would keep this test process alive. Pre-load it
// here with intervals unref'd so the lazy import inside completeSessionRecord
// hits the module cache.
process.env.GOOGLE_CLIENT_ID ||= "test";
process.env.GOOGLE_CLIENT_SECRET ||= "test";
{
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => { const t = realSetInterval(...args); t?.unref?.(); return t; };
  const restoreLog = (() => { const l = console.log; console.log = () => {}; return () => { console.log = l; }; })();
  try { await import("../../ranking/routes.js"); } finally { globalThis.setInterval = realSetInterval; restoreLog(); }
}

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const {
  isMissingColumn, createSessionRecord, ensureSessionRecord,
  readSessionBlocks, appendSessionBlocks, completeSessionRecord,
} = await import("./lifecycle.js");
const { carryForward } = await import("./context.js");
const { createTeachingEvidenceState } = await import("../teaching-evidence.js");

const T = "edu.adaptive_sessions";
const quiet = () => {
  const saved = { warn: console.warn, error: console.error, log: console.log };
  console.warn = () => {}; console.error = () => {}; console.log = () => {};
  return () => Object.assign(console, saved);
};
// awardXP is fired without await (`.catch(() => {})`); let it settle.
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

const orch = (extra = {}) => ({
  studentAgentRecord: { id: "agent-1" },
  session: { mustKnowParts: ["light", "chlorophyll"] },
  ...extra,
});

test("isMissingColumn matches PostgREST/PG missing-column errors only", () => {
  assert.equal(isMissingColumn({ code: "42703", message: "x" }, "teaching_evidence"), true);
  assert.equal(isMissingColumn({ code: "PGRST204", message: "x" }, "teaching_evidence"), true);
  assert.equal(isMissingColumn({ message: 'column "teaching_evidence" of relation "adaptive_sessions" does not exist' }, "teaching_evidence"), true);
  assert.equal(isMissingColumn({ message: "Could not find the 'teaching_evidence' column of 'adaptive_sessions' in the schema cache" }, "teaching_evidence"), true);
  assert.equal(isMissingColumn({ message: "insert or update violates foreign key constraint" }, "teaching_evidence"), false);
  assert.equal(isMissingColumn({ message: 'column "other" does not exist' }, "teaching_evidence"), false);
  assert.equal(isMissingColumn(null, "teaching_evidence"), false);
});

test("createSessionRecord: fresh / continuation / decay rows share one shape; opening blocks carry the prior transcript", async () => {
  const fake = installFakeDb(db, {});
  const opening = [{ type: "agent", text: "Hi, teach me!" }];
  const prior = [{ type: "system-divider", label: "x" }, { type: "user", text: "old" }, { type: "agent", text: "older reply" }];

  const modes = {
    fresh: carryForward([], opening),
    continuation: carryForward(prior, opening),
    decay: carryForward(prior.slice(1, 2), opening),
  };
  const ids = {};
  for (const [mode, openingBlocks] of Object.entries(modes)) {
    const o = orch();
    ids[mode] = await createSessionRecord(o, { studentId: "learner-1", topic: `Photosynthesis ${mode}`, subject: "Biology", openingBlocks });
    assert.ok(ids[mode], `${mode} row created`);
    assert.equal(o.dbSessionId, ids[mode]);
    assert.deepEqual(o.sessionMeta, { studentId: "learner-1", topic: `Photosynthesis ${mode}`, subject: "Biology" });
  }

  const rows = fake.rows(T);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.student_id, "learner-1");
    assert.equal(row.student_agent_id, "agent-1");
    assert.equal(row.subject, "Biology");
    assert.deepEqual(row.subtopics, ["light", "chlorophyll"]);
    assert.deepEqual(row.objectives, {});
    assert.equal(row.current_subtopic_idx, 0);
    assert.equal(row.current_phase, "1");
    assert.equal(row.status, "active");
    assert.ok(Array.isArray(row.session_history) && row.session_history.length === 0);
    assert.ok(Array.isArray(row.block_history), "block_history is a real JSON array, not a string");
    assert.equal(typeof row.teaching_evidence, "object");
    assert.ok(row.started_at && row.updated_at);
  }
  const byTopic = Object.fromEntries(rows.map((r) => [r.topic.split(" ")[1], r]));
  assert.deepEqual(byTopic.fresh.block_history, opening);
  // Continuation: dividers dropped, prior blocks faded, opening blocks last.
  assert.deepEqual(byTopic.continuation.block_history, [
    { type: "user", text: "old", faded: true }, { type: "agent", text: "older reply", faded: true }, ...opening,
  ]);
  assert.deepEqual(byTopic.decay.block_history, [{ type: "user", text: "old", faded: true }, ...opening]);
  fake.restore();
});

test("createSessionRecord: defaults NOT NULL topic/subject, serialises evidence, and is a no-op once saved", async () => {
  const fake = installFakeDb(db, {});
  const o = { session: {}, teachingEvidence: createTeachingEvidenceState({ conceptCount: 2 }) };
  const id = await createSessionRecord(o, { studentId: "learner-1", openingBlocks: "not-an-array" });
  const [row] = fake.rows(T);
  assert.equal(row.topic, "Untitled session");
  assert.equal(row.subject, "General");
  assert.equal(row.student_agent_id, null);
  assert.deepEqual(row.subtopics, []);
  assert.deepEqual(row.block_history, []);
  assert.equal(row.teaching_evidence.concepts.length, 2);
  assert.equal(row.teaching_evidence.policyVersion, "teaching-evidence-v1");

  assert.equal(await createSessionRecord(o, { studentId: "learner-1" }), id);
  assert.equal(fake.rows(T).length, 1, "already-saved orchestrator never inserts twice");
  fake.restore();
});

test("createSessionRecord: missing teaching_evidence column retries the insert without it", async () => {
  const restoreConsole = quiet();
  const fake = installFakeDb(db, {});
  fake.failNext(T, "insert", { code: "42703", message: 'column "teaching_evidence" of relation "adaptive_sessions" does not exist' });
  const o = orch();
  const id = await createSessionRecord(o, { studentId: "learner-1", topic: "Cells", subject: "Biology", openingBlocks: [] });
  restoreConsole();
  assert.ok(id);
  const rows = fake.rows(T);
  assert.equal(rows.length, 1);
  assert.equal(Object.hasOwn(rows[0], "teaching_evidence"), false, "legacy row omits the pending column");
  assert.equal(rows[0].student_agent_id, "agent-1");
  assert.equal(fake.calls.filter((c) => c.table === T && c.op === "insert").length, 2);
  fake.restore();
});

test("createSessionRecord: a failing student_agent_id FK retries with null; a hard failure returns null and records saveError", async () => {
  const restoreConsole = quiet();
  const fake = installFakeDb(db, {});
  fake.failNext(T, "insert", { code: "23503", message: "violates foreign key constraint adaptive_sessions_student_agent_id_fkey" });
  const o = orch();
  const id = await createSessionRecord(o, { studentId: "learner-1", topic: "Cells", subject: "Biology", openingBlocks: [] });
  assert.ok(id);
  assert.equal(fake.rows(T)[0].student_agent_id, null);
  assert.ok(fake.rows(T)[0].teaching_evidence, "evidence kept when only the FK failed");

  // No student_agent_id to drop → the error propagates to the catch.
  fake.failNext(T, "insert", { code: "23502", message: "null value in column student_id" });
  const bare = { session: {} };
  assert.equal(await createSessionRecord(bare, { studentId: null, topic: "x", subject: "y" }), null);
  restoreConsole();
  assert.deepEqual(bare.saveError, { message: "null value in column student_id", code: "23502" });
  assert.equal(bare.dbSessionId, undefined);
  fake.restore();
});

test("ensureSessionRecord: returns existing id, null without sessionMeta, else creates from sessionMeta", async () => {
  const fake = installFakeDb(db, {});
  assert.equal(await ensureSessionRecord({ dbSessionId: "row-9" }), "row-9");
  assert.equal(await ensureSessionRecord({ session: {} }), null);
  assert.equal(await ensureSessionRecord(null), null);
  assert.equal(await ensureSessionRecord({ sessionMeta: { topic: "x" } }), null, "studentId is required");
  assert.equal(fake.rows(T).length, 0);

  const o = orch({ sessionMeta: { studentId: "learner-1", topic: "Cells", subject: "Biology" } });
  const id = await ensureSessionRecord(o);
  assert.ok(id);
  assert.equal(fake.rows(T)[0].topic, "Cells");
  assert.deepEqual(fake.rows(T)[0].block_history, []);
  fake.restore();
});

test("readSessionBlocks: [] without a row id, filters non-object blocks, [] on read error", async () => {
  const restoreConsole = quiet();
  const fake = installFakeDb(db, { [T]: [{ id: "row-1", block_history: [{ type: "user", text: "a" }, null, "junk", { type: "agent", text: "b" }] }] });
  assert.deepEqual(await readSessionBlocks({}), []);
  assert.deepEqual(await readSessionBlocks({ dbSessionId: "row-1" }), [{ type: "user", text: "a" }, { type: "agent", text: "b" }]);
  assert.deepEqual(await readSessionBlocks({ dbSessionId: "missing" }), []);
  fake.failNext(T, "select", { message: "boom" });
  assert.deepEqual(await readSessionBlocks({ dbSessionId: "row-1" }), []);
  restoreConsole();
  fake.restore();
});

test("appendSessionBlocks: appends in order and refreshes position / subtopics / evidence", async () => {
  const fake = installFakeDb(db, { [T]: [{ id: "row-1", block_history: [{ type: "agent", text: "hello" }], current_phase: "1", current_subtopic_idx: 0, subtopics: [] }] });
  const o = { dbSessionId: "row-1", session: { phase: "PHASE_3", mustKnowIndex: 1, mustKnowParts: ["a", "b"] }, teachingEvidence: createTeachingEvidenceState({ conceptCount: 2 }) };
  await appendSessionBlocks(o, [{ type: "user", text: "t1" }, { type: "agent", text: "r1" }]);
  await appendSessionBlocks(o, [{ type: "user", text: "t2" }]);
  const [row] = fake.rows(T);
  assert.deepEqual(row.block_history.map((b) => b.text), ["hello", "t1", "r1", "t2"]);
  assert.equal(row.current_phase, "3");
  assert.equal(row.current_subtopic_idx, 1);
  assert.deepEqual(row.subtopics, ["a", "b"]);
  assert.equal(row.teaching_evidence.concepts.length, 2);

  // Empty append is a no-op (no reads, no writes).
  const before = fake.calls.length;
  await appendSessionBlocks(o, []);
  assert.equal(fake.calls.length, before);
  fake.restore();
});

test("appendSessionBlocks: block_history is NOT bounded within one session (current behaviour)", async () => {
  // Documented, not asserted as a bug: carryForward caps what a *new* row
  // inherits (CARRY_BLOCK_CAP), but a single live session's row grows by every
  // turn with no cap (lifecycle.js:142).
  const fake = installFakeDb(db, { [T]: [{ id: "row-1", block_history: [] }] });
  const o = { dbSessionId: "row-1", session: {} };
  for (let i = 0; i < 30; i++) await appendSessionBlocks(o, Array.from({ length: 5 }, (_, j) => ({ type: "user", text: `${i}.${j}` })));
  assert.equal(fake.rows(T)[0].block_history.length, 150);
  assert.equal(fake.rows(T)[0].current_phase, "1", "phase defaults to 1 when the session has none");
  fake.restore();
});

test("appendSessionBlocks: creates the row via sessionMeta when none exists yet; retries update without teaching_evidence", async () => {
  const restoreConsole = quiet();
  const fake = installFakeDb(db, {});
  const o = orch({ sessionMeta: { studentId: "learner-1", topic: "Cells", subject: "Biology" } });
  await appendSessionBlocks(o, [{ type: "user", text: "first" }]);
  assert.ok(o.dbSessionId);
  assert.deepEqual(fake.rows(T)[0].block_history, [{ type: "user", text: "first" }]);

  fake.failNext(T, "update", { code: "PGRST204", message: "Could not find the 'teaching_evidence' column" });
  await appendSessionBlocks(o, [{ type: "agent", text: "second" }]);
  restoreConsole();
  assert.deepEqual(fake.rows(T)[0].block_history.map((b) => b.text), ["first", "second"]);
  fake.restore();

  // Without an id or sessionMeta nothing is written.
  const fake2 = installFakeDb(db, {});
  await appendSessionBlocks({ session: {} }, [{ type: "user", text: "lost" }]);
  assert.equal(fake2.calls.length, 0);
  fake2.restore();
});

test("completeSessionRecord: sets completion fields and awards ranking XP once; a second call awards nothing", async () => {
  const fake = installFakeDb(db, {
    [T]: [{ id: "row-1", student_id: "learner-1", subject: "Biology", status: "active", completed_at: null }],
  }, { rpc: { increment_agent_xp: () => ({ data: null }) } });
  const o = { dbSessionId: "row-1", teachingEvidence: createTeachingEvidenceState({ conceptCount: 1 }) };

  await completeSessionRecord(o);
  await settle();
  const [row] = fake.rows(T);
  assert.equal(row.status, "complete");
  assert.ok(row.completed_at);
  assert.ok(row.updated_at);
  assert.equal(row.teaching_evidence.concepts.length, 1);

  const xp = fake.rows("xp_transactions");
  assert.equal(xp.length, 1);
  assert.equal(xp[0].user_id, "learner-1");
  assert.equal(xp[0].reason, "teaching_session");
  assert.equal(xp[0].amount, 15); // XP.SESSION_ATTEND
  assert.equal(xp[0].subject, "Biology");
  assert.deepEqual(fake.rpcCalls.map((c) => c.name), ["increment_agent_xp"]);
  assert.deepEqual(fake.rpcCalls[0].args, { user_id_input: "learner-1", xp_amount: 15 });

  // Second completion (e.g. end_session re-sent): row re-stamped, no extra XP.
  await completeSessionRecord(o);
  await settle();
  assert.equal(fake.rows("xp_transactions").length, 1);
  assert.equal(fake.rpcCalls.length, 1);
  fake.restore();
});

test("completeSessionRecord: no id → no-op; missing row or row without student → no XP; teaching_evidence fallback", async () => {
  const restoreConsole = quiet();
  const fake = installFakeDb(db, {
    [T]: [{ id: "row-anon", student_id: null, status: "active" }, { id: "row-2", student_id: "learner-2", status: "active" }],
  }, { rpc: { increment_agent_xp: () => ({ data: null }) } });
  await completeSessionRecord({});
  assert.equal(fake.calls.length, 0);

  await completeSessionRecord({ dbSessionId: "nope" });
  await completeSessionRecord({ dbSessionId: "row-anon" });
  await settle();
  assert.equal(fake.rows("xp_transactions").length, 0);
  assert.equal(fake.rows(T).find((r) => r.id === "row-anon").status, "complete");

  fake.failNext(T, "update", { code: "42703", message: 'column "teaching_evidence" does not exist' });
  await completeSessionRecord({ dbSessionId: "row-2" });
  await settle();
  restoreConsole();
  const row2 = fake.rows(T).find((r) => r.id === "row-2");
  assert.equal(row2.status, "complete");
  assert.equal(Object.hasOwn(row2, "teaching_evidence"), false);
  assert.equal(fake.rows("xp_transactions").length, 1, "XP still awarded after the legacy-column retry");
  fake.restore();
});

test("completeSessionRecord: two concurrent completions of one session award XP exactly once",
  async () => {
    const fake = installFakeDb(db, {
      [T]: [{ id: "row-1", student_id: "learner-1", subject: "Biology", status: "active" }],
    }, { rpc: { increment_agent_xp: () => ({ data: null }) } });
    const o = { dbSessionId: "row-1" };
    await Promise.all([completeSessionRecord(o), completeSessionRecord(o)]);
    await settle();
    const awarded = fake.rows("xp_transactions").length;
    fake.restore();
    assert.equal(awarded, 1);
  });
