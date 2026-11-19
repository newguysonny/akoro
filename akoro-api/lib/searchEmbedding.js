/**
 * lib/searchEmbedding.js — embedding a learner's QUESTION for a search, with
 * a time limit (2026-10-20).
 *
 * A search must answer even when the embedding provider is slow: a RunPod
 * endpoint scaled to zero takes 10–30 s to start, and an open breaker or an
 * outage fails outright. So a search waits at most SEARCH_EMBED_TIMEOUT_MS
 * (default 3 s) for its vector, then goes on without it — every match_* search
 * ranks on its text half when the vector is null. A late answer is not wasted:
 * the call still finishes in the background, which is what wakes a cold worker
 * for the next search.
 *
 * Only for searches. Storing a vector (notes, chunks, topics) keeps the plain
 * embed: a stored row may wait, and a missing vector is the sweeper's to fill.
 */
export const SEARCH_EMBED_TIMEOUT_MS = Math.max(250, Number(process.env.SEARCH_EMBED_TIMEOUT_MS) || 3000);

const stats = { asked: 0, late: 0, failed: 0, shared: 0 };

// One question, one embedding (realtime, 2026-11-07): a chat turn searches the
// syllabus, past questions, the protégé's knowledge and the learner's memories
// with the SAME words — four embedding calls, 1–3.7 s each on the sandbox. The
// same text now shares one call (in flight or finished in the last minute).
const SHARE_MS = 60_000;
const SHARE_MAX = 200;
const shared = new Map();   // input → { call, at }
export const sharedCall = (input, make) => {
  const now = Date.now();
  const hit = shared.get(input);
  if (hit && now - hit.at < SHARE_MS) { stats.shared++; return hit.call; }
  const call = make();
  shared.set(input, { call, at: now });
  call.catch(() => shared.delete(input));   // a failure is never reused
  if (shared.size > SHARE_MAX) shared.delete(shared.keys().next().value);
  return call;
};
/** How often searches went without their vector since boot (admin/health). */
export const searchEmbedStats = () => ({ ...stats, timeoutMs: SEARCH_EMBED_TIMEOUT_MS });

/**
 * Plain embedding for storing a vector (notes, chunks, topics) — no search
 * limit. One text → its vector, or an array → its vectors.
 */
export async function embed(input) {
  const one = (text) => String(text ?? "").slice(0, 8000);
  const res = await (await import("./aiModel.js")).openai.embeddings.create({
    model: "text-embedding-3-small",
    input: Array.isArray(input) ? input.map(one) : one(input),
  });
  return Array.isArray(input) ? res.data.map((d) => d.embedding) : res.data[0].embedding;
}

/**
 * → the query's vector, or null when it failed or took longer than the limit
 * (the caller searches on text alone). Never throws.
 */
export async function embedForSearch(text, { userId = null, feature = "search_embedding", payer = null, timeoutMs = SEARCH_EMBED_TIMEOUT_MS, create = null } = {}) {
  const input = String(text ?? "").trim().slice(0, 8000);
  if (!input) return null;
  stats.asked++;
  const embed = create || (async (p) => (await import("./aiModel.js")).openai.embeddings.create(p));
  const make = () => Promise.resolve().then(() => embed({
    model: "text-embedding-3-small", input,
    __feature: feature,
    ...(payer === "platform" ? { __payer: "platform" } : userId ? { __userId: userId } : {}),
  }));
  // A test's own `create` is never shared; the platform's embedding is.
  const call = create ? make() : sharedCall(input, make);
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve("late"), timeoutMs); });
  try {
    const res = await Promise.race([call, late]);
    if (res === "late") {
      stats.late++;
      call.catch(() => {});   // finishes in the background (warms a cold worker); its failure is nobody's
      console.warn(`[search-embed] no vector within ${timeoutMs} ms — searching on text (${feature})`);
      return null;
    }
    return res?.data?.[0]?.embedding ?? null;
  } catch (e) {
    stats.failed++;
    console.warn(`[search-embed] failed — searching on text (${feature}):`, String(e?.message || e).slice(0, 160));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Tests only: forget the shared embeddings (seam tests count embedding calls). */
export function resetSharedEmbeddings() { shared.clear(); }
