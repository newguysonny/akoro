// The teaching guide speaks in ideas (pills under the protégé's reply), never a message.
import assert from "node:assert/strict";
import test from "node:test";
import { guideIdeas, openingIdeas, shortConcept } from "./guideIdeas.js";
import { resultToTypedBlocks } from "./blocks.js";

test("guideIdeas: the model's suggestions, cleaned and capped at three", () => {
  const ideas = guideIdeas(['"Imagine a raisin in water overnight — what happens?"', "- Explain it back to me.", "Explain it back to me.", "x", "What if the water were salty?", "One more"], { concept: "osmosis" });
  assert.deepEqual(ideas, ["Imagine a raisin in water overnight — what happens?", "Explain it back to me.", "What if the water were salty?"]);
});

test("guideIdeas: none from the model → the guide's next move fills in", () => {
  const ideas = guideIdeas(null, { nextAction: "USE_ANALOGY", concept: "osmosis" });
  assert.ok(ideas.length >= 2 && ideas.length <= 3);
  assert.ok(ideas.some((s) => /osmosis/.test(s)));
  assert.ok(guideIdeas([], { nextAction: "NOPE" }).length >= 2, "an unknown move still gives ideas");
});

test("a turn's blocks: the protégé's reply carries the guide's ideas; no guide message", () => {
  const blocks = resultToTypedBlocks({ studentAgentResponse: "Is it when water moves?", guideMessage: "Nice — push for the membrane.",
    guideSuggestions: ["What does the membrane do?", "Picture a tea bag in water."], guideNextAction: "DIG_DEEPER",
    currentSubtopic: "osmosis", guideName: "NaNa Esumai", guideEmoji: "🧠" });
  assert.equal(blocks.filter((b) => b.type === "guide").length, 0, "the guide sends no message");
  const reply = blocks.find((b) => b.type === "student-agent");
  assert.deepEqual(reply.guide, { name: "NaNa Esumai", emoji: "🧠", ideas: ["What does the membrane do?", "Picture a tea bag in water."] });
});

test("openingIdeas: three starters about the current idea", () => {
  assert.equal(openingIdeas("photosynthesis").length, 3);
  assert.ok(openingIdeas("photosynthesis").every((s) => s.includes("photosynthesis")));
  assert.ok(openingIdeas("cells", { review: true })[0].includes("remember"));
});

test("shortConcept: an objective's label becomes a phrase", () => {
  assert.equal(shortConcept("What a plant is made of: cells, leaves, and chloroplasts"), "what a plant is made of");
  assert.equal(shortConcept("Osmosis"), "Osmosis");
  assert.equal(shortConcept(null), "");
});
