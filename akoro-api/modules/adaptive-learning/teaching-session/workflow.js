/**
 * teaching-session/workflow.js — a teaching session as a workflow of the
 * generic engine (Phase 6, 2026-10-20). PURE — no db, no clock.
 *
 * The live session is still the adaptive socket (websocket.js) and its row
 * edu.adaptive_sessions; the workflow is what the rest of the app can see and
 * wait on: that a session exists, where it is, and how it ended. Study Prep
 * hands a topic over to one (a below-the-mark Agent Check), and the session's
 * outcome hands it back (study-prep/teaching-handoff.js).
 *
 *   proposed         offered in Study Prep's chat; the learner confirms, or it
 *                    approves itself after HANDOFF_AUTO_APPROVE_MS
 *   scheduled        created — waiting on the learner's dashboard
 *   teaching_active  the learner is teaching (the modal is open, or parked)
 *   adapt_strategy   the session changed tack (a drift warning) — back to teaching next turn
 *   assessment       the learner ended it; its evidence is being read
 *   completed        done — the outcome went to the parent
 *   cancelled / abandoned
 */
import { defineWorkflow } from "../../workflows/definition.js";
import { registerWorkflow } from "../../workflows/registry.js";

export const TEACHING_STATES = Object.freeze(["proposed", "scheduled", "teaching_active", "adapt_strategy", "assessment", "completed", "cancelled", "abandoned"]);
export const TEACHING_TRANSITIONS = Object.freeze({
  proposed: ["scheduled", "cancelled"],
  scheduled: ["teaching_active", "cancelled", "abandoned"],
  teaching_active: ["adapt_strategy", "assessment", "cancelled", "abandoned"],
  adapt_strategy: ["teaching_active", "assessment", "cancelled", "abandoned"],
  assessment: ["completed", "teaching_active"],
  completed: [], cancelled: [], abandoned: [],
});
/** Where a learner can still pick it up (the dashboard lists these). */
export const OPEN_TEACHING_STATES = Object.freeze(["scheduled", "teaching_active", "adapt_strategy"]);

export const teachingWorkflow = registerWorkflow(defineWorkflow({
  type: "teaching", version: "1",
  states: TEACHING_STATES, initial: "proposed", transitions: TEACHING_TRANSITIONS,
  statusOf: {
    proposed: "waiting_learner", scheduled: "waiting_learner",
    teaching_active: "active", adapt_strategy: "active", assessment: "active",
    completed: "completed", cancelled: "cancelled", abandoned: "abandoned",
  },
}));

/** A proposal approves itself after this long without a tap (the user's call, like the checks' auto-start). */
export const HANDOFF_AUTO_APPROVE_MS = 60_000;
const MAX_FOCUS = 4;
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * What a below-the-mark Agent Check hands over: the topic and what the agent
 * couldn't answer (the session's parts). Null when there is nothing to hand
 * over (passed, out of tries).
 */
export function handoffFromCheck({ outcome, topic, gaps = [] }) {
  if (outcome !== "retest_offered" || !topic?.label) return null;
  const focus = [...new Set((gaps || []).map((g) => clip(g, 120)).filter(Boolean))].slice(0, MAX_FOCUS);
  return { topic: clip(topic.label, 160), focus };
}

/** The proposal's auto-approve time, from when it was proposed. */
export const autoApproveAt = (proposedAtIso) => new Date((Date.parse(proposedAtIso) || 0) + HANDOFF_AUTO_APPROVE_MS).toISOString();

/** Is a proposal past its auto-approve time? */
export const dueForAutoApprove = (instance, nowMs) => instance?.state === "proposed"
  && Date.parse(instance.metadata?.autoApproveAt || "") <= nowMs;

/**
 * Where a teaching turn left the session: { part, of, phase, milestone }.
 * milestone: a part was finished or the phase moved — worth telling the
 * parent (every turn is not).
 */
export function teachingProgress(result, previous = {}) {
  const of = Math.max(0, Number(result?.totalSubtopics) || 0);
  const idx = Math.max(0, Number(result?.subtopicIdx) || 0);
  const part = of ? Math.min(of, idx + 1) : null;
  const phase = result?.currentPhase ?? null;
  const mastery = phase === "MASTERY";
  // Parts behind the current one are taught; reaching mastery finishes the last.
  const done = of ? Math.min(of, idx + (mastery ? 1 : 0)) : 0;
  const milestone = Boolean(result?.phaseChanged) || done > (Number(previous.done) || 0);
  return { part, of: of || null, done, phase, mastery, milestone, drift: result?.type === "drift_warning" };
}

/**
 * The outcome a finished session hands back — counted facts only: endSession()'s
 * result, the notes it saved (orchestrator.stats.agentKnowledgeAdded) and the
 * last progress.
 */
export function teachingOutcome(endResult = {}, { focus = [], notesAdded = 0, progress = null } = {}) {
  const evidence = Number(endResult.learnerEvidenceScore);
  const notes = Math.max(0, Number(notesAdded) || 0);
  return {
    partsDone: progress?.done ?? null, parts: progress?.of ?? null, mastery: Boolean(progress?.mastery),
    turns: Number(endResult.totalTurns) || 0,
    learnerEvidenceScore: Number.isFinite(evidence) ? evidence : null,
    notesAdded: notes,
    focus: (focus || []).slice(0, MAX_FOCUS),
    taught: Number(endResult.totalTurns) > 0,
  };
}

/** The card's and the dashboard's view of one teaching workflow. */
export function teachingView(instance) {
  if (!instance) return null;
  const m = instance.metadata || {};
  return {
    workflowId: instance.id, state: instance.state, status: instance.status,
    topic: m.topic || null, subject: m.subject || null, focus: Array.isArray(m.focus) ? m.focus : [],
    from: m.studyPrepSessionId ? { kind: "study_prep", sessionId: m.studyPrepSessionId, topicId: m.topicId || null, label: m.fromLabel || null } : null,
    autoApproveAt: instance.state === "proposed" ? (m.autoApproveAt || null) : null,
    progress: m.progress || null,
    adaptiveSessionId: m.adaptiveSessionId || null,
    outcome: m.outcome || null,
    createdAt: instance.created_at || null, updatedAt: instance.updated_at || null,
  };
}
