// modules/records/searchLib.js
//
// The library's semantic index — chunks, embeddings, and the one search
// every learner-facing surface calls. See 2026-record-search.sql for the
// shape; this file is the write path and the read path around it.
//
// Two rules govern everything here:
//
//   1 · Indexing NEVER breaks the flow that produced the text. An upload,
//       an extraction batch or a transcription job succeeds even when the
//       embedding call fails — the chunk row lands vectorless and the
//       sweeper (record_chunks is a store in lib/embeddingSweeper.js)
//       fills it on a later pass. Search being temporarily dumber is
//       acceptable; an extraction the learner waited twenty seconds for
//       failing because embeddings hiccuped is not.
//
//   2 · Search degrades honestly. With no OPENAI key (or a failed query
//       embedding) the match function still runs lexical-only — the RRF
//       fusion treats a missing arm as one unvote, so keyword search
//       keeps working through exactly the outage that killed vectors.

import { canEmbed } from "../../lib/embeddingProvider.js";   // pure — no db, no client

const dbLazy = async () => (await import("../../db.js")).default;

/** The one embedding dimension the platform standardises on. */
export const EMBED_DIM = 1536;

/** Chunks are embedded pieces, not archives — ~a page of speech. */
const MAX_CHUNK_CHARS = 1200;

// Can this server embed? Our RunPod endpoint or OpenAI (lib/embeddingProvider.js).
const hasOpenAI = () => canEmbed();

/* ── Pure shaping ──────────────────────────────────────────────────────────── */

/**
 * Split text into ≤maxChars chunks, preferring paragraph boundaries, then
 * sentence ends — a cut mid-sentence is the thing every bad RAG demo does.
 * Never returns empty chunks; a text shorter than max is one chunk.
 */
export function chunkText(text, maxChars = MAX_CHUNK_CHARS) {
  const src = String(text || "").replace(/\s+\n/g, "\n").trim();
  if (!src) return [];
  if (src.length <= maxChars) return [src];

  const chunks = [];
  let rest = src;
  while (rest.length > maxChars) {
    // Best cut point: last paragraph break, else last sentence end, else hard cut.
    let cut = rest.lastIndexOf("\n", maxChars);
    if (cut < maxChars * 0.5) {
      cut = rest.lastIndexOf(". ", maxChars);
      if (cut >= 0) cut += 1;   // keep the period with the chunk it ends
    }
    if (cut < maxChars * 0.5) cut = maxChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

/**
 * Group transcript segments into_windows of ≤maxChars, keeping each
 * segment whole (a segment is a diarized paragraph — never split it).
 * The window's start_ms/end_ms span its members, so a search hit can
 * jump the player to where the window begins.
 */
export function windowsFromSegments(segments, maxChars = MAX_CHUNK_CHARS) {
  const wins = [];
  let cur = null;
  for (const s of Array.isArray(segments) ? segments : []) {
    const text = String(s?.text || "").trim();
    if (!text) continue;
    const startMs = Number.isFinite(Number(s?.startMs)) ? Number(s.startMs) : 0;
    const endMs = Number.isFinite(Number(s?.endMs)) ? Number(s.endMs) : startMs;
    if (cur && cur.chars + text.length + 1 <= maxChars) {
      cur.texts.push(text);
      cur.chars += text.length + 1;
      cur.endMs = Math.max(cur.endMs, endMs);
    } else {
      if (cur) wins.push(cur);
      cur = { texts: [text], chars: text.length, startMs, endMs };
    }
  }
  if (cur) wins.push(cur);
  return wins.map((w) => ({ startMs: w.startMs, endMs: w.endMs, text: w.texts.join("\n") }));
}

/** A search hit's snippet — long enough to recognise, short enough to scan. */
export function snippetOf(text, max = 260) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/* ── Embedding ─────────────────────────────────────────────────────────────── */

/**
 * Embed up to `texts.length` strings in as few OpenAI calls as the batch
 * limit allows. Returns vectors aligned to inputs; a failed batch yields
 * nulls for its inputs (the rows still insert — vectorless, sweeper-bound).
 */
export async function embedMany(texts, { userId = null } = {}) {
  const clean = (Array.isArray(texts) ? texts : []).map((t) => String(t || "").slice(0, 8000));
  if (!clean.length || !hasOpenAI()) return clean.map(() => null);
  const { openai } = await import("../../lib/aiModel.js");
  const out = new Array(clean.length).fill(null);
  const BATCH = 64;
  for (let i = 0; i < clean.length; i += BATCH) {
    const slice = clean.slice(i, i + BATCH);
    try {
      const res = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: slice,
        ...(userId ? { __userId: userId } : {}),
      });
      (res.data || []).forEach((d) => {
        if (d?.index >= 0 && d.index < slice.length && Array.isArray(d.embedding)) out[i + d.index] = d.embedding;
      });
    } catch (e) {
      console.warn("[record-search] embedding batch failed (rows land vectorless):", String(e?.message || e).slice(0, 160));
    }
  }
  return out;
}

/* ── Write path ────────────────────────────────────────────────────────────── */

