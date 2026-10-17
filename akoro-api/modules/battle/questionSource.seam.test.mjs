// Seam tests for battle question sourcing over the in-memory fake db
// (MIGRATION_MATRIX §7). `generate` (LLM) is never reached: buildQuestions is
// only driven with source "bank".
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const { perQuestionSeconds, fromPastPapers, fromCourseBank, buildQuestions } = await import("./questionSource.js");

function fakeFor(t, seed = {}, options = {}) {
  const fake = installFakeDb(db, seed, options);
  t.after(() => fake.restore());
  return fake;
}

const correctText = (q) => q.options[q.correctIndex].text;

// ── perQuestionSeconds ──────────────────────────────────────────────────────

test("perQuestionSeconds: shares the duration across questions, floored to whole seconds", () => {
  assert.equal(perQuestionSeconds(900, 15), 60);
  assert.equal(perQuestionSeconds(100, 3), 33);
  assert.equal(perQuestionSeconds("600", "10"), 60, "numeric strings");
});

test("perQuestionSeconds: clamps to 8..180", () => {
  assert.equal(perQuestionSeconds(30, 15), 8);
  assert.equal(perQuestionSeconds(3600, 2), 180);
});

test("perQuestionSeconds: falls back to 15s when there is nothing to divide", () => {
  for (const [total, count] of [[null, 10], [0, 10], [-60, 10], [600, 0], [600, -1], ["abc", 5], [600, NaN], [Infinity, 5], [undefined, undefined]]) {
    assert.equal(perQuestionSeconds(total, count), 15, `${total}/${count}`);
  }
});

// ── fromPastPapers ──────────────────────────────────────────────────────────

const pq = (over = {}) => ({
  type: "mcq", verified: true, subject: "Mathematics", difficulty: "medium", topic: "Algebra",
  stem: `What is ${Math.random()}?`, options: ["A. one", "B. two", "C. three", "D. four"], answer: "B",
  past_papers: { exam_slug: "waec", year: 2019 }, ...over,
});

test("fromPastPapers: only verified MCQs with an answer for the subject (case-insensitive)", async (t) => {
  const fake = fakeFor(t, { "edu.past_questions": [
    pq({ stem: "Keep me" }),
    pq({ stem: "Unverified", verified: false }),
    pq({ stem: "Theory", type: "theory" }),
    pq({ stem: "No answer", answer: null }),
    pq({ stem: "Other subject", subject: "Biology" }),
    pq({ stem: "Lower case subject", subject: "mathematics" }),
  ] });
  const out = await fromPastPapers({ subject: "MATHEMATICS", difficulty: "intermediate", limit: 10 });
  assert.deepEqual(out.map((q) => q.stem).sort(), ["Keep me", "Lower case subject"]);
  assert.ok(fake.calls.every((c) => c.table === "edu.past_questions" && c.op === "select"), "read only");
});

test("fromPastPapers: normalised shape — letter labels, prefixes stripped, answer letter → index, exam tag", async (t) => {
  fakeFor(t, { "edu.past_questions": [pq({ stem: "2+2?", options: ["A) three", "B. four", "C five", "D. five"], answer: "b", topic: null })] });
  const [q] = await fromPastPapers({ subject: "Mathematics", difficulty: "medium", limit: 5 });
  assert.deepEqual(q.options, [
    { label: "A", text: "three" }, { label: "B", text: "four" }, { label: "C", text: "C five" }, { label: "D", text: "five" },
  ]);
  assert.equal(q.correctIndex, 1);
  assert.equal(correctText(q), "four");
  assert.equal(q.topic, "Mathematics", "falls back to the subject when the row has no topic");
  assert.equal(q.exam, "WAEC");
  assert.equal(q.year, 2019);
  assert.equal(q.xp, 35);
});

test("fromPastPapers: answers given as option text resolve; object options keep their labels", async (t) => {
  fakeFor(t, { "edu.past_questions": [
    pq({ stem: "Capital?", options: ["Lagos", "Abuja", "Kano"], answer: "abuja" }),
    pq({ stem: "Obj?", options: [{ label: "a", text: " x " }, { label: "b", text: "y" }], answer: "B" }),
  ] });
  const out = await fromPastPapers({ subject: "Mathematics", difficulty: "medium", limit: 5 });
  const capital = out.find((q) => q.stem === "Capital?");
  assert.equal(correctText(capital), "Abuja");
  const obj = out.find((q) => q.stem === "Obj?");
  assert.deepEqual(obj.options, [{ label: "A", text: "x" }, { label: "B", text: "y" }]);
  assert.equal(correctText(obj), "y");
});

