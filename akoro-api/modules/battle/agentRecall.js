// modules/battle/agentRecall.js
//
// The agent answers from what its owner actually taught it.
//
// What this replaces: agentPlayer.js turned the learner's per-topic confidence
// into a probability and rolled dice — right with chance p, otherwise a random
// wrong option. It never read the question. A learner who had written pages of
// notes on photosynthesis and a learner who had written nothing were handled by
// identical code; only a number differed. The battle log said "Amara's Agent
// answered wrong — chose B" as though something had chosen B.
//
// Now it is a recall: the question is embedded, the learner's own
// edu.student_knowledge is searched for what they wrote on it, and the model is
// given ONLY those notes and asked which option they support. Nothing else is
// in the prompt — no general knowledge, no syllabus, no course material — so a
// correct answer means the learner's notes contained the answer.
//
// When the notes do not cover it the agent says UNKNOWN and guesses, and the
// log says it guessed and what it was missing. That is the honest outcome and
// the useful one: it names the gap, which is the whole loop — teach the agent,
// the agent does better.

import db from "../../db.js";
import { openai } from "../../lib/aiModel.js";

/** The model that answers. Small on purpose — this is a lookup, not an essay. */
const ANSWER_MODEL = process.env.BATTLE_ANSWER_MODEL || "gpt-4o-mini";

/** How many notes to put in front of it. */
const RECALL_LIMIT = 6;

/**
 * Below this cosine similarity a note is not about this question.
 *
 * Without a floor the search always returns SOMETHING — its nearest six rows,
 * however unrelated — and the model, handed a note about the water cycle and a
 * question about fractions, will pick an option anyway. That would be the dice
 * roll again, wearing a citation.
 */
const MIN_SIMILARITY = 0.30;

/** Embed a question once; every agent in the battle searches with the same vector. */
export async function embedQuestion(text) {
  try {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: String(text ?? "").slice(0, 8000),
      __feature: "battle_recall",
    });
    return res.data?.[0]?.embedding ?? null;
  } catch (e) {
    console.warn("[battle/recall] embedding failed:", e.message);
    return null;
  }
}

/**
 * What does this learner know that bears on this question?
 *
 * Vector search first, because topics are free text written by whatever
 * generated the question — "Family Roles" and "Family roles" are different
 * strings and the same idea, and an exact match would miss most of what the
 * learner actually wrote. The topic match is a second pass for the case where
 * the wording diverges but the label agrees.
 */
export async function recall({ studentId, embedding, topic, limit = RECALL_LIMIT }) {
  const found = new Map();   // id -> note

  if (embedding) {
    try {
      const { data } = await db.rpc("match_student_knowledge", {
        p_student_id: studentId,
        p_query_embedding: embedding,
        p_match_count: limit,
      });
      for (const r of (data ?? [])) {
        if (Number(r.similarity ?? 0) < MIN_SIMILARITY) continue;
        found.set(r.id, { ...r, via: "similarity" });
      }
    } catch (e) {
      console.warn("[battle/recall] vector search failed:", e.message);
    }
  }

  // Same label, different words. Cheap, and it rescues the case where the
  // learner's note is terse enough that the embedding does not place it near a
  // wordy question.
  if (topic && found.size < limit) {
    try {
      const { data } = await db.schema("edu").from("student_knowledge")
        .select("id, topic, content, source, confidence, tags")
        .eq("student_id", studentId).ilike("topic", topic)
        .limit((limit - found.size) + 4);
      for (const r of (data ?? [])) {
        // Placeholders written when a battle met a topic the learner had never
        // been taught. They record the encounter, not the subject, and handing
        // one to the model as a note would have the agent reasoning from "got
        // this wrong once".
        if ((r.tags ?? []).includes("battle-encounter")) continue;
        if (found.size >= limit) break;
        if (!found.has(r.id)) found.set(r.id, { ...r, similarity: null, via: "topic" });
      }
    } catch { /* nothing to add */ }
  }

  return [...found.values()];
}

/**
 * How well is this agent placed on this question, without asking a model?
 *
 * Only used for pacing — an agent that has notes on the topic answers sooner,
 * so the log still reads like a race and the "who was quicker" tie-break still
 * means something. Deliberately NOT used to decide the answer: that would be
 * the old probability sneaking back in through the timing.
 */