/**
 * Replace a record's chunks of one kind with fresh ones. Delete-then-insert
 * keeps re-indexing idempotent (an extraction batch that re-runs a page must
 * not leave the page searchable twice).
 */
export async function replaceRecordChunks({ userId, recordId, contentKey = null, kind, rows, pageNumbers = null, bill = true }, deps = {}) {
  const embed = deps.embedMany || embedMany;
  const clean = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      kind,
      page_number: Number.isInteger(r?.pageNumber) ? r.pageNumber : null,
      start_ms: Number.isFinite(Number(r?.startMs)) ? Math.round(Number(r.startMs)) : null,
      end_ms: Number.isFinite(Number(r?.endMs)) ? Math.round(Number(r.endMs)) : null,
      text: String(r?.text || "").trim(),
    }))
    .filter((r) => r.text.length >= 3)
    .slice(0, 200);   // a malformed write must not be able to insert thousands
  // Pages arrive in batches (≤8 per extract request). A batch replaces ONLY
  // its own pages — wiping every page chunk left a long PDF searchable on
  // its last batch alone. Pages in the batch that came back empty are
  // cleared too, so stale text cannot outlive a re-extraction.
  const scopedPages = kind === "page" && Array.isArray(pageNumbers)
    ? [...new Set(pageNumbers.filter(Number.isInteger))]
    : null;
  if (!clean.length && !scopedPages?.length) return 0;

  // Embed BEFORE deleting: a failed embed must leave the old chunks in place.
  // bill:false — platform work the owner didn't ask for (the backfill): the
  // embedding is unmetered instead of charged to their wallet.
  const embeddings = clean.length ? await embed(clean.map((r) => r.text), { userId: bill ? userId : null }) : [];
  const db = deps.db || await dbLazy();
  let del = db.schema("edu").from("record_chunks").delete()
    .eq("record_id", recordId).eq("kind", kind);
  if (scopedPages) del = del.in("page_number", scopedPages);
  await del;
  if (!clean.length) return 0;

  const now = new Date().toISOString();
  const insertRows = clean.map((r, i) => ({
    user_id: userId,
    record_id: recordId,
    content_key: contentKey,
    kind: r.kind,
    page_number: r.page_number,
    start_ms: r.start_ms,
    end_ms: r.end_ms,
    chunk_text: r.text,
    embedding: embeddings[i],
    embedded_at: embeddings[i] ? now : null,
  }));
  const { error } = await db.schema("edu").from("record_chunks").insert(insertRows);
  if (error) { console.warn("[record-search] chunk insert failed:", error.message); return 0; }
  return insertRows.length;
}

/**
 * Index one record from whatever text it currently has: its name always,
 * plus its content (paste), extraction pages (via the shared content cache)
 * or transcript windows when present. Safe to call for records with none of
 * those — the name chunk alone still makes the record findable.
 */
export async function indexRecord({ userId, recordId, name, contentKey = null, pasteText = null, pages = null, segments = null, bill = true }) {
  if (!userId || !recordId) return;
  try {
    let n = 0;
    if (name) {
      n += await replaceRecordChunks({ userId, recordId, contentKey, kind: "name", rows: [{ text: name }], bill });
    }
    if (pasteText) {
      n += await replaceRecordChunks({
        userId, recordId, contentKey, kind: "paste", bill,
        rows: chunkText(pasteText).map((text) => ({ text })),
      });
    }
    if (Array.isArray(pages) && pages.length) {
      n += await replaceRecordChunks({
        userId, recordId, contentKey, kind: "page", bill,
        pageNumbers: pages.map((p) => p?.pageNumber),
        rows: pages
          .filter((p) => String(p?.markdown || "").trim())
          .map((p) => ({ pageNumber: p.pageNumber, text: p.markdown })),
      });
    }
    if (Array.isArray(segments) && segments.length) {
      n += await replaceRecordChunks({
        userId, recordId, contentKey, kind: "transcript", bill,
        rows: windowsFromSegments(segments),
      });
    }
    if (n) console.log(`[record-search] indexed ${n} chunk(s) for record ${recordId}`);
  } catch (e) {
    console.warn(`[record-search] indexing record ${recordId} failed (sweeper will repair):`, String(e?.message || e).slice(0, 160));
  }
}

/**
 * Index an extraction/transcription that ran under a SHARED content key:
* the chunks belong to the record that owns that file key (its owner's
 * user_id — privacy rides the row). Lessons have no record row and are
 * deliberately skipped: the library search indexes records.
 */
export async function indexByContentKey({ contentKey, pages = null, segments = null, bill = true }) {
  if (!contentKey) return;
  try {
    const db = await dbLazy();
    const { data: rec } = await db.schema("edu").from("records")
      .select("id, user_id, name, file_key").eq("file_key", contentKey)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!rec) return;   // a lesson stream or an orphaned key — nothing to index under
    await indexRecord({
      userId: rec.user_id, recordId: rec.id, name: rec.name,
      contentKey: rec.file_key, pages, segments, bill,
    });
  } catch (e) {
    console.warn("[record-search] indexByContentKey failed:", String(e?.message || e).slice(0, 160));
  }
}

