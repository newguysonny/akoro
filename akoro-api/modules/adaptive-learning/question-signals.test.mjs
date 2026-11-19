// §7.15.1 question signals (Phase 4a): tags, time to answer and confusion
// pairs from Agent Checks and proctored practice, through one recorder; read
// back by learner-model.js readQuestionSignals.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const qs = await import("./question-signals.js");
const { readQuestionSignals } = await import("./learner/learner-model.js");
const { makePracticeRun } = await import("./practice/service.js");

const C = "22222222-2222-4222-8222-222222222222";

test("tags: the question's own when valid, else derived from its text", () => {
  assert.deepEqual(qs.deriveQuestionTags({ text: "What is evaporation?", options: ["A. x", "B. y"] }), { skill: "recall", format: "mcq", tagSource: "derived" });
  assert.equal(qs.deriveQuestionTags({ text: "Calculate 12 + 4 litres" }).format, "calculation");
  assert.equal(qs.deriveQuestionTags({ text: "Calculate 12 + 4 litres" }).skill, "apply");
  assert.equal(qs.deriveQuestionTags({ text: "Predict what would happen to a puddle in the sun" }).skill, "transfer");
  assert.equal(qs.deriveQuestionTags({ text: "Label the diagram" }).format, "diagram");
  assert.deepEqual(qs.deriveQuestionTags({ text: "x", skill: "transfer", format: "short" }), { skill: "transfer", format: "short", tagSource: "question" });
  assert.equal(qs.deriveQuestionTags({ text: "x", skill: "guessing" }).skill, "recall", "an off-list tag is never stored");
});

test("Agent Check: a wrong answer from the notes is a confusion pair; a guess or a right answer is not", () => {
  const battle = { topic: "Evaporation" };
  const questions = [
    { id: "q1", question_text: "Which process loses water through leaves?", options_json: JSON.stringify(["A. Evaporation", "B. Transpiration"]), correct_answer_index: 1, time_limit_seconds: 15, topic: "Transpiration" },
    { id: "q2", question_text: "What is evaporation?", options_json: JSON.stringify(["A. Liquid to gas", "B. Gas to liquid"]), correct_answer_index: 0, time_limit_seconds: 15, topic: "Evaporation" },
    { id: "q3", question_text: "Boiling point of water?", options_json: "[\"A. 100\", \"B. 50\"]", correct_answer_index: 0, time_limit_seconds: 15 },
    { id: "q4", question_text: "Unanswered?", options_json: "[]", correct_answer_index: 0 },
  ];
  const answers = [
    { question_id: "q1", selected_index: 0, is_correct: false, answer_basis: "notes", response_time_ms: 4200 },
    { question_id: "q2", selected_index: 0, is_correct: true, answer_basis: "notes", response_time_ms: 2100 },
    { question_id: "q3", selected_index: 1, is_correct: false, answer_basis: "unknown", response_time_ms: 9000 },
  ];
  const signals = qs.checkQuestionSignals({ battle, questions, answers });
  assert.deepEqual(signals.map((s) => s.outcome), ["wrong", "correct", "guessed", "unanswered"]);
  const rows = signals.map((s) => qs.questionSignalRow({ learnerId: "u", source: "agent_check", sessionRef: "check:b1", topic: "Evaporation" }, s));
  assert.deepEqual([rows[0].confused_with, rows[0].confusion_concept, rows[0].correct_option, rows[0].time_to_answer_ms, rows[0].time_budget_s], ["Evaporation", "Transpiration", "Transpiration", 4200, 15]);
  assert.equal(rows[1].confused_with, null);
  assert.equal(rows[2].confused_with, null, "a guess is not a judged error");
  assert.equal(rows[3].time_to_answer_ms, null);
  assert.equal(qs.questionSignalRow({ learnerId: "u", source: "battle", sessionRef: "x" }, signals[0]), null, "unknown source");
});

test("proctored records → signals: free text, judged score, time to first answer", () => {
  const s = qs.proctoredQuestionSignals([{ qIndex: 0, objective: "Explain osmosis", judged: 80, answerMs: 30_000 }, { qIndex: 1, objective: "Diffusion", judged: 20 }, { qIndex: 2, judged: null }]);
  assert.deepEqual(s.map((x) => [x.questionRef, x.outcome, x.score, x.format]), [["q1", "correct", 0.8, "short"], ["q2", "wrong", 0.2, "short"], ["q3", "unanswered", null, "short"]]);
  assert.equal(s[0].timeToAnswerMs, 30_000);
});

