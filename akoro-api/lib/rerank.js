// lib/rerank.js
//
// Second-pass scoring over retrieved candidates.
//
// Retrieval optimises for RECALL — cast wide, do not miss the right note. What
// reaches the prompt needs PRECISION, and those are different jobs. Fusing
// vector and lexical rank (2026-hybrid-retrieval.sql) gets the right note into
// the top twelve; it does not reliably get it into the top three, and the top
// three is what the model actually reads.
//
// A real cross-encoder would be the textbook answer. There isn't one in this
// stack and adding a model server to Railway for it would cost more per month,
// in idle RAM alone, than the whole platform's current AI spend. So this is a
// listwise LLM reranker: one small call that sees the query and every candidate
// together and orders them. Listwise, not pointwise, because scoring candidates
// one at a time is N calls and — worse — gives the model no way to say "this
// one is better than that one", which is the entire question.
//
// It is OFF unless asked for. An extra call on every retrieval is a real cost
// and a real 300–800ms, and the honest position is that reranking is worth it
// only where precision demonstrably pays: it is enabled for battle recall,
// where the wrong note means a learner is marked wrong.

import { openai } from "./aiModel.js";

const RERANK_MODEL = process.env.RERANK_MODEL || "gpt-4o-mini";

/**
 * Order candidates by how well each ANSWERS the query, keep the best `topK`.
 *
 * Returns the same objects, reordered and trimmed, each with `rerankScore`.
 * On any failure it returns the input untouched — a reranker that can drop
 * results when the model hiccups is worse than no reranker, because the
 * failure is invisible and looks like bad retrieval.
 *
 * @param {object}   o
 * @param {string}   o.query       what is being asked
 * @param {Array}    o.candidates  retrieved rows
 * @param {Function} o.textOf      row -> the text to judge
 * @param {number}   o.topK        how many survive
 */
export async function rerank({ query, candidates, textOf, topK = 4, userId = null, model = RERANK_MODEL }) {
  // Nothing to choose between. Reranking three candidates down to four is a
  // model call that cannot change the outcome.
  if (!Array.isArray(candidates) || candidates.length <= topK) return candidates ?? [];

  const listed = candidates.map((c, i) =>
    `[${i + 1}] ${String(textOf(c) ?? "").slice(0, 600)}`).join("\n\n");

  try {
    const resp = await openai.chat.completions.create({
      model,
      max_tokens: 200,
      temperature: 0,
      __feature: "rerank",
      __userId: userId,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You rank passages by how well they help ANSWER a question. Relevance is not topical overlap: a " +
            "passage about the right subject that does not contain the answer ranks below a short one that does. " +
            'Reply as JSON: {"order":[<passage numbers, best first>]}. Include only genuinely useful passages — ' +
            "omitting the rest is more useful than ranking them.",
        },
        { role: "user", content: `QUESTION:\n${query}\n\nPASSAGES:\n${listed}` },
      ],
    });

    const parsed = JSON.parse(resp.choices?.[0]?.message?.content ?? "{}");
    const order = Array.isArray(parsed.order) ? parsed.order : null;
    if (!order?.length) return candidates.slice(0, topK);

    const picked = [];
    const seen = new Set();
    for (const n of order) {
      const i = Number(n) - 1;
      // Hallucinated indexes are common enough to be worth handling rather than
      // trusting; a bad index would otherwise put `undefined` in the prompt.
      if (!Number.isInteger(i) || i < 0 || i >= candidates.length || seen.has(i)) continue;
      seen.add(i);
      picked.push({ ...candidates[i], rerankScore: picked.length + 1 });
      if (picked.length >= topK) break;
    }

    // The model dropped everything. That is a legitimate verdict — none of the
    // candidates answer the question — and passing it through is the point:
    // downstream, an empty recall means "I don't know", which is true.
    return picked;
  } catch (e) {
    console.warn("[rerank] failed, keeping retrieval order:", e.message);
    return candidates.slice(0, topK);
  }
}

/** Is reranking on for this call site? Off by default; it costs a call. */
export const rerankEnabled = (site) => {
  const on = String(process.env.RERANK_SITES ?? "battle").split(",").map((s) => s.trim());
  return on.includes(site) || on.includes("all");
};
