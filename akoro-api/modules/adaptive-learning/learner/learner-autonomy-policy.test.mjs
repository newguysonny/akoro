import assert from "node:assert/strict";
import test from "node:test";

import { buildAutonomyTaskMessage } from "./learner-autonomy-policy.js";

test("due-task nudge names the task and asks the learner for the next step", () => {
  const message = buildAutonomyTaskMessage({
    title: "Revise quadratic equations",
    description: "Finish questions 1 to 10 before the test.",
    priority: "high",
  });
  assert.match(message, /high-priority task is due/i);
  assert.match(message, /Revise quadratic equations/);
  assert.match(message, /Finish questions 1 to 10 before the test/);
  assert.match(message, /What would you like to tackle first\?/);
});

test("due-task nudge has safe fallbacks and does not interpolate unbounded text", () => {
  const message = buildAutonomyTaskMessage({ title: "x".repeat(500), priority: "urgent" });
  assert.match(message, /planned-priority task is due/i);
  assert.ok(message.length < 400, "the persisted proactive message is bounded");
});
