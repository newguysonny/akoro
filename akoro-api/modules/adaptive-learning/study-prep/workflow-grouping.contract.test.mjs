import assert from "node:assert/strict";
import test from "node:test";

/**
 * Workflow-list grouping (Master Plan §4.8.3 + acceptance test 12):
 * one entry per study-prep session with topics nested; a six-topic session
 * leaves other workflow types visible in the list.
 */

import { groupWorkflowRows, publicGroupedWorkflows } from "./workflow-grouping.js";

const publicWorkflow = (row) => ({ id: row.id, type: row.workflow_type, topic: row.topic, state: row.state });

const topicRow = (session, topic, state, updatedAt) => ({
  id: `wf-${session}-${topic}`, workflow_type: "exam_prep", study_prep_session_id: session,
  topic, subject: "Basic Science", state, current_attempt: 1, last_score: null,
  updated_at: updatedAt, completed_at: null,
});

test("a six-topic session is ONE list entry with nested topics", () => {
  const rows = ["Water Cycle", "Photosynthesis", "Matter", "Energy", "Force and Motion", "Human Body"]
    .map((topic, index) => topicRow("session-1", topic, "passed", `2026-01-0${index + 1}T00:00:00Z`));
  const grouped = groupWorkflowRows(rows);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].kind, "study_prep_session");
  assert.equal(grouped[0].topics.length, 6);
  assert.equal(grouped[0].state, "passed");
  assert.equal(grouped[0].updatedAt, "2026-01-06T00:00:00Z", "the group follows the most recent row");
});

test("other workflow types stay visible beside the session group", () => {
  const rows = [
    { id: "wf-other", workflow_type: "exam_prep", topic: "Standalone topic", state: "retest_ready", subject: "Mathematics", updated_at: "2026-01-02T00:00:00Z" },
    ...["A", "B", "C", "D", "E", "F"].map((topic, index) => topicRow("session-1", topic, "passed", `2026-01-0${index + 1}T00:00:00Z`)),
  ];
  const grouped = publicGroupedWorkflows(rows, publicWorkflow);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].type, "exam_prep", "the standalone topic keeps the classic shape");
  assert.equal(grouped[1].type, "study_prep_session");
  assert.equal(grouped[1].topicCount, 6);
  assert.equal(grouped[1].topics[0].topic, "A");
});

test("public session entries expose only learner-safe fields", () => {
  const rows = [topicRow("session-1", "Water Cycle", "teach_back_required", "2026-01-01T00:00:00Z")];
  const [entry] = publicGroupedWorkflows(rows, publicWorkflow);
  assert.equal(entry.id, "session-1");
  assert.equal(entry.studyPrepSessionId, "session-1");
  assert.equal(entry.topicCount, 1);
  assert.deepEqual(Object.keys(entry.topics[0]), ["id", "topic", "state", "currentAttempt", "lastScore"]);
});

test("ungrouped rows pass through untouched", () => {
  const rows = [{ id: "wf-1", workflow_type: "exam_prep", topic: "T", state: "passed", updated_at: null }];
  const [entry] = publicGroupedWorkflows(rows, publicWorkflow);
  assert.equal(entry.type, "exam_prep");
  assert.equal(entry.topic, "T");
  assert.equal(groupWorkflowRows([]).length, 0);
  assert.equal(groupWorkflowRows(null).length, 0);
});
