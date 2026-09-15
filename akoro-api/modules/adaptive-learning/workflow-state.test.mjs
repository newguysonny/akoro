import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionWorkflow, workflowEvent } from "./workflow-state.js";

test("adaptive workflow transitions are explicit, learner-visible, and terminal", () => {
  assert.equal(canTransitionWorkflow("diagnostic_ready", "teach_back_required"), true);
  assert.equal(canTransitionWorkflow("teach_back_required", "retest_ready"), true);
  assert.equal(canTransitionWorkflow("passed", "retest_ready"), false);
  assert.equal(canTransitionWorkflow("diagnostic_ready", "researching"), false);
});

test("workflow status events contain only bounded public state", () => {
  assert.deepEqual(workflowEvent({ state: "passed", attempt: 2, score: .8 }), {
    state: "passed", label: "Assessment result recorded", attempt: 2, score: .8,
  });
  assert.equal(workflowEvent({ state: "teach_back_required", score: 8 }).score, 1);
  assert.throws(() => workflowEvent({ state: "hidden_thought" }));
});
