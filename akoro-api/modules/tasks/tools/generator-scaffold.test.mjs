import assert from "node:assert/strict";
import test from "node:test";
import { assembleWorksheetQuestions, assembleLessonPlan } from "./generator-scaffold.js";

test("worksheet: sequential n, lettered options, type coercion, drops empty", () => {
  const out = assembleWorksheetQuestions([
    { type: "mcq", question: "Capital of France?", options: ["Paris", "Rome"], answer: "Paris" },
    { question: "Explain osmosis" },
    { question: "  " },
    { type: "true_false", question: "Water is wet.", answer: "True" },
  ]);
  assert.deepEqual(out.map((q) => q.n), [1, 2, 3]);
  assert.equal(out[0].type, "mcq");
  assert.deepEqual(out[0].options, ["A. Paris", "B. Rome"]);
  assert.equal(out[1].type, "short");
  assert.equal("options" in out[1], false);
  assert.deepEqual(out[2].options, ["A. True", "B. False"]);
});

test("worksheet: an mcq with <2 options becomes short", () => {
  const out = assembleWorksheetQuestions([{ type: "mcq", question: "q", options: ["only"] }]);
  assert.equal(out[0].type, "short");
});

test("lesson plan: request owns subject/class/duration; canonical phases when absent", () => {
  const plan = assembleLessonPlan({ title: "Photosynthesis", phases: [] }, { subject: "Biology", yearGroup: "SS2", durationMins: 40 });
  assert.equal(plan.subject, "Biology");
  assert.equal(plan.yearGroup, "SS2");
  assert.equal(plan.durationMins, 40);
  assert.deepEqual(plan.phases.map((p) => p.name), ["Starter", "Main", "Plenary"]);
  assert.equal(plan.phases.reduce((n, p) => n + p.minutes, 0), 40);
});

test("lesson plan: overrides a wrong echoed duration; coerces phase minutes", () => {
  const plan = assembleLessonPlan({ durationMins: 999, phases: [{ name: "Starter", minutes: "5", activity: "hook" }] }, { subject: "X", yearGroup: "Y", durationMins: 40 });
  assert.equal(plan.durationMins, 40);
  assert.equal(plan.phases[0].minutes, 5);
});
