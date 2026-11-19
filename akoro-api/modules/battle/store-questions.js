/**
 * battle/store-questions.js — the question tables: the course bank, the
 * questions a battle asks, the answers its agents gave, and the battle log.
 */
import db from "../../db.js";

const bank = () => db.from("question_bank");
const battleQuestions = () => db.from("battle_questions");
const answers = () => db.from("battle_answers");
const log = () => db.from("battle_log");

// ─── question bank ────────────────────────────────────────────────────────────

export const bankForAssignment = ({ courseId, topic, subject, difficulty, total }) => {
  let query = bank().select("*")
    .eq("course_id", courseId).eq("is_active", true).eq("difficulty", difficulty ?? "intermediate");
  if (topic)   query = query.eq("topic", topic);
  if (subject) query = query.eq("subject", subject);
  return query.limit(total);
};

export const bankFallback = ({ courseId, excludeIds, needed }) => {
  let q = bank().select("*").eq("course_id", courseId).eq("is_active", true);
  if (excludeIds.length) q = q.not("id", "in", `(${excludeIds.join(",")})`);
  return q.limit(needed);
};

export const recordQuestionUse = (qId) => db.rpc("increment_question_uses", { q_id: qId });

export const bankList = ({ courseId, topic, subject, difficulty }) => {
  let query = bank().select("*").eq("course_id", courseId).eq("is_active", true);
  if (topic)      query = query.eq("topic", topic);
  if (subject)    query = query.eq("subject", subject);
  if (difficulty) query = query.eq("difficulty", difficulty);
  return query.order("topic").order("created_at", { ascending: false });
};

export const insertBankQuestion = (payload) => bank().insert(payload).select().single();

export const insertBankQuestionRow = (payload) => bank().insert(payload);

export const updateBankQuestion = (questionId, userId, updates) =>
  bank().update(updates).eq("id", questionId).eq("created_by", userId);

export const retireBankQuestion = (questionId, userId) =>
  bank().update({ is_active: false }).eq("id", questionId).eq("created_by", userId);

// ─── battle questions ─────────────────────────────────────────────────────────

export const insertBattleQuestion = (payload) => battleQuestions().insert(payload);

export const countBattleQuestions = (battleId) =>
  battleQuestions().select("id", { count: "exact", head: true }).eq("battle_id", battleId);

export const battleQuestionIds = (battleIds) =>
  battleIds.length ? battleQuestions().select("battle_id").in("battle_id", battleIds) : { data: [] };

export const questionsForPdf = (battleId) =>
  battleQuestions().select("question_order, question_text, options_json, correct_answer_index, explanation, topic")
    .eq("battle_id", battleId).order("question_order");

export const allBattleQuestions = (battleId) =>
  battleQuestions().select("*").eq("battle_id", battleId).order("question_order");

export const questionReached = (battleId) =>
  log().select("question_order").eq("battle_id", battleId)
    .not("question_order", "is", null).order("question_order", { ascending: false }).limit(1);

// ─── answers ──────────────────────────────────────────────────────────────────

export const myAnswer = (participantId, questionId) =>
  answers().select("selected_index, is_correct, xp_gained")
    .eq("participant_id", participantId).eq("question_id", questionId).maybeSingle();

export const answersOfParticipant = (participantId) =>
  answers().select("*").eq("participant_id", participantId);

export const answerBattleIds = (battleIds) =>
  battleIds.length ? answers().select("battle_id").in("battle_id", battleIds) : { data: [] };

// ─── log ──────────────────────────────────────────────────────────────────────

export const battleLog = (battleId, since) => {
  let query = log().select("*").eq("battle_id", battleId).order("created_at");
  if (since) query = query.gt("created_at", since);
  return query;
};
