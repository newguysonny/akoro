/**
 * Study-prep session & topic state machines + harness policy constants
 * (Master Plan §1.3, §4.12). PURE — no db, no LLM, no clock.
 *
 *   Session: planning → awaiting_confirmation → topic_active ⇄ replanning
 *                                            ⇄ paused → completed|abandoned|cancelled
 *   Topic (Grand Plan §8.3, D15/D16):
 *     queued → active ─ notes ─→ diagnostic_ready → diagnostic (the check)
 *                     └ none ──→ intervention_required
 *     diagnostic | retest → understood | intervention_required | capped_out
 *     intervention_required → awaiting_teaching   (request_teaching, D15)
 *                           → retest_ready        (inline teach-back: the fallback when Teaching is off)
 *     awaiting_teaching → retest_ready (TEACHING_COMPLETED) → retest
 *     capped_out → deferred | flagged_gap;   deferred | flagged_gap → queued
 *
 *   The exam-prep run is the ATTEMPT RECORD (questions, answers, score,
 *   attempt number). Its status (RUN_*) is kept for the record and the
 *   standalone exam-prep route; it never drives a topic — the topic machine does.
 */
import { strategiesFor } from "../strategies/library.js";

export const SESSION_STATES = Object.freeze([
  "planning", "awaiting_confirmation", "topic_active", "replanning", "paused", "completed", "abandoned", "cancelled",
]);

export const ACTIVE_SESSION_STATES = Object.freeze(
  SESSION_STATES.filter((state) => !["completed", "abandoned", "cancelled"].includes(state)),
);

export const TOPIC_STATES = Object.freeze([
  "queued", "active", "diagnostic_ready", "diagnostic", "intervention_required", "awaiting_teaching",
  "retest_ready", "retest", "understood", "flagged_gap", "capped_out", "deferred",
]);

/** The states of the topic being worked on (at most one per session). */
export const TOPIC_IN_PROGRESS_STATES = Object.freeze([
  "active", "diagnostic_ready", "diagnostic", "intervention_required", "awaiting_teaching", "retest_ready", "retest",
]);
/** A check (or a practice) is out on the topic, waiting to be scored. */
export const TOPIC_CHECKING_STATES = Object.freeze(["diagnostic", "retest"]);
/** Where the auto-start may begin a check by itself. */
export const TOPIC_STARTABLE_STATES = Object.freeze(["active", "diagnostic_ready", "retest_ready"]);

export const isTopicInProgress = (state) => TOPIC_IN_PROGRESS_STATES.includes(state);

/**
 * The topic's coarse status for the learner surfaces (the Study Prep card,
 * session.get_state's `status`): every in-progress state reads "active", so
 * the card is unchanged; `state` carries the §8.3 state itself.
 */
export const publicTopicStatus = (state) => (isTopicInProgress(state) ? "active" : state);

/** Where a scored attempt leaves the topic (§8.3). */
export function topicStateAfterScore({ passed, capped }) {
  if (passed) return "understood";
  if (capped) return "capped_out";
  return "intervention_required";
}

/**
 * Where a practice / Agent Check starts from, by the topic's state (§8.3).
 *   → { ok: true, mode, ready, running }   ready: the state before the charge,
 *                                          running: the state once it runs
 *   → { ok: false, code, message }
 * A retest only from retest_ready (teaching completed, or the inline
 * teach-back), and a retest_ready topic always runs a retest. A first check
 * from active / diagnostic_ready, or from intervention_required while no
 * attempt was ever scored (the first check found no notes; now taught).
 */
export function practiceStart({ state, attemptsUsed = 0 }, mode = "diagnostic") {
  if (state === "retest_ready") return { ok: true, mode: "retest", ready: "retest_ready", running: "retest" };
  const gate = { ok: false, code: "teach_back_gate", message: "The learner must confirm the teach-back before a retest" };
  if (mode === "retest") {
    return ["intervention_required", "awaiting_teaching"].includes(state) ? gate
      : { ok: false, code: "invalid_state_transition", message: "That topic has no retest waiting" };
  }
  const first = { ok: true, mode: "diagnostic", ready: "diagnostic_ready", running: "diagnostic" };
  if (state === "active" || state === "diagnostic_ready") return first;
  if (state === "intervention_required" && Number(attemptsUsed) === 0) return first;
  if (["intervention_required", "awaiting_teaching"].includes(state)) return gate;
  return { ok: false, code: "invalid_state_transition", message: "That topic is not ready for a check" };
}

