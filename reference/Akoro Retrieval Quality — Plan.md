# Akoro Retrieval Quality — Plan

Status: planning (no implementation yet)
Scope: Library search, Ask grounding, study-tool grounding, Discover search
Owner surface: `akoro-api/modules/records/searchLib.js`, `migrations/2026-record-search.sql`,
`lib/blogResearch.js`, `lib/embeddingSweeper.js`

This plan covers only the **high-value** and **medium-value** retrieval work identified in the
audit. Lower-value items (near-duplicate Jaccard dedupe, language provenance, permissions
snapshots in chunks) are deliberately excluded — see *Out of scope*.

---

## What exists today (baseline)

- Chunks live in `edu.record_chunks` (`user_id`, `record_id`, `content_key`, `kind`,
  `page_number`, `start_ms/end_ms`, `chunk_text`, `embedding vector(1536)`, `embedded_at`).
- **PDFs are one chunk per extracted page**, entire markdown, with no size cap.
- Pastes use `chunkText()` — paragraph → sentence → hard cut at 1200 chars.
- Transcripts use `windowsFromSegments()` (segment-aligned, 1200-char windows, ms spans).
- Blog posts already chunk by heading (`blogPassages`) into `content.blog_chunks`.
- Search is **hybrid RRF** (cosine + `to_tsvector('english')`) inside `match_record_chunks`,
  owner-scoped, with a lexical-only fallback when embeddings are unavailable.
- `searchPlatformChunks` (Discover) is **lexical only**.
- PHARM.D catalogue content is not in this index (separate Ask path).

Consequences: dense pages become weak single vectors, repeated OCR furniture (headers,
footers, page numbers, watermarks) dilutes similarity, and re-uploaded handouts create
duplicate hits and duplicate embedding spend.

---

## High value

### H1 — Heading-aware, size-capped chunking

**Why:** retrieval quality starts here. Returning the paragraph that answers a question
beats returning a whole page that merely contains it. Directly affects Ask citations,
quiz/flashcard grounding and keyword hits.

**Design**
- Split extracted markdown on H1–H3 first; each section becomes a node with a `section_path`
  (e.g. `Cell Structure > Chloroplast > Thylakoids`).
- Split large sections into 800–1200-character leaves with ~15% overlap, preferring
  paragraph, then sentence boundaries (reuse `chunkText`'s rules).
- Never split inside a GFM table, code fence or figure sentinel; oversized tables ship as a
  single chunk with a warning.
- Every chunk carries its `section_path` and page number.
- Transcripts keep the existing segment-window approach (already structure-aware).
- Hard cap per chunk (e.g. 2000 chars) as a safety net; log anything truncated.

**Touched**
- `modules/records/searchLib.js`: new pure splitter (`chunksFromMarkdown`) beside `chunkText`;
  `indexRecord`/`replaceRecordChunks` use it for `kind: "page"`.
- Schema: `section_path text`, `char_start int`, `char_end int` (see H2/M1 migration).
- Tests: pure splitter fixtures — scanned textbook page, OCR table page, long section,
  figure sentinel, transcript.

**Acceptance**
- Every page chunk ≤ cap; sections preserve heading order; tables unsplit.
- Ask on a 27-page scan cites the correct section rather than the whole page.

### H2 — Clean-for-embed

**Why:** scanned notes repeat running headers, footers, page numbers and watermarks on every
page. Those repeats dominate embeddings and make pages look alike. Cleaning the copy used for
embedding (while keeping raw markdown for display) is cheap and immediately improves ranking.

**Design**
- Add `cleanForEmbed(markdown, { pageNumber })`:
  - strip OCR layout tokens (`<|ref|>…<|/ref|>`, `<|box|>…`) that survive parsing;
  - drop lines repeated on ≥60% of a document's pages (headers/footers), page-number-only
    lines, and known watermark phrases;
  - collapse whitespace and duplicate blank lines;
  - keep tables, formulas and figure sentinels intact.
- Store the raw text in `chunk_text` for display/citations; store the cleaned text for the
  embedding input (or recompute deterministically at index time — no extra column needed if
  cleaning is pure).
- Cleaning runs before `embedMany`, never after retrieval.

**Touched**
- `modules/records/searchLib.js` (pure cleaner + wiring), `lib/blogResearch.js` (reuse for
  posts where applicable).
- Tests: header/footer removal, watermark removal, table preserved, idempotent.

**Acceptance**
- Duplicate-line rate per document drops materially on a real scanned fixture.
- No visible change to what the reader shows or cites.

### H3 — Exact-duplicate suppression

**Why:** learners re-upload the same handout; shared and catalogue files repeat across
records. Duplicates waste embedding spend and produce redundant search hits.

**Design**
- Normalise cleaned text (lowercase, collapse whitespace, strip punctuation) → SHA-256 per
  chunk.
- Within a document, drop chunks whose hash already exists (keep the first by page order).
- Across a learner's shelf, keep the chunk on the earliest record (same rule the index uses
  for shared file keys) and skip re-embedding a hash that already has a fresh vector.
- Store `content_hash` on the chunk for both dedupe and future embedding reuse.
- Do not dedupe across different owners (privacy boundary).

