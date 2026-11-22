// Admin maintenance actions that would otherwise need a shell on the host.
//
// The first is the document-preview backfill: render page 1 for every upload
// whose row has no preview yet (pdfjs + napi canvas, in modules/records).
// Batched on purpose — the page runs it again until `remaining` is 0, so the
// request never sits long enough for a proxy to cut it.
import {
  listRecordsMissingPreview, countRecordsMissingPreview, generatePreviewForRecord,
  renderPdfPages, pdfTextsByPage, parsePagesWithModel, parsePageOnRunpod, saveExtractionPage, readRecordFileBytes,
  runDeepseekOcr, ocrConfigured,
  scanExtractionGaps, startExtractionBackfill, getExtractionBackfill,
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

/* POST /api/admin/records/extractions/backfill { dryRun, limit }
   Dry run: counts of uploads without extraction, by reader lane. Otherwise a
   job id; GET .../backfill/:jobId polls { status, total, processed, results }. */
export async function backfillExtractions(req, res) {
  try {
    if (req.body?.dryRun) {
      const gap = await scanExtractionGaps();
      return res.status(200).json({ success: true, data: { dryRun: true, ...gap } });
    }
    const out = await startExtractionBackfill({ limit: req.body?.limit, maxPages: req.body?.maxPages });
    return res.status(200).json({ success: true, data: { dryRun: false, ...out } });
  } catch (err) {
    console.error("[admin/extractions] backfill failed:", err?.stack || err);
    return res.status(500).json({ success: false, message: String(err?.message || err) });
  }
}

export async function readExtractionBackfill(req, res) {
  try {
    const job = await getExtractionBackfill(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, message: "That backfill job was not found." });
    return res.status(200).json({ success: true, data: job });
  } catch (err) {
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
      userId: null, model,
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

/* POST /api/admin/records/extract-save-test — proves the cache write path.
   Returns the thrown message instead of a bare 500. */
export async function extractSaveTest(req, res) {
  const contentKey = `debug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const out = await saveExtractionPage({ contentKey, pageNumber: 1, blocks: [], markdown: "hello from the save test", model: "debug", size: null });
    return res.status(200).json({ success: true, data: { contentKey, page: out } });
  } catch (err) {
    console.error("[admin/extract-save-test] failed:", err?.stack || err);
    return res.status(500).json({ success: false, message: String(err?.message || err), detail: String(err?.details || err?.hint || "") });
  }
}

/* POST /api/admin/records/extract-run-test {recordId, from?, to?}
   Runs the model lane against a stored record exactly as submitExtract does,
   returning the real error instead of a bare 500. Admin-only diagnostics. */
export async function extractRunTest(req, res) {
  try {
    const recordId = String(req.body?.recordId || '');
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) return res.status(400).json({ success: false, message: 'recordId is required.' });
    const bytes = await readRecordFileBytes(recordId);
    if (!bytes?.length) return res.status(404).json({ success: false, message: 'No stored file for that record.' });
    const from = Math.max(1, Number(req.body?.from) || 1);
    const to = Math.min(from + 2, Number(req.body?.to) || from + 1);
    const pages = await renderPdfPages(bytes, { from, to, width: 1200 });
    const model = extractModelId();
    const parsed = await parsePagesWithModel({
      pages: pages.map((p) => ({ pageNumber: p.pageNumber, b64: p.jpeg.toString('base64') })),
      userId: req.user?.id || null, model,
    });
    const saved = [];
    for (const r of parsed) {
      if (r.error) { saved.push({ pageNumber: r.pageNumber, error: r.error }); continue; }
      try {
        await saveExtractionPage({ contentKey: 'debug-run-' + recordId + '-' + Date.now(), pageNumber: r.pageNumber, blocks: [], markdown: r.markdown, model: r.model, size: null });
        saved.push({ pageNumber: r.pageNumber, ok: true, chars: r.markdown.length });
      } catch (err) { saved.push({ pageNumber: r.pageNumber, saveError: String(err?.message || err) }); }
    }
    return res.status(200).json({ success: true, data: { model, pages: pages.length, parsed: saved } });
  } catch (err) {
    console.error('[admin/extract-run-test] failed:', err?.stack || err);
    return res.status(500).json({ success: false, message: String(err?.message || err), stack: String(err?.stack || '').split(String.fromCharCode(10)).slice(0, 3) });
  }
}

/* POST /api/admin/records/extract-benchmark {recordId, model?, concurrency?}
   Times the vision lane over EVERY page of a stored PDF, off the request path.
   Returns { jobId } immediately; GET .../extract-benchmark/:jobId reads the
   result from edu.platform_settings. Nothing is cached. */
export async function startExtractBenchmark(req, res) {
  try {
    const recordId = String(req.body?.recordId || '');
    if (!/^[0-9a-f-]{36}$/i.test(recordId)) return res.status(400).json({ success: false, message: 'recordId is required.' });
    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const model = String(req.body?.model || '') || extractModelId();
    const concurrency = Math.min(16, Math.max(1, Number(req.body?.concurrency) || 4));
    const width = Math.min(1600, Math.max(600, Number(req.body?.width) || 1200));
    const pagesPerCall = Math.min(4, Math.max(1, Number(req.body?.pagesPerCall) || 1));
    const db = (await import('../../db.js')).default;
    const save = (value) => db.schema('edu').from('platform_settings')
      .upsert({ key: 'extract_benchmark:' + jobId, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    void (async () => {
      try {
        const bytes = await readRecordFileBytes(recordId);
        if (!bytes?.length) throw new Error('no stored file');
        const tRender = Date.now();
        const pages = await renderPdfPages(bytes, { from: 1, to: 999, width });
        const renderMs = Date.now() - tRender;
        const tModel = Date.now();
        const parsed = await parsePagesWithModel({
          pages: pages.map((p) => ({ pageNumber: p.pageNumber, b64: p.jpeg.toString('base64') })),
          userId: null, model, concurrency, pagesPerCall,
        });
        const modelMs = Date.now() - tModel;
        const ok = parsed.filter((p) => !p.error);
        await save({
          status: 'done', model, concurrency, width, pagesPerCall, pages: pages.length,
          renderMs, modelMs, totalMs: renderMs + modelMs,
          chars: ok.reduce((n, p) => n + (p.markdown || '').length, 0),
          failures: parsed.filter((p) => p.error).map((p) => ({ pageNumber: p.pageNumber, error: p.error })),
          perPage: parsed.map((p) => ({ pageNumber: p.pageNumber, chars: (p.markdown || '').length, error: p.error || null })),
        });
      } catch (err) {
        console.error('[admin/extract-benchmark] failed:', err?.stack || err);
        await save({ status: 'failed', error: String(err?.message || err) }).catch(() => {});
      }
    })();

    return res.status(202).json({ success: true, data: { jobId } });
  } catch (err) {
    return res.status(500).json({ success: false, message: String(err?.message || err) });
  }
}

export async function readExtractBenchmark(req, res) {
  const db = (await import('../../db.js')).default;
  const { data } = await db.schema('edu').from('platform_settings')
    .select('value').eq('key', 'extract_benchmark:' + req.params.jobId).maybeSingle();
  if (!data) return res.status(404).json({ success: false, message: 'Unknown benchmark job.' });
  return res.status(200).json({ success: true, data: data.value });
}

/* POST /api/admin/records/ocr-test {recordId} — run the OCR lane synchronously
   and return counts/first page, to see exactly what the API gave us. */
export async function ocrTest(req, res) {
  try {
    if (!ocrConfigured()) return res.status(501).json({ success: false, message: 'DEEPSEEK_API_KEY is not set.' });
    const recordId = String(req.body?.recordId || '');
    const bytes = await readRecordFileBytes(recordId);
    if (!bytes?.length) return res.status(404).json({ success: false, message: 'No stored file.' });
    const t0 = Date.now();
    const out = await runDeepseekOcr({ buffer: bytes, filename: 'document.pdf' });
    return res.status(200).json({ success: true, data: {
      ms: Date.now() - t0, model: out.model, pageCount: out.pageCount, pages: out.pages.length,
      chars: out.pages.reduce((n, p) => n + (p.markdown || '').length, 0),
      withBlocks: out.pages.filter((p) => (p.blocks || []).length).length,
      first: { pageNumber: out.pages[0]?.pageNumber, chars: out.pages[0]?.markdown?.length, blocks: out.pages[0]?.blocks?.length, sample: out.pages[0]?.markdown?.slice(0, 120) },
    } });
  } catch (err) {
    console.error('[admin/ocr-test] failed:', err?.stack || err);
    return res.status(500).json({ success: false, message: String(err?.message || err) });
  }
}
