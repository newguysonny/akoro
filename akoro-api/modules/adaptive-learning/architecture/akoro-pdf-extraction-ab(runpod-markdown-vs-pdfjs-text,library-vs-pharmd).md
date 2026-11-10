# Akoro PDF Extraction A/B — RunPod Markdown vs pdf.js Text Layer

**What this covers:** a side-by-side comparison of the two ways a PDF becomes *content* in the reader and teaching session — **(A) library uploads**, which now run the RunPod `hanji-parse-4b` model to produce structured markdown + layout blocks, and **(B) Pharm.D course topics**, which use the PDF's embedded text via pdf.js. The comparison measures two things for each path: (1) **guide/chat grounding quality** (how well the reference text represents tables, figures, and reading order), and (2) **drag-select / text-overlay alignment** (how precisely the selectable layer sits on the printed words, especially over tables and diagrams). The outcome decides whether to adopt model extraction for text PDFs, keep pdf.js for selection, or run both (pdf.js for selection, markdown for grounding).

**Reads alongside:** [[akoro-creator-agent(custom-learning-sessions,blueprint)]], the reader in `akoro-learner/src/components/library/PdfPages.jsx`, `RecordTeachSession.jsx`, `PharmDTopicSession.jsx`, and the extraction pipeline in `akoro-api/modules/records/extractLib.js`.

---

## 1. The two paths today

| | **A — Library upload** | **B — Pharm.D topic** |
|---|---|---|
| Reader entry | `RecordTeachSession.jsx` | `PharmDTopicSession.jsx` |
| Content source | RunPod `hanji-parse-4b` markdown + blocks (after this change: always) | pdf.js `getTextContent()` embedded text |
| Reference for guide/chat | `{ name, text }` = markdown (structured) | `{ name, text }` = pdf.js joined text (flat) |
| Selectable overlay | pdf.js text layer (text pages) **or** `BlockTextLayer` (scans / extraction) | pdf.js text layer only |
| Storage | `content_parses` (keyed by `content_key`) | none — raw text derived at open |
| Cost | GPU per page (RunPod) | zero (embedded text) |

The two paths are complementary, not equivalent: pdf.js text is pixel-accurate but *structurally flat* (table cells become one jumbled line, figures vanish because they are vector graphics with no text); the model markdown preserves structure (GFM tables, `<image>` figure sentinels, reading order) but re-derives word positions from vision bboxes, which is the fragile part for selection.

## 2. What is already done

The library `scanned` gate was removed. `RecordTeachSession.jsx` previously ran the model **only** when a page's text layer was thinner than ~20 chars/page (`const scanned = joined.replace(/\s+/g,'').length < 20 * texts.length; if (!scanned) { ...pdf.js only... }`). That early-return is now gone, so **every** PDF upload falls through to the extraction path:

- cached extraction (`getRecordExtraction` / `getSharedExtraction`) → `applyExtracted` swaps in markdown + blocks immediately;
- not cached → `setExtract({ status: 'offer' })` asks before spending GPU, showing pdf.js text as the interim reference.

No server change was needed: `POST /api/records/extract` (`akoro-api/modules/records/routes.js`) already accepts any rendered page images; the "scanned-only" behaviour was entirely a client-side decision.

## 3. What is still missing: the overlay toggle

Right now a *text* PDF still renders its **pdf.js text layer** for selection, even after extraction, because `BlockTextLayer` only mounts when `hasText === false` (`PdfPages.jsx`, near line 226):

```jsx
{wrapW > 0 && hasText === false && <BlockTextLayer blocks={blockList} height={wrapW * aspect} surface={drawn ? canvasRef.current : null} surfaceKey={drawn}/>}
```

To actually compare the **extracted-markdown overlay** against the **pdf.js text layer** for drag-select, add a toggle so the extracted overlay can be shown for a text PDF:

1. **`PdfPages.jsx`** — add a prop to `PdfPage`, e.g. `selectionOverlay` (boolean). When true:
   - skip building the pdf.js text layer (early-return in `relayTextLayer`, or hide the `.pdf-text-layer` div rendered around line 204), and
   - mount `BlockTextLayer` regardless of `hasText`.
2. **`RecordTeachSession.jsx`** — `renderPageContent` (around line 546) already passes `blocks={pdfBlocks.get(i + 1)}`; add `selectionOverlay={overlayOn}`. The `overlayOn` state lives here.
3. **`SessionReaderModal.jsx`** (optional) — a toolbar button to flip `overlayOn`, or for speed just read a query param (`?overlay=1`) in `RecordTeachSession`.

## 4. Build order

| Phase | Deliverable | Notes |
|---|---|---|
| 1 | Library always-extracts | **Done.** `RecordTeachSession.jsx` `scanned` gate removed. |
| 2 | Overlay toggle in `PdfPage` | **Done.** `selectionOverlay` prop hides the pdf.js layer and mounts `BlockTextLayer` when the page has blocks. |
| 3 | Toggle plumbing | **Done.** `renderPageContent(i, { selectionOverlay })`; `SessionReaderModal` toolbar button ("PDF text" ↔ "Extracted"), shown once blocks exist. |
| 4 | A/B harness | Two openers of the same PDF: Pharm.D (pdf.js) vs a library record (markdown). |
| 5 | Measure + record | Screenshots + drag-select checks + guide replies on the same pages; fill §6 table. |
| 6 | Decide | Adopt model extraction, keep pdf.js for selection, or both. |

## 5. The A/B measurement plan

Use **one document** (e.g. BIO 111 "Cell Structure and Organization", 27 pages) in both paths. Focus on the pages with tables/diagrams (pages 3–5: Figure 1 timeline, "3.1 Units" table, the microscope comparison table) plus a plain-text page (page 2) as control.

For each path, capture:

| Measure | How | Success signal |
|---|---|---|
| Guide grounding — tables | Ask the guide to explain the page-5 microscope table | Markdown: correct column/row relationships. pdf.js: cells jumbled. |
| Guide grounding — figures | Ask about "Figure 1" on page 3 | Markdown: acknowledges the figure. pdf.js: no figure text to ground on. |
| Drag-select — table cells | Drag across "Living specimens" row | Highlight sits exactly on the printed words, confined to cells. |
| Drag-select — figure/caption | Drag across "Image credit" (page 8) | Correct caption selected, no drift over the graphic. |
| Alignment spot-check | Screenshot selection on 3–5 pages | Highlight on glyphs, not offset. |

## 6. Expected outcome (hypothesis to verify)

- **Guide/chat grounding → markdown wins.** Tables and figures are structured; pdf.js flattens them.
- **Drag-select alignment → pdf.js wins or ties.** pdf.js uses the PDF's own glyph coordinates; `BlockTextLayer` re-derives word positions from vision bboxes + `findInkLines` ink detection, which is exactly the fragile path over tables/diagrams.

If both hold, the recommended end-state is **pdf.js text layer for selection + RunPod markdown for the guide/chat reference** — which is a smaller change than a full overlay swap (use markdown only as the `reference.text`, keep pdf.js as the selectable layer).

## 7. Open design decisions

- **Auto-extract vs offer.** The change keeps the `offer` prompt (asks before GPU spend). Should text PDFs auto-extract on open, or stay offer-gated? Cost/UX trade-off.
- **Pharm.D extraction.** Pharm.D topics have no `recordId`/`contentKey`, so they can't call `POST /extract` as-is. If the model wins for grounding, do we give Pharm.D topics a `contentKey` (or extract them in a backfill) so the guide also gets markdown?
- **Two-layer hybrid.** If we keep pdf.js for selection and markdown for grounding, the `reference` swap in `applyExtracted` already does the grounding half — the toggle (§3) is only needed for the *selection* half of the comparison.
- **Model.** This plan is intentionally model-agnostic; execute the A/B with a capable non-v4-pro model and record results before any further code changes.
