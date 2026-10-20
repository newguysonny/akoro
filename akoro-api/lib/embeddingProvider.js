/**
 * lib/embeddingProvider.js — where the app's embeddings come from (2026-10-20).
 *
 *   openai  text-embedding-3-small, 1536 dims (the default)
 *   runpod  Qwen/Qwen3-Embedding-0.6B on our own RunPod endpoint (embed-worker/),
 *           1024 dims, padded with zeros to the database's 1536 columns —
 *           zeros change neither dot products nor norms, so cosine similarity
 *           is exactly the model's own.
 *
 * Every embedding in the app goes through lib/aiModel.js's embeddings seam,
 * which asks this module. There is deliberately NO fallback from one provider
 * to the other: two models' vectors don't compare, and a mixed store would
 * quietly return wrong matches. If the chosen provider fails, the call fails
 * (search falls back to its lexical half).
 *
 * Env: EMBEDDINGS_PROVIDER=runpod, RUNPOD_EMBED_ENDPOINT_ID, RUNPOD_API_KEY.
 */
export const DB_DIMENSIONS = 1536;
export const SELF_HOSTED_MODEL = "qwen3-embedding-0.6b";
export const SELF_HOSTED_DIMENSIONS = 1024;
const RUNSYNC_WAIT_MS = 60_000;

export function embeddingsProvider(env = process.env) {
  return String(env.EMBEDDINGS_PROVIDER || "").trim().toLowerCase() === "runpod" && env.RUNPOD_EMBED_ENDPOINT_ID && env.RUNPOD_API_KEY
    ? "runpod" : "openai";
}

/** Can this server embed at all? (Callers that skip embedding without a key.) */
export const canEmbed = (env = process.env) => embeddingsProvider(env) === "runpod" || !!env.OPENAI_API_KEY;

/** A vector padded with zeros to `n` (never cut — a longer one is a bug upstream). */
export function padTo(vector, n = DB_DIMENSIONS) {
  if (!Array.isArray(vector)) return vector;
  if (vector.length > n) throw new Error(`embedding has ${vector.length} dims; the columns hold ${n}`);
  return vector.length === n ? vector : vector.concat(new Array(n - vector.length).fill(0));
}

/**
 * The OpenAI embeddings call, answered by the RunPod endpoint: same params
 * ({ input: string | string[] }), same response shape ({ data: [{ embedding,
 * index }], usage, model }).
 */
export async function runpodEmbeddings(params = {}, { env = process.env, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const texts = (Array.isArray(params.input) ? params.input : [params.input]).map((t) => String(t ?? ""));
  const base = `https://api.runpod.ai/v2/${env.RUNPOD_EMBED_ENDPOINT_ID}`;
  const headers = { Authorization: `Bearer ${env.RUNPOD_API_KEY}`, "Content-Type": "application/json" };
  const call = async (url, init) => {
    const res = await fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(RUNSYNC_WAIT_MS + 10_000) });
    const body = await res.json().catch(() => null);
    if (!res.ok) { const e = new Error(`RunPod embeddings HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`); e.status = res.status; throw e; }
    return body;
  };
  let job = await call(`${base}/runsync?wait=${RUNSYNC_WAIT_MS}`, { method: "POST", body: JSON.stringify({ input: { input: texts, dimensions: SELF_HOSTED_DIMENSIONS } }) });
  // runsync answers IN_QUEUE / IN_PROGRESS when the job outlives its wait (a cold worker): poll briefly.
  const started = Date.now();
  while (job && ["IN_QUEUE", "IN_PROGRESS"].includes(job.status) && Date.now() - started < RUNSYNC_WAIT_MS) {
    await sleep(1500);
    job = await call(`${base}/status/${job.id}`, { method: "GET" });
  }
  if (job?.status !== "COMPLETED") throw Object.assign(new Error(`RunPod embeddings job ${job?.status || "failed"}${job?.error ? `: ${String(job.error).slice(0, 200)}` : ""}`), { status: 503 });
  const out = job.output || {};
  if (out.error) throw Object.assign(new Error(`RunPod embeddings: ${String(out.error).slice(0, 200)}`), { status: /^bad_input/.test(out.error) ? 400 : 503 });
  const vectors = Array.isArray(out.embeddings) ? out.embeddings : [];
  if (vectors.length !== texts.length) throw Object.assign(new Error(`RunPod embeddings returned ${vectors.length} vectors for ${texts.length} texts`), { status: 502 });
  const tokens = Number(out.usage?.prompt_tokens) || 0;
  return {
    object: "list", model: SELF_HOSTED_MODEL,
    data: vectors.map((v, index) => ({ object: "embedding", index, embedding: padTo(v) })),
    usage: { prompt_tokens: tokens, total_tokens: tokens },
  };
}
