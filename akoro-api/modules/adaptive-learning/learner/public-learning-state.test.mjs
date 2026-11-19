import assert from "node:assert/strict";
import test from "node:test";

import { createPublicLearningState } from "./public-learning-state.js";

test("public learning state gives an application-focused response context without scores", () => {
  const state = createPublicLearningState({
    currentConcept: "Michaelis–Menten kinetics",
    masteryStatus: "developing",
    dialogue: { move: "apply_in_context", canAdvance: false, allConceptsVerified: false },
  });

  assert.deepEqual(state, {
    currentIdea: "Michaelis–Menten kinetics",
    learningState: "Building evidence",
    nextLearningMove: "Apply the idea in context",
    whyThisResponse: "it asks you to apply the idea, rather than assuming the explanation is complete.",
    advancementEligible: false,
  });
  assert.equal("confidence" in state, false);
  assert.equal("score" in state, false);
});

test("public learning state describes a verified idea without exposing internal phase labels", () => {
  const state = createPublicLearningState({
    currentConcept: "Enzyme inhibition",
    masteryStatus: "verified",
    dialogue: { move: "consolidate_and_advance", canAdvance: true, allConceptsVerified: false },
  });

  assert.equal(state.learningState, "This idea is ready to connect");
  assert.equal(state.nextLearningMove, "Connect this idea to the next one");
  assert.equal(state.advancementEligible, true);
  assert.equal(JSON.stringify(state).includes("PHASE_"), false);
});

test("public learning state bounds concept copy and safely defaults missing state", () => {
  const state = createPublicLearningState({
    currentConcept: `  ${"A".repeat(200)}  `,
    dialogue: { move: "repair_misconception" },
  });

  assert.equal(state.currentIdea.length, 160);
  assert.equal(state.learningState, "Let's refine one detail");
  assert.equal(state.nextLearningMove, "Refine one important detail");
});
