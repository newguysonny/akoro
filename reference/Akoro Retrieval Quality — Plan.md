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

### H4 — Citation integrity: every claim carries its exact source

**Why:** Ask/tools already ask the model to cite `[n]` and map markers to page, bbox and a
quote (`extractCitations` in `modules/records/askLib.js`), but nothing checks that citations
are complete or that unsupported claims are surfaced. Given the product promise ("cite the
exact source"), this is high value and cheap because the machinery exists.

**Design**
- Deterministic post-check on every generated answer:
  - split the answer into sentences/claims, ignoring headings and list labels;
  - flag claims with no valid `[n]` and any marker that maps to no passage;
  - require at least one citation per paragraph when passages were supplied.
- Keep the existing jump targets: page number, bbox/token box or `start_ms/end_ms`, and the
  quoted passage — the exact source, not just the document.
- When coverage is incomplete, mark the answer as partially grounded in the UI (a subtle
  badge, "some points aren't cited") rather than presenting it as fully sourced.
- Log coverage and unknown-marker counts per surface (see H5); never rewrite the answer
  silently.

**Touched**
- `modules/records/askLib.js` (pure `citationCoverage(answer, citations)`), answer route,
  reader citation UI, study-tool output path.
- Tests: claim splitter, marker mapping, unknown markers, no-passage case.

**Acceptance**
- Coverage is recorded for every generated answer.
- Uncited claims are visibly marked; unknown citation markers are never shown.

### H5 — Measure retrieval and generation separately

**Why:** tuning is guesswork without numbers. Retrieval and generation fail differently: no
useful passage versus a weak answer over good passages. There is an embedding eval set but no
query telemetry, and zero-result searches are invisible.

**Design**
- One bounded event per search/ask (tenant-scoped, retention-limited):
  - retrieval: surface (library, discover, ask, tool, chat), normalised query, filters,
    latency, candidate counts, vector-vs-lexical contribution, top fused score,
    zero/weak-result flag;
  - generation: passages supplied, citations emitted, coverage (H4), unknown markers, model,
    prompt version (M2), answer length, latency.
- Separate views: retrieval health (zero-result rate, citation jumps, "open source" clicks,
  follow-up rephrase rate) and generation health (citation coverage, unresolved claims,
  sampled answer↔quote agreement).
- Every query that returned nothing useful is a row with `zero_result = true` and the
  normalised query, so gaps (synonyms, metadata, missing catalogue content) are listable.
- Surface the same data in an admin view; reuse the admin jobs/backfill pattern for reports.

**Touched**
- New event-table migration; `searchLib.js`, ask/tool routes, Discover search, admin
  maintenance.

**Acceptance**
- Zero-result queries can be listed and grouped for any date range.
- Retrieval and generation are reported independently.

### H6 — Tables, figures and scans as first-class content

**Why:** real inputs are scanned textbooks and notes, not clean prose. The RunPod lane emits
figure sentinels and the reader expects layout blocks, but the OCR lane joins block text
verbatim: tables arrive as raw/HTML fragments (seen in Ask quotes) and figures can disappear.
Character chunking then splits tables across vectors.

**Design**
- Normalise tables before indexing and grounding: convert OCR HTML/row fragments to GFM
  tables with a header row; when conversion is unsafe, keep the table as one verbatim block
  prefixed `[table]`.
- Preserve figure placeholders in the OCR lane (RunPod already emits `*[figure]*`); never
  embed a placeholder-only chunk, and exclude placeholders from claim grounding.
- Keep tables, formulas and figure sentinels unsplit in the H1 chunker; oversized tables ship
  as a single chunk with a warning.
- Scans need no OCR-lane change; the point is that everything downstream treats layout
  content as structured, not prose.

**Touched**
- `modules/records/extractOcr.js`, `modules/records/extractLib.js` (markdown builder),
  `searchLib.js` (unsplittable blocks), reader table rendering check.
- Fixtures: scanned table page, figure-only page, mixed text/table/photo page.

**Acceptance**
- A scanned table retrieves and cites as a table, not as broken HTML rows.
- Figure-only pages create no bogus embeddings or unsupported claims.

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

### M2 — Version embeddings, chunking and prompts together

**Why:** vectors and extractions are attributable only loosely today (`content_parses.model`,
an in-process embedding cache key). A chunker or prompt change cannot be rolled out or rolled
back safely. This belongs with M1's provenance work.

**Design**
- Stamp every write with the bundle it came from: `embed_provider`, `embed_model`,
  `chunker_version`, `extract_version`, `prompt_version`, and `index_version` (one integer
  that bumps when any of them changes).
- Bump the bundle when changing H1/H2/H6, the Ask/tool prompts or the embedding model; the
  sweeper re-embeds stale rows in bounded batches using M1's reindex mechanism.
- Keep the embedding cache key `provider:model` (already correct); chunks additionally record
  which model produced their vector so a mixed-index state is detectable.
- Reindex jobs are resumable, dry-runnable and report remaining rows (same admin pattern as
  previews/extraction).

**Acceptance**
- Any answer can be traced to its chunker/extractor/prompt/embedding bundle.
- Changing a prompt or the chunker has an explicit, measurable rollout path.

### M3 — Hybrid vector arm for Discover/platform search

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

1. **H4 + H5 first (cheap, read-only)** — citation coverage and query telemetry set the
   baseline; no reindex.
2. **H1 + H2 + H3 + H6** in one chunker/extraction change (same reindex), with the M1/M2
   schema (section path, provenance, version bundle) in the same migration.
3. **M1 + M2 rollout** — provenance/version fill + batched sweeper reindex.
4. **M3** — platform hybrid, after evaluation shows the Library improvements held.

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
- citation coverage and unknown-marker rate (H4);
- zero-result and weak-result query rates, grouped by surface (H5);
- table/figure fidelity on scanned fixtures (H6);
- Discover relevance on paraphrased queries (M3 only).

Gate: ship H-series only if recall/MRR improve without a latency regression; ship M3 only if
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

## Caching (already partly done)

- **Embeddings are cached today**: `lib/embeddingCache.js` keys `provider:model + content
  hash` in Postgres, and `lib/searchEmbedding.js` shares an identical question's embedding
  for 60 s. H3 extends this by reusing vectors for identical chunk hashes; no new cache is
  needed for text.
- **Frequent-answer caching is deliberately excluded**: answers depend on the passage set,
  prompt version, model and learner context; a cached answer must preserve citations and be
  invalidated on every reindex or prompt bump. The gain does not justify the staleness and
  personalisation risk. Cache retrieval candidates instead (H5 data) if latency ever becomes
  the bottleneck.

## Out of scope (deliberately)

- Near-duplicate (Jaccard/shingle) suppression.
- Language provenance and multilingual embedding models.
- Permissions snapshots stored per chunk.
- Reranker models and query rewriting.
- PHARM.D catalogue indexing (its Ask path is separate).
- Frequent-answer / semantic answer caching (see above).
