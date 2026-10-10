import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const { validateMarks, numberComments, buildMarkedPdf, MARKUP_LIMITS } = await import("./submissionMarkup.js");
const { scoreMcqs, rubricRows, buildAiGradeMessages, shapeAiGrade, runAiGrade, aiGradeSchema } = await import("./aiGrade.js");
const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../../migrations/2026-submission-markup.sql", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../../migrations/manifest.json", import.meta.url), "utf8"));

test("marks are validated: types, pages, positions clamped to the page, empty comments and click-sized boxes dropped", () => {
  const { marks } = validateMarks([
    { id: "a", page: 1, type: "tick", x: 0.5, y: 0.2 },
    { page: 2, type: "cross", x: 1.4, y: -0.2 },
    { page: 1, type: "comment", x: 0.1, y: 0.1, text: "  Good point  " },
    { page: 1, type: "comment", x: 0.1, y: 0.1, text: "   " },
    { page: 1, type: "highlight", x: 0.1, y: 0.3, w: 0.5, h: 0.04 },
    { page: 1, type: "highlight", x: 0.1, y: 0.3, w: 0.0001, h: 0.04 },
  ]);
  assert.deepEqual(marks.map((m) => m.type), ["tick", "cross", "comment", "highlight"]);
  assert.deepEqual([marks[1].x, marks[1].y, marks[1].id], [1, 0, "m2"]);
  assert.equal(marks[2].text, "Good point");
  assert.match(validateMarks([{ page: 1, type: "smiley", x: 0, y: 0 }]).error, /type/);
  assert.match(validateMarks([{ page: 0, type: "tick", x: 0, y: 0 }]).error, /page/);
  assert.match(validateMarks("nope").error, /list/);
  assert.match(validateMarks(Array(MARKUP_LIMITS.MAX_MARKS + 1).fill({ page: 1, type: "tick", x: 0, y: 0 })).error, /At most/);
});

test("comments are numbered in reading order", () => {
  const n = numberComments([
    { type: "comment", page: 2, x: 0, y: 0.1, text: "c" },
    { type: "comment", page: 1, x: 0, y: 0.9, text: "b" },
    { type: "tick", page: 1, x: 0, y: 0 },
    { type: "comment", page: 1, x: 0, y: 0.2, text: "a" },
  ]);
  assert.deepEqual(n.map((c) => [c.text, c.n]), [["a", 1], ["b", 2], ["c", 3]]);
});

test("the marked copy: grade page first, the marks drawn, the comments listed at the end", async () => {
  const src = await PDFDocument.create(); const f = await src.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) src.addPage([595, 842]).drawText(`Page ${i + 1}`, { x: 50, y: 760, size: 14, font: f });
  const bytes = await buildMarkedPdf({
    submissionPdf: await src.save(),
    marks: [
      { type: "tick", page: 1, x: 0.8, y: 0.1 }, { type: "cross", page: 2, x: 0.8, y: 0.1 },
      { type: "highlight", page: 1, x: 0.08, y: 0.08, w: 0.3, h: 0.03 },
      { type: "comment", page: 1, x: 0.5, y: 0.5, text: "Show your working here — Ẹ ṣé!" },
    ],
    grade: { score: 78, rubric: [{ name: "Accuracy", max: 4, level: 3 }], feedback: "Good effort.", gradedAt: "2026-10-10T10:00:00Z" },
    title: "Photosynthesis", learner: "Adéwálé",
  });
  const out = await PDFDocument.load(bytes);
  assert.equal(out.getPageCount(), 4);   // grade page + 2 + comments
  const empty = await PDFDocument.load(await buildMarkedPdf({ submissionPdf: await src.save(), grade: { score: 50 } }));
  assert.equal(empty.getPageCount(), 3); // no comments → no comments page
});

const assignment = {
  title: "Plants", subject: "Biology",
  details: {
    questions: [
      { q: "Pigment?", options: ["Haemoglobin", "Chlorophyll"], correct: 1, max_points: 2 },
      { q: "Why are leaves thin?", max_points: 4, answer: "Short diffusion distance." },
      { q: "Pick one", options: ["a", "b"], correct: 0 },
    ],
    rubric: [{ criterion: "Accuracy", points: 4 }, { criterion: "Clarity", points: 3 }, { criterion: "", points: 2 }],
  },
};