**Touched**
- `modules/records/searchLib.js`, schema (`content_hash text`), index on
  `(user_id, content_hash)`.

**Acceptance**
- Re-uploading an already-indexed handout adds no new embeddings and no duplicate hits.
- Distinct pages with identical boilerplate are not over-collapsed (hash is per cleaned chunk).

---

## Medium value

### M1 — Provenance metadata on every chunk

**Why:** needed to explain and tune retrieval: which section was cited, which document, how
old it is, which extractor produced it. Enables recency boosts and safe reindexing.

**Design — migration `2026-record-chunk-provenance.sql`**
- `section_path text`, `char_start int`, `char_end int` (from H1)
- `source_type text` — `upload` | `paste` | `transcript` | `catalogue` | `blog`
- `doc_at timestamptz` — record `created_at` (document date, not index date)
- `extract_version text` — parser+prompt+chunker version, e.g. `ocr-v1+chunk-v2`
- `index_version int` — bumped when the chunker changes; the sweeper repairs mismatches
- `content_hash text` (H3)
- Indexes: `(user_id, content_hash)`, `(record_id, index_version)`, `(index_version)` for
  sweep queries.
- **Not** stored per chunk: permissions/visibility snapshots. Access stays derived from
  `records.private`, owner checks and Premium rules at query time, so it cannot drift.

**Rollout**
- Backfill `doc_at`/`source_type` from `records`; `section_path`/offsets only on reindex;
  `index_version` set to the current chunker for new writes, `0` for legacy rows.
- Extend the embedding sweeper to re-chunk rows whose `index_version` is stale, in bounded
  batches, reusing the admin backfill pattern (dry-run + job).

**Acceptance**
- Every newly written chunk has provenance; queries can filter/boost by `doc_at`.
- A version bump can be rolled out and completed without downtime.

### M2 — Hybrid vector arm for Discover/platform search

**Why:** the Library is already hybrid; Discover (`searchPlatformChunks`) is lexical only,
so cross-learner discovery misses semantically relevant notes written with different words.
This is the remaining retrieval gap, and it matters for shared notes and catalogue-style
material.

**Design**
- New RPC `match_platform_chunks(p_user_id, p_query_embedding, p_query_text, p_match_count)`
  mirroring `match_record_chunks`' RRF, but:
  - only rows whose record is `private = false`, `deleted_at is null`, kind in
    (`upload`, `paste`), owner ≠ requester, and owner not an active Premium subscriber
    (the same rule as `access.js`);
  - returns record/owner identity and provenance fields needed by the Discover card.
- Keep the existing lexical prefilter as a cheap candidate stage; union with vector
  candidates before RRF, and re-verify every hit against its record before returning it
  (existing behaviour).
- Embed the query only when `canEmbed()`; otherwise fall back to today's lexical path.

**Touched**
- `migrations/2026-platform-hybrid-search.sql`, `modules/records/searchLib.js`,
  Discover callers, `lib/embeddingEvalSet.js` fixtures.
- Security review: RLS/RPC must never expose Premium-owner rows or private records.

**Acceptance**
- Discover returns semantically relevant notes for paraphrased queries.
- No access regression: private/deleted/Premium-owner rows never appear.
- p95 latency within the current search budget and lexical fallback intact.

---

## Sequencing

1. **H1 + H2 + H3** in one chunker change (same reindex), behind an `index_version` bump (M1
   schema can land in the same migration).
2. **M1 rollout** — provenance fill + sweeper reindex.
3. **M2** — platform hybrid, after evaluation shows the Library improvements held.

This order avoids two re-embeds: chunking, cleaning, dedupe and provenance land together,
then Discover changes only add a query path.

## Evaluation

Use `lib/embeddingEvalSet.js` plus real learner queries (Library search, Ask citations, tool
grounding). Measure before/after on the same corpus:

- recall@10 and MRR for known-answer queries;
- citation correctness on a 27-page scan (does the cited page/section contain the answer?);
- duplicate-hit rate per query;
- embedding spend per document (dedupe + reuse effect);
- p95 search latency;
- Discover relevance on paraphrased queries (M2 only).

Gate: ship H-series only if recall/MRR improve without a latency regression; ship M2 only if
access checks and latency hold.

## Risks

- **Reindex invalidates embeddings** — bounded by `index_version` and batched sweeper;
  old rows keep serving until replaced.
- **Over-splitting** — tables/formulas must stay whole; cap and warn on oversized chunks.
- **Over-cleaning** — never drop content that is the answer; cleaning is for embeddings, raw
  text stays for display and citations.
- **Exact-hash dedupe across pages** — legitimate repeated boilerplate remains once; verify
  with fixtures before enabling cross-record reuse.
- **Discover vectors** — privacy is enforced in SQL; every hit is still re-verified against
  its record before returning.

## Out of scope (deliberately)

- Near-duplicate (Jaccard/shingle) suppression.
- Language provenance and multilingual embedding models.
- Permissions snapshots stored per chunk.
- Reranker models and query rewriting.
- PHARM.D catalogue indexing (its Ask path is separate).
