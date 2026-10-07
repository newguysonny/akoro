/**
 * Learner-facing state for adaptive teaching responses.
 *
 * This module deliberately translates server-owned evidence into short, useful
 * learning direction. It never exposes evaluator scores, hidden model rationale,
 * or a claim that the protege understands simply because it produced a reply.
 */

const MAX_COPY_LENGTH = 160;

const MOVE_COPY = Object.freeze({
  clarify_core: {
    next: "Explain the core idea in your own words",
    why: "it invites you to make the central relationship clearer.",
  },
  repair_misconception: {
    next: "Refine one important detail",
    why: "it focuses on one detail that will make the explanation more accurate.",
  },
  apply_in_context: {
    next: "Apply the idea in context",
    why: "it asks you to apply the idea, rather than assuming the explanation is complete.",
  },
  connect_and_explain: {
    next: "Connect the idea to what you already know",
    why: "it helps you connect this idea to the wider topic.",
  },
  stretch_transfer: {
    next: "Try a more challenging example",
    why: "it invites you to test the idea in a new, more challenging situation.",
  },
  consolidate_and_advance: {
    next: "Connect this idea to the next one",
    why: "it helps you link the explanation and example before moving on.",
  },
  synthesise: {
    next: "Bring the ideas together",
    why: "it helps you connect the key ideas into one explanation.",
  },
});

function safeCopy(value, fallback) {
  if (typeof value !== "string") return fallback;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, MAX_COPY_LENGTH) : fallback;
}

function learningStatus({ move, masteryStatus, canAdvance, allConceptsVerified }) {
  if (allConceptsVerified) return "Let's connect the whole topic";
  if (canAdvance || masteryStatus === "verified" || move === "consolidate_and_advance") {
    return "This idea is ready to connect";
  }
  if (move === "repair_misconception") return "Let's refine one detail";
  if (move === "stretch_transfer") return "Try it with an example";
  return "Building evidence";
}

/**
 * Shape a narrow, learner-safe response context from the authoritative workflow
 * result. `dialogue` must come from the server's evidence gate, not the browser.
 */
export function createPublicLearningState({
  currentConcept,
  dialogue = {},
  masteryStatus = "introduced",
} = {}) {
  const move = typeof dialogue?.move === "string" ? dialogue.move : "clarify_core";
  const copy = MOVE_COPY[move] || MOVE_COPY.clarify_core;
  const canAdvance = dialogue?.canAdvance === true || masteryStatus === "verified";

  return Object.freeze({
    currentIdea: safeCopy(currentConcept, "Current learning idea"),
    learningState: learningStatus({
      move,
      masteryStatus,
      canAdvance,
      allConceptsVerified: dialogue?.allConceptsVerified === true,
    }),
    nextLearningMove: copy.next,
    whyThisResponse: copy.why,
    advancementEligible: canAdvance,
  });
}
