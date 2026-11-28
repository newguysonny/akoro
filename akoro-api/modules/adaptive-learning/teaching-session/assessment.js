/**
 * teaching-session/assessment.js — `teaching.request_assessment` (Grand Plan
 * §7.12, §9.3 tool table, Phase 7): a short Agent Check, mid-session, on the
 * parts just taught (teach_agent mode only).
 *
 *   NaNa asks (one question per part) → the protégé answers ONLY from what the
 *   learner taught it this session (its notes) → Sergeant judges each answer.
 *
 * The question writer and the judge are the locked `assessor` role (grading
 * stays the same whichever model the learner picked); the protégé's answers
 * are the `persona` role and carry the learner's pick. A guess — an answer the
 * notes don't support — never counts, right or not. The result is a card the
 * turn returns, and the protégé's one line about it is the turn's reply. It
 * never moves the session: the evidence gate still does that.
 *
 *   assessmentConcepts({ requested, parts, index, verified }) PURE → string[]
 *   teachingNotes(history)                                    PURE → string[]
 *   scoreAssessment(items)                                    PURE → { correct, total, outcome }
 *   protegeLine(result)                                       PURE → string
 *   runTeachingAssessment({ orchestrator, concepts, modelPick, complete })  → result
 */
import { closeJson } from "../../teaching/index.js";

export const MAX_ASSESSMENT_CONCEPTS = 3;

/** PURE: which parts to check — the ones asked for that were taught, else the parts taught so far (up to 3). */
export function assessmentConcepts({ requested = [], parts = [], index = 0, verified = [] } = {}) {
  const taught = parts.slice(0, Math.max(0, Math.min(parts.length, index + 1)));
  const pool = [...new Set([...taught, ...verified.filter((v) => parts.includes(v))])];
  const asked = (Array.isArray(requested) ? requested : []).map((c) => String(c || "").trim()).filter(Boolean)
    .map((c) => pool.find((p) => p.toLowerCase() === c.toLowerCase()) || null).filter(Boolean);
  return [...new Set(asked.length ? asked : pool)].slice(-MAX_ASSESSMENT_CONCEPTS);
}

/** PURE: what the learner taught the protégé this session — the only thing it may answer from. */
export function teachingNotes(history = [], limit = 12) {
  const cap = Math.max(1, Math.floor(Number(limit) || 12));
  return history.filter((h) => h?.role === "human_teacher" && String(h.content || "").trim())
    .map((h) => String(h.content).replace(/\s+/g, " ").trim().slice(0, 600)).slice(-cap);
}

/** PURE: correct = right AND from the notes; a guess never counts. */
export function scoreAssessment(items = []) {
  const total = items.length;
  const correct = items.filter((i) => i.outcome === "correct").length;
  return { correct, total, outcome: total && correct === total ? "passed" : correct > 0 ? "partial" : "not_yet" };
}

/** PURE: the protégé's reply about the check (code-written, from the result). */
export function protegeLine({ correct, total, items = [] }) {
  if (!total) return "I couldn't be checked yet — teach me a part first.";
  const missed = items.filter((i) => i.outcome !== "correct").map((i) => i.concept);
  if (correct === total) return `I got all ${total} right from what you taught me. Shall we go on?`;
  const first = missed[0] ? ` I'm still unsure about ${missed[0].toLowerCase()} — can you teach me that again?` : "";
  return `I got ${correct} of ${total} right from what you taught me.${first}`;
}

const json = (text, fallback) => {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch { /* try closing it */ }
  try { return JSON.parse(closeJson(t)); } catch { return fallback; }
};

/** The production model calls; `complete(params)` is injectable (tests). */
async function defaultComplete(params) {
  const { openai } = await import("../../../lib/aiModel.js");
  const res = await openai.chat.completions.create(params);
  return res.choices?.[0]?.message?.content || "";
}

/**
 * Run the check. → { concepts, items: [{ concept, question, answer, fromNotes, outcome, note }], correct, total, outcome }
 * outcome per item: correct | guessed | guessed_right | wrong
 */
export async function runTeachingAssessment({ orchestrator, concepts, modelPick = {}, complete = defaultComplete, notesLimit = 12 }) {
  const session = orchestrator?.session || {};
  const topic = session.topic || "this topic";
  const notes = teachingNotes(session.history || [], notesLimit);
  const userId = orchestrator?.userId || orchestrator?.studentId || null;
  const base = { response_format: { type: "json_object" }, temperature: 0, max_tokens: 700, __feature: "teaching_assessment", ...(userId ? { __userId: userId } : {}) };
  if (!concepts.length) return { concepts, items: [], ...scoreAssessment([]) };

  // 1. NaNa asks: one short question per part (assessor — locked).
  const asked = json(await complete({
    ...base, __role: "assessor",
    messages: [
      { role: "system", content: "You are NaNa, a teaching guide. Write ONE short check question per concept, answerable in a sentence or two by a student who was taught it. JSON: {\"questions\":[{\"concept\":string,\"question\":string}]}" },
      { role: "user", content: JSON.stringify({ topic, concepts }) },
    ],
  }), {});
  const questions = concepts.map((concept, i) => ({ concept, question: String(asked?.questions?.[i]?.question || `In your own words: ${concept}?`).slice(0, 300) }));

  // 2. The protégé answers from its notes only (persona — the learner's pick applies).
  const answered = json(await complete({
    ...base, temperature: 0.2, __role: "persona", ...(modelPick || {}),
    messages: [
      { role: "system", content: "You are a student agent. Answer each question using ONLY the notes your teacher gave you. If the notes don't cover it, answer your best guess and set fromNotes false. JSON: {\"answers\":[{\"answer\":string,\"fromNotes\":boolean}]}" },
      { role: "user", content: JSON.stringify({ notes, questions: questions.map((q) => q.question) }) },
    ],
  }), {});

  // 3. Sergeant judges each answer (assessor — locked).
  const items = questions.map((q, i) => ({ ...q, answer: String(answered?.answers?.[i]?.answer || "").slice(0, 400), fromNotes: answered?.answers?.[i]?.fromNotes === true }));
  const judged = json(await complete({
    ...base, __role: "assessor",
    messages: [
      { role: "system", content: "You are Sergeant, a strict, fair examiner. For each question and answer say whether the answer is correct for the concept. JSON: {\"verdicts\":[{\"correct\":boolean,\"note\":string}]}" },
      { role: "user", content: JSON.stringify({ topic, items: items.map(({ concept, question, answer }) => ({ concept, question, answer })) }) },
    ],
  }), {});
  const marked = items.map((item, i) => {
    const right = judged?.verdicts?.[i]?.correct === true;
    const outcome = item.answer && item.fromNotes ? (right ? "correct" : "wrong") : (right ? "guessed_right" : "guessed");
    return { ...item, outcome, note: String(judged?.verdicts?.[i]?.note || "").slice(0, 200) };
  });
  return { concepts, items: marked, ...scoreAssessment(marked) };
}
