// Admin maintenance actions that would otherwise need a shell on the host.
//
// The first is the document-preview backfill: render page 1 for every upload
// whose row has no preview yet (pdfjs + napi canvas, in modules/records).
// Batched on purpose — the page runs it again until `remaining` is 0, so the
// request never sits long enough for a proxy to cut it.
import {
  listRecordsMissingPreview, countRecordsMissingPreview, generatePreviewForRecord,
  renderPdfPages, pdfTextsByPage, parsePagesWithModel, parsePageOnRunpod,
} from "../records/index.js";
import { getExtractEngine, setExtractEngine, extractModelId } from "../records/index.js";

const MAX_BATCH = 50;

export async function backfillPreviews(req, res) {
 try {
  const dryRun = !!req.body?.dryRun;
  const requested = Number(req.body?.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(MAX_BATCH, Math.floor(requested)) : MAX_BATCH;

  let rows;
  try {
    rows = await listRecordsMissingPreview(limit);
  } catch (err) {
    console.error("[admin/previews] could not list records:", err?.message || err);
    // Surfaced to the admin console: this is an ops tool, and a generic "could
    // not read" hides the actual PostgREST error from the person running it.
    return res.status(400).json({ success: false, message: `Could not read the records table: ${err?.message || err}` });
  }

  let written = 0;
  let failed = 0;
  const failures = [];
  for (const row of rows) {
    if (dryRun) continue;
    // A render is ~200 ms; a batch of 50 stays well inside a normal request.
    let reason = null;
    const key = await generatePreviewForRecord(row, (err) => { reason = err?.message || String(err); });
    if (key) written += 1;
    else { failed += 1; if (failures.length < 5) failures.push({ id: row.id, name: row.name, reason }); }
  }

  let remaining = 0;
  try { remaining = await countRecordsMissingPreview(); }
  catch (err) { console.error("[admin/previews] count failed:", err?.message || err); }

  return res.status(200).json({ success: true, data: { dryRun, scanned: rows.length, written, failed, remaining, failures } });
 } catch (err) {
   console.error("[admin/previews] backfill failed:", err?.stack || err);
   return res.status(500).json({ success: false, message: String(err?.message || err) });
 }
}

/* GET /api/admin/records/extract-engine — which parser runs, and on which model. */
export async function readExtractEngine(req, res) {
  try {
    const engine = await getExtractEngine();
    return res.status(200).json({ success: true, data: { engine, model: extractModelId() } });
  } catch (err) {
    return res.status(500).json({ success: false, message: String(err?.message || err) });
  }
}

/* PUT /api/admin/records/extract-engine { engine: runpod|model } */
export async function writeExtractEngine(req, res) {
  try {
    const engine = await setExtractEngine(req.body?.engine, req.user?.id || null);
    return res.status(200).json({ success: true, data: { engine, model: extractModelId() } });
  } catch (err) {
    return res.status(400).json({ success: false, message: String(err?.message || err) });
  }
}

/* ── Engine comparison (ops evidence before changing the default) ────────── */

const words = (text) => new Set(String(text || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const jaccard = (a, b) => {
  const A = words(a), B = words(b);
  if (!A.size && !B.size) return 1;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / (A.size + B.size - shared);
};
const tableRows = (md) => String(md || "").split("\n").filter((l) => l.trim().startsWith("|") && !/^\|?[\s:|-]+\|?$/.test(l.trim()));
const tableCells = (md) => tableRows(md).flatMap((l) => l.split("|").map((c) => c.trim()).filter(Boolean));

/* How much of a lane's table content also appears in the page's real text —
   a proxy for table accuracy without a hand-labelled fixture. Scanned pages
   have no text layer, so the score is null there. */
function tableScore(md, pageText) {
  const cells = tableCells(md);
  if (!cells.length) return { rows: 0, cells: 0, inPageText: null };
  if (!pageText || !pageText.trim()) return { rows: tableRows(md).length, cells: cells.length, inPageText: null };
  const haystack = String(pageText).toLowerCase();
  const hit = cells.filter((c) => c.length > 2 && haystack.includes(c.toLowerCase())).length;
  return { rows: tableRows(md).length, cells: cells.length, inPageText: +(hit / cells.length).toFixed(2) };
}

/* Citation offset: the page index whose real text best matches the markdown.
   Should be the same page; +1/-1 means the engine drifted a page. */
function bestOffset(markdown, texts, pageNumber) {
  const scores = texts.map((t) => ({ page: t.pageNumber, s: jaccard(markdown, t.text) }));
  scores.sort((a, b) => b.s - a.s);
  const best = scores[0];
  if (!best) return null;
  return { offset: best.page - pageNumber, score: +best.s.toFixed(2) };
}

async function fetchPdfBytes(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`could not fetch the PDF (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 40 * 1024 * 1024) throw new Error("PDF is larger than 40 MB");
  return buf;
}

/* POST /api/admin/records/extract-compare
   { pdfUrl, from?, to? (max 3 pages), model? } → per-page metrics from both
   lanes. Admin-only; documents are fetched server-side, so CORS and storage
   do not interfere. */
export async function compareExtractEngines(req, res) {
  try {
    const url = String(req.body?.pdfUrl || "");
    if (!/^https?:\/\//.test(url)) return res.status(400).json({ success: false, message: "pdfUrl must be http(s)." });
    const from = Math.max(1, Number(req.body?.from) || 1);
    const to = Math.min(from + 2, Math.max(from, Number(req.body?.to) || from + 1));   // ≤3 pages/request
    const model = String(req.body?.model || "") || extractModelId();

    const bytes = await fetchPdfBytes(url);
    const pages = await renderPdfPages(bytes, { from, to, width: 1200 });
    if (!pages.length) return res.status(422).json({ success: false, message: "No pages rendered." });
    const texts = await pdfTextsByPage(bytes, { from, to });

    const tModel = Date.now();
    const modeled = await parsePagesWithModel({
      pages: pages.map((p) => ({ pageNumber: p.pageNumber, b64: p.jpeg.toString("base64") })),
      userId: req.user?.id || null, model,
    });
    const modelMs = Date.now() - tModel;

    const tRun = Date.now();
    const runpod = [];
    for (const p of pages) {
      try {
        const out = await parsePageOnRunpod({ imageBase64: p.jpeg.toString("base64") });
        runpod.push({ pageNumber: p.pageNumber, markdown: out.markdown, blocks: out.blocks });
      } catch (err) {
        runpod.push({ pageNumber: p.pageNumber, error: String(err?.message || err) });
      }
    }
    const runpodMs = Date.now() - tRun;

    const rows = pages.map((p) => {
      const a = modeled.find((m) => m.pageNumber === p.pageNumber) || {};
      const b = runpod.find((m) => m.pageNumber === p.pageNumber) || {};
      const pageText = texts.find((t) => t.pageNumber === p.pageNumber)?.text || "";
      return {
        page: p.pageNumber,
        overlap: a.markdown && b.markdown ? +jaccard(a.markdown, b.markdown).toFixed(2) : null,
        modelChars: (a.markdown || "").length,
        runpodChars: (b.markdown || "").length,
        modelBlocks: 0,                                  // the model lane has no geometry
        runpodBlocks: Array.isArray(b.blocks) ? b.blocks.filter((x) => Array.isArray(x.bbox_2d) && x.bbox_2d.length === 4).length : 0,
        modelTable: tableScore(a.markdown || "", pageText),
        runpodTable: tableScore(b.markdown || "", pageText),
        modelOffset: bestOffset(a.markdown || "", texts, p.pageNumber),
        runpodOffset: bestOffset(b.markdown || "", texts, p.pageNumber),
        error: a.error || b.error || null,
      };
    });
    const overlaps = rows.map((r) => r.overlap).filter((n) => typeof n === "number");
    return res.status(200).json({
      success: true,
      data: {
        model, from, to, pages: pages.length, modelMs, runpodMs,
        meanOverlap: overlaps.length ? +(overlaps.reduce((x, y) => x + y, 0) / overlaps.length).toFixed(2) : null,
        rows,
      },
    });
  } catch (err) {
    console.error("[admin/compare] failed:", err?.stack || err);
    return res.status(500).json({ success: false, message: String(err?.message || err) });
  }
}
