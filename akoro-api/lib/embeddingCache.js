/**
 * lib/embeddingCache.js — Lever 2 of the token-cost plan (see
 * modules/adaptive-learning/architecture/akoro-token-cost-optimization…md).
 *
 * An embedding is a pure function of (provider, model, text). Embedding the same
 * text twice is paying twice for an identical vector. This caches `content-hash
 * → vector` so stable text (syllabus subtopics, knowledge chunks, repeated
 * searches) is embedded once.
 *
 * Keyed on the CONTENT HASH, not the row id (plan D7): the key changes the
 * moment the text changes, so the cache self-invalidates — there is no way to
 * serve a stale vector for edited wording. The model/provider is part of the key
 * because two models' vectors don't compare (embeddingProvider never mixes them).
 *
 * Storage is Postgres (the source of truth): the vectors survive restarts, so
 * the savings actually accrue rather than evaporating with a process. Reads and
 * writes are best-effort — a cache that can break an embed is worse than none.
 *
 * The pure key functions import nothing heavy, so they are unit-testable
 * without a database; db.js is imported lazily inside get/put.
 */
import { createHash } from "node:crypto";
import { embeddingsProvider, selfHostedModel } from "./embeddingProvider.js";

export const DEFAULT_EMBED_MODEL = "text-embedding-3-small";

/** The provider:model pair this vector belongs to — part of the key so vectors never mix. */
export function cacheModel(input = {}) {
  const provider = embeddingsProvider();
  const model = provider === "runpod"
    ? selfHostedModel()
    : (typeof input.model === "string" && input.model) || DEFAULT_EMBED_MODEL;
  return `${provider}:${model}`;
}

/**
 * Content-hash key for a SINGLE-text embedding, or null when the input is not one
 * non-empty string (batch/array inputs bypass the cache and embed as before).
 */
export function singleTextKey(input = {}) {
  if (typeof input.input !== "string" || !input.input.trim()) return null;
  return createHash("sha256").update(`${cacheModel(input)}\n${input.input}`).digest("hex");
}

/** → the cached vector, or null on a miss / any error. Never throws. */
export async function embeddingCacheGet(key) {
  if (!key) return null;
  try {
    const { default: db } = await import("../db.js");
    const { data, error } = await db.schema("edu").from("embedding_cache")
      .select("embedding").eq("key", key).maybeSingle();
    if (error || !data) return null;
    // last_used_at drives future pruning; best-effort, never awaited.
    db.schema("edu").from("embedding_cache")
      .update({ last_used_at: new Date().toISOString() }).eq("key", key)
      .then(() => {}, () => {});
    return Array.isArray(data.embedding) ? data.embedding : null;
  } catch { return null; }
}

/** Store a vector for `key`. Best-effort; never throws, never blocks the caller. */
export async function embeddingCachePut(key, model, embedding) {
  if (!key || !Array.isArray(embedding) || !embedding.length) return;
  try {
    const { default: db } = await import("../db.js");
    const now = new Date().toISOString();
    await db.schema("edu").from("embedding_cache").upsert(
      { key, model, dim: embedding.length, embedding, created_at: now, last_used_at: now },
      { onConflict: "key", ignoreDuplicates: true },
    );
  } catch { /* best-effort cache */ }
}
