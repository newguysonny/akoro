/**
 * modules/tasks/tools/quiz-scaffold.js — Lever 4 of the token-cost plan
 * (akoro-token-cost-optimization…md): the fixed structure of a quiz is a SCRIPT,
 * only the content is the model's job.
 *
 * Before, the model was asked to emit the whole shape — ids, question numbers,
 * marks, option letters — every call, and to regenerate it correctly. That is
 * boilerplate output tokens and a chance to get the shape wrong (a duplicate id,
 * a missing mark). This assembles that fixed scaffold in code from the model's
 * content rows, so the model writes only question/options/answer/explanation and
 * the shape is guaranteed identical on every run.
 *
 * PURE: no clock, no db, no randomness except the injected idFactory (defaults
 * to a random UUID, which is the intended per-question id).
 */
import { randomUUID } from "node:crypto";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const stripPrefix = (s) => String(s ?? "").replace(/^[A-F][.)]\s*/i, "").trim();
const normDifficulty = (d) => (DIFFICULTIES.has(String(d || "").toLowerCase()) ? String(d).toLowerCase() : "medium");

/**
 * assembleQuiz(rows, { marksPerQuestion, format, idFactory }) → fixed-shape questions.
 *   • id        — new UUID when absent (no duplicates from the model)
 *   • n         — sequential 1..N
 *   • type      — derived from the requested format + presence of options
 *   • options   — normalised and lettered "A. …", "B. …" (mcq only)
 *   • marks     — marksPerQuestion, always (the model never sets it)
 * Rows without a question are dropped rather than emitted empty.
 */
export function assembleQuiz(rows, { marksPerQuestion = 2, format = "mcq", idFactory = randomUUID } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const marks = Number.isFinite(Number(marksPerQuestion)) ? Number(marksPerQuestion) : 2;
  const out = [];

  for (const r of list) {
    const question = String(r?.question ?? r?.stem ?? r?.prompt ?? "").trim();
    if (!question) continue;

    let options = Array.isArray(r?.options) ? r.options.map(stripPrefix).filter(Boolean) : [];
    const rawType = String(r?.type ?? "").toLowerCase();

    let type;
    if (format === "mcq") type = "mcq";
    else if (format === "short_answer") type = "short_answer";
    else if (rawType === "true_false") type = "true_false";
    else type = options.length ? "mcq" : "short_answer";

    if (type === "true_false") options = ["True", "False"];
    // An MCQ with fewer than two options can't be graded — never emit one.
    if (type === "mcq" && options.length < 2) type = "short_answer";

    const item = { id: typeof r?.id === "string" && r.id ? r.id : idFactory(), n: out.length + 1, type, question };
    if (type === "mcq" || type === "true_false") {
      options = options.slice(0, LETTERS.length).map((o, i) => `${LETTERS[i]}. ${o}`);
      item.options = options;
    }
    item.answer = String(r?.answer ?? "").trim();
    item.explanation = String(r?.explanation ?? "").trim();
    item.difficulty = normDifficulty(r?.difficulty);
    item.marks = marks;
    out.push(item);
  }
  return out;
}