/**
 * The exam-prep run as an attempt record (§8.3): its own small machine, kept
 * for the record and the standalone exam-prep route (`/exam-prep/confidence-runs`).
 * One table — the exam-prep run definition (workflow.js) is built from it.
 */
export const RUN_STATES = Object.freeze([
  "researching", "planned", "diagnostic_ready", "teach_back_required", "retest_ready", "passed", "change_approach", "cancelled",
]);
export const RUN_TRANSITIONS = Object.freeze({
  researching: ["planned", "cancelled"],
  planned: ["diagnostic_ready", "cancelled"],
  diagnostic_ready: ["teach_back_required", "passed", "change_approach", "cancelled"],
  teach_back_required: ["retest_ready", "cancelled"],
  retest_ready: ["teach_back_required", "passed", "change_approach", "cancelled"],
  passed: [], change_approach: [], cancelled: [],
});
/** Learner-safe labels for each run state (the run's step rows). */
export const RUN_STATE_LABELS = Object.freeze({
  researching: "Preparing approved study context",
  planned: "Practice plan ready",
  diagnostic_ready: "Generated practice ready",
  teach_back_required: "Teach-back available before a fresh retest",
  retest_ready: "Fresh generated retest ready",
  passed: "Assessment result recorded",
  change_approach: "Attempt cap reached; choose a different approach",
  cancelled: "Workflow cancelled",
});

/** The run record's status after a scored attempt (pass / cap / teach-back). */
export function runStatusAfterScore({ passed, currentAttempt, maxAttempts }) {
  if (passed) return "passed";
  return Number(currentAttempt) >= Number(maxAttempts) ? "change_approach" : "teach_back_required";
}

export const SESSION_TRANSITIONS = Object.freeze({
  // paused: the planning agent hit its step cap — resumable back into planning.
  planning: ["awaiting_confirmation", "replanning", "paused", "abandoned", "cancelled"],
  awaiting_confirmation: ["topic_active", "replanning", "cancelled", "abandoned"],
  topic_active: ["paused", "replanning", "completed", "abandoned", "cancelled"],
  replanning: ["topic_active", "awaiting_confirmation", "paused", "abandoned", "cancelled"],
  paused: ["topic_active", "planning", "replanning", "abandoned", "cancelled"],
  completed: [],
  abandoned: [],
  cancelled: [],
});

export const TOPIC_TRANSITIONS = Object.freeze({
  queued: ["active", "deferred"],
  active: ["diagnostic_ready", "intervention_required", "deferred", "flagged_gap", "queued"],
  // No notes after all (a stopped check, restarted) → intervention_required.
  diagnostic_ready: ["diagnostic", "intervention_required", "deferred", "flagged_gap"],
  // A stopped check goes back to ready.
  diagnostic: ["understood", "intervention_required", "capped_out", "diagnostic_ready"],
  // → awaiting_teaching: request_teaching (D15). → retest_ready: the inline teach-back.
  // → diagnostic_ready: the first check, once taught (no attempt was scored yet).
  intervention_required: ["awaiting_teaching", "retest_ready", "diagnostic_ready", "deferred", "flagged_gap"],
  // TEACHING_COMPLETED (or taught elsewhere) → retest_ready; abandoned with no re-offer → intervention_required.
  awaiting_teaching: ["retest_ready", "intervention_required", "deferred", "flagged_gap"],
  retest_ready: ["retest", "deferred", "flagged_gap"],
  retest: ["understood", "intervention_required", "capped_out", "retest_ready"],
  understood: [],
  flagged_gap: ["queued"],
  capped_out: ["deferred", "flagged_gap", "queued"],
  deferred: ["queued"],
});

export function canTransitionSession(from, to) {
  return (SESSION_TRANSITIONS[from] || []).includes(to);
}

export function canTransitionTopic(from, to) {
  return (TOPIC_TRANSITIONS[from] || []).includes(to);
}

/** Which pause reasons may resume into which state (resumable pauses, §4.4). */
export const PAUSE_REASONS = Object.freeze(["agent_loop_cap", "insufficient_balance", "learner_requested"]);

