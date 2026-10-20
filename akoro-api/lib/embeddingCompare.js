/**
 * lib/embeddingCompare.js — choosing between the self-hosted embedding models
 * WITHOUT touching the stores (2026-10-20). The stores hold one model's
 * vectors at a time, so a comparison never re-embeds them: it embeds a fixed
 * test set (lib/embeddingEvalSet.js) with each model and scores how often a
 * learner's question finds its passage.
 *
 * Per candidate: the first call's time (a cold worker shows here), recall@1,
 * recall@5, MRR, the same by language, the misses, and the median time of a
 * single-question embed — what every search pays.
 *
 * Candidates: every self-hosted model with an endpoint, Qwen3 also with its
 * query instruction (the app doesn't send one today — this shows whether it
 * would be worth it), and OpenAI when it is what the app uses now.
 * Called by POST /api/admin/embeddings/compare and smoke.embeddings_compare.
 */
import { endpointFor, runpodEmbeddings, SELF_HOSTED_MODELS } from "./embeddingProvider.js";
import { PASSAGES, QUERIES } from "./embeddingEvalSet.js";

export const QUERY_INSTRUCTION = "Given a student's question, retrieve the study passage that answers it";
const LATENCY_SAMPLES = 5;

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const norm = (a) => Math.sqrt(dot(a, a)) || 1;
export const cosine = (a, b) => dot(a, b) / (norm(a) * norm(b));
const round = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

/**
 * PURE. Rank the passages for each question by cosine; where does its answer land?
 * → { queries, recall1, recall5, mrr, byLang: { en: {…}, pcm: {…} }, misses: [{ q, want, got }] }
 */
export function scoreRetrieval({ passages, passageVectors, queries, queryVectors }) {
  const rows = queries.map((query, i) => {
    const ranked = passages.map((p, j) => ({ id: p.id, score: cosine(queryVectors[i], passageVectors[j]) })).sort((a, b) => b.score - a.score);
    return { query, rank: ranked.findIndex((r) => r.id === query.answer) + 1, top: ranked[0]?.id };
  });
  const sum = (rs) => {
    const n = rs.length || 1;
    return { queries: rs.length, recall1: round(rs.filter((r) => r.rank === 1).length / n), recall5: round(rs.filter((r) => r.rank >= 1 && r.rank <= 5).length / n), mrr: round(rs.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / n) };
  };
  const byLang = {};
  for (const lang of [...new Set(queries.map((q) => q.lang || "en"))]) byLang[lang] = sum(rows.filter((r) => (r.query.lang || "en") === lang));
  return { ...sum(rows), byLang, misses: rows.filter((r) => r.rank !== 1).map((r) => ({ q: r.query.q, want: r.query.answer, got: r.top, rank: r.rank })) };
}

/** The candidates this server can run. → [{ key, model, instruction?, via }] */
export function candidates(env = process.env, { provider = "openai", openaiKey = !!env.OPENAI_API_KEY } = {}) {
  const out = [];
  if (env.RUNPOD_API_KEY) {
    for (const model of Object.keys(SELF_HOSTED_MODELS)) {
      if (!endpointFor(model, env)) continue;
      out.push({ key: model, model, via: "runpod" });
      if (model.startsWith("qwen3")) out.push({ key: `${model}+instruction`, model, instruction: QUERY_INSTRUCTION, via: "runpod" });
    }
  }
  if (provider === "openai" && openaiKey) out.push({ key: "text-embedding-3-small (current)", model: "text-embedding-3-small", via: "openai" });
  return out;
}

const vectorsOf = (res) => [...(res?.data || [])].sort((a, b) => a.index - b.index).map((d) => d.embedding);

/**
 * Run the test set on every candidate, one after the other (each against its
 * own endpoint). `embed(candidate, texts, { query })` → vectors is injectable;
 * the default calls RunPod directly (unbilled — the platform's own test) or
 * OpenAI through the app's seam. → { at, passages, queries, results: [...] }
 */
export async function compareEmbeddings({ env = process.env, embed = null, list = null, nowMs = () => Date.now() } = {}) {
  const run = embed || (async (c, texts, { query }) => {
    if (c.via === "runpod") return vectorsOf(await runpodEmbeddings({ input: texts }, { env, model: c.model, instruction: query ? c.instruction : null }));
    const { openai } = await import("./aiModel.js");
    return vectorsOf(await openai.embeddings.create({ model: c.model, input: texts, __payer: "platform", __feature: "embedding_compare" }));
  });
  let cands = list;
  if (!cands) {
    const { embeddingsProvider } = await import("./embeddingProvider.js");
    cands = candidates(env, { provider: embeddingsProvider(env) });
  }
  // Wake every endpoint at once: cold starts overlap instead of adding up.
  const first = await Promise.all(cands.map(async (c) => {
    const t = nowMs();
    try { await run(c, [QUERIES[0].q], { query: true }); return { ms: nowMs() - t }; } catch (e) { return { error: e }; }
  }));
  const results = [];
  for (const [i, c] of cands.entries()) {
    const r = { key: c.key, model: c.model, via: c.via };
    try {
      if (first[i].error) throw first[i].error;
      r.firstCallMs = first[i].ms;
      let t;
      const passageVectors = await run(c, PASSAGES.map((p) => p.text), { query: false });
      const queryVectors = await run(c, QUERIES.map((q) => q.q), { query: true });
      Object.assign(r, scoreRetrieval({ passages: PASSAGES, passageVectors, queries: QUERIES, queryVectors }));
      const times = [];
      for (let i = 0; i < LATENCY_SAMPLES; i++) {
        t = nowMs();
        await run(c, [QUERIES[(i * 7 + 3) % QUERIES.length].q], { query: true });
        times.push(nowMs() - t);
      }
      r.searchEmbedMs = median(times);
    } catch (e) {
      r.error = String(e?.message || e).slice(0, 240);
    }
    results.push(r);
  }
  return { at: new Date(nowMs()).toISOString(), passages: PASSAGES.length, queries: QUERIES.length, results };
}