export function recallStrength(notes) {
  if (!notes.length) return 0;
  const sims = notes.map((n) => Number(n.similarity ?? 0.5)).filter(Number.isFinite);
  const best = sims.length ? Math.max(...sims) : 0.5;
  const conf = notes.reduce((s, n) => s + Math.max(0, Number(n.confidence ?? 0.5)), 0) / notes.length;
  return Math.min(1, best * 0.7 + conf * 0.3);
}

/**
 * Answer from the notes, or admit the notes do not cover it.
 *
 * The prompt is deliberately starved: the notes, the question, the options,
 * and an instruction to use nothing else. A model asked a JSS1 question with no
 * constraint will answer it correctly from its own training every time, and the
 * battle would stop measuring the learner entirely — every agent would score
 * full marks and the knowledge bank would be decoration.
 *
 * Returns { index, basis, cited, why }.
 *   basis 'recall'  — the notes supported an option
 *   basis 'unknown' — they did not; index is a guess and is marked as one
 */
export async function answerFromRecall({
  question, options, notes, userId,
  // The eval suite points this same path at a different tier — comparing
  // models on "does it refuse when the notes are silent" is the only way that
  // constraint is more than an assertion.
  model = ANSWER_MODEL,
}) {
  if (!notes.length) {
    return { index: null, basis: "unknown", cited: null, why: "nothing in memory on this" };
  }

  const noteBlock = notes.map((n, i) =>
    `[${i + 1}] (${n.topic ?? "untitled"}) ${String(n.content ?? "").slice(0, 700)}`).join("\n\n");
  const optionBlock = options.map((o, i) =>
    `${String.fromCharCode(65 + i)}. ${typeof o === "string" ? o : (o?.text ?? "")}`).join("\n");

  const resp = await openai.chat.completions.create({
    model,
    max_tokens: 120,
    // 0: recalling what a note says is not a creative act, and a battle that
    // gave different answers to the same notes would not be measuring anything.
    temperature: 0,
    __feature: "battle_answer",
    __userId: userId,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a student's memory. You may use ONLY the notes given to you — not your own knowledge of the " +
          "subject. If the notes do not contain what is needed to answer, you MUST say so rather than working it " +
          "out yourself; answering from outside the notes is the one thing you must never do.\n" +
          'Reply as JSON: {"answer":"A"|"B"|"C"|"D"|"E"|"UNKNOWN","note":<number of the note used, or null>}',
      },
      {
        role: "user",
        content: `MY NOTES:\n${noteBlock}\n\nQUESTION:\n${question}\n\nOPTIONS:\n${optionBlock}\n\n` +
                 `Which option do MY NOTES support? If they do not cover it, answer UNKNOWN.`,
      },
    ],
  });

  let parsed = {};
  try { parsed = JSON.parse(resp.choices?.[0]?.message?.content ?? "{}"); } catch { /* handled below */ }

  const letter = String(parsed.answer ?? "").trim().toUpperCase();
  if (!letter || letter === "UNKNOWN") {
    return { index: null, basis: "unknown", cited: null, why: "my notes do not cover this" };
  }

  const index = letter.charCodeAt(0) - 65;
  if (!Number.isInteger(index) || index < 0 || index >= options.length) {
    // A malformed letter is not a wrong answer, it is no answer — treating it
    // as one would quietly credit or punish the learner for a parse failure.
    return { index: null, basis: "unknown", cited: null, why: "could not read my own notes" };
  }

  const citedNote = Number.isInteger(parsed.note) ? notes[parsed.note - 1] : null;
  return { index, basis: "recall", cited: citedNote?.topic ?? null, why: null };
}

/**
 * A guess, for when there is genuinely nothing to recall.
 *
 * Uniform across every option INCLUDING the right one — a learner with no notes
 * who picks at random does sometimes get it right, and excluding the correct
 * option would make "doesn't know" strictly worse than random, which is not
 * what not knowing means.
 */
export function guess(optionCount) {
  return Math.floor(Math.random() * Math.max(1, optionCount));
}