/* ── Read path ─────────────────────────────────────────────────────────────── */

/**
 * The library search. Embeds the query (vector arm) and lets the SQL
 * function fuse it with the lexical arm; either arm failing still leaves
 * the other. Returns chunk hits joined with their record's identity.
 */
export async function searchRecordChunks({ userId, q, limit = 12, recordId = null, full = false }) {
  const query = String(q || "").trim();
  if (!query) return [];

  // At most a few seconds for the vector (lib/searchEmbedding.js); without it, lexical only.
  const embedding = hasOpenAI()
    ? await (await import("../../lib/searchEmbedding.js")).embedForSearch(query, { userId, feature: "record_search" })
    : null;

  const db = await dbLazy();
  const { data, error } = await db.rpc("match_record_chunks", {
    p_user_id: userId,
    p_query_embedding: embedding,
    p_match_count: Math.min(Math.max(Number(limit) || 12, 1), 25),
    p_query_text: query,
    p_record_id: recordId,
  });
  if (error) throw new Error(error.message);
  // A record in Recently deleted (§7.17) keeps its chunks until the purge, but isn't found.
  const ids = [...new Set((data || []).map((r) => r.record_id).filter(Boolean))];
  const { data: gone } = ids.length
    ? await db.schema("edu").from("records").select("id").in("id", ids).not("deleted_at", "is", null)
    : { data: [] };
  const hidden = new Set((gone || []).map((g) => g.id));
  return (data || []).filter((r) => !hidden.has(r.record_id)).map((r) => ({
    recordId: r.record_id,
    name: r.record_name,
    kind: r.record_kind,
    mime: r.mime || null,
    chunkKind: r.chunk_kind,
    pageNumber: r.page_number ?? null,
    startMs: r.start_ms != null ? Number(r.start_ms) : null,
    endMs: r.end_ms != null ? Number(r.end_ms) : null,
    snippet: snippetOf(r.chunk_text),
    ...(full ? { text: r.chunk_text || "" } : {}),   // Ask needs the whole passage
    similarity: r.similarity != null ? Number(r.similarity) : 0,
    fused: r.fused != null ? Number(r.fused) : 0,
  }));
}

/* ── The platform (Discover) search ─────────────────────────────────────────
   The library search widened to the community's free notes — the records
   the Discover feed shows: uploads and pastes, not private, not deleted,
   not the requester's own, and never a Premium subscriber's (the access.js
   rule). The hybrid RPC is owner-scoped, so this arm is lexical: chunks
   carrying the query's significant terms. Every hit is re-verified against
   its record before it is returned — a chunk outlives nothing its record
   wouldn't allow. Callers score the hits (studyMaterialCore's term
   coverage) and rank records exactly like the own-Library tier. */

const PLATFORM_STOPWORDS = new Set([
  "the", "and", "for", "from", "with", "this", "that", "what", "about", "into",
  "quiz", "make", "create", "please", "notes", "note", "material", "materials",
]);

export async function searchPlatformChunks({ userId, q, limit = 40 }) {
  const query = String(q || "").trim();
  if (!query || !userId) return [];
  const terms = [...new Set(query.toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !PLATFORM_STOPWORDS.has(t)))].slice(0, 6);
  if (!terms.length) return [];
  const db = await dbLazy();
  const { data: chunks, error } = await db.schema("edu").from("record_chunks")
    .select("record_id, chunk_text, page_number, kind")
    .neq("user_id", userId)
    .or(terms.map((t) => `chunk_text.ilike.%${t}%`).join(","))
    .limit(Math.min(Math.max(Number(limit) || 40, 1), 80));
  if (error) throw new Error(error.message);
  if (!chunks?.length) return [];
  const ids = [...new Set(chunks.map((c) => c.record_id).filter(Boolean))];
  const { activePremiumUserIds } = await import("./access.js");
  const premium = new Set(await activePremiumUserIds().catch(() => []));
  const { data: recs } = await db.schema("edu").from("records")
    .select("id, user_id, name, kind, private")
    .in("id", ids).is("deleted_at", null).eq("private", false)
    .in("kind", ["upload", "paste"]).neq("user_id", userId);
  const open = new Map((recs || []).filter((r) => !premium.has(r.user_id)).map((r) => [r.id, r]));
  if (!open.size) return [];
  const ownerIds = [...new Set([...open.values()].map((r) => r.user_id))];
  const { data: users } = await db.schema("edu").from("users").select("id, full_name").in("id", ownerIds);
  const owners = new Map((users || []).map((u) => [u.id, u.full_name || "Learner"]));
  return chunks.filter((c) => open.has(c.record_id)).map((c) => {
    const rec = open.get(c.record_id);
    return {
      recordId: c.record_id, name: rec.name, kind: rec.kind,
      ownerId: rec.user_id, ownerName: owners.get(rec.user_id) || "Learner",
      chunkKind: c.kind, pageNumber: c.page_number ?? null,
      text: c.chunk_text || "", snippet: snippetOf(c.chunk_text),
    };
  });
}
