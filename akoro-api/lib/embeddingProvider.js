/**
 * lib/embeddingProvider.js — where the app's embeddings come from (2026-10-20).
 *
 *   openai  text-embedding-3-small, 1536 dims (the default)
 *   runpod  our own RunPod endpoint (embed-worker/): Qwen3-Embedding-0.6B or
 *           bge-m3 (EMBEDDINGS_MODEL; one endpoint per model), 1024 dims,
 *           padded with zeros to the database's 1536 columns — zeros change
 *           neither dot products nor norms, so cosine similarity is exactly
 *           the model's own.
 *
 * Every embedding in the app goes through lib/aiModel.js's embeddings seam,
 * which asks this module. There is deliberately NO fallback from one provider
 * to the other: two models' vectors don't compare, and a mixed store would
 * quietly return wrong matches. If the chosen provider fails, the call fails
 * (search falls back to its lexical half).
 *
 * Changing EMBEDDINGS_MODEL is a model switch like any other: re-embed
 * everything (lib/embeddingCutover.js). To choose between the two without
 * touching the stores, compare them first (lib/embeddingCompare.js).
 *
 * Env: EMBEDDINGS_PROVIDER=runpod, RUNPOD_API_KEY, EMBEDDINGS_MODEL
 * (qwen3-embedding-0.6b | bge-m3), and each model's endpoint:
 * RUNPOD_EMBED_ENDPOINT_ID (Qwen3), RUNPOD_EMBED_BGE_ENDPOINT_ID (bge-m3).
 */
export const DB_DIMENSIONS = 1536;
export const SELF_HOSTED_DIMENSIONS = 1024;
/** The self-hosted models: the name the app bills under → its endpoint's env var. */
export const SELF_HOSTED_MODELS = Object.freeze({
  "qwen3-embedding-0.6b": Object.freeze({ hf: "Qwen/Qwen3-Embedding-0.6B", endpointEnv: "RUNPOD_EMBED_ENDPOINT_ID" }),
  "bge-m3": Object.freeze({ hf: "BAAI/bge-m3", endpointEnv: "RUNPOD_EMBED_BGE_ENDPOINT_ID" }),
});
export const SELF_HOSTED_MODEL = "qwen3-embedding-0.6b";
export const isSelfHostedModel = (model) => Object.hasOwn(SELF_HOSTED_MODELS, String(model || ""));
const RUNSYNC_WAIT_MS = 60_000;

/** The self-hosted model the app uses (EMBEDDINGS_MODEL; Qwen3 unless named). */
export function selfHostedModel(env = process.env) {
  const name = String(env.EMBEDDINGS_MODEL || "").trim().toLowerCase();
  return isSelfHostedModel(name) ? name : SELF_HOSTED_MODEL;
}

/** A self-hosted model's RunPod endpoint id, or null when it isn't deployed. */
export const endpointFor = (model, env = process.env) => String(env[SELF_HOSTED_MODELS[model]?.endpointEnv] || "").trim() || null;

export function embeddingsProvider(env = process.env) {
  return String(env.EMBEDDINGS_PROVIDER || "").trim().toLowerCase() === "runpod" && endpointFor(selfHostedModel(env), env) && env.RUNPOD_API_KEY
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
 * index }], usage, model }). `model` picks a self-hosted model (the app's
 * own by default); `instruction` is Qwen3's query format (bge-m3 ignores it).
 */
export async function runpodEmbeddings(params = {}, { env = process.env, model = selfHostedModel(env), instruction = null, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const texts = (Array.isArray(params.input) ? params.input : [params.input]).map((t) => String(t ?? ""));
  const endpoint = endpointFor(model, env);
  if (!endpoint) throw Object.assign(new Error(`no RunPod endpoint for ${model} (set ${SELF_HOSTED_MODELS[model]?.endpointEnv || "EMBEDDINGS_MODEL"})`), { status: 503 });
  const base = `https://api.runpod.ai/v2/${endpoint}`;
  const headers = { Authorization: `Bearer ${env.RUNPOD_API_KEY}`, "Content-Type": "application/json" };
  const call = async (url, init) => {
    const res = await fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(RUNSYNC_WAIT_MS + 10_000) });
    const body = await res.json().catch(() => null);
    if (!res.ok) { const e = new Error(`RunPod embeddings HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`); e.status = res.status; throw e; }
    return body;
  };
  let job = await call(`${base}/runsync?wait=${RUNSYNC_WAIT_MS}`, { method: "POST", body: JSON.stringify({ input: { input: texts, dimensions: SELF_HOSTED_DIMENSIONS, ...(instruction ? { instruction } : {}) } }) });
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
    object: "list", model,
    data: vectors.map((v, index) => ({ object: "embedding", index, embedding: padTo(v) })),
    usage: { prompt_tokens: tokens, total_tokens: tokens },
  };
}
