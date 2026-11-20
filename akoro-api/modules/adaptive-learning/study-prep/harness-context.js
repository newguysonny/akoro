/**
 * study-prep harness context — the shared seams every harness operation uses.
 *
 * The guarded store (definition checks + workflow mirror) is passed in; this
 * module only shapes the activity log, the learner-facing views and the
 * conditional state moves. It owns no policy of its own.
 */

import { canTransitionSession, isTopicInProgress, publicTopicStatus } from "./state-machine.js";
import { makeEvent, stampThoughtType } from "./events.js";
import { deliberate } from "./narration.js";
import { GENERATED_OUTLINE_LABEL, documentsPlanLabel } from "./harness-rules.js";

export function makeHarnessContext({ store, now }) {
  const log = async (sessionId, topicId, partial) => {
    const row = makeEvent({
      sequence: 0, // the store allocates the real sequence atomically
      topicId,
      thoughtType: stampThoughtType(partial),
      ...partial,
    });
    return store.appendEvents(sessionId, [row]).then((rows) => rows[0]);
  };

  const publicTopic = (row) => ({
    id: row.id, syllabusTopicId: row.syllabus_topic_id, position: Number(row.position), label: row.label,
    // status: coarse (every in-progress state is "active" — the card reads it); state: the §8.3 state.
    status: publicTopicStatus(row.status), state: row.status, teachingWorkflowId: row.teaching_workflow_id || null,
    attemptsUsed: Number(row.attempts_used || 0), deferredRetryUsed: Boolean(row.deferred_retry_used),
    flaggedReason: row.flagged_reason || null, examPrepRunId: row.exam_prep_run_id || null,
    learnerConfirmedReady: Boolean(row.learner_confirmed_ready),
    checkBattleId: row.check_battle_id || null, checkMode: row.check_mode || null,
    checkScoredAt: row.check_scored_at || null, checkResult: row.check_result || null,
    updatedAt: row.updated_at || null,
  });

  const publicSession = (row, topics = null) => ({
    id: row.id, goal: row.goal, subject: row.subject, classLevel: row.class_level, entryMode: row.entry_mode,
    examBoard: row.exam_board, status: row.status, pausedReason: row.paused_reason || null,
    plan: row.plan || null, estimate: row.estimate || null, policyVersion: row.policy_version,
    toolCallsUsed: Number(row.tool_calls_used || 0), createdAt: row.created_at, updatedAt: row.updated_at,
    completedAt: row.completed_at || null, topics: topics ? topics.map(publicTopic) : undefined,
    syllabusSource: row.syllabus_source || "platform",
    // §8.8: a school exam, or a scholarship / competition / professional exam / own topic.
    goalType: row.goal_type || "curricular", materialsRequested: Boolean(row.materials_requested_at),
    // The plan card says where the topics came from (preview approved 2026-11-07): an AI-drafted
    // outline, or an outline drawn from the learner's own files — never passed off as the school's syllabus.
    syllabusLabel: row.syllabus_source === "generated" ? GENERATED_OUTLINE_LABEL : row.syllabus_source === "documents" ? documentsPlanLabel(row) : null,
    syllabusLabelKind: row.syllabus_source === "generated" ? "generated" : row.syllabus_source === "documents" ? "documents" : null,
    workflowId: row.workflow_id || null,
  });

  async function ownedSession(sessionId, learnerId) {
    const session = await store.getSession(sessionId);
    if (!session || session.learner_id !== learnerId) return null;
    return session;
  }

  /** The topic being worked on: any in-progress §8.3 state. */
  function activeTopic(topics) { return topics.find((topic) => isTopicInProgress(topic.status)) || null; }

  /** One topic move, conditional on the state it was read in (the guarded store checks the edge). */
  const moveTopic = (topic, to, patch = {}) => store.updateTopicConditional(topic.id, topic.status, { status: to, ...patch, updated_at: now() });

  async function pause(session, reason, extraFacts = {}) {
    // Only from a state that can pause: a plan already waiting on the learner
    // stays waiting (the step cap after a proposed plan is not the learner's error).
    if (!canTransitionSession(session.status, "paused")) return null;
    const paused = await store.updateSessionConditional(session.id, session.status, {
      status: "paused", paused_reason: reason, updated_at: now(),
    });
    if (paused) {
      await log(session.id, null, {
        eventType: "harness_decision", origin: "harness", decisionNode: "session_paused",
        facts: { reason, ...extraFacts }, narrative: deliberate("session_paused", { reason })?.narrative,
      });
    }
    return paused;
  }

  return { log, publicTopic, publicSession, ownedSession, activeTopic, moveTopic, pause };
}
