import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const { paperSchema, revisionSchema, paperResponseFormat, answerSpaceFor, submissionDocument } = await import("./paperSchema.js");
const { normalizePaper, applyRevision, draftPaper, revisePaper } = await import("./questionPaper.js");
const { cropDrawing, isDrawingName } = await import("./submissionFiles.js");
const { aiGradeSchema, shapeAiGrade } = await import("./aiGrade.js");

const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");

/** OpenAI strict mode: every object closed, every property required. */
function assertStrict(node, path = "$") {
  if (!node || typeof node !== "object") return;
  const types = [].concat(node.type || []);
  if (types.includes("object")) {
    assert.equal(node.additionalProperties, false, `${path} must be closed`);
    assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path} must require every property`);
    for (const [k, v] of Object.entries(node.properties)) assertStrict(v, `${path}.${k}`);
  }
  if (node.items) assertStrict(node.items, `${path}[]`);
}

test("the paper and revision schemas are valid strict structured output", () => {
  assertStrict(paperSchema());
  assertStrict(revisionSchema());
  assertStrict(aiGradeSchema());
  const f = paperResponseFormat();
  assert.equal(f.type, "json_schema");
  assert.equal(f.json_schema.strict, true);
  const q = paperSchema().properties.questions.items.properties;
  for (const k of ["answer_space", "marking", "answer", "section", "passage", "label_answers"]) assert.ok(q[k], k);
});

const NULLS = Object.fromEntries(Object.keys(paperSchema().properties.questions.items.properties).map((k) => [k, null]));
const sq = (fields) => ({ ...NULLS, ...fields });

test("a strict reply (nulls for unused fields) → the stored question shape, with answer space and marking", () => {
  const paper = normalizePaper({
    instructions: "Answer all questions.",
    sections: [{ title: "Part A – Equations", instructions: "Show your working." }, { title: "Part B – Case Study", instructions: "" }],
    passages: [{ title: "Finding the number of notebooks bought", text: "A student bought some notebooks for ₦150 each." }],
    questions: [
      sq({ text: "Solve for x: 3x + 5 = 20.", type: "Calculation", answer_space: "working", max_points: 2, answer: "x = 5", marking: "3x = 20 − 5 (1 mark); x = 5 (1 mark)", section: 0 }),
      sq({ text: "Which is the solution to 2x − 4 = 10?", type: "MCQ", answer_space: "options", options: ["x = 3", "x = 7", "x = 5", "x = 6"], correct: 1, max_points: 1, marking: "B – x = 7", section: 0 }),
      sq({ text: "The place value of 7 in 4,072 is ____.", type: "Fill in the gap", answer_space: "blank", answer: "tens", marking: "Tens", section: 0 }),
      sq({ text: "Write an equation and find how many notebooks she bought.", type: "Case study", format: "case_study", answer_space: "options", section: 1, passage: 0, max_points: 3 }),
      sq({ text: "Name the labelled parts.", type: "Labelling", format: "label", labels: ["P", "Q"], label_answers: [{ label: "P", answer: "Nucleus" }, { label: "Q", answer: "Cell wall" }], answer_space: "labels", figure_note: "A plant cell" }),
    ],
  }, { options: 4 });
  const [w, m, b, c, l] = paper.questions;
  assert.deepEqual(w, { q: "Solve for x: 3x + 5 = 20.", type: "Calculation", max_points: 2, difficulty: "", cognitive_level: "", answer: "x = 5", section: 0,
    answer_space: "working", marking: "3x = 20 − 5 (1 mark); x = 5 (1 mark)" });
  assert.equal(m.answer_space, "options");
  assert.equal(m.correct, 1);
  assert.equal(b.answer_space, "blank");
  assert.equal(c.answer_space, undefined, "options on an open question don't fit — dropped (answerSpaceFor decides)");
  assert.equal(c.passage, 0);
  assert.deepEqual(l.answer, { P: "Nucleus", Q: "Cell wall" });
  assert.equal(l.answer_space, "labels");
  assert.equal(paper.sections.length, 2);
  assert.ok(!("options" in w) && !("figure" in w), "nulls are not stored");
});

test("a strict revision reply: { from } with nulls copies; a changed question keeps what it didn't restate", () => {
  const base = { instructions: "x", questions: [
    { q: "Q one", type: "MCQ", options: ["a", "b", "c", "d"], correct: 2, max_points: 1, answer_space: "options", marking: "C" },
    { q: "Q two", type: "Theory", max_points: 4, answer_space: "lines" },
  ] };
  const R = Object.fromEntries(Object.keys(revisionSchema().properties.questions.items.properties).map((k) => [k, null]));
  const { paper, changes } = applyRevision(base, { note: "Q2 harder", passages: null, questions: [
    { ...R, from: 0 },
    { ...R, from: 1, changed: true, text: "Q two, harder", max_points: 6, marking: "Three points, 2 marks each" },
  ] });
  assert.deepEqual(paper.questions[0], base.questions[0]);
  assert.equal(paper.questions[1].q, "Q two, harder");
  assert.equal(paper.questions[1].max_points, 6);
  assert.equal(paper.questions[1].marking, "Three points, 2 marks each");
  assert.deepEqual(changes, { 1: "changed" });
});

test("draft and revision calls carry the strict schema to the model", async () => {
  const seen = [];
  const reply = { instructions: "Answer all.", sections: null, passages: null, questions: [sq({ text: "One", type: "Theory", answer_space: "lines" })] };
  await draftPaper({ chat: async (_m, opts) => { seen.push(opts?.response_format?.json_schema?.name); return JSON.stringify(reply); }, topic: "t", subject: "s", request: "1 theory question" });
  await revisePaper({ chat: async (_m, opts) => { seen.push(opts?.response_format?.json_schema?.name); return JSON.stringify({ note: "", passages: null, questions: [{ from: 0 }] }); },
    topic: "t", subject: "s", request: "keep it", base: { questions: [{ q: "One", type: "Theory" }] } });
  assert.deepEqual(seen, ["assignment_paper", "assignment_revision"]);
});

test("answer space: its own when set, else from the question's kind", () => {
  assert.equal(answerSpaceFor({ q: "x", options: ["a", "b"] }), "options");
  assert.equal(answerSpaceFor({ q: "x", format: "true_false", options: ["True", "False"] }), "true_false");
  assert.equal(answerSpaceFor({ q: "x", format: "label", labels: ["P"] }), "labels");
  assert.equal(answerSpaceFor({ q: "x", type: "Fill in the gap" }), "blank");
  assert.equal(answerSpaceFor({ q: "x", type: "Calculation" }), "working");
  assert.equal(answerSpaceFor({ q: "x", type: "Theory" }), "lines");
  assert.equal(answerSpaceFor({ q: "x", type: "Theory", answer_space: "working" }), "working");
});

// The reference submission (Equations — Assignment, Amara JSS1-2).
const EQUATIONS = {
  title: "Equations — Assignment", subject: "Mathematics", topic: "Equations", due_at: null,
  details: {
    instructions: "Answer all questions.",
    sections: [{ title: "Part A – Equations", instructions: "" }, { title: "Part B – Case Study", instructions: "" }],
    passages: [{ title: "Finding the number of notebooks bought", text: "A student bought some notebooks for ₦150 each. She bought x notebooks and spent ₦1,200 in total." }],
    questions: [
      { q: "Solve for x: 3x + 5 = 20.", type: "Calculation", max_points: 2, section: 0 },
      { q: "Which of the following is the solution to the equation 2x − 4 = 10?", type: "MCQ", options: ["x = 3", "x = 7", "x = 5", "x = 6"], correct: 1, max_points: 1, section: 0 },
      { q: "If 5x = 35, what is the value of x?", type: "Calculation", max_points: 1, section: 0 },
      { q: "Solve for y: 4y − 7 = 9.", type: "Calculation", max_points: 2, section: 0 },
      { q: "Which equation represents the statement: “Seven more than twice a number is 15”?", type: "MCQ", options: ["2x + 7 = 15", "7x + 2 = 15", "2x − 7 = 15", "7 + x = 15"], correct: 0, max_points: 1, section: 0 },
      { q: "Solve the equation: 3(x − 2) = 9.", type: "Calculation", max_points: 2, section: 0 },
      { q: "Write an equation to represent this situation and find how many notebooks she bought.", type: "Case study", format: "case_study", max_points: 3, section: 1, passage: 0 },
      { q: "If the student had ₦300 more and bought 2 more notebooks, write an equation and find the total.", type: "Case study", format: "case_study", max_points: 4, section: 1, passage: 0 },
    ],
  },
};
const drawings = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `f${i}`, name: `drawing-q${i + 1}.png`, mime: "image/png", kind: "image", question: i }));
const SUBMITTED = { submission: { submittedAt: "2026-10-12T22:14:00Z", answers: { 1: "B", 4: "A" }, files: drawings } };

test("the submission document follows the template: numbering, parts, summary, answers under questions", () => {
  const doc = submissionDocument({ assignment: EQUATIONS, target: SUBMITTED, learner: { name: "Amara", className: "JSS1-2", username: "demo_stu_jss12" }, files: drawings });
  assert.equal(doc.header.badge, "LEARNER SUBMISSION");
  assert.equal(doc.totalPoints, 16);
  assert.deepEqual(doc.summary, { answered: 6, total: 8, unanswered: [7, 8], attachments: { drawings: 6, files: 0 } });
  const [a, b] = doc.parts;
  assert.equal(a.title, "Part A – Equations");
  assert.equal(a.note, "Questions 1–6 · 9 points");
  assert.deepEqual(a.questions.map((q) => q.number), [1, 2, 3, 4, 5, 6], "numbered 1..n, never 0 or repeated");
  assert.equal(b.note, "Questions 7–8 · 7 points");
  assert.deepEqual(b.passages, [{ index: 0, title: "Finding the number of notebooks bought", text: EQUATIONS.details.passages[0].text, questions: "Questions 7–8" }]);
  assert.deepEqual(b.questions.map((q) => q.number), [7, 8]);
  const q2 = a.questions[1];
  assert.equal(q2.answer.selected, "B");
  assert.equal(q2.answer.text, null, "a bare letter is the choice, not text");
  assert.deepEqual(q2.options.map((o) => o.selected), [false, true, false, false]);
  assert.deepEqual(q2.answer.drawings.map((d) => d.name), ["drawing-q2.png"]);
  assert.equal(a.questions[0].answerSpace, "working");
  assert.equal(b.questions[0].status, "unanswered");
  assert.deepEqual(q2.marks, { max: 1, awarded: null, comment: null });
  assert.equal(doc.feedback.score, null);
  assert.ok(!JSON.stringify(doc).includes('"correct"'), "no answer key in the document");
});

test("published marks fill the marks boxes and the total", () => {
  const doc = submissionDocument({ assignment: EQUATIONS, target: { ...SUBMITTED, grade: 56, feedback: { text: "Good working.", questions: [{ index: 0, awarded: 2 }, { index: 1, awarded: 1, comment: "Right." }] } } });
  assert.equal(doc.parts[0].questions[1].marks.comment, "Right.");
  assert.equal(doc.feedback.score, 3);
  assert.equal(doc.feedback.text, "Good working.");
});

test("a paper without parts is one part; files without a question are listed separately", () => {
  const doc = submissionDocument({ assignment: { title: "T", details: { questions: [{ q: "A", type: "Theory" }] } },
    target: { submission: { answers: { 0: "Because." }, files: [{ id: "x", name: "notes.pdf", question: null }] } } });
  assert.equal(doc.parts.length, 1);
  assert.equal(doc.parts[0].title, null);
  assert.equal(doc.parts[0].questions[0].answer.text, "Because.");
  assert.deepEqual(doc.files.map((f) => f.name), ["notes.pdf"]);
  assert.equal(doc.parts[0].questions[0].answer.files.length, 0);
});

test("a whiteboard drawing is cropped to the handwriting", async () => {
  const c = createCanvas(900, 1200);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, 900, 1200);
  ctx.strokeStyle = "#1E1B4B"; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(200, 300); ctx.lineTo(500, 420); ctx.stroke();
  const cropped = await loadImage(await cropDrawing(c.toBuffer("image/png")));
  assert.ok(cropped.width > 300 && cropped.width < 360, `width ${cropped.width}`);
  assert.ok(cropped.height > 120 && cropped.height < 180, `height ${cropped.height}`);
  // Blank board, or bytes that aren't an image: unchanged.
  const blank = createCanvas(300, 200); blank.getContext("2d").fillStyle = "#fff"; blank.getContext("2d").fillRect(0, 0, 300, 200);
  const blankPng = blank.toBuffer("image/png");
  assert.equal(await cropDrawing(blankPng), blankPng);
  const junk = Buffer.from("not a png");
  assert.equal(await cropDrawing(junk), junk);
  assert.ok(isDrawingName("drawing-q3.png") && !isDrawingName("photo.png"));
});

test("upload crops only whiteboard drawings; the paper data has its own route", () => {
  assert.match(routes, /if \(sniffed\.format === "png" && isDrawingName\(clean\)\) bytes = await cropDrawing\(bytes\);/);
  assert.match(routes, /submission\\\.json\$\/i/);
});

test("the AI grade reads the learner's answer (handwriting transcribed) for the paper", () => {
  const d = shapeAiGrade({ assignment: { details: { questions: [{ q: "Solve 3x + 5 = 20", max_points: 2 }] } }, submission: { answers: {} },
    json: { questions: [{ index: 0, read: "3x = 15\nx = 5", awarded: 2, why: "Correct steps." }], rubric: [], feedback: "f" } });
  assert.equal(d.questions[0].read, "3x = 15\nx = 5");
});
