import assert from "node:assert/strict";
import test from "node:test";

import { newToolRequestId, toolObservation } from "./toolObservation.js";

test("newToolRequestId is a short req_ hex id", () => {
  const id = newToolRequestId();
  assert.match(id, /^req_[0-9a-f]{8}$/);
  assert.notEqual(id, newToolRequestId());
});

test("a successful write observation carries the backend's data", () => {
  const observation = toolObservation({
    action: "create_task",
    requestId: "req_8f72a1",
    result: {
      created: true, taskId: "todo_123", title: "Learn Python",
      priority: "normal", dueAt: "2026-09-09T08:00:00Z",
    },
  });
  assert.deepEqual(observation, {
    success: true,
    request_id: "req_8f72a1",
    action: "create_task",
    result: {
      created: true, taskId: "todo_123", title: "Learn Python",
      priority: "normal", dueAt: "2026-09-09T08:00:00Z",
    },
    error: null,
  });
});

test("an explicit success flag is hoisted out of result", () => {
  const observation = toolObservation({
    action: "create_task",
    result: { success: true, taskId: "t1" },
  });
  assert.equal(observation.success, true);
  assert.deepEqual(observation.result, { taskId: "t1" });
});

test("a failed tool is success:false with the error on the envelope", () => {
  const observation = toolObservation({
    action: "create_task",
    result: { error: "Could not create the task" },
  });
  assert.equal(observation.success, false);
  assert.equal(observation.error, "Could not create the task");
  assert.deepEqual(observation.result, {});
});

test("explicit success:false wins over a missing error string", () => {
  const observation = toolObservation({
    action: "submit_tool_request",
    result: { success: false, submitted: false },
  });
  assert.equal(observation.success, false);
  assert.equal(observation.error, null);
  assert.deepEqual(observation.result, { submitted: false });
});

test("an explicit error beats an optimistic success flag", () => {
  const observation = toolObservation({
    action: "list_tasks",
    result: { success: true, error: "connection reset", tasks: [] },
  });
  assert.equal(observation.success, false);
  assert.equal(observation.error, "connection reset");
  assert.deepEqual(observation.result, { tasks: [] });
});

test("plain read results pass through untouched", () => {
  const result = { courses: [{ title: "Physics" }], total_xp: 40, rank: 3 };
  const observation = toolObservation({ action: "check_progress", result });
  assert.equal(observation.success, true);
  assert.deepEqual(observation.result, result);
});

test("array and scalar results keep a stable shape", () => {
  const arr = toolObservation({ action: "list_tasks", result: [1, 2] });
  assert.deepEqual(arr.result, [1, 2]);

  const str = toolObservation({ action: "legacy_tool", result: "ok" });
  assert.deepEqual(str.result, { value: "ok" });

  const none = toolObservation({ action: "legacy_tool" });
  assert.equal(none.result, null);
});

test("long errors are bounded before entering the model context", () => {
  const observation = toolObservation({
    action: "create_task",
    result: { error: "x".repeat(900) },
  });
  assert.equal(observation.error.length, 500);
});

test("extra replay flags merge at the envelope level", () => {
  const observation = toolObservation({
    action: "create_task",
    requestId: "req_abcd1234",
    result: { taskId: "t9" },
    extra: { alreadyDone: true, note: "create_task already ran for this task" },
  });
  assert.equal(observation.alreadyDone, true);
  assert.equal(observation.note, "create_task already ran for this task");
  assert.equal(observation.success, true);
});

test("request_id and action are bounded strings", () => {
  const observation = toolObservation({
    action: "x".repeat(200),
    requestId: "y".repeat(200),
    result: {},
  });
  assert.equal(observation.action.length, 80);
  assert.equal(observation.request_id.length, 40);
});
