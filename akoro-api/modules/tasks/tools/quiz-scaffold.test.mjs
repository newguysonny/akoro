import assert from "node:assert/strict";
import test from "node:test";
import { assembleQuiz } from "./quiz-scaffold.js";

const counter = () => { let i = 0; return () => `id-${++i}`; };

test("assembles the fixed scaffold: ids, sequential n, marks, lettered options", () => {
  const out = assembleQuiz([
    { question: "2+2?", options: ["1", "2", "3", "4"], answer: "4", difficulty: "easy" },
    { question: "Explain gravity", answer: "...", difficulty: "hard" },
  ], { marksPerQuestion: 3, format: "mixed", idFactory: counter() });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((q) => q.n), [1, 2]);
  assert.deepEqual(out.map((q) => q.id), ["id-1", "id-2"]);
  assert.deepEqual(out.map((q) => q.marks), [3, 3]);
  assert.equal(out[0].type, "mcq");
  assert.deepEqual(out[0].options, ["A. 1", "B. 2", "C. 3", "D. 4"]);
  assert.equal(out[1].type, "short_answer");
  assert.equal("options" in out[1], false);
});

test("format drives type; true/false gets lettered True/False; an ungradable MCQ is demoted", () => {
  const mcq = assembleQuiz([{ question: "q", options: ["x", "y"], answer: "x" }], { format: "mcq", idFactory: () => "id" });
  assert.equal(mcq[0].type, "mcq");
  assert.deepEqual(mcq[0].options, ["A. x", "B. y"]);

  const sa = assembleQuiz([{ question: "q", options: ["x", "y"] }], { format: "short_answer", idFactory: () => "id" });
  assert.equal(sa[0].type, "short_answer");

  const tf = assembleQuiz([{ question: "q", type: "true_false", answer: "True" }], { format: "mixed", idFactory: () => "id" });
  assert.deepEqual(tf[0].options, ["A. True", "B. False"]);

  const one = assembleQuiz([{ question: "q", options: ["only"] }], { format: "mixed", idFactory: () => "id" });
  assert.equal(one[0].type, "short_answer", "an MCQ with <2 options can't be graded");
});

test("drops empty questions; difficulty defaults to medium", () => {
  const out = assembleQuiz([{ question: "  " }, { question: "kept", difficulty: "bogus" }], { idFactory: () => "id" });
  assert.equal(out.length, 1);
  assert.equal(out[0].difficulty, "medium");
});