/** Harness policy constants — the model can never change these (S2 §11). */
export const POLICY = Object.freeze({
  MAX_TOPICS: 12,                 // Decision 7
  DEFAULT_MAX_ATTEMPTS: 3,        // policy table may override; exam-confidence default
  CRAM_MAX_ATTEMPTS: 1,           // Decision 6
  PASS_THRESHOLD: 0.70,           // policy table may override
  MAX_ITERATIONS_PER_STEP: 10,    // Decision 1 — harness constant, not a model choice (10 since 2026-10-19: deeper planning)
  SESSION_TOOL_CALL_CAP: 40,      // S4 max-turns guard
  DEFERRED_RETRIES_PER_SESSION: 1,// Decision 5
  INTENT_MAX_CHARS: 240,          // S5 still-open, adopted
  FAN_OUT_CONCURRENCY: 4,         // S4: generation fan-out ≤ 3–4
  // The ONE library's Study Prep strategies (strategies/library.js, §7.7.2 v3).
  STRATEGY_LIBRARY: Object.freeze(strategiesFor("study_prep", { includeDisabled: true })),
});

/**
 * Rejection codes the harness emits (Master Plan §4.4). Every code is stable,
 * machine-readable, and surfaces on a 4xx. The agent OBSERVES the code and
 * adapts; it never re-tries the identical call.
 */
export const REJECTION_CODES = Object.freeze([
  "study_prep_disabled",
  "session_not_found",
  "tool_not_permitted",
  "tool_schema_invalid",
  "invalid_state_transition",
  "attempt_cap_exceeded",
  "strategy_not_permitted",
  "prerequisite_violation",
  "topic_not_in_syllabus",
  "plan_too_large",
  "duplicate_topic",
  "deferred_retry_used",
  "insufficient_balance",
  "teach_back_gate",
  "teaching_unavailable",
  "agent_loop_cap",
  "session_tool_call_cap",
  "unknown_action",
  "syllabus_exists",
  "outline_invalid",
  "over_estimate",
]);

/** The closed decision-node enum deliberate() may narrate (§4.7). */
export const DECISION_NODES = Object.freeze([
  "harness_rejection", "plan_validated", "plan_confirmed", "plan_adjusted", "topic_started",
  "practice_generated", "practice_scored", "strategy_offered", "teach_back_confirmed",
  "topic_advanced", "topic_deferred", "topic_flagged", "session_concluded", "session_paused",
  "syllabus_generated", "syllabus_resolved", "agent_check_started", "agent_check_skipped", "agent_check_scored",
  "coins_approved", "teaching_requested", "teaching_completed", "strategy_declined",
]);

/** Hard plan validation (Master Plan §4.4 step 7): the ONLY plan constraints. */
export function validatePlan({ proposedTopics, syllabusTopics, prerequisites = [], maxTopics = POLICY.MAX_TOPICS }) {
  const syllabusIds = new Set((syllabusTopics || []).map((topic) => topic.id));
  if (!Array.isArray(proposedTopics) || proposedTopics.length === 0) {
    return { ok: false, code: "tool_schema_invalid", message: "A plan needs at least one topic" };
  }
  if (proposedTopics.length > maxTopics) {
    return { ok: false, code: "plan_too_large", message: `A session can cover at most ${maxTopics} topics` };
  }
  const seen = new Set();
  for (const topic of proposedTopics) {
    if (!syllabusIds.has(topic)) return { ok: false, code: "topic_not_in_syllabus", message: `“${topic}” is not in the approved syllabus` };
    if (seen.has(topic)) return { ok: false, code: "duplicate_topic", message: `“${topic}” appears twice in the plan` };
    seen.add(topic);
  }
  // Prerequisite order is a HARD constraint (Decision 4); soft ordering
  // (weak-first, strong-first) stays the agent's call.
  const position = new Map(proposedTopics.map((id, index) => [id, index]));
  for (const edge of prerequisites || []) {
    const before = position.get(edge.before);
    const after = position.get(edge.after);
    if (before != null && after != null && before > after) {
      return { ok: false, code: "prerequisite_violation", message: `“${edge.beforeLabel || edge.before}” should come before “${edge.afterLabel || edge.after}”` };
    }
  }
  return { ok: true };
}

/** Teach-back gate: only learnerConfirmedReady unlocks a retest (§4.4 step 9). */
export function teachBackGate({ mode, learnerConfirmedReady }) {
  if (mode === "retest" && learnerConfirmedReady !== true) {
    return { ok: false, code: "teach_back_gate", message: "The learner must confirm the teach-back before a retest" };
  }
  return { ok: true };
}

/** Attempt-cap gate for practice generation (§4.4 step 6). */
export function attemptCapGate({ attemptsUsed, maxAttempts }) {
  if (Number(attemptsUsed) >= Number(maxAttempts)) {
    return { ok: false, code: "attempt_cap_exceeded", message: "The attempt cap for this topic was reached" };
  }
  return { ok: true };
}