test("fromPastPapers: questions whose answer matches no option, < 2 options, or no stem are dropped", async (t) => {
  fakeFor(t, { "edu.past_questions": [
    pq({ stem: "Bad key", answer: "E" }),
    pq({ stem: "One option", options: ["A. only"], answer: "A" }),
    pq({ stem: "   ", answer: "A" }),
    pq({ stem: "Good" }),
  ] });
  const out = await fromPastPapers({ subject: "Mathematics", difficulty: "medium", limit: 5 });
  assert.deepEqual(out.map((q) => q.stem), ["Good"]);
});

test("fromPastPapers: prefers the wanted difficulty ('intermediate' means medium), dedupes stems, honours limit", async (t) => {
  const fake = fakeFor(t, { "edu.past_questions": [
    pq({ stem: "Easy 1", difficulty: "easy" }),
    pq({ stem: "Hard 1", difficulty: "hard" }),
    pq({ stem: "Medium 1", difficulty: "medium" }),
    pq({ stem: "medium   1!", difficulty: "medium" }), // same stem after normalising
    pq({ stem: "Medium 2", difficulty: "medium" }),
  ] });
  const out = await fromPastPapers({ subject: "Mathematics", difficulty: "intermediate", limit: 3 });
  assert.deepEqual(out.map((q) => q.stem), ["Medium 1", "Medium 2", "Easy 1"]);
  assert.equal((await fromPastPapers({ subject: "Mathematics", difficulty: "hard", limit: 1 }))[0].stem, "Hard 1");
  assert.ok(fake.calls.length >= 2);
});

test("fromPastPapers: no past_papers link → no exam tag; a db error → []", async (t) => {
  const fake = fakeFor(t, { "edu.past_questions": [pq({ past_papers: null })] });
  const [q] = await fromPastPapers({ subject: "Mathematics", difficulty: "medium", limit: 1 });
  assert.equal(q.exam, undefined);
  fake.failNext("edu.past_questions", "select", { message: "down" });
  assert.deepEqual(await fromPastPapers({ subject: "Mathematics", difficulty: "medium", limit: 1 }), []);
});

// ── fromCourseBank ──────────────────────────────────────────────────────────

const COURSE = randomUUID();
const bank = (over = {}) => ({
  id: randomUUID(), course_id: COURSE, is_active: true, topic: "Fractions", subject: "Maths", difficulty: "intermediate",
  question_text: "Half of 4?", options_json: JSON.stringify(["1", "2", "3", "4"]), correct_answer_index: 1, xp_value: 50, ...over,
});

test("fromCourseBank: exact course/topic/subject/difficulty matches, options_json parsed, index kept, xp carried", async (t) => {
  fakeFor(t, { question_bank: [
    bank({ question_text: "Exact" }),
    bank({ question_text: "Inactive", is_active: false }),
    bank({ question_text: "Other course", course_id: randomUUID() }),
  ] });
  const out = await fromCourseBank({ courseId: COURSE, topic: "Fractions", subject: "Maths", difficulty: "intermediate", limit: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].stem, "Exact");
  assert.equal(correctText(out[0]), "2");
  assert.equal(out[0].xp, 50);
  assert.equal(out[0].topic, "Fractions");
});

test("fromCourseBank: tops up from the rest of the course's active bank when the exact match is thin", async (t) => {
  const fake = fakeFor(t, { question_bank: [
    bank({ question_text: "Other difficulty", difficulty: "hard", options_json: ["a", "b"], correct_answer_index: 0 }),
    bank({ question_text: "Other topic", topic: "Decimals" }),
    bank({ question_text: "Inactive", is_active: false, difficulty: "hard" }),
    bank({ question_text: "Exact" }),
  ] });
  const out = await fromCourseBank({ courseId: COURSE, topic: "Fractions", subject: null, difficulty: null, limit: 3 });
  assert.equal(out[0].stem, "Exact", "exact matches first; difficulty defaults to intermediate");
  assert.deepEqual(out.slice(1).map((q) => q.stem), ["Other difficulty", "Other topic"]);
  assert.equal(fake.calls.filter((c) => c.table === "question_bank").length, 2);
});

