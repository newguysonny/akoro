import assert from "node:assert/strict";
import test from "node:test";

test("speed: a typed answer is never copied back by the model — `read` comes from the learner's own text", async () => {
  const { shapeAiGrade, buildAiGradeMessages } = await import("./aiGrade.js");
  const assignment = { title: "Photosynthesis", details: { questions: [{ q: "What do plants make?", max_points: 4 }, { q: "Draw a leaf", max_points: 2 }] } };
  const submission = { answers: { 0: "Glucose and oxygen." }, files: [{ question: 1 }] };
  const shaped = shapeAiGrade({ assignment, submission, json: { questions: [{ index: 0, read: "", awarded: 3, why: "names both" }, { index: 1, read: "a leaf outline", awarded: 1, why: "partly" }], rubric: [], marking: [], feedback: "Good." } });
  const byIndex = new Map(shaped.questions.map((q) => [q.index, q]));
  assert.equal(byIndex.get(0).read, "Glucose and oxygen.", "typed: the learner's own text");
  assert.equal(byIndex.get(1).read, "a leaf outline", "a file answer: what the model transcribed");
  const sys = buildAiGradeMessages({ assignment, markdown: "x", answers: submission.answers, files: new Set([1]) })[0].content;
  assert.match(sys, /`read` is ONLY for an answer given as a photo, drawing or file/);
  assert.match(sys, /2-3 short sentences/);
});

test("question numbers: the model answers with the number it was shown; a 0-based index from an older draft still reads right", async () => {
  const { shapeAiGrade } = await import("./aiGrade.js");
  const assignment = { details: { questions: [{ q: "MCQ", options: ["a", "b"], correct: 0, max_points: 2 }, { q: "Q two", max_points: 3 }, { q: "Q three", max_points: 3 }] } };
  const submission = { answers: { 0: "A", 1: "good", 2: "" } };
  const byNumber = shapeAiGrade({ assignment, submission, json: { questions: [{ number: 2, read: "", awarded: 3, why: "right" }, { number: 3, read: "", awarded: 0, why: "blank" }], rubric: [], marking: [], feedback: "" } });
  const m = new Map(byNumber.questions.map((q) => [q.index, q.awarded]));
  assert.equal(m.get(1), 3, "Q2's mark lands on Q2");
  assert.equal(m.get(2), 0, "Q3's mark lands on Q3");
  const old = shapeAiGrade({ assignment, submission, json: { questions: [{ index: 1, awarded: 2, why: "x" }], rubric: [], marking: [], feedback: "" } });
  assert.equal(new Map(old.questions.map((q) => [q.index, q.awarded])).get(1), 2);
});
