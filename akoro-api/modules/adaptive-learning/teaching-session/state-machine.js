/**
 * teaching-session/state-machine.js — the PURE teaching-session state
 * machine, in the study-prep state-machine pattern: frozen phase tables and
 * one pure transition function, no I/O, directly unit-testable.
 *
 * The deterministic progression gate used to live inline in
 * teaching-workflow/tools.js (gate_teaching_progress). Neither the browser
 * nor NaNa's generated recommendation can bypass it — that property is
 * preserved exactly; only the location changed.
 */
import { ACTION_FOR_DIALOGUE_MOVE, recommendNextAction } from "../teaching/adaptive-engine.js";

/** Learner-facing phase labels (moved from agents/student/orchestrator.js). */
export const STUDENT_PHASES = Object.freeze({
  PHASE_1: "Phase 1 — What does Student Agent already know?",
  PHASE_2: "Phase 2 — Must-know parts",
  PHASE_3: "Phase 3 — Student Agent teaches it back",
  PHASE_4: "Phase 4 — Push a little further!",
  MASTERY: "Mastery",
});

/** The canonical teaching phases, in order. */
export const TEACHING_SESSION_PHASES = Object.freeze([
  "PHASE_1", "PHASE_2", "PHASE_3", "PHASE_4", "MASTERY",
]);

// What the guide does next for each observed dialogue move. The table and
// the decision now live in the Adaptive Learning Engine (Phase 10: one
// next-action path); re-exported so existing importers keep working.
export { ACTION_FOR_DIALOGUE_MOVE };

/**
 * The deterministic progression gate. Pure: given where the session is and
 * what the evidence observed, decide the next subtopic index, the next phase
 * and the guide's next action. Behaviour is identical to the former inline
 * gate, including its deliberate quirks:
 *
 *  • Subtopic advance requires canAdvance AND a next subtopic.
 *  • MASTERY requires canAdvance, NO next subtopic, and every concept
 *    verified — a missing evidence gate can never be talked past.
 *  • A guide-requested phase change applies only when the evidence allows
 *    advancement, and a request for a phase the session is already in (or
 *    MASTERY) changes nothing.
 *
 * @returns {{phase, mustKnowIndex, subtopicAdvanced, phaseChanged, enteredMastery,
 *            nextAction, nextMustKnowIndex}} the applied next state
 */
export function applyTeachingProgress({
  phase,
  mustKnowIndex,
  mustKnowCount,
  canAdvance,
  allConceptsVerified,
  requestedPhase,
  dialogueMove,
  actionForDialogueMove = ACTION_FOR_DIALOGUE_MOVE,
}) {
  const hasNextSubtopic = Number(mustKnowIndex) < Math.max(0, Number(mustKnowCount || 0) - 1);
  const mayAdvance = Boolean(canAdvance);

  let nextIndex = Number(mustKnowIndex) || 0;
  let subtopicAdvanced = false;
  let nextAction;
  if (mayAdvance && hasNextSubtopic) {
    nextIndex = (Number(mustKnowIndex) || 0) + 1;
    subtopicAdvanced = true;
    nextAction = "NEXT_SUBTOPIC";
  } else {
    nextAction = recommendNextAction({ dialogueMove, actionForDialogueMove }).action;
  }

  const mayEnterMastery = mayAdvance && !hasNextSubtopic && Boolean(allConceptsVerified);
  let nextPhase = phase;
  let phaseChanged = false;
  let enteredMastery = false;
  if (mayEnterMastery && phase !== "MASTERY") {
    nextPhase = "MASTERY";
    phaseChanged = true;
    enteredMastery = true;
    nextAction = "MASTERY";
  } else if (mayAdvance && requestedPhase && requestedPhase !== "MASTERY" && requestedPhase !== phase) {
    nextPhase = requestedPhase;
    phaseChanged = true;
  }

  return {
    phase: nextPhase,
    mustKnowIndex: nextIndex,
    subtopicAdvanced,
    phaseChanged,
    enteredMastery,
    nextAction,
    nextMustKnowIndex: nextIndex,
  };
}