test("fromCourseBank: unparsable options or an out-of-range index drop the question", async (t) => {
  fakeFor(t, { question_bank: [
    bank({ question_text: "Broken json", options_json: "{not json" }),
    bank({ question_text: "Out of range", correct_answer_index: 7 }),
    bank({ question_text: "Fine" }),
  ] });
  const out = await fromCourseBank({ courseId: COURSE, topic: "Fractions", subject: "Maths", difficulty: "intermediate", limit: 3 });
  assert.deepEqual(out.map((q) => q.stem), ["Fine"]);
});

test("fromCourseBank: a blank option must not shift the answer key onto the wrong option", async (t) => {
  fakeFor(t, { question_bank: [
    bank({ question_text: "Capital of Nigeria?", options_json: JSON.stringify(["Lagos", "", "Abuja", "Kano"]), correct_answer_index: 2 }),
  ] });
  const out = await fromCourseBank({ courseId: COURSE, topic: "Fractions", subject: "Maths", difficulty: "intermediate", limit: 1 });
  // Either drop the question or keep the key on "Abuja" — never mark "Kano" correct.
  if (out.length) assert.equal(correctText(out[0]), "Abuja");
});

// ── buildQuestions (bank only — no model) ──────────────────────────────────

test("buildQuestions 'bank': places past-paper questions as battle_questions rows paced by the duration", async (t) => {
  const battleId = randomUUID();
  const fake = fakeFor(t, { "edu.past_questions": [
    pq({ stem: "Q1", answer: "A" }), pq({ stem: "Q2", answer: "C", past_papers: null }), pq({ stem: "Q3", answer: "D" }),
  ] });
  const out = await buildQuestions({ battleId, source: "bank", total: 5, subject: "Mathematics", durationSeconds: 300 });
  assert.deepEqual(out, { placed: 3, fromBank: 3, generated: 0, charged: 0, secondsPerQuestion: 100 });
  const rows = fake.rows("battle_questions");
  assert.deepEqual(rows.map((r) => r.question_order), [1, 2, 3]);
  assert.ok(rows.every((r) => r.battle_id === battleId && r.time_limit_seconds === 100 && r.xp_value === 35));
  assert.deepEqual(JSON.parse(rows[0].options_json), ["A. one", "B. two", "C. three", "D. four"]);
  assert.deepEqual(rows.map((r) => r.correct_answer_index), [0, 2, 3]);
  assert.equal(rows[0].past_exam, "WAEC");
  assert.equal(rows[0].past_year, 2019);
  assert.ok(!("past_exam" in rows[1]), "no exam tag without a paper link");
  assert.ok(!fake.calls.some((c) => c.table === "edu.curriculum_topics"), "generate's grounding was never reached");
});

test("buildQuestions 'bank': uses the course bank when a course is given; trims to total", async (t) => {
  const fake = fakeFor(t, { question_bank: [bank({ question_text: "C1" }), bank({ question_text: "C2" }), bank({ question_text: "C3" })] });
  const out = await buildQuestions({ battleId: "b1", source: "bank", total: 2, subject: "Maths", topic: "Fractions", courseId: COURSE });
  assert.equal(out.placed, 2);
  assert.equal(out.secondsPerQuestion, 15, "no duration → 15s");
  assert.equal(fake.rows("battle_questions").length, 2);
  assert.ok(!fake.calls.some((c) => c.table === "edu.past_questions"));
});

test("buildQuestions 'bank': an empty archive inserts nothing", async (t) => {
  const fake = fakeFor(t, { "edu.past_questions": [] });
  const out = await buildQuestions({ battleId: "b2", source: "bank", total: 10, subject: "Physics", durationSeconds: 600 });
  assert.deepEqual(out, { placed: 0, fromBank: 0, generated: 0, charged: 0, secondsPerQuestion: 15 });
  assert.equal(fake.calls.filter((c) => c.op === "insert").length, 0);
});
