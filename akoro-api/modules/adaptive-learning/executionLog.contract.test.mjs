import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stepRow, classifyError } from "./executionLogCore.js";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..", "..");
const read = (p) => readFileSync(join(apiRoot, p), "utf8");

test("Phase 22: the tool loop opens a run, records a step per call, closes the run", () => {
  const chat = read("modules/adaptive-learning/chat.js");
  assert.match(chat, /const runId = await startRun\(/, "opens a run");
  assert.match(chat, /await recordStep\(runId, stepRow\(/, "records a step per tool call");
  assert.match(chat, /await finishRun\(runId, \{ status: "ok" \}\)/, "closes the run");
  assert.match(chat, /durationMs: Date\.now\(\) - callStarted/, "measures duration");
});

test("Phase 22: the server starts execution-log maintenance (sweep + digest)", () => {
  const app = read("app.js");
  assert.match(app, /startExecutionLogMaintenance\(\)/, "maintenance started at boot");
});

test("Phase 22: the migration defines the trace + digest tables, service-role only", () => {
  const sql = read("migrations/2026-agent-execution-log.sql");
  for (const table of ["agent_runs", "agent_run_steps", "agent_failure_digests"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS edu\\.${table}`), `${table} table`);
  }
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/, "RLS on");
  assert.match(sql, /REVOKE ALL ON edu\.agent_runs FROM anon, authenticated/, "no learner reads");
});

test("Phase 22: crash recovery posts one interrupt notice for a stale run", () => {
  const src = read("modules/adaptive-learning/executionLog.js");
  assert.match(src, /export async function recoverInterruptedRuns/);
  assert.match(src, /postIntoChat\(/, "posts into the chat");
  assert.match(src, /agent_interrupted/, "notice kind");
  assert.match(src, /recoverInterruptedRuns\(\)/, "maintenance calls it");
});

test("Phase 22: a failed step stores a real error class and message, never raw args", () => {
  const row = stepRow({
    runId: "r", iteration: 4, tool: "schedule_chat_follow_up",
    input: { message: "hi", password: "secret", chatId: "abc" },
    success: false, result: { error: 'relation "scheduled_chat_follow_ups" does not exist' },
    durationMs: 88, retries: 1, requestId: "req",
  });
  assert.equal(row.status, "failed");
  assert.equal(row.error_class, "database");
  assert.match(row.error_message, /does not exist/);
  assert.equal(row.input_redacted.password, "[redacted]");
  assert.equal(row.input_redacted.message, "hi");
  assert.equal(row.duration_ms, 88);
  assert.equal(row.retries, 1);
  assert.equal(classifyError({ error: "503 unavailable" }), "unavailable");
});

test("Phase 22 #1: user message persisted at turn start; a crashed turn re-runs once, safely", () => {
  const chat = read("modules/adaptive-learning/chat.js");
  assert.match(chat, /persistLearnerAgentUserTurnMessage\(/, "persists the user message at turn start");
  assert.match(chat, /startRun\(\{ sessionId: conversationId, userId: studentId, model, turnId \}\)/, "run carries the turn id");
  assert.match(chat, /sideEffecting: changes/, "steps mark side-effecting calls");
  const log = read("modules/adaptive-learning/executionLog.js");
  assert.match(log, /canAutoRetry\(\{ run, steps \}\)/, "guarded by the pure check");
  assert.match(log, /reRunCrashedTurn\(/, "re-runs the same turn");
  assert.match(log, /auto_retried_at/, "once-only");
});
