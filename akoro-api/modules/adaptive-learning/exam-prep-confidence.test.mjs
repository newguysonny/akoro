import test from "node:test";
import assert from "node:assert/strict";

import { normaliseExamConfidenceQuestions } from "./exam-prep-confidence-validation.js";

const deterministicId = (() => {
  let index = 0;
  return () => `question-${++index}`;
})();

test("exam-confidence questions retain answers only in a separate key before public shaping", () => {
  const questions = normaliseExamConfidenceQuestions({ questions: [
    { question: "Which organ pumps blood?", options: ["Lung", "Heart", "Liver", "Skin"], answerIndex: 1, objective: "Identify the heart", difficulty: "easy" },
    { question: "What carries oxygen?", options: ["Blood", "Bone", "Hair", "Nail"], answerIndex: 0, objective: "Identify blood", difficulty: "medium" },
    { question: "Which is part of circulation?", options: ["Artery", "Leaf", "Root", "Seed"], answerIndex: 0, objective: "Identify artery", difficulty: "hard" },
  ] }, 3, deterministicId);
  assert.equal(questions.length, 3);
  assert.equal(questions[0].answerIndex, 1);
  const publicQuestion = (({ answerIndex, ...rest }) => rest)(questions[0]);
  assert.equal("answerIndex" in publicQuestion, false);
  assert.equal(publicQuestion.options.length, 4);
});

test("exam-confidence question validation refuses theory/free-text grading and malformed MCQ answers", () => {
  assert.throws(() => normaliseExamConfidenceQuestions({ questions: [
    { question: "Explain circulation", options: [], answer: "Long answer" },
    { question: "Broken", options: ["A", "B", "C", "D"], answerIndex: 9 },
    { question: "Also broken", options: ["A", "B", "C"], answerIndex: 1 },
  ] }, 3, deterministicId), /invalid questions/);
});
