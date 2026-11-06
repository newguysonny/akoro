/**
 * teaching-session/policy.js — the rules of the agent-driven teaching turn
 * (Grand Plan §9.3–9.6, Phase 6). PURE — no db, no model, no clock.
 *
 * The teaching agent proposes; this module says what it may propose, what
 * happens when it doesn't (the fallback move), and when a session must end.
 * The progression gate (state-machine.js applyTeachingProgress) stays the only
 * thing that moves a session forward.
 */
import { isPermittedStrategy, normaliseStrategyId, strategiesFor } from "../strategies/library.js";

/** §9.5 — the session's bounds. */
export const TEACHING_POLICY = Object.freeze({
  MAX_ITERATIONS_PER_TURN: 3,     // D7
  DECISION_TIMEOUT_MS: 8_000,     // D8 → fallback
  MAX_STRATEGY_CHANGES: 2,        // per session; then a bounded end
  MAX_TURNS: 60,                  // per session; then a bounded end
  MAX_ASSESSMENTS: 2,             // per session
  SESSION_TOOL_CALL_CAP: 120,
});

/** The two teaching modes (D24). */
export const TEACHING_MODES = Object.freeze(["teach_agent", "learn_with_guide"]);
export const normaliseMode = (mode) => (TEACHING_MODES.includes(mode) ? mode : "teach_agent");

/** What the protégé can do in its reply (teach_agent). */
export const PROTEGE_MOVES = Object.freeze({
  ask_followup: "ask a natural follow-up question that makes the teacher go one step deeper",
  request_clarification: "say plainly which part you didn't get and ask the teacher to explain it again, more simply",
  challenge: "push back with a 'but what if…' case that tests whether the explanation really holds",
  acknowledge: "say what you now understand, in your own words, and ask what comes next",
  teach_back_prompt: "try to explain it back in your own words (a little imperfectly) and ask the teacher to check you",
  confused_student: "show the confusion a real student would have here (a common mix-up), so the teacher has to correct it",
});

/** What NaNa can do when she is the teacher (learn_with_guide). */
export const GUIDE_MOVES = Object.freeze({
  explain: "explain the idea clearly in a few short sentences, with one concrete example",
  ask_check_question: "ask one short question that checks whether the learner understood",
  give_example: "give one worked, everyday example and ask the learner to say what it shows",
  use_analogy: "explain it through a simple analogy from daily life, then ask them to map it back",
  correct_misconception: "gently name the mistake in what they said and set it right",
  ask_explain_back: "ask the learner to explain it back to you in their own words",
  summarise: "sum up what they now know in 2-3 short lines and say what comes next",
});

/**
 * Strategies the agent may switch to inside a session: the ONE library's
 * entries allowed in Teaching that a Teaching session runs itself (§7.7.2 v3).
 * Harness strategies (replan, schedule, export, escalate, peer stories) are
 * chosen by the workflow that owns them, never mid-session.
 */
export const TEACHING_STRATEGIES = Object.freeze(strategiesFor("teaching", { executor: "teaching", includeDisabled: true }));

/** PURE: the library id for a strategy_select argument (legacy names map), or null when not allowed now. */
export function teachingStrategy(strategy) {
  const id = normaliseStrategyId(strategy);
  return TEACHING_STRATEGIES.includes(id) && isPermittedStrategy(id, "teaching") ? id : null;
}

/** The evidence's dialogue move → the protégé's default move (the fallback). */
export const PROTEGE_MOVE_FOR_DIALOGUE = Object.freeze({
  clarify_core: "request_clarification",
  repair_misconception: "confused_student",
  apply_in_context: "ask_followup",
  connect_and_explain: "ask_followup",
  stretch_transfer: "challenge",
  consolidate_and_advance: "acknowledge",
  synthesise: "teach_back_prompt",
});

/** The evidence's dialogue move → NaNa's default move in guide mode (the fallback). */
export const GUIDE_MOVE_FOR_DIALOGUE = Object.freeze({
  clarify_core: "explain",
  repair_misconception: "correct_misconception",
  apply_in_context: "give_example",
  connect_and_explain: "use_analogy",
  stretch_transfer: "ask_check_question",
  consolidate_and_advance: "summarise",
  synthesise: "ask_explain_back",
});

