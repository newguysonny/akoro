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
import { rerank, rerankEnabled } from "../../lib/rerank.js";

/** The model that answers. Small on purpose — this is a lookup, not an essay. */
const ANSWER_MODEL = process.env.BATTLE_ANSWER_MODEL || "gpt-4o-mini";

/** How many notes end up in front of the model. */
const RECALL_LIMIT = 4;

/**
 * How many are retrieved before reranking narrows them.
 *
 * Retrieval is tuned for recall and reranking for precision: fusion reliably
 * gets the right note into a wide set and unreliably gets it into the top
 * three, and the top three is what actually gets read. Fetching 12 to keep 4
 * costs one extra model call and nothing in retrieval time.
 */
const RECALL_WIDE = 12;

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
      // One vector shared by every agent in the battle — the app's, not one learner's.
      __payer: "platform",
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
 * One call now, not two. This used to run a vector search and then a separate
 * exact-label pass in JS, unioning whatever each returned — which meant the two
 * arms could not be RANKED against each other, only concatenated, and a note
 * that was the best lexical hit sat behind six mediocre vector hits.
 *
 * The fusion is in SQL now (see 2026-hybrid-retrieval.sql): vector rank and
 * full-text rank combined by Reciprocal Rank Fusion. The lexical arm matters
 * more here than the usual RAG intuition suggests, because school notes are
 * full of the things embeddings are worst at — a formula, a definition, a unit,
 * a named person. "P x R x T / 100" and "simple interest formula" are barely
 * related as vectors and identical to a learner.
 *
 * Subject is passed through as a filter. Without it a Mathematics question
 * could pull back a Social Studies note purely because the vectors sat close,
 * and the only thing stopping it being used was the similarity floor below.
 */
export async function recall({ studentId, embedding, topic, queryText = null, subject = null, limit = RECALL_LIMIT, payer = null }) {
  try {
    const { data, error } = await db.rpc("match_student_knowledge", {
      p_student_id: studentId,
      p_query_embedding: embedding,
      p_match_count: rerankEnabled("battle") ? Math.max(limit, RECALL_WIDE) : limit,
      // The question itself drives the lexical arm; the topic label is included
      // because it is often the most specific phrase available.
      p_query_text: [topic, queryText].filter(Boolean).join(" ").slice(0, 2000) || null,
      p_subject: subject,
      // Placeholders recording that a learner MET a topic in a battle. They are
      // not knowledge about it, and the lexical arm surfaces them eagerly
      // because they repeat the topic name back — verified: without this the
      // placeholder ranked above real notes for its own topic.
      p_exclude_tags: ["battle-encounter"],
    });
    if (error) { console.warn("[battle/recall] search failed:", error.message); return []; }

    // The floor still applies, but only to rows the vector arm found. A row
    // that surfaced lexically has no meaningful similarity to threshold — it
    // matched on words, which is its own evidence.
    const kept = (data ?? []).filter((r) =>
      r.vector_rank == null || Number(r.similarity ?? 0) >= MIN_SIMILARITY);

    if (!rerankEnabled("battle") || kept.length <= limit) return kept.slice(0, limit);

    // Second pass. Fusion ranks by how well a note MATCHES the question;
    // this ranks by whether it ANSWERS it, which is the thing that decides
    // whether the learner is marked right.
    return rerank({
      query: [topic, queryText].filter(Boolean).join(" — "),
      candidates: kept,
      textOf: (n) => `(${[n.topic, n.subtopic].filter(Boolean).join(" — ")}) ${n.content ?? ""}`,
      topK: limit,
      // An Agent Check was charged once, up front (D45): its rerank is the platform's.
      userId: payer === "platform" ? null : studentId,
    });
  } catch (e) {
    console.warn("[battle/recall] search threw:", e.message);
    return [];
  }
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
  // "platform": the app pays — an Agent Check was charged once, up front (D45).
  payer = null,
}) {
  if (!notes.length) {
    return { index: null, basis: "unknown", cited: null, why: "nothing in memory on this" };
  }

  const noteBlock = notes.map((n, i) => {
    // Label with both levels when they differ: "Family — Family Roles" tells the
    // model which of six sibling notes it is looking at, where "Family" six
    // times over tells it nothing.
    const label = n.subtopic && n.subtopic !== n.topic
      ? `${n.topic} — ${n.subtopic}` : (n.topic ?? "untitled");
    return `[${i + 1}] (${label}) ${String(n.content ?? "").slice(0, 700)}`;
  }).join("\n\n");
  const optionBlock = options.map((o, i) =>
    `${String.fromCharCode(65 + i)}. ${typeof o === "string" ? o : (o?.text ?? "")}`).join("\n");

  const resp = await openai.chat.completions.create({
    model,
    max_tokens: 120,
    // 0: recalling what a note says is not a creative act, and a battle that
    // gave different answers to the same notes would not be measuring anything.
    temperature: 0,
    __feature: payer === "platform" ? "agent_check_answer" : "battle_answer",
    __userId: userId,
    ...(payer === "platform" ? { __payer: "platform" } : {}),
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
