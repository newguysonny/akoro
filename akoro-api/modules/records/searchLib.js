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

import { createHash } from "node:crypto";
import { canEmbed, embeddingsProvider, selfHostedModel } from "../../lib/embeddingProvider.js";   // pure — no db, no client

const dbLazy = async () => (await import("../../db.js")).default;

/** The one embedding dimension the platform standardises on. */
export const EMBED_DIM = 1536;

/** Chunks are embedded pieces, not archives — ~a page of speech. */
export const MAX_CHUNK_CHARS = 1200;
export const INDEX_VERSION = 2;   // bumped when the chunker/cleaner bundle changes

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

/* ── Structure-aware chunking (H1/H2/H3) ─────────────────────────────────── */

const HEADING = /^(#{1,6})\s+(.+?)\s*$/;
const TABLE_ROW = /^\s*\|/;
const FENCE = /^\s*(```|~~~)/;
const FIGURE_ONLY = /^\s*(?:\*?\[figure\]\*?|!\[[^\]]*\]\([^)]*\))\s*$/i;

/** Remove layout tokens and whitespace noise; never alters table cells. */
export function cleanForEmbed(text) {
  return String(text || "")
    .replace(/<\|[^>]*\|>/g, " ")
    .replace(/\uFF5C/g, "|")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Normalised text → content hash (dedupe + embedding reuse). */
export function chunkHash(text) {
  const norm = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex");
}

/**
 * Lines repeated on most pages of ONE document: running headers, footers,
 * watermark stamps. Headings/tables/fences are never treated as boilerplate.
 */
export function boilerplateLines(pages, { share = 0.6, minPages = 3 } = {}) {
  const list = (Array.isArray(pages) ? pages : []).filter((p) => p);
  if (list.length < minPages) return new Set();
  const counts = new Map();
  for (const p of list) {
    const seen = new Set();
    for (const raw of cleanForEmbed(p?.markdown || "").split("\n")) {
      const line = raw.trim();
      if (line.length < 3 || line.length > 120) continue;
      if (HEADING.test(line) || TABLE_ROW.test(line) || FENCE.test(line)) continue;
      // A full sentence repeated on every page is content, not furniture.
      if (/[.!?]$/.test(line) && line.split(/\s+/).length > 4) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      counts.set(line, (counts.get(line) || 0) + 1);
    }
  }
  const threshold = Math.max(minPages, Math.ceil(list.length * share));
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([line]) => line));
}

/** Strip boilerplate lines and bare page numbers from a page's text. */
export function stripBoilerplate(text, boilerplate = new Set()) {
  return cleanForEmbed(text)
    .split("\n")
    .filter((raw) => {
      const line = raw.trim();
      if (!line) return true;
      if (/^\d{1,4}$/.test(line)) return false;                       // page number
      if (/^(?:page|pg\.?)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(line)) return false;
      if (/^\d+\s*(?:of|\/)\s*\d+$/i.test(line)) return false;
      if (boilerplate.has(line)) return false;
      return true;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split an oversized prose block at a boundary, with a small overlap. */
function leaves(text, maxChars, overlap) {
  const src = String(text || "").trim();
  if (!src) return [];
  if (src.length <= maxChars) return [src];
  const out = [];
  let at = 0;
  while (at < src.length) {
    let end = Math.min(src.length, at + maxChars);
    if (end < src.length) {
      const para = src.lastIndexOf("\n\n", end);
      const sentence = src.lastIndexOf(". ", end);
      if (para > at + maxChars * 0.4) end = para;
      else if (sentence > at + maxChars * 0.4) end = sentence + 1;
    }
    const piece = src.slice(at, end).trim();
    if (piece) out.push(piece);
    if (end >= src.length) break;
    at = Math.max(end - overlap, at + 1);
  }
  return out;
}

/**
 * Markdown → chunks that follow the document's structure.
 *
 * Headings define sections (their path rides on every chunk); tables, code
 * fences and figure sentinels are ATOMIC — never split across chunks, even
 * when oversized (the item is more useful intact). Figure-only chunks are
 * dropped: a placeholder has nothing to embed. Prose sections split at
 * paragraph/sentence boundaries with a 15% overlap.
 */
export function chunksFromMarkdown(markdown, { pageNumber = null, maxChars = MAX_CHUNK_CHARS, overlap = Math.round(MAX_CHUNK_CHARS * 0.15) } = {}) {
  const clean = cleanForEmbed(markdown);
  if (!clean) return [];
  const nodes = [];
  let path = [];
  let buf = [];
  let mode = null;         // "table" | "fence" while inside an atomic block
  let atomic = [];

  const section = () => path.join(" > ");
  const flushText = () => {
    const text = buf.join("\n").trim();
    buf = [];
    if (text) nodes.push({ text, sectionPath: section() || null, atomic: false });
  };
  const flushAtomic = () => {
    const text = atomic.join("\n").trim();
    atomic = [];
    mode = null;
    if (text) nodes.push({ text, sectionPath: section() || null, atomic: true });
  };

  for (const raw of clean.split("\n")) {
    const line = raw.trimEnd();
    if (mode === "fence") {
      atomic.push(line);
      if (FENCE.test(line)) flushAtomic();
      continue;
    }
    if (mode === "table") {
      if (TABLE_ROW.test(line)) { atomic.push(line); continue; }
      flushAtomic();
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushText();
      const level = heading[1].length;
      path = path.slice(0, Math.max(0, level - 1));
      path[level - 1] = heading[2].trim();
      continue;
    }
    if (FENCE.test(line)) {
      flushText();
      mode = "fence";
      atomic.push(line);
      continue;
    }
    if (TABLE_ROW.test(line)) {
      flushText();
      mode = "table";
      atomic.push(line);
      continue;
    }
    if (!line.trim()) { flushText(); continue; }
    buf.push(line);
  }
  if (mode === "fence" || mode === "table") flushAtomic();
  flushText();

  const out = [];
  let cursor = 0;
  for (const node of nodes) {
    if (!node.atomic && FIGURE_ONLY.test(node.text)) continue;
    const pieces = node.atomic ? [node.text] : leaves(node.text, maxChars, overlap);
    for (const text of pieces) {
      if (!text || FIGURE_ONLY.test(text)) continue;
      const at = clean.indexOf(text.slice(0, 40), cursor);
      const start = at >= 0 ? at : (cursor < clean.length ? cursor : null);
      const end = start != null ? Math.min(clean.length, start + text.length) : null;
      if (start != null) cursor = end;
      out.push({
        pageNumber, text, sectionPath: node.sectionPath,
        charStart: start, charEnd: end,
        oversized: node.atomic && text.length > maxChars,
      });
    }
  }
  return out;
}

/**
 * Extraction pages → index rows. Cleans each page, removes document-wide
 * boilerplate, chunks by structure and drops exact duplicates (H3).
 */
export function chunksForPages(pages) {
  const list = (Array.isArray(pages) ? pages : []).filter((p) => p);
  const boilerplate = boilerplateLines(list);
  const out = [];
  const seen = new Set();
  for (const page of list) {
    const text = stripBoilerplate(page?.markdown || "", boilerplate);
    if (!text) continue;
    for (const c of chunksFromMarkdown(text, { pageNumber: page.pageNumber })) {
      const hash = chunkHash(c.text);
      if (seen.has(hash)) continue;
      seen.add(hash);
      out.push({ ...c, contentHash: hash });
    }
  }
  return out;
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
export async function replaceRecordChunks({ userId, recordId, contentKey = null, kind, rows, pageNumbers = null, bill = true, sourceType = null, docAt = null, extractVersion = null }, deps = {}) {
  const embed = deps.embedMany || embedMany;
  const clean = (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      kind,
      page_number: Number.isInteger(r?.pageNumber) ? r.pageNumber : null,
      start_ms: Number.isFinite(Number(r?.startMs)) ? Math.round(Number(r.startMs)) : null,
      end_ms: Number.isFinite(Number(r?.endMs)) ? Math.round(Number(r.endMs)) : null,
      text: String(r?.text || "").trim(),
      section_path: r?.sectionPath ? String(r.sectionPath).slice(0, 300) : null,
      char_start: Number.isInteger(r?.charStart) ? r.charStart : null,
      char_end: Number.isInteger(r?.charEnd) ? r.charEnd : null,
      content_hash: r?.contentHash || chunkHash(String(r?.text || "")),
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
    section_path: r.section_path,
    char_start: r.char_start,
    char_end: r.char_end,
    content_hash: r.content_hash,
    index_version: INDEX_VERSION,
    source_type: sourceType,
    doc_at: docAt,
    extract_version: extractVersion,
    embed_model: embeddings[i]
      ? (embeddingsProvider() === "runpod" ? selfHostedModel() : "text-embedding-3-small")
      : null,
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
export async function indexRecord({ userId, recordId, name, contentKey = null, pasteText = null, pages = null, segments = null, bill = true, sourceType = null, docAt = null, extractVersion = null }) {
  if (!userId || !recordId) return;
  try {
    let n = 0;
    if (name) {
      n += await replaceRecordChunks({ userId, recordId, contentKey, kind: "name", rows: [{ text: name }], bill, sourceType, docAt, extractVersion });
    }
    if (pasteText) {
      // Pasted notes follow the same structural chunker: headings in a note
      // are real sections, and duplicate passages are dropped once.
      const seen = new Set();
      const rows = chunksFromMarkdown(pasteText).filter((c) => {
        const hash = chunkHash(c.text);
        if (seen.has(hash)) return false;
        seen.add(hash);
        return true;
      }).map((c) => ({ ...c, contentHash: chunkHash(c.text) }));
      n += await replaceRecordChunks({ userId, recordId, contentKey, kind: "paste", bill, rows, sourceType, docAt, extractVersion });
    }
    if (Array.isArray(pages) && pages.length) {
      // H1/H2/H3: heading-aware leaves, document-wide boilerplate removed,
      // exact duplicate chunks dropped before embedding.
      n += await replaceRecordChunks({
        userId, recordId, contentKey, kind: "page", bill,
        pageNumbers: pages.map((p) => p?.pageNumber),
        rows: chunksForPages(pages), sourceType, docAt, extractVersion,
      });
    }
    if (Array.isArray(segments) && segments.length) {
      n += await replaceRecordChunks({
        userId, recordId, contentKey, kind: "transcript", bill,
        rows: windowsFromSegments(segments), sourceType, docAt, extractVersion,
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
      .select("id, user_id, name, file_key, created_at").eq("file_key", contentKey)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!rec) return;   // a lesson stream or an orphaned key — nothing to index under
    await indexRecord({
      userId: rec.user_id, recordId: rec.id, name: rec.name,
      contentKey: rec.file_key, pages, segments, bill,
      sourceType: pages?.length ? "upload" : segments?.length ? "transcript" : null,
      docAt: rec.created_at || null,
      extractVersion: pages?.[0]?.model || segments?.[0]?.model || null,
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
export async function searchRecordChunks({ userId, q, limit = 12, recordId = null, full = false, surface = "library" }) {
  const startedAt = Date.now();
  const query = String(q || "").trim();
  if (!query) return [];

  // At most a few seconds for the vector (lib/searchEmbedding.js); without it, lexical only.
  const embedding = hasOpenAI()
    ? await (await import("../../lib/searchEmbedding.js")).embedForSearch(query, { userId, feature: "record_search" })
    : null;

  const wanted = Math.min(Math.max(Number(limit) || 12, 1), 96);   // Library search pages by growing the limit in 12s
  // The RPC is tuned for recall; a second-stage rerank fixes the ORDER (the
  // paragraph that answers beats a long page that only mentions the words).
  // Fetch a wider candidate set than the page needs, then keep `wanted`.
  const rerankOn = process.env.RECORDS_RERANK !== "off";
  const db = await dbLazy();
  const { data, error } = await db.rpc("match_record_chunks", {
    p_user_id: userId,
    p_query_embedding: embedding,
    p_match_count: rerankOn ? Math.min(Math.max(wanted * 3, wanted), 96) : wanted,
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
  const live = (data || []).filter((r) => !hidden.has(r.record_id));
  const ordered = rerankOn
    ? rerankChunks({ query, chunks: live.map((r) => ({ ...r, text: r.chunk_text })), limit: wanted })
    : live.slice(0, wanted);
  // H5: the retrieval half of search health (zero-result is the useful signal).
  recordRetrieval({
    userId, surface, phase: "retrieval", query,
    zeroResult: ordered.length === 0,
    candidates: live.length,
    latencyMs: Date.now() - startedAt,
    vector: !!embedding,
    topScore: Number(ordered[0]?.fused ?? ordered[0]?.similarity ?? 0) || null,
    meta: { rerank: rerankOn, requested: wanted },
  });
  return ordered.map((r) => ({
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
   Other learners' public uploads/pastes, hybrid once the RPC exists (lexical
   fallback before the migration). Every hit is re-verified against its record:
   private/deleted, requester and Premium-owner rules still apply here. */

const PLATFORM_STOPWORDS = new Set(("the and for from with this that what about into quiz make create please notes note material materials").split(" "));

export async function searchPlatformChunks({ userId, q, limit = 40 }) {
  const query = String(q || "").trim();
  if (!query || !userId) return [];
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 80);
  const { activePremiumUserIds } = await import("./access.js");
  const premium = new Set(await activePremiumUserIds().catch(() => []));
  const db = await dbLazy();
  const embedding = hasOpenAI() ? await (await import("../../lib/searchEmbedding.js")).embedForSearch(query, { userId, feature: "platform_search" }) : null;
  let chunks = null;
  try {
    const { data, error } = await db.rpc("match_platform_chunks", {
      p_user_id: userId, p_query_embedding: embedding, p_query_text: query,
      p_match_count: cap, p_premium_user_ids: [...premium],
    });
    if (error) throw new Error(error.message);
    chunks = data || [];
  } catch { /* migration not applied yet — the lexical arm below still works */ }
  if (!chunks) {
    const terms = [...new Set(query.toLowerCase().split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !PLATFORM_STOPWORDS.has(t)))].slice(0, 6);
    if (!terms.length) return [];
    const { data, error } = await db.schema("edu").from("record_chunks")
      .select("record_id, chunk_text, page_number, kind")
      .neq("user_id", userId)
      .or(terms.map((t) => `chunk_text.ilike.%${t}%`).join(","))
      .limit(cap);
    if (error) throw new Error(error.message);
    chunks = data || [];
  }
  if (!chunks.length) return [];
  const ids = [...new Set(chunks.map((c) => c.record_id).filter(Boolean))];
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