test("MCQs are scored exactly from the key — typed answers (or an older option index)", () => {
  assert.deepEqual(scoreMcqs(assignment.details.questions, { 0: "b", 2: 1 }), [
    { index: 0, awarded: 2, max: 2, auto: true, why: "Correct." },
    { index: 2, awarded: 0, max: 5, auto: true, why: "Chose B; the answer is A." },
  ]);
  assert.equal(scoreMcqs(assignment.details.questions, {})[0].why, "No answer.");
  assert.deepEqual(rubricRows(assignment.details), [{ name: "Accuracy", max: 4 }, { name: "Clarity", max: 3 }]);
});

test("the model sees only what it marks: open questions (with any model answer), the rubric, the work and photos", () => {
  const [sys, user] = buildAiGradeMessages({ assignment, markdown: "# Plants\nMy answers", images: [{ mime: "image/png", bytes: Buffer.from("png") }] });
  assert.match(sys.content, /Q2 \(index 1, max 4\): Why are leaves thin\?\n  Model answer: Short diffusion distance\./);
  assert.doesNotMatch(sys.content, /Pigment\?/);                    // auto-scored MCQs aren't sent
  assert.match(sys.content, /- Accuracy \(max 4\)\n- Clarity \(max 3\)/);
  assert.match(sys.content, /teacher reviews and approves/);
  assert.equal(user.content[0].text, "The submission:\n\n# Plants\nMy answers");
  assert.equal(user.content[1].image_url.url, `data:image/png;base64,${Buffer.from("png").toString("base64")}`);
  assert.equal(aiGradeSchema().additionalProperties, false);
});

test("the draft: model marks clamped, unknown criteria ignored, the score from question points", () => {
  const d = shapeAiGrade({
    assignment, submission: { answers: { 0: 1, 2: 1 } },
    json: {
      questions: [{ index: 1, awarded: 3.7, why: "Mentions diffusion." }, { index: 0, awarded: 0, why: "ignored — auto" }],
      rubric: [{ criterion: "accuracy", level: 9, why: "Strong." }, { criterion: "Made up", level: 2, why: "x" }],
      feedback: "Nice work.",
    },
  });
  assert.deepEqual(d.questions.map((q) => [q.index, q.awarded, q.max, !!q.auto]), [[0, 2, 2, true], [1, 3.5, 4, false], [2, 0, 5, true]]);
  assert.equal(d.score, Math.round((5.5 / 11) * 100));
  assert.deepEqual(d.rubric, [{ name: "Accuracy", max: 4, level: 4, why: "Strong." }, { name: "Clarity", max: 3, level: null, why: "" }]);
  assert.equal(d.feedback, "Nice work.");
});

test("runAiGrade: making → ready; a failure lands as failed and never throws", async () => {
  const saves = [];
  const deps = {
    save: async (id, ai) => saves.push(ai.status),
    load: async () => ({ assignment, submission: { answers: { 0: 1 } }, markdown: "x", images: [] }),
    chat: async () => JSON.stringify({ questions: [{ index: 1, awarded: 4, why: "ok" }], rubric: [], feedback: "f" }),
  };
  const draft = await runAiGrade("t1", deps);
  assert.deepEqual(saves, ["making", "ready"]);
  assert.equal(draft.questions.find((q) => q.index === 1).awarded, 4);
  saves.length = 0;
  assert.equal(await runAiGrade("t1", { ...deps, chat: async () => { const e = new Error("x"); e.name = "InsufficientCoins"; throw e; } }), null);
  assert.deepEqual(saves, ["making", "failed"]);
});

test("routes: marks saved by the owner, the marked copy on publish, AI drafts after submit when switched on", () => {
  assert.match(routes, /router\.put\("\/:id\/targets\/:studentId\/markup", requireRole\(TEACHER_ROLES\)/);
  assert.match(routes, /router\.post\("\/:id\/targets\/:studentId\/ai-grade", requireRole\(TEACHER_ROLES\)/);
  assert.match(routes, /if \(target\.submission\?\.submittedAt\) buildMarkedCopyLater\(target\.id\);/);
  assert.match(routes, /if \(isLearner && full\?\.grade == null\) return res\.status\(409\)/);       // learners only after grading
  assert.match(routes, /brief\?\.details\?\.ai_auto_grade \? aiGradeTarget\(target\.id\) : null/);
  assert.match(routes, /feedbackRubric: t\.grade != null/);
  assert.doesNotMatch(routes.slice(routes.indexOf('router.get("/mine"'), routes.indexOf('router.get("/:id/analytics"')), /ai_grade|markup/);   // never to the learner
  assert.match(migration, /ADD COLUMN IF NOT EXISTS markup\s+JSONB/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS ai_grade\s+JSONB/);
  assert.ok(manifest.schema.includes("2026-submission-markup.sql"));
});
