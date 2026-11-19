import test from "node:test";
import assert from "node:assert/strict";
import { redactInput, redactValue, classifyError, errorMessage, stepRow, canAutoRetry } from "./executionLogCore.js";

test("redactInput scrubs secrets and caps long values", () => {
  const out = redactInput({
    subject: "Biology",
    password: "hunter2",
    API_KEY: "sk-live-123",
    nested: { access_token: "abc", ok: true },
    long: "x".repeat(1000),
    many: Array.from({ length: 40 }, (_, i) => i),
  });
  assert.equal(out.subject, "Biology");
  assert.equal(out.password, "[redacted]");
  assert.equal(out.API_KEY, "[redacted]");
  assert.equal(out.nested.access_token, "[redacted]");
  assert.equal(out.nested.ok, true);
  assert.ok(out.long.length <= 240, "long string capped");
  assert.ok(out.many.length <= 24, "array capped");
});

test("redactInput never returns an array/primitive as the stored input", () => {
  assert.deepEqual(redactInput("just a string"), {});
  assert.deepEqual(redactInput([1, 2, 3]), {});
  assert.deepEqual(redactInput(null), {});
});

test("redactValue caps depth rather than recursing forever", () => {
  const deep = { a: { b: { c: { d: 1 } } } };
  const out = redactValue(deep);
  assert.equal(out.a.b, "[…]");
});

test("classifyError buckets the common failure kinds", () => {
  assert.equal(classifyError({ error: "The request timed out" }), "timeout");
  assert.equal(classifyError({ error: "429 too many requests" }), "rate_limit");
  assert.equal(classifyError({ error: "The service is unavailable (503)" }), "unavailable");
  assert.equal(classifyError({ error: "403 permission revoked" }), "auth");
  assert.equal(classifyError({ error: "subject is required" }), "validation");
  assert.equal(classifyError({ error: "folder not found" }), "not_found");
  assert.equal(classifyError({ error: 'relation "study_prep_sessions" does not exist' }), "database");
  assert.equal(classifyError({ error: "something odd" }), "error");
  assert.equal(classifyError({}), "unknown");
});

test("errorMessage picks a message and caps it", () => {
  assert.equal(errorMessage({ error: "  boom   now " }), "boom now");
  assert.equal(errorMessage({}), null);
  assert.ok(errorMessage({ error: "y".repeat(900) }).length <= 500);
});

test("stepRow marks ok vs failed and only records error fields on failure", () => {
  const ok = stepRow({ runId: "r1", iteration: 2, tool: "list_tasks", input: { token: "x", n: 1 }, success: true, durationMs: 12.4, requestId: "req1" });
  assert.equal(ok.status, "ok");
  assert.equal(ok.error_class, null);
  assert.equal(ok.error_message, null);
  assert.equal(ok.input_redacted.token, "[redacted]");
  assert.equal(ok.duration_ms, 12);
  assert.equal(ok.request_id, "req1");

  const bad = stepRow({ runId: "r1", iteration: 3, tool: "schedule_chat_follow_up", input: {}, success: false, result: { error: "503 unavailable" }, retries: 1 });
  assert.equal(bad.status, "failed");
  assert.equal(bad.error_class, "unavailable");
  assert.match(bad.error_message, /503 unavailable/);
  assert.equal(bad.retries, 1);
});

test("stepRow records side_effecting; canAutoRetry is guarded and once-only", () => {
  const write = stepRow({ runId: "r", tool: "create_task", input: {}, success: true, sideEffecting: true });
  const read = stepRow({ runId: "r", tool: "list_tasks", input: {}, success: true });
  assert.equal(write.side_effecting, true);
  assert.equal(read.side_effecting, false);

  assert.equal(canAutoRetry({ run: { session_id: "s", turn_id: "t", auto_retried_at: null }, steps: [read] }), true);
  assert.equal(canAutoRetry({ run: { session_id: "s", turn_id: "t", auto_retried_at: "2026-01-01" }, steps: [read] }), false, "already retried");
  assert.equal(canAutoRetry({ run: { session_id: "s", turn_id: "t" }, steps: [write] }), false, "a change already landed");
  assert.equal(canAutoRetry({ run: { session_id: "s" }, steps: [read] }), false, "no turn id");
  assert.equal(canAutoRetry({ run: null, steps: [] }), false);
});
