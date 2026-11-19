import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
const { normalise } = await import("./questionSource.js");
const { checkQuestionSignals, deriveQuestionTags } = await import("../adaptive-learning/assessment/question-signals.js");

const raw = { stem: "Which part of a leaf lets water vapour out?", options: [{ label: "A", text: "Stomata" }, { label: "B", text: "Xylem" }], answer: "A" };

test("the question source keeps its own skill and format tags; off-list values are dropped", () => {
  const q = normalise({ ...raw, skill: "Recall", format: "mcq" }, "Transpiration");
  assert.deepEqual([q.skill, q.format], ["recall", "mcq"]);
  const bad = normalise({ ...raw, skill: "memorise", format: "essay" }, "Transpiration");
  assert.equal(bad.skill, undefined);
  assert.equal(bad.format, undefined);
});

test("the Agent Check's signals carry the source tags (tag_source question), else derive them", () => {
  const [tagged] = checkQuestionSignals({ battle: { topic: "Transpiration" }, questions: [{ id: "q1", question_text: raw.stem, options_json: '["A. Stomata","B. Xylem"]', correct_answer_index: 0, skill: "transfer", format: "mcq" }], answers: [] });
  assert.deepEqual([tagged.skill, tagged.format], ["transfer", "mcq"]);
  assert.equal(deriveQuestionTags({ text: tagged.text, options: tagged.options, skill: tagged.skill, format: tagged.format }).tagSource, "question");
  assert.equal(deriveQuestionTags({ text: raw.stem, options: ["a", "b"] }).tagSource, "derived");
});

test("wiring: the generator asks for tags; rows and the Agent Check read them; the columns exist", async () => {
  const [src, check, sql] = await Promise.all([
    readFile(new URL("./questionSource.js", import.meta.url), "utf8"),
    readFile(new URL("./agentCheck.js", import.meta.url), "utf8"),
    readFile(new URL("../../migrations/2026-battle-question-tags.sql", import.meta.url), "utf8"),
  ]);
  assert.match(src, /"skill":"recall\|apply\|transfer"/);
  assert.match(src, /q\.skill \? \{ skill: q\.skill \}/);
  assert.match(check, /time_limit_seconds, skill, format"\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS skill text/);
});
