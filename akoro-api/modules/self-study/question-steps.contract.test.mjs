import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const { cleanAnswer, cleanQuestionMarks, questionPoints } = await import("./submissionView.js");
const { buildMarkedPdf } = await import("./submissionMarkup.js");
const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../../migrations/manifest.json", import.meta.url), "utf8"));

const questions = [
  { q: "Pigment?", options: ["Haemoglobin", "Chlorophyll", "Keratin"], correct: 1, max_points: 2 },
  { q: "Why are leaves thin?", max_points: 4 },
  "Name a product.",
];

test("one answer at a time: every answer is typed text (an older option index still works), capped, empty clears", () => {
  assert.deepEqual(cleanAnswer(questions, "0", "B"), { index: 0, value: "B" });
  assert.deepEqual(cleanAnswer(questions, 0, 1), { index: 0, value: 1 });
  assert.match(cleanAnswer(questions, 0, 3).error, /No such option/);
  assert.deepEqual(cleanAnswer(questions, 1, "x".repeat(5000)).value.length, 4000);
  assert.deepEqual(cleanAnswer(questions, 2, 42), { index: 2, value: "42" });
  assert.deepEqual(cleanAnswer(questions, 1, "   "), { index: 1, value: null });
  assert.deepEqual(cleanAnswer(questions, 1, null), { index: 1, value: null });
  assert.match(cleanAnswer(questions, 3, "x").error, /No such question/);
  assert.match(cleanAnswer(questions, -1, "x").error, /No such question/);
  assert.match(cleanAnswer(questions, 1, { a: 1 }).error, /text/);
});

test("marked question by question: halves, clamped to the question's points, one row each, sorted", () => {
  const { marks } = cleanQuestionMarks(questions, [
    { index: 1, awarded: 3.7, comment: "  Good on diffusion. " },
    { index: 0, awarded: 9 },
    { index: 1, awarded: 1 },            // a duplicate row is ignored
    { index: 2, awarded: -1 },
    { index: 7, awarded: 1 },            // no such question
  ]);
  assert.deepEqual(marks, [
    { index: 0, awarded: 2, max: 2, comment: "" },
    { index: 1, awarded: 3.5, max: 4, comment: "Good on diffusion." },
    { index: 2, awarded: 0, max: 5, comment: "" },
  ]);
  assert.deepEqual(cleanQuestionMarks(questions, undefined), { marks: [] });
  assert.match(cleanQuestionMarks(questions, "x").error, /list/);
  assert.equal(questionPoints("plain"), null);
});

test("the marked copy's grade page lists each question's mark and comment", async () => {
  const src = await PDFDocument.create(); src.addPage([595, 842]);
  const bytes = await buildMarkedPdf({
    submissionPdf: await src.save(),
    grade: { score: 64, questions: [{ index: 0, awarded: 2, max: 2, comment: "", q: questions[0] }, { index: 1, awarded: 1.5, max: 4, comment: "Mention surface area.", q: questions[1] }] },
  });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
});

test("routes: answers are submitted per question, handed in from the review, marks published per question", () => {
  assert.match(routes, /router\.put\("\/:id\/draft\/:index", asyncHandler/);
  const draft = routes.slice(routes.indexOf('router.put("/:id/draft/:index"'), routes.indexOf('router.post("/:id/start"'));
  assert.match(draft, /target\.grade != null \|\| target\.status === "complete"\) return res\.status\(409\)/);   // closed once handed in
  assert.match(draft, /cleanAnswer\(assignment\?\.details\?\.questions/);
  assert.match(routes, /const merged = \{ \.\.\.\(target\.draft\?\.answers \|\| \{\}\), \.\.\.sent \};/);
  assert.match(routes, /const qm = cleanQuestionMarks\(assignment\.details\?\.questions \|\| \[\], feedback\.questions\);/);
  assert.match(routes, /feedbackQuestions: t\.grade != null/);
  assert.ok(manifest.schema.includes("2026-submission-steps.sql"));
});

test("typed answers: the API and both apps read an MCQ answer the same way", async () => {
  const { readChoice } = await import("./submissionView.js");
  const learner = await import("../../../akoro-learner/src/lib/paper.js");
  const instructor = await import("../../../akoro-instructor/src/lib/paper.js");
  const q = { options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"] };
  const tf = { format: "true_false", options: ["True", "False"] };
  const pq = { options: ["P", "Q", "R", "S"] };
  const cases = [
    [q, "B", 1], [q, "b.", 1], [q, "(B)", 1], [q, "Option B", 1], [q, "Answer: b", 1], [q, "B. Carbon dioxide", 1],
    [q, "B Carbon dioxide", 1], [q, "carbon dioxide", 1], [q, "Carbon Dioxide.", 1], [q, 2, 2], [q, 7, null],
    [q, "A plant needs water", null], [q, "E", null], [q, "", null], [q, "b) oxygen", null], [q, "Nitrogen gas", null],
    [q, "B. because plants breathe it in", 1], [tf, "true", 0], [tf, "F", 1], [tf, "no", 1], [tf, "B", 1],
    [pq, "R", 2], [pq, "C", 2], [{}, "B", null], [q, null, null],
  ];
  for (const [question, typed, want] of cases) {
    assert.equal(readChoice(question, typed), want, `API: ${JSON.stringify(typed)}`);
    assert.equal(learner.readChoice(question, typed), want, `learner: ${JSON.stringify(typed)}`);
    assert.equal(instructor.readChoice(question, typed), want, `instructor: ${JSON.stringify(typed)}`);
  }
  assert.equal(learner.isAnswered("", 1), true, "a file answers the question");
  assert.equal(learner.isAnswered("  ", 0), false);
  assert.equal(learner.answerLabel(q, 1), "B · Carbon dioxide");
  assert.equal(learner.answerLabel(q, "b"), "b");
});

test("the learner's Review step reads the same paper template as the handed-in copy (draft.html, mine only)", async () => {
  const { readFileSync } = await import("node:fs");
  const routes = readFileSync(new URL("./routes.js", import.meta.url), "utf8");
  assert.match(routes, /draft\\\.html\$\/i/);
  assert.match(routes, /seen\.target\.student_id !== req\.user\.id\) return denied/);
  assert.match(routes, /submissionPaperHtml\(seen\.target\.id, \{ embed: !!req\.query\.embed, draft: true \}\)/);
});
