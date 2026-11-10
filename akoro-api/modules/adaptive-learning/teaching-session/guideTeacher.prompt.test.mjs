import assert from "node:assert/strict";
import test from "node:test";
import { guideTeachPrompt } from "./guideTeacherPrompt.js";

const base = { topic: "Cell theory", part: "2.1 Historical development", focusConcept: "cell theory", evidence: {}, history: [] };

test("an explanation is a structured teaching note, not prose", () => {
  const p = guideTeachPrompt({ ...base, move: "explain" });
  for (const bit of ["short structured note", "2–3 `###` sections", "**bold lead-in**", "**Bottom line:**", "about 200 words"]) {
    assert.ok(p.includes(bit), bit);
  }
  assert.doesNotMatch(p, /under 120 words/, "the long-answer move must not be capped at a paragraph");
  assert.match(p, /Never say you are an AI/);
});

test("an analogy is a structured note too", () => {
  const p = guideTeachPrompt({ ...base, move: "use_analogy" });
  assert.match(p, /short structured note/);
});

test("a one-question or one-line move stays short", () => {
  for (const move of ["ask_check_question", "ask_explain_back", "give_example", "correct_misconception", "summarise"]) {
    const p = guideTeachPrompt({ ...base, move });
    assert.match(p, /under 120 words/, move);
    assert.doesNotMatch(p, /short structured note/, move);
  }
});

test("the move, the reference and the recent turns still reach the model", () => {
  const p = guideTeachPrompt({ ...base, move: "explain", reference: { text: "Hooke named cells in 1665." }, history: [{ role: "human_teacher", content: "I think cells are boxes." }] });
  assert.match(p, /This reply, do exactly this:/);
  assert.match(p, /<reference_material>\nHooke named cells in 1665.\n<\/reference_material>/);
  assert.match(p, /Learner: I think cells are boxes\./);
});
