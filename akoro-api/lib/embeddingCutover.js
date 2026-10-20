/**
 * lib/embeddingCutover.js — switching the app's embedding model (2026-10-20).
 *
 * Vectors from two models don't compare: a store holding some of each returns
 * quietly wrong matches. So a switch (EMBEDDINGS_PROVIDER=runpod, Qwen3-
 * Embedding-0.6B) re-embeds EVERYTHING, once:
 *   1. probe — the new provider must answer with a 1536-wide vector first;
 *      nothing is cleared if it doesn't;
 *   2. clear — every vector in the nine stores at once (search runs on its
 *      lexical half meanwhile, never on a mix);
 *   3. refill — the sweeper's seven stores plus curriculum topics and past
 *      questions, in a background loop until nothing is missing.
 * Admin: POST /api/admin/embeddings/reembed-all, progress on GET /api/admin/embeddings.
 */
import db from "../db.js";
import { openai } from "./aiModel.js";
import { DB_DIMENSIONS, embeddingsProvider } from "./embeddingProvider.js";

/** Every table that stores a vector, and whether it carries embedded_at (the sweeper's queue flag). */
export const VECTOR_STORES = Object.freeze([
  { table: "student_knowledge", stamped: true }, { table: "agent_knowledge", stamped: true },
  { table: "training_chunks", stamped: true }, { table: "syllabus_chunks", stamped: true },
  { table: "learner_agent_memories", stamped: true }, { table: "record_chunks", stamped: true },
  { table: "learner_agent_conversation_summaries", stamped: true, key: "chat_session_id" },
  { table: "curriculum_topics", stamped: false }, { table: "past_questions", stamped: false },
]);

const state = { running: false, startedAt: null, finishedAt: null, provider: null, cleared: [], filled: 0, failed: 0, error: null };
export const cutoverState = () => ({ ...state, cleared: [...state.cleared] });

/** The new provider answers with a vector the columns can hold. → { ok, dims, provider, error } */
export async function probeEmbeddings() {
  const provider = embeddingsProvider();
  try {
    const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: "Mitochondria are the sites of aerobic respiration.", __payer: "platform", __feature: "embedding_probe" });
    const v = res?.data?.[0]?.embedding;
    return { ok: Array.isArray(v) && v.length === DB_DIMENSIONS, dims: v?.length ?? 0, provider, model: res?.model || null };
  } catch (e) {
    return { ok: false, dims: 0, provider, error: String(e?.message || e).slice(0, 240) };
  }
}

async function clearAll() {
  const cleared = [];
  for (const s of VECTOR_STORES) {
    const patch = s.stamped ? { embedding: null, embedded_at: null } : { embedding: null };
    const { error } = await db.schema("edu").from(s.table).update(patch).not("embedding", "is", null);
    if (error) throw new Error(`clearing ${s.table}: ${error.message}`);
    cleared.push(s.table);
  }
  return cleared;
}

async function refill({ deadlineMs }) {
  const { sweepOnce } = await import("./embeddingSweeper.js");
  const { reembedMissingCurriculum } = await import("../modules/curriculum/routes.js");
  const { reembedMissingPastQuestions } = await import("../modules/past-questions/routes.js");
  for (;;) {
    if (Date.now() > deadlineMs) throw new Error("re-embed ran past its time limit — run it again to continue");
    const did = await sweepOnce({ batch: 100 });
    const cur = await reembedMissingCurriculum({ limit: 100 });
    const pq = await reembedMissingPastQuestions({ limit: 100 });
    const filled = did.reduce((n, d) => n + d.filled, 0) + cur.embedded + pq.embedded;
    state.filled += filled;
    state.failed += did.reduce((n, d) => n + d.failed, 0);
    if (!filled) return;   // nothing left that can be filled
  }
}

/**
 * Probe, clear, refill in the background. → { started, probe } — refuses (nothing
 * cleared) unless the provider is the self-hosted one and answers correctly,
 * or `allowOpenAI` for a deliberate re-embed on OpenAI.
 */
export async function startReembedAll({ allowOpenAI = false, maxHours = 6 } = {}) {
  if (state.running) return { started: false, reason: "already running", state: cutoverState() };
  const probe = await probeEmbeddings();
  if (!probe.ok) return { started: false, reason: "the embedding provider didn't answer with a 1536-wide vector — nothing was cleared", probe };
  if (probe.provider !== "runpod" && !allowOpenAI) return { started: false, reason: "EMBEDDINGS_PROVIDER is not runpod — nothing to switch", probe };
  Object.assign(state, { running: true, startedAt: new Date().toISOString(), finishedAt: null, provider: probe.provider, cleared: [], filled: 0, failed: 0, error: null });
  (async () => {
    try {
      state.cleared = await clearAll();
      await refill({ deadlineMs: Date.now() + maxHours * 3600_000 });
    } catch (e) {
      state.error = String(e?.message || e).slice(0, 300);
      console.error("[embeddings] re-embed:", state.error);
    } finally {
      state.running = false;
      state.finishedAt = new Date().toISOString();
      console.log(`[embeddings] re-embed done: ${state.filled} filled, ${state.failed} failed${state.error ? ` — ${state.error}` : ""}`);
    }
  })();
  return { started: true, probe };
}
