/**
 * battle/service-bank.js — a course's question bank: read it, add one, edit
 * or retire one, or generate a set with the platform's model. Ownership is
 * enforced by the route's requireBankOwner middleware; these handlers assume
 * the caller passed it.
 */
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";
import { questions } from "./store.js";

export async function listBankQuestions(req, res) {
  const { topic, subject, difficulty } = req.query;
  const { data } = await questions.bankList({ courseId: req.params.courseId, topic, subject, difficulty });
  res.json({ questions: (data ?? []).map((q) => ({ ...q, options: JSON.parse(q.options_json) })), total: data?.length ?? 0 });
}

export async function createBankQuestion(req, res) {
  const { question_text, options, correct_answer_index, topic, subject, difficulty, xp_value } = req.body;
  if (!question_text || !options?.length || correct_answer_index === undefined) return res.status(400).json({ error: "question_text, options, and correct_answer_index are required" });
  if (!Array.isArray(options) || options.length !== 4) return res.status(400).json({ error: "options must be an array of exactly 4 strings" });

  const { data, error } = await questions.insertBankQuestion({
    course_id: req.params.courseId, subject, topic, question_text,
    options_json: JSON.stringify(options), correct_answer_index,
    difficulty: difficulty ?? "intermediate", xp_value: xp_value ?? 35,
    created_by: req.user.id,
  });
  if (error) throw new Error(error.message);
  res.status(201).json({ success: true, question: data });
}

export async function updateBankQuestion(req, res) {
  const { question_text, options, correct_answer_index, topic, subject, difficulty, xp_value } = req.body;
  const updates = {};
  if (question_text !== undefined)       updates.question_text        = question_text;
  if (options !== undefined)             updates.options_json         = JSON.stringify(options);
  if (correct_answer_index !== undefined) updates.correct_answer_index = correct_answer_index;
  if (topic !== undefined)               updates.topic      = topic;
  if (subject !== undefined)             updates.subject    = subject;
  if (difficulty !== undefined)          updates.difficulty = difficulty;
  if (xp_value !== undefined)            updates.xp_value   = xp_value;

  await questions.updateBankQuestion(req.params.questionId, req.user.id, updates);
  res.json({ success: true });
}

export async function retireBankQuestion(req, res) {
  await questions.retireBankQuestion(req.params.questionId, req.user.id);
  res.json({ success: true });
}

// POST /api/courses/:courseId/questions-bank/generate  (AI generation via Anthropic)
export async function generateBankQuestions(req, res) {
  const { topic, subject, difficulty = "intermediate", count = 15 } = req.body;
  if (!topic || !subject) return res.status(400).json({ error: "topic and subject are required" });

  const message = await openai.chat.completions.create({
    model:      OPENAI_MODEL,
    max_tokens: 2000,
    messages:   [
      { role: "system", content: `You are an expert educator. Generate exactly ${count} multiple-choice questions about "${topic}" for ${subject} at ${difficulty} difficulty. Return ONLY valid JSON with no preamble or markdown. Format: { "questions": [{ "question_text": "...", "options": ["A","B","C","D"], "correct_answer_index": 0, "topic": "${topic}", "xp_value": 35 }] }` },
      { role: "user", content: `Generate ${count} ${difficulty} ${subject} questions about ${topic}.` },
    ],
  });

  const raw = (message.choices?.[0]?.message?.content ?? "").replace(/```json|```/g, "").trim();
  const { questions: generated } = JSON.parse(raw);

  let inserted = 0;
  for (const q of generated) {
    if (!q.question_text || !Array.isArray(q.options) || q.correct_answer_index === undefined) continue;
    await questions.insertBankQuestionRow({
      course_id: req.params.courseId, subject, topic, question_text: q.question_text,
      options_json: JSON.stringify(q.options), correct_answer_index: q.correct_answer_index,
      difficulty, xp_value: q.xp_value ?? 35, created_by: req.user.id, is_ai_generated: true,
    });
    inserted++;
  }

  res.status(201).json({ success: true, generated: inserted, topic, subject, difficulty });
}