/** The reply the harness gives when the agent doesn't: { tool, args }. */
export function fallbackReply(mode, dialogueMove) {
  return normaliseMode(mode) === "learn_with_guide"
    ? { tool: "guide_teach", args: { move: GUIDE_MOVE_FOR_DIALOGUE[dialogueMove] || "explain" } }
    : { tool: "protege_respond", args: { move: PROTEGE_MOVE_FOR_DIALOGUE[dialogueMove] || "ask_followup" } };
}

/** The agent's tools per mode: read · propose · the one terminal reply. */
const COMMON = ["teaching_get_state", "strategy_select", "teaching_propose_complete", "teaching_propose_pause"];
export const TOOLS_BY_MODE = Object.freeze({
  teach_agent: Object.freeze([...COMMON, "guide_coach", "protege_respond"]),
  learn_with_guide: Object.freeze([...COMMON, "guide_teach"]),
});
/** A tool whose result IS the learner's reply this turn (§9.3 ⟂). */
export const TERMINAL_TOOLS = Object.freeze(["protege_respond", "guide_teach", "teaching_propose_complete", "teaching_propose_pause"]);
/** The plan's names for the events (§9.4). */
export const PLAN_NAME = Object.freeze({
  teaching_get_state: "teaching.get_state", strategy_select: "strategy.select", guide_coach: "guide.coach",
  protege_respond: "protege.respond", guide_teach: "guide.teach",
  teaching_propose_complete: "teaching.propose_complete", teaching_propose_pause: "teaching.propose_pause",
});

/** PURE: is this decision allowed? → { ok } | { ok:false, error } (tool_not_permitted, invalid_arguments, …). */
export function validateDecision(mode, decision, { strategyChanges = 0 } = {}) {
  const m = normaliseMode(mode);
  const tool = decision?.tool;
  const args = decision?.args && typeof decision.args === "object" ? decision.args : {};
  if (!TOOLS_BY_MODE[m].includes(tool)) return { ok: false, error: "tool_not_permitted" };
  if (tool === "protege_respond" && !Object.hasOwn(PROTEGE_MOVES, args.move)) return { ok: false, error: "invalid_arguments" };
  if (tool === "guide_teach" && !Object.hasOwn(GUIDE_MOVES, args.move)) return { ok: false, error: "invalid_arguments" };
  if (tool === "strategy_select") {
    if (!TEACHING_STRATEGIES.includes(normaliseStrategyId(args.strategy))) return { ok: false, error: "invalid_arguments" };
    if (!teachingStrategy(args.strategy)) return { ok: false, error: "strategy_not_permitted" };
    if (strategyChanges >= TEACHING_POLICY.MAX_STRATEGY_CHANGES) return { ok: false, error: "strategy_cap_reached" };
  }
  return { ok: true };
}

/** PURE: the teaching objective is met — the gate reached MASTERY with every part verified (§9.6). */
export const objectiveMet = ({ phase, allConceptsVerified }) => phase === "MASTERY" && allConceptsVerified === true;

/** PURE: must the session end now without its objective? → reason | null. */
export function boundedEnd({ turnCount = 0, strategyChanges = 0, toolCalls = 0 } = {}) {
  if (turnCount >= TEACHING_POLICY.MAX_TURNS) return "turn_cap";
  if (strategyChanges > TEACHING_POLICY.MAX_STRATEGY_CHANGES) return "strategy_cap";
  if (toolCalls >= TEACHING_POLICY.SESSION_TOOL_CALL_CAP) return "tool_call_cap";
  return null;
}

/** PURE: what a finished session recommends next (§9.6). */
export function recommendedNextAction({ met, abandoned = false, bounded = null } = {}) {
  if (abandoned) return "reoffer";
  if (met) return "retest";
  return bounded ? "flag_gap" : "retest";
}
