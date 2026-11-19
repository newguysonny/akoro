/**
 * adaptive-learning/question-signals.js — Phase 4a, §7.15.1: the per-question
 * signals struggle detection needs — question tags, time to answer, and
 * confusion pairs — recorded once per question from Agent Checks and the
 * proctored assessment, into ONE table (edu.learning_question_signals,
 * 2026-learning-question-signals.sql) through ONE recorder.
 *
 *   recordQuestionSignals({ learnerId, source, sessionRef, subject?, topic?,
 *                           conceptId?, questions: [QuestionSignal] })
 *     → { recorded: n } | { recorded: 0, reason }
 *   QuestionSignal = { questionRef, text?, options?, skill?, format?, timeBudgetS?,
 *                      timeToAnswerMs?, outcome, score?, chosenOption?, correctOption?,
 *                      concept? }
 *   deriveQuestionTags / questionSignalRow / checkQuestionSignals /
 *   proctoredQuestionSignals / summariseQuestionSignals      PURE
 *
 * Tags: `skill` (recall | apply | transfer) and `format` (mcq | short |
 * diagram | word_problem | calculation) come from the question when its source
 * set them (`tag_source: question`); otherwise they are derived from the
 * question text (`tag_source: derived`) — never anything else.
 * A confusion pair is a WRONG answer that chose a real option: the chosen
 * option's idea ↔ the concept the question tested. Agent Check answers are
 * the learner's agent answering from their notes (§7.15.1 note), so the pair
 * says what the learner taught; `source` keeps them apart from proctored ones.
 *
 * Idempotent per learner + session + question; never throws. Read nowhere yet
 * except learner-model.js readQuestionSignals.
 */
import db from "../../db.js";

export const QUESTION_SKILLS = Object.freeze(["recall", "apply", "transfer"]);
export const QUESTION_FORMATS = Object.freeze(["mcq", "short", "diagram", "word_problem", "calculation"]);
export const SIGNAL_SOURCES = Object.freeze(["agent_check", "proctored"]);
export const SIGNAL_OUTCOMES = Object.freeze(["correct", "wrong", "guessed", "unanswered"]);

const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t ? t.slice(0, n) : null; };
const int = (n, lo, hi) => (n == null || !Number.isFinite(Number(n)) ? null : Math.max(lo, Math.min(hi, Math.round(Number(n)))));
const unit = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Math.max(0, Math.min(1, Number(n))));
/** "B. Transpiration" → "Transpiration" (battle options carry their letter). */
export const optionText = (o) => clip(String(o ?? "").replace(/^\s*[A-Ha-h][.)]\s+/, ""), 160);

const CALC = /\b(calculate|how (?:many|much)|find the (?:value|area|volume|mass|speed)|solve|work out)\b|\d\s*[-+*/×÷=]\s*\d/i;
const WORD = /\b(if|suppose|a (?:farmer|trader|student|man|woman|boy|girl)|bought|sold|travels?)\b.*\?/i;
const DIAGRAM = /\b(diagram|figure|graph|label(?:led)? part|shown (?:above|below))\b/i;
const TRANSFER = /\b(new situation|predict|what would happen|which (?:of these )?would|why might|best explains?|in a different)\b/i;
const APPLY = /\b(apply|use|calculate|solve|example of|which (?:of the following )?is an example)\b/i;

/** PURE: the question's tags — its own when valid, else derived from its text. */
export function deriveQuestionTags({ text = "", options = [], skill = null, format = null } = {}) {
  const given = QUESTION_SKILLS.includes(skill) && QUESTION_FORMATS.includes(format);
  const t = String(text || "");
  const derivedFormat = DIAGRAM.test(t) ? "diagram"
    : CALC.test(t) ? "calculation"
      : WORD.test(t) ? "word_problem"
        : (options || []).length >= 2 ? "mcq" : "short";
  const derivedSkill = TRANSFER.test(t) ? "transfer" : (APPLY.test(t) || derivedFormat === "calculation" || derivedFormat === "word_problem") ? "apply" : "recall";
  return {
    skill: QUESTION_SKILLS.includes(skill) ? skill : derivedSkill,
    format: QUESTION_FORMATS.includes(format) ? format : derivedFormat,
    tagSource: given ? "question" : "derived",
  };
}

/** PURE: one table row for one question, or null when it cannot be recorded. */
export function questionSignalRow({ learnerId, source, sessionRef, subject = null, topic = null, conceptId = null }, q = {}) {
  const questionRef = clip(q.questionRef, 120);
  if (!learnerId || !SIGNAL_SOURCES.includes(source) || !clip(sessionRef, 180) || !questionRef || !SIGNAL_OUTCOMES.includes(q.outcome)) return null;
  const tags = deriveQuestionTags({ text: q.text, options: q.options, skill: q.skill, format: q.format });
  const chosen = optionText(q.chosenOption);
  const correct = optionText(q.correctOption);
  const concept = clip(q.concept || topic, 200);
  // A confusion pair: a wrong answer that picked a real, different option.
  const confused = q.outcome === "wrong" && chosen && chosen !== correct ? chosen : null;
  return {
    learner_id: learnerId, source, session_ref: clip(sessionRef, 180), question_ref: questionRef,
    concept_id: conceptId || null, subject: clip(subject, 120), topic_label: clip(topic, 200),
    skill: tags.skill, format: tags.format, tag_source: tags.tagSource,
    time_budget_s: int(q.timeBudgetS, 1, 3600), time_to_answer_ms: int(q.timeToAnswerMs, 0, 3_600_000),
    outcome: q.outcome, score: unit(q.score),
    chosen_option: chosen, correct_option: correct,
    confused_with: confused, confusion_concept: confused ? concept : null,
  };
}

