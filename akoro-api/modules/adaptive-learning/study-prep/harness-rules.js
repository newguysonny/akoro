/**
 * study-prep harness rules (Master Plan §4.4). PURE — no db, no clock.
 *
 * The stable rejection codes, the per-action state checks, the plan-card
 * labels and the open strategy offer. Everything here is data or a pure
 * function over recorded state; the harness core only reads it.
 */

import { TOPIC_IN_PROGRESS_STATES } from "./state-machine.js";
import { stateIs } from "../../agent-runtime/index.js";

/** Thrown/mapped when the wallet cannot cover a charge → session pauses. */
export class InsufficientBalanceError extends Error {
  constructor(coins, balance) { super(`Insufficient coins: need ${coins}, have ${balance}`); this.code = "insufficient_balance"; this.coins = coins; this.balance = balance; }
}

const HTTP_FOR_CODE = {
  study_prep_disabled: 409, session_not_found: 404, tool_not_permitted: 403, tool_schema_invalid: 422,
  invalid_state_transition: 409, attempt_cap_exceeded: 409, strategy_not_permitted: 422,
  prerequisite_violation: 422, topic_not_in_syllabus: 422, plan_too_large: 422, duplicate_topic: 422,
  deferred_retry_used: 409, insufficient_balance: 402, over_estimate: 409, teach_back_gate: 409, teaching_unavailable: 409, agent_loop_cap: 409,
  session_tool_call_cap: 409, unknown_action: 400, syllabus_exists: 409, outline_invalid: 502,
  // §8.8 files and non-curricular goals.
  no_materials: 422, materials_already_requested: 409, materials_not_requested: 409,
};

export { HTTP_FOR_CODE };

/** Study Prep's check plug-in: the state each action needs (copy and codes unchanged). */
export const STUDY_PREP_CHECKS = Object.freeze({
  generate_syllabus: [stateIs(["planning", "replanning"], "An outline can only be drafted while planning")],
  syllabus_from_documents: [stateIs(["planning", "replanning"], "An outline can only be drawn from the files while planning")],
  request_materials: [stateIs(["planning", "replanning"], "Materials can only be asked for while planning")],
  propose_plan: [stateIs(["planning", "replanning"], "A plan can only be proposed while planning")],
  confirm_plan: [stateIs("awaiting_confirmation", "There is no plan waiting for confirmation")],
  adjust_plan: [stateIs("awaiting_confirmation", "The plan can only be adjusted before it is confirmed")],
  start_practice: [
    stateIs("topic_active", "Practice can only start while a topic is active"),
    stateIs(TOPIC_IN_PROGRESS_STATES, "That topic is not the active topic", { key: "topic" }),
  ],
  // Submit-status guard (Phase 5): a stopped or paused session takes no answers.
  submit_practice: [stateIs("topic_active", "Answers can only be submitted while the session is running")],
  // D15: a missed topic is handed to a teaching session, only while the session runs.
  request_teaching: [stateIs("topic_active", "A teaching session can only be requested while the plan is running")],
  advance_topic: [stateIs("topic_active", "No topic is active")],
  resume_session: [stateIs("paused", "The session is not paused")],
});

/** What the plan card says when the session plans against a generated outline (§8.7). */
export const GENERATED_OUTLINE_LABEL = "AI-drafted outline — not your school's official syllabus";

const ALLOW_DOES = Object.freeze({
  schedule: "I'll add short reviews to your chat on different days.",
  replan: "I'll change the order of your remaining topics.",
  offline_export: "I'll save a summary and a self-test to your Records.",
  notify_human: "I'll let your class teacher know you'd like help with this.",
  peer_stories: "I'll share how other learners got past this, in your chat.",
  goal_set: "I'll ask you in the chat what 'got it' should look like here.",
});

/**
 * The strategy the agent offered and the learner hasn't answered yet, per
 * topic (Phase 4a, preview approved 2026-11-07): the latest strategy_offered /
 * strategy_declined event for a topic decides. PURE.
 *   → { topicId, strategy, name, summary, operation, allowDoes } | null
 */
export function pendingStrategyOffer(events = [], topics = [], getEntry = () => null) {
  const latest = new Map();
  for (const e of events || []) {
    if (e?.decision_node !== "strategy_offered" && e?.decision_node !== "strategy_declined") continue;
    if (e.topic_id) latest.set(e.topic_id, e);
  }
  const inProgress = new Set((topics || []).filter((t) => t && TOPIC_IN_PROGRESS_STATES.includes(t.status)).map((t) => t.id));
  for (const [topicId, e] of latest) {
    if (!inProgress.has(topicId) || e.decision_node !== "strategy_offered" || e.facts?.accepted) continue;
    const entry = getEntry(e.facts?.strategy);
    if (!entry) continue;
    const op = entry.runsAs?.executor === "harness" ? entry.runsAs.operation : "teach";
    return { topicId, strategy: entry.id, name: entry.name, summary: entry.summary, operation: op,
      allowDoes: ALLOW_DOES[op] || (op === "teach" ? "It's used in your next teaching session." : null) };
  }
  return null;
}

/** The plan card's label for a plan made from the learner's files. PURE. */
export function documentsPlanLabel(row) {
  const n = Array.isArray(row?.material_record_ids) ? row.material_record_ids.length : 0;
  return `Outline drawn from your files${n ? ` (${n} file${n === 1 ? "" : "s"})` : ""}. Not your school's official syllabus.`;
}
