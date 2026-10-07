/**
 * Workflow-list grouping (Master Plan §4.8.3): one list entry per study-prep
 * session with its topics nested, so a six-topic session never crowds the
 * other workflow types out of the learner's list. PURE — tested directly.
 */

/**
 * groupWorkflowRows(rows) → [{ kind: "study_prep_session", … } | { kind: "workflow", row }]
 * Session groups aggregate their exam-prep topic rows: the group's state and
 * updatedAt follow the most recently updated topic row.
 */
export function groupWorkflowRows(rows) {
  const groups = [];
  const bySession = new Map();
  for (const row of rows || []) {
    if (row.workflow_type === "exam_prep" && row.study_prep_session_id) {
      let group = bySession.get(row.study_prep_session_id);
      if (!group) {
        group = {
          kind: "study_prep_session", studyPrepSessionId: row.study_prep_session_id,
          subject: row.subject, state: row.state, updatedAt: row.updated_at,
          completedAt: null, topics: [],
        };
        bySession.set(row.study_prep_session_id, group);
        groups.push(group);
      }
      group.topics.push(row);
      if (String(row.updated_at || "") > String(group.updatedAt || "")) {
        group.updatedAt = row.updated_at;
        group.state = row.state;
      }
      if (row.completed_at) group.completedAt = row.completed_at;
    } else {
      groups.push({ kind: "workflow", row });
    }
  }
  return groups;
}

/**
 * Shape a grouped list for the public API: session groups become one entry
 * with nested topic summaries; standalone workflows keep the classic shape.
 */
export function publicGroupedWorkflows(rows, publicWorkflow) {
  return groupWorkflowRows(rows).map((group) => {
    if (group.kind === "workflow") return publicWorkflow(group.row);
    return {
      id: group.studyPrepSessionId,
      type: "study_prep_session",
      studyPrepSessionId: group.studyPrepSessionId,
      subject: group.subject,
      state: group.state,
      updatedAt: group.updatedAt,
      completedAt: group.completedAt,
      topicCount: group.topics.length,
      topics: group.topics.map((row) => ({
        id: row.id, topic: row.topic, state: row.state,
        currentAttempt: Number(row.current_attempt || 1), lastScore: row.last_score == null ? null : Number(row.last_score),
      })),
    };
  });
}
