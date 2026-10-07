/**
 * Study-prep session & topic state machines + harness policy constants
 * (Master Plan §1.3, §4.12). PURE — no db, no LLM, no clock.
 *
 *   Session: planning → awaiting_confirmation → topic_active ⇄ replanning
 *                                            ⇄ paused → completed|abandoned|cancelled
 *   Topic:   queued → active → understood | flagged_gap | capped_out | deferred
 */

export const SESSION_STATES = Object.freeze([
  "planning", "awaiting_confirmation", "topic_active", "replanning", "paused", "completed", "abandoned", "cancelled",
]);

export const ACTIVE_SESSION_STATES = Object.freeze(
  SESSION_STATES.filter((state) => !["completed", "abandoned", "cancelled"].includes(state)),
);

export const TOPIC_STATES = Object.freeze(["queued", "active", "understood", "flagged_gap", "capped_out", "deferred"]);

const SESSION_TRANSITIONS = Object.freeze({
  planning: ["awaiting_confirmation", "replanning", "abandoned", "cancelled"],
  awaiting_confirmation: ["topic_active", "replanning", "cancelled", "abandoned"],
  topic_active: ["paused", "replanning", "completed", "abandoned", "cancelled"],
  replanning: ["topic_active", "awaiting_confirmation", "paused", "abandoned", "cancelled"],
  paused: ["topic_active", "planning", "replanning", "abandoned", "cancelled"],
  completed: [],
  abandoned: [],
  cancelled: [],
});

const TOPIC_TRANSITIONS = Object.freeze({
  queued: ["active", "deferred"],
  active: ["understood", "flagged_gap", "capped_out", "deferred", "queued"],
  understood: [],
  flagged_gap: ["queued"],
  capped_out: ["deferred", "queued"],
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
  MAX_ITERATIONS_PER_STEP: 6,     // Decision 1 — harness constant, not a model choice
  SESSION_TOOL_CALL_CAP: 40,      // S4 max-turns guard
  DEFERRED_RETRIES_PER_SESSION: 1,// Decision 5
  INTENT_MAX_CHARS: 240,          // S5 still-open, adopted
  FAN_OUT_CONCURRENCY: 4,         // S4: generation fan-out ≤ 3–4
  STRATEGY_LIBRARY: Object.freeze(["teach_back", "different_analogy", "interleave", "space_out", "escalate_human"]),
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
  "agent_loop_cap",
  "session_tool_call_cap",
  "unknown_action",
]);

/** The closed decision-node enum deliberate() may narrate (§4.7). */
export const DECISION_NODES = Object.freeze([
  "harness_rejection", "plan_validated", "plan_confirmed", "plan_adjusted", "topic_started",
  "practice_generated", "practice_scored", "strategy_offered", "teach_back_confirmed",
  "topic_advanced", "topic_deferred", "topic_flagged", "session_concluded", "session_paused",
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
