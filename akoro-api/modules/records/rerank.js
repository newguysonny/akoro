/**
 * modules/records/rerank.js — second-stage passage ranking.
 *
 * The RPC already fuses vector and lexical ranks (RRF), which is good at
 * RECALL and mediocre at ordering: a long page that merely contains the query
 * words can outrank the paragraph that answers it. This is a cheap,
 * deterministic re-score over the fused candidates — no extra model call, no
 * latency budget spent, and explainable enough to debug.
 *
 * Signals (deliberately few):
 *   • query-term coverage — the share of significant terms the passage has;
 *   • exact phrase — the whole question phrase appears;
 *   • proximity — how tightly the terms cluster (one window beats scatter);
 *   • heading — a markdown heading at the top carries the terms;
 *   • table — a "compare / data / table" question prefers a table passage;
 *   • fused prior — keeps the hybrid RPC's judgement in the mix;
 *   • length — very long chunks lose a little (they dilute an embedding).
 *
 * Pure on (query, candidates); the caller decides whether to use it
 * (RECORDS_RERANK=off disables the stage).
 */
const STOPWORDS = new Set([
  "the", "and", "for", "from", "with", "this", "that", "what", "when", "where",
  "which", "who", "why", "how", "are", "was", "were", "does", "did", "can",
  "could", "should", "would", "about", "into", "than", "then", "them", "they",
  "there", "their", "his", "her", "its", "our", "your", "you", "have", "has",
  "had", "not", "but", "also", "more", "most", "some", "any", "all", "each",
  "between", "using", "use", "used", "explain", "describe", "define", "give",
  "list", "please", "note", "notes", "tell", "show", "make", "create",
]);

const normalize = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

export function queryTerms(query) {
  const seen = new Set();
  for (const t of normalize(query).split(/[^a-z0-9]+/)) {
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    seen.add(t);
  }
  return [...seen];
}

/** Terms with at least `min` distinct members inside one maxWindow-char span. */
function bestWindow(text, terms, maxWindow = 40) {
  if (!terms.length) return 0;
  let best = 0;
  for (const term of terms) {
    let at = text.indexOf(term);
    while (at >= 0) {
      const end = Math.min(text.length, at + maxWindow);
      let distinct = 0;
      for (const t of terms) if (text.indexOf(t, at) >= 0 && text.indexOf(t, at) < end) distinct += 1;
      best = Math.max(best, distinct / terms.length);
      at = text.indexOf(term, at + 1);
    }
  }
  return best;
}

const TABLE_WORDS = /(?:^|[^a-z])(table|tables|compare|comparison|data|values?|columns?|rows?|figure|figures|chart|graph)(?:[^a-z]|$)/i;

/**
 * Rank fused candidates. Each candidate: { text, fused?, similarity?, ... };
 * returns new objects with `rerankScore`, best first, sliced to `limit`.
 */
export function rerankChunks({ query = "", chunks = [], limit = 12 } = {}) {
  const list = Array.isArray(chunks) ? chunks.filter((c) => c && typeof c === "object") : [];
  if (list.length <= 1) return list.slice(0, Math.max(0, limit));
  const terms = queryTerms(query);
  const phrase = normalize(query);
  const wantsTable = TABLE_WORDS.test(phrase);
  const maxFused = Math.max(...list.map((c) => Number(c.fused) || 0), 1e-9);

  const scored = list.map((c) => {
    const text = normalize(c.text ?? c.chunk_text ?? "");
    const head = text.slice(0, 160);
    let matched = 0;
    for (const t of terms) if (text.includes(t)) matched += 1;
    const coverage = terms.length ? matched / terms.length : 0;
    const phraseHit = phrase.length >= 8 && text.includes(phrase) ? 1 : 0;
    const proximity = bestWindow(text, terms.filter((t) => text.includes(t)));
    const headingHit = terms.length && terms.some((t) => head.includes(t)) ? 1 : 0;
    const tableHit = wantsTable && /(?:^|\n)\s*\|[^\n]*\|/.test(text) ? 1 : 0;
    const prior = (Number(c.fused) || 0) / maxFused;
    const lengthPenalty = text.length > 1500 && !phraseHit ? 0.08 : 0;
    const rerankScore = 0.6 * coverage + 0.1 * phraseHit + 0.1 * proximity
      + 0.1 * headingHit + 0.1 * tableHit + 0.1 * prior - lengthPenalty;
    return { ...c, rerankScore };
  });

  scored.sort((a, b) => (b.rerankScore - a.rerankScore)
    || ((Number(b.fused) || 0) - (Number(a.fused) || 0)));
  return scored.slice(0, Math.max(0, limit));
}
