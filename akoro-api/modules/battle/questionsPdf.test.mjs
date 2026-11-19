// node --test modules/battle/questionsPdf.test.mjs — a finished battle's questions as a PDF.
import "../../test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

const { questionRows, buildQuestionsPdf } = await import("./questionsPdf.js");

const rows = [
  { question_order: 2, question_text: "What gas do plants give off?", options_json: JSON.stringify(["Oxygen", "Nitrogen", "Helium", "Argon"]), correct_answer_index: 0, explanation: "A by-product of photosynthesis.", topic: "Products" },
  { question_order: 1, question_text: "Ẹ̀kọ́: where does photosynthesis happen?", options_json: JSON.stringify(["Roots", "Chloroplasts", "Stem", "Flowers"]), correct_answer_index: 1, topic: null },
];

test("questionRows: in order, options parsed, the answer kept", () => {
  const r = questionRows(rows);
  assert.deepEqual(r.map((q) => q.order), [1, 2]);
  assert.equal(r[0].options[r[0].correct], "Chloroplasts");
  assert.equal(r[1].explanation, "A by-product of photosynthesis.");
  assert.deepEqual(questionRows([{ question_order: 1, question_text: "x", options_json: "not json" }])[0].options, []);
});

test("buildQuestionsPdf: a real PDF, titled, Yoruba letters and all", async () => {
  const bytes = await buildQuestionsPdf({ battle: { title: "Class review: Photosynthesis", subject: "Basic Science", topic: "Photosynthesis", actual_end: "2026-10-24T10:00:00Z" }, questions: rows });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(), "Class review: Photosynthesis — questions");
  assert.ok(doc.getPageCount() >= 1);
});

test("the route: finished battles only, sent as an attachment", () => {
  const src = readFileSync(new URL("./routes.js", import.meta.url), "utf8")
    + readFileSync(new URL("./service-battle.js", import.meta.url), "utf8");
  assert.match(src, /router\.get\("\/battles\/:battleId\/questions\.pdf"/);
  assert.match(src, /if \(battle\.status !== "completed"\) return res\.status\(409\)/);
  assert.match(src, /Content-Disposition", `attachment; filename=/);
});
