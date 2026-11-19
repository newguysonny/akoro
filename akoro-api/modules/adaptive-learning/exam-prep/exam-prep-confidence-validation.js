/** Pure validation helpers for learner-owned generated exam-style MCQ attempts. */

const text = (value, maximum) => String(value || "").replace(/[\r\n\x00]+/g, " ").trim().slice(0, maximum);

export function normaliseExamConfidenceQuestions(raw, expected, createId) {
  const candidates = Array.isArray(raw) ? raw : raw?.questions;
  if (!Array.isArray(candidates) || candidates.length < 3) throw new Error("Question generator returned too few usable questions");
  const questions = [];
  for (const item of candidates.slice(0, expected)) {
    const question = text(item?.question, 900);
    const options = Array.isArray(item?.options) ? item.options.slice(0, 4).map((option) => text(option, 320)).filter(Boolean) : [];
    const answerIndex = Number(item?.answerIndex);
    if (!question || options.length !== 4 || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) continue;
    questions.push({
      id: createId(), question, options, answerIndex,
      objective: text(item?.objective, 180) || "Current topic objective",
      difficulty: ["easy", "medium", "hard"].includes(String(item?.difficulty)) ? item.difficulty : "mixed",
    });
  }
  if (questions.length < 3) throw new Error("Question generator returned invalid questions");
  return questions;
}
