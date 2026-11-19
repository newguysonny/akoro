import assert from "node:assert/strict";
import test from "node:test";

import { validateLearnerTaskInput } from "./learner-task-validation.js";

test("the resolved action for 'Revise Maths tomorrow at 8 am' becomes a precise Lagos task", () => {
  const action = validateLearnerTaskInput({
    title: "Revise Maths",
    description: "Work through Algebra practice questions.",
    priority: "medium",
    due: "Tomorrow at 8 AM",
    dueAt: "2026-09-08T08:00:00+01:00",
    timezone: "Africa/Lagos",
    course: "Mathematics",
  });
  assert.deepEqual(action, {
    title: "Revise Maths",
    description: "Work through Algebra practice questions.",
    priority: "medium",
    due: "Tomorrow at 8 AM",
    dueAt: "2026-09-08T07:00:00.000Z",
    timezone: "Africa/Lagos",
    course: "Mathematics",
  });
});

test("different explicit task prompts preserve their own timezone and exact due instant", () => {
  const promptsAndActions = [
    ["Set a reminder to complete my WAEC essay at 6:30 pm in London", {
      title: "Complete WAEC essay", priority: "high", due: "6:30 PM today",
      dueAt: "2026-09-07T18:30:00+01:00", timezone: "Europe/London", course: "English",
    }, "2026-09-07T17:30:00.000Z"],
    ["Plan a Physics past-question task for 7:15 pm in New York", {
      title: "Practise Physics past questions", priority: "medium", due: "7:15 PM",
      dueAt: "2026-09-08T19:15:00-04:00", timezone: "America/New_York", course: "Physics",
    }, "2026-09-08T23:15:00.000Z"],
  ];
  for (const [prompt, input, dueAt] of promptsAndActions) {
    const action = validateLearnerTaskInput(input);
    assert.equal(action.dueAt, dueAt, prompt);
    assert.equal(action.timezone, input.timezone, prompt);
  }
});

test("a manually scheduled task without a precise time uses the learner account timezone", () => {
  const action = validateLearnerTaskInput({
    title: "Read Chapter 4", priority: "low", due: "Tomorrow",
  }, { defaultTimezone: "Europe/London" });
  assert.equal(action.dueAt, null);
  assert.equal(action.timezone, "Europe/London");
  assert.equal(action.due, "Tomorrow");
});

test("task actions fail closed for ambiguous due times and invalid timezones", () => {
  assert.throws(() => validateLearnerTaskInput({
    title: "Revise Maths", priority: "medium", dueAt: "2026-09-08 08:00",
  }), /timezone offset/);
  assert.throws(() => validateLearnerTaskInput({
    title: "Revise Maths", priority: "medium", timezone: "Not/A_Timezone",
  }), /IANA timezone/);
});
