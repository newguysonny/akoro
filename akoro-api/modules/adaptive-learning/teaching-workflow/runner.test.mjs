import assert from "node:assert/strict";
import test from "node:test";

import {
  TEACHING_TURN_WORKFLOW,
  runTeachingWorkflowTools,
} from "./runner.js";

test("adaptive teaching executes its sealed evidence-first tool sequence", async () => {
  const invoked = [];
  const statusEvents = [];
  const tools = Object.fromEntries(TEACHING_TURN_WORKFLOW.tools.map((name) => [name, {
    execute: async (context) => {
      invoked.push(name);
      context.counter = (context.counter || 0) + 1;
    },
  }]));
  const context = { completedTools: [], secretHumanMessage: "must not be emitted" };

  await runTeachingWorkflowTools({ context, tools, onStep: (event) => statusEvents.push(event) });

  assert.deepEqual(invoked, TEACHING_TURN_WORKFLOW.tools);
  assert.deepEqual(context.completedTools, TEACHING_TURN_WORKFLOW.tools);
  assert.equal(context.counter, TEACHING_TURN_WORKFLOW.tools.length);
  assert.equal(statusEvents.length, TEACHING_TURN_WORKFLOW.tools.length * 2);
  assert.ok(statusEvents.every((event) => event.workflow === "adaptive_teaching_turn"));
  assert.ok(statusEvents.every((event) => !Object.hasOwn(event, "secretHumanMessage")));
  assert.ok(statusEvents.every((event) => !Object.hasOwn(event, "output")));
});

test("a missing workflow tool fails closed instead of skipping the gate", async () => {
  const tools = Object.fromEntries(TEACHING_TURN_WORKFLOW.tools.slice(0, -1).map((name) => [name, {
    execute: async () => {},
  }]));

  await assert.rejects(
    () => runTeachingWorkflowTools({ context: { completedTools: [] }, tools }),
    /gate_teaching_progress/,
  );
});
