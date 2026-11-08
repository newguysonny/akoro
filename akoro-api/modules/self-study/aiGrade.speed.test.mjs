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
