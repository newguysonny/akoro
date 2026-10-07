import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Index audit contract — 2026-hot-path-indexes.sql exists because the
 * audit found verified gaps: FK columns Postgres never auto-indexes,
 * filtered/sorted columns without coverage, on tables the API really
 * queries. The test pins the method (predicate-verified, not blanket),
 * the completeness of the list, and the one deliberate drop.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [migration, manifest] = await Promise.all([
  read("2026-hot-path-indexes.sql"),
  read("manifest.json"),
]);

test("registered in the schema group", () => {
  assert.ok(JSON.parse(manifest).schema.includes("2026-hot-path-indexes.sql"));
});

test("every index is idempotent", () => {
  const creates = migration.match(/CREATE INDEX [^;]+;/g) ?? [];
  assert.ok(creates.length >= 16, "the audited gap list");
  assert.ok(creates.every((c) => c.includes("IF NOT EXISTS")), "re-runnable");
  assert.ok(/DROP INDEX IF EXISTS/.test(migration), "the drop is idempotent too");
});

test("the verified hot paths are covered", () => {
  // Each line names a table+column the codebase really filters on.
  for (const want of [
    "public.chat_messages(user_id)",            // agent chat history
    "public.chat_messages(agent_session_id)",   // turns by agent session
    "edu.adaptive_sessions(student_id, updated_at DESC)", // sessions, newest first
    "class_messages(agent_id)",                 // class chat threads
    "battle_viewers(user_id)",                  // spectator feed
    "edu.training_sessions(teacher_id, created_at DESC)",
    "edu.training_chunks(session_id)",
    "edu.stream_tokens(session_id)",
    "edu.stream_tokens(expires_at)",            // cleanup job scan
    "notification_queue(user_id)",
    "notification_queue(session_id)",
    "xp_ledger(agent_id)",
    "edu.agent_knowledge(student_id)",          // decay engine
    "edu.learner_agent_conversation_turns(agent_session_id)",
    "edu.self_study_assignments(classroom_id)",
    "edu.adaptive_workflow_runs(exam_prep_run_id)",
    "edu.pharmd_courses(programme_id)",         // GET /api/pharmd/programme
    "edu.pharmd_topic_progress(topic_id)",      // cascade side
  ]) {
    assert.ok(migration.includes(want), `missing: ${want}`);
  }
});

test("the redundant Pharm.D index is dropped, not duplicated", () => {
  assert.ok(migration.includes("DROP INDEX IF EXISTS edu.idx_pharmd_progress_user"),
    "PK (user_id, topic_id) already serves user_id lookups");
  assert.ok(!/CREATE INDEX [^;]*idx_pharmd_progress_user/.test(migration),
    "it must not be re-created anywhere");
});

test("the audit is honest about what it deliberately skips", () => {
  assert.ok(migration.includes("cold school-management suite"),
    "documents the ~250 unindexed cold FK columns as a decision, not an oversight");
});
