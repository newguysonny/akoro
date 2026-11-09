/**
 * lib/extractionCache.js — Lever 5 of the token-cost plan: one-shot document
 * ingestion → a compiled artifact.
 *
 * The most expensive calls in the app are extraction calls (vision over PDF
 * pages, long-context structuring). Their output is a pure function of the
 * document bytes (+ model + hint), so re-ingesting the same document should not
 * pay for vision again. This caches the extracted artifact keyed on a content
 * hash — the same self-invalidating discipline as the embedding cache.
 *
 * The pure `extractOnce` takes get/put/extract so it is unit-testable with no
 * database and no model; `makePgCache` is the production Postgres backing.
 */
import { createHash } from "node:crypto";

/** Content key for an extraction: scope + model + a stable hint + the document bytes. */
export function contentKey(input, { scope = "pdf", model = "", hint = "" } = {}) {
  const h = createHash("sha256");
  h.update(String(scope)); h.update("\n");
  h.update(String(model)); h.update("\n");
  h.update(String(hint)); h.update("\n");
  h.update(Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? "")));
  return h.digest("hex");
}

/**
 * Return the cached artifact, or run `extract()` once and store it.
 * → { doc, cached }. Never throws on a cache failure (it degrades to a miss).
 */
export async function extractOnce({ key, extract, get, put }) {
  const cached = key && get ? await Promise.resolve().then(() => get(key)).catch(() => null) : null;
  if (cached) return { doc: cached, cached: true };
  const doc = await extract();
  if (key && put && doc) await Promise.resolve().then(() => put(key, doc)).catch(() => {});
  return { doc, cached: false };
}

/** Postgres-backed cache (edu.pdf_extraction_cache). Best-effort; never blocks a miss. */
export function makePgCache({ model = "" } = {}) {
  return {
    async get(key) {
      try {
        const { default: db } = await import("../db.js");
        const { data } = await db.schema("edu").from("pdf_extraction_cache").select("doc").eq("content_key", key).maybeSingle();
        if (data == null) return null;
        db.schema("edu").from("pdf_extraction_cache").update({ last_used_at: new Date().toISOString() }).eq("content_key", key).then(() => {}, () => {});
        return data.doc ?? null;
      } catch { return null; }
    },
    async put(key, doc) {
      try {
        const { default: db } = await import("../db.js");
        const now = new Date().toISOString();
        await db.schema("edu").from("pdf_extraction_cache").upsert(
          { content_key: key, model, doc, created_at: now, last_used_at: now },
          { onConflict: "content_key", ignoreDuplicates: true },
        );
      } catch { /* best-effort cache */ }
    },
  };
}
