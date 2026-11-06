/**
 * adaptive-learning/adaptive-engine.js — the Adaptive Learning Engine's
 * next-action recommendation (Grand Plan §7.7, Phase 10).
 *
 * PURE: no db, no LLM, no clock reads (`now` is passed in). ONE decision path
 * for "what should the guide do next":
 *
 *   recommendNextAction(input) → { action, reason, source }
 *
 *   • In a teaching turn (input carries `dialogueMove`, even an unknown one)
 *     the evidence observer's dialogue move decides — the table below, with
 *     DIG_DEEPER for a move it does not know. This is exactly the behaviour
 *     the teaching progression gate always had; the gate (state-machine.js)
 *     now asks this function instead of looking the table up itself.
 *   • Outside a turn (no dialogue move) the learner model decides: the rules
 *     that used to be `student-state.js:decideNextAction`, folded in here as a
 *     recommendation input. The misconception signal is the CENTRAL one
 *     (learner_concept_state.misconception_active, recorded by
 *     learning-events.js) — no longer the per-agent `knowledge[topic].mistakes`
 *     array, which is retired.
 *
 * The result is a recommendation. The teaching gate still decides whether a
 * session may advance; nothing here can bypass a missing evidence gate.
 */

/** What the guide does next for each observed dialogue move. */
export const ACTION_FOR_DIALOGUE_MOVE = Object.freeze({
  clarify_core: "DIG_DEEPER",
  repair_misconception: "CLEAR_MISTAKE",
  apply_in_context: "USE_ANALOGY",
  connect_and_explain: "ONE_MORE_PUSH",
  stretch_transfer: "CHALLENGE",
  consolidate_and_advance: "GAP_CLOSED",
  synthesise: "TRIGGER_RECALL",
});

export const NEXT_ACTIONS = Object.freeze([
  "DIG_DEEPER", "CLEAR_MISTAKE", "USE_ANALOGY", "ONE_MORE_PUSH", "NEXT_SUBTOPIC",
  "NAME_IT", "SPACED_REVIEW", "TRIGGER_RECALL", "GAP_CLOSED", "CHALLENGE", "MASTERY",
]);

// Spaced-review intervals (moved with the rules from student-state.js).
export const REVIEW_SPACING_MS = Object.freeze({
  mid: 24 * 60 * 60 * 1000,
  high: 3 * 24 * 60 * 60 * 1000,
});

/**
 * Scale guard for the learner model's 0–1 inputs. The cognitive state and
 * learner_concept_state are 0–1; a 0–100 percentage reaching here by mistake
 * (the legacy knowledge_confidence / UI scale) is converted, not clamped to 1.
 * Anything else non-numeric → null (no evidence), never a guess.
 */
export function unitInterval(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return null;
}

/** The teaching-turn fallback: the action for an observed dialogue move. */
export function defaultTeachingAction({ dialogueMove, actionForDialogueMove = ACTION_FOR_DIALOGUE_MOVE } = {}) {
  return (actionForDialogueMove && actionForDialogueMove[dialogueMove]) || "DIG_DEEPER";
}

/**
 * The learner-model rules (formerly decideNextAction). Inputs, all optional:
 *   understanding      0–1 (cognitive state) — or conceptState.mastery when absent
 *   confusion          0–1
 *   misconceptionActive  boolean — the central learner_concept_state flag
 *   lastReviewedAt     ms epoch of the last review of this topic/concept
 *   hasHistory         false when the learner model has nothing on this topic
 *   now                ms epoch (required for the spacing rule; no clock reads)
 */
function learnerModelAction({ understanding, confusion, misconceptionActive, lastReviewedAt, hasHistory, now }) {
  const u = understanding ?? 0;
  const c = confusion ?? 0;
  if (misconceptionActive) return { action: "CLEAR_MISTAKE", reason: "misconception_active" };
  if (!hasHistory || u < 0.35) return { action: "DIG_DEEPER", reason: hasHistory ? "low_understanding" : "no_history" };
  if (c > 0.55) return { action: "USE_ANALOGY", reason: "high_confusion" };
  if (u < 0.55) return { action: "ONE_MORE_PUSH", reason: "developing" };
  if (u < 0.72) return { action: "NEXT_SUBTOPIC", reason: "secure_enough" };
  if (u < 0.82) return { action: "NAME_IT", reason: "nearly_secure" };
  if (u > 0.88) {
    const elapsed = Number(now ?? 0) - Number(lastReviewedAt || 0);
    const interval = u > 0.92 ? REVIEW_SPACING_MS.high : REVIEW_SPACING_MS.mid;
    if (elapsed > interval) return { action: "SPACED_REVIEW", reason: "review_due" };
    return u > 0.94 ? { action: "TRIGGER_RECALL", reason: "strong" } : { action: "GAP_CLOSED", reason: "secure" };
  }
  return { action: "NEXT_SUBTOPIC", reason: "secure_enough" };
}

/**
 * The one next-action decision path.
 *
 * Teaching turn: { dialogueMove, actionForDialogueMove? }
 * Learner model: { cognitive?: {understanding, confusion}, conceptState?: {mastery,
 *                  misconception_active, last_evidence_at}, misconceptionActive?,
 *                  lastReviewedAt?, hasHistory?, now }
 */
export function recommendNextAction(input = {}) {
  if (Object.hasOwn(input, "dialogueMove")) {
    return {
      action: defaultTeachingAction(input),
      reason: `dialogue_move:${input.dialogueMove ?? "none"}`,
      source: "teaching_evidence",
    };
  }
  const cs = input.conceptState || null;
  const understanding = unitInterval(input.cognitive?.understanding) ?? unitInterval(cs?.mastery);
  const confusion = unitInterval(input.cognitive?.confusion);
  const misconceptionActive = Boolean(input.misconceptionActive ?? cs?.misconception_active);
  const lastReviewedAt = input.lastReviewedAt ?? (cs?.last_evidence_at ? Date.parse(cs.last_evidence_at) : null);
  const hasHistory = input.hasHistory ?? Boolean(cs || input.cognitive);
  const { action, reason } = learnerModelAction({
    understanding, confusion, misconceptionActive, lastReviewedAt, hasHistory, now: input.now,
  });
  return { action, reason, source: "learner_model" };
}
