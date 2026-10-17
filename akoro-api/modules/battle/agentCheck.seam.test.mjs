import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const { checkResults } = await import("./agentCheck.js");
const { minPlayersFor, isMarkSheet } = await import("./entry.js");

const q = (n, topic = "Cell Structure") => ({ id: `q${n}`, battle_id: "b1", question_order: n, question_text: `Question ${n}?`, topic, correct_answer_index: 0 });

test("checkResults: from a note right = correct; a guess (right or wrong) = guessed; no answer = unknown", async () => {
  const fake = installFakeDb(db, {
    battles: [{ id: "b1", battle_type: "check", topic: "Cell Structure", subject: "Biology", total_questions: 5, study_prep_topic_id: "t1", status: "completed" }],
    battle_questions: [q(1), q(2), q(3), q(4, "Cell wall"), q(5, "Mitochondria")],
    battle_participants: [{ id: "p1", battle_id: "b1", user_id: "learner-1", role: "participant" }],
    battle_answers: [
      { participant_id: "p1", question_id: "q1", is_correct: true, answer_basis: "recall", recalled_topic: "Cells" },
      { participant_id: "p1", question_id: "q2", is_correct: true, answer_basis: "unknown" },
      { participant_id: "p1", question_id: "q3", is_correct: false, answer_basis: "recall" },
      { participant_id: "p1", question_id: "q4", is_correct: false, answer_basis: "unknown" },
    ],
  });
  try {
    const r = await checkResults("b1");
    assert.deepEqual(r.perQuestion.map((p) => p.outcome), ["correct", "guessed", "wrong", "guessed", "unknown"]);
    assert.equal(r.correct, 1);
    assert.equal(r.score, 0.2, "a lucky guess is not demonstrated");
    assert.equal(r.studyPrepTopicId, "t1");
    assert.equal(r.learnerId, "learner-1");
    assert.equal(r.perQuestion[0].fromNote, "Cells");
    assert.ok(r.gaps.includes("Cell wall") && r.gaps.includes("Mitochondria"), "sub-topics name the gaps");
    assert.ok(r.gaps.includes("Question 2?"), "the battle's own topic falls back to the question");
  } finally { fake.restore(); }
});

test("checkResults ignores battles that are not Agent Checks", async () => {
  const fake = installFakeDb(db, { battles: [{ id: "b2", battle_type: "review" }] });
  try { assert.equal(await checkResults("b2"), null); } finally { fake.restore(); }
});

test("an Agent Check runs with its one agent and is a mark sheet", () => {
  assert.equal(minPlayersFor({ battle_type: "check" }), 1);
  assert.equal(isMarkSheet("check"), true);
  assert.equal(isMarkSheet("review"), true);
  assert.equal(isMarkSheet("1v1"), false);
});