/** PURE: an Agent Check's questions + one seat's answers → QuestionSignals. */
export function checkQuestionSignals({ battle = {}, questions = [], answers = [] }) {
  const byQ = new Map((answers || []).map((a) => [a.question_id, a]));
  return (questions || []).map((q) => {
    let options = [];
    try { options = Array.isArray(q.options) ? q.options : JSON.parse(q.options_json || "[]"); } catch { options = []; }
    const a = byQ.get(q.id);
    const outcome = !a ? "unanswered" : a.answer_basis === "unknown" ? "guessed" : a.is_correct ? "correct" : "wrong";
    return {
      questionRef: q.id, text: q.question_text, options, skill: q.skill || null, format: q.format || null,
      timeBudgetS: q.time_limit_seconds ?? null, timeToAnswerMs: a?.response_time_ms ?? null,
      outcome, score: outcome === "correct" ? 1 : 0,
      chosenOption: a && Number.isInteger(a.selected_index) ? options[a.selected_index] ?? null : null,
      correctOption: Number.isInteger(q.correct_answer_index) ? options[q.correct_answer_index] ?? null : null,
      concept: q.topic && q.topic !== battle.topic ? q.topic : battle.topic || null,
    };
  });
}

/** PURE: the proctored assessment's per-question records → QuestionSignals (free-text answers: no options). */
export function proctoredQuestionSignals(records = []) {
  return (records || []).filter(Boolean).map((r) => ({
    questionRef: `q${Number(r.qIndex) + 1}`, text: r.objective || "", format: "short", skill: null,
    timeToAnswerMs: r.answerMs ?? null,
    outcome: r.judged == null ? "unanswered" : r.judged >= 50 ? "correct" : "wrong",
    score: r.judged == null ? null : r.judged / 100,
    concept: r.objective || null,
  }));
}

export async function recordQuestionSignals({ learnerId, source, sessionRef, subject = null, topic = null, conceptId = null, questions = [] } = {}) {
  if (!learnerId) return { recorded: 0, reason: "no_learner" };
  if (!SIGNAL_SOURCES.includes(source)) return { recorded: 0, reason: "unknown_source" };
  if (!clip(sessionRef, 180)) return { recorded: 0, reason: "no_reference" };
  try {
    let concept = conceptId;
    if (!concept && topic) concept = await (await import("./learner/learning-events.js")).resolveConceptId({ subject, topic });
    const rows = (questions || []).slice(0, 60).map((q) => questionSignalRow({ learnerId, source, sessionRef, subject, topic, conceptId: concept }, q)).filter(Boolean);
    if (!rows.length) return { recorded: 0, reason: "no_questions" };
    const { error } = await db.schema("edu").from("learning_question_signals")
      .upsert(rows, { onConflict: "learner_id,session_ref,question_ref", ignoreDuplicates: true });
    if (error) {
      console.warn("[question-signals] not recorded:", error.message);
      return { recorded: 0, reason: "write_failed", detail: String(error.message || "").slice(0, 200) };
    }
    return { recorded: rows.length, conceptId: concept || null };
  } catch (e) {
    console.warn("[question-signals] failed:", e?.message || e);
    return { recorded: 0, reason: "error" };
  }
}

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * PURE: what the signals say — per skill and format: answered, correct share,
 * median time; the learner's confusion pairs (most frequent first).
 */
export function summariseQuestionSignals(rows = []) {
  const group = (key) => {
    const out = {};
    for (const r of rows) {
      const k = r[key] || "unknown";
      (out[k] ||= []).push(r);
    }
    return Object.fromEntries(Object.entries(out).map(([k, rs]) => [k, {
      answered: rs.filter((r) => r.outcome !== "unanswered").length,
      correctShare: rs.length ? Math.round((rs.filter((r) => r.outcome === "correct").length / rs.length) * 100) / 100 : null,
      medianMs: median(rs.map((r) => (r.time_to_answer_ms == null ? NaN : Number(r.time_to_answer_ms)))),
    }]));
  };
  const pairs = new Map();
  for (const r of rows) {
    if (!r.confused_with) continue;
    const k = `${String(r.confusion_concept || "").toLowerCase()}|${String(r.confused_with).toLowerCase()}`;
    const p = pairs.get(k) || { concept: r.confusion_concept, confusedWith: r.confused_with, count: 0 };
    p.count++;
    pairs.set(k, p);
  }
  return {
    questions: rows.length, bySkill: group("skill"), byFormat: group("format"),
    confusions: [...pairs.values()].sort((a, b) => b.count - a.count).slice(0, 10),
  };
}