test("recordQuestionSignals writes one row per question, refuses junk, never throws; readQuestionSignals summarises", async (t) => {
  const fake = installFakeDb(db, { "edu.concept_catalog": [{ id: C, status: "approved", subject: "Basic Science", topic_key: "evaporation", title: "Evaporation" }] });
  t.after(() => fake.restore());
  assert.equal((await qs.recordQuestionSignals({ learnerId: "u", source: "chat", sessionRef: "x", questions: [] })).reason, "unknown_source");
  assert.equal((await qs.recordQuestionSignals({ learnerId: null })).reason, "no_learner");
  const questions = [
    { questionRef: "q1", text: "Which loses water through leaves?", options: ["A. Evaporation", "B. Transpiration"], outcome: "wrong", chosenOption: "A. Evaporation", correctOption: "B. Transpiration", concept: "Transpiration", timeToAnswerMs: 4000 },
    { questionRef: "q2", text: "What is evaporation?", options: ["A. a", "B. b"], outcome: "correct", timeToAnswerMs: 2000 },
  ];
  const r = await qs.recordQuestionSignals({ learnerId: "u", source: "agent_check", sessionRef: "check:b1", subject: "Basic Science", topic: "Evaporation", questions });
  assert.deepEqual([r.recorded, r.conceptId], [2, C]);
  await qs.recordQuestionSignals({ learnerId: "u", source: "agent_check", sessionRef: "check:b1", subject: "Basic Science", topic: "Evaporation", questions });
  assert.equal(fake.rows("edu.learning_question_signals").length, 2, "idempotent per learner + session + question");
  const read = await readQuestionSignals({ learnerId: "u", topic: "evaporation" });
  assert.equal(read.questions, 2);
  assert.equal(read.bySkill.recall.correctShare, 0.5);
  assert.equal(read.byFormat.mcq.medianMs, 3000);
  assert.deepEqual(read.confusions, [{ concept: "Transpiration", confusedWith: "Evaporation", count: 1 }]);
  assert.equal((await readQuestionSignals({ learnerId: "someone-else" })).questions, 0);
  fake.failNext("edu.learning_question_signals", "upsert", { message: "down" });
  assert.equal((await qs.recordQuestionSignals({ learnerId: "u", source: "proctored", sessionRef: "practice:1", questions })).reason, "write_failed");
});

test("proctored practice: signals recorded for a clean finished run only", async () => {
  const calls = [];
  const engine = {
    create: async () => ({ instance: { id: "w1" } }), appendEvent: async () => {}, emitOutcome: async () => {},
    get: async () => ({ id: "w1", state: "in_progress" }), transition: async (id, { to }) => ({ id, state: to }),
  };
  const run = makePracticeRun({ engine, signals: async (a) => { calls.push(a); return { recorded: 1 }; } });
  const records = [{ qIndex: 0, objective: "Osmosis", judged: 90, answerMs: 1000 }];
  await run.finish("w1", { learnerId: "u", topic: "Osmosis", subject: "Biology", summary: { assessmentScore: 90, verdict: "pass", cheatProbability: 0, records } });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].source, calls[0].sessionRef, calls[0].records], ["proctored", "practice:w1", records]);
  await run.finish("w1", { learnerId: "u", topic: "Osmosis", subject: "Biology", summary: { assessmentScore: 90, verdict: "flagged", cheatProbability: 0.9, records } });
  assert.equal(calls.length, 1, "a flagged run records nothing");
});

test("wiring: the battle worker records check signals; the proctor times first answers; the table is migrated", async () => {
  const read = (f) => readFile(new URL(f, import.meta.url), "utf8");
  const [worker, proctor, sql, manifest] = await Promise.all([read("../battle/worker.js"), read("./agents/sargeant/proctor.js"), read("../../migrations/2026-learning-question-signals.sql"), read("../../migrations/manifest.json")]);
  assert.match(worker, /recordCheckQuestionSignals\(battleId\)/);
  assert.match(proctor, /rec\.answerMs = Math\.max\(0, Date\.now\(\) - this\.askedAt\)/);
  assert.match(sql, /UNIQUE \(learner_id, session_ref, question_ref\)/);
  assert.match(sql, /CREATE OR REPLACE VIEW edu\.learning_confusion_pairs/);
  assert.ok(JSON.parse(manifest).schema.includes("2026-learning-question-signals.sql"));
});
