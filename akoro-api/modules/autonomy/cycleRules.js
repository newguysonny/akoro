/**
 * modules/autonomy/cycleRules.js — constants the cycle's validator and
 * reasoner share, extracted from cycle.js.
 */

/** A run nothing can be shown from (every kind off or observe): platform-paid, outside the learner's weekly budget (Phase 18 item 1). */
export const OBSERVE_FEATURE = "agent_autonomy_observe";

/** The kinds shaped by readyKinds.js from a real record/goal/topic. */
export const READY_SHAPED = new Set(["quiz_from_records", "teach_weak_topic", "study_plan", "revision_battle", "follow_up_question", "goal_nudge"]);
