/**
 * extractPages.js — client-side page rasterization for the reader's AI
 * text extraction (hanji-parse-4b on RunPod, via /api/records/extract).
 *
 * The READER already renders PDFs (pdf.js) and images, so rasterization
 * happens right here in the browser: each page is drawn to a canvas at a
 * little under the parse model's 2-megapixel training cap, flattened to
 * white-background JPEG, and handed to the API in ≤16-page batches. The
 * server side never needs a PDF renderer, and nothing leaves the device
 * except the page images the model has to see anyway.
 *
 * Batching keeps each request small and progress honest; a failed batch
 * keeps everything parsed before it (the API upserts per page, so
 * re-running only parses what's missing).
 */
import * as pdfjsLib from 'pdfjs-dist';
import { extractRecordPages, getExtractionStatus, getRecordExtraction, getExtractionEngine } from '../../services/recordsApi.js';
import { runExtraction, EXTRACT_BATCH_PAGES } from '../../lib/extractRun.js';
import { looksScanned } from '../../lib/textLayer.js';
import { fetchFileWithRetry } from '../../lib/fetchFile.js';

export const MAX_RECORD_PAGES = 60;   // matches the API's cap

/* The OCR lane recognises the WHOLE stored file server-side in one call, so
   there is nothing to rasterize or batch: submit once (pages: []) and poll the
   job. The old path rasterized every page, uploaded them in ≤16-page batches —
   images the OCR lane ignores — and because each batch submits, a 27-page scan
   ran the full recognition twice. This keeps it to one round. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const OCR_POLL_MS = 3000;
const OCR_DEADLINE_MS = 12 * 60_000;
async function runOcrWholeDocument(record, { total = 0, onProgress } = {}) {
  // The lane saves all pages or none, so anything already stored is the whole
  // result — a retry after a completed run costs nothing.
  const before = await getRecordExtraction(record.id).catch(() => ({ pages: [] }));
  if (before?.pages?.length) return { status: 'done', done: before.pages.length, total: total || before.pages.length };
  onProgress?.(0, total);
  try {
    await extractRecordPages({ recordId: record.id, pages: [] });   // OCR branch reads the stored file
  } catch (e) {
    if (e?.status !== 409) return { status: 'error', error: e?.message || 'Could not start the extraction.', done: 0, total };
  }
  const deadline = Date.now() + OCR_DEADLINE_MS;
  let flaky = 0, limited = 0;
  for (;;) {
    await sleep(OCR_POLL_MS);
    let st;
    try { st = await getExtractionStatus({ recordId: record.id }); }
    catch (e) {
      if (e?.status === 429 && ++limited <= 8) { await sleep(15_000); continue; }
      if (!e?.status && ++flaky <= 6) { await sleep(5_000); continue; }
      return { status: 'error', error: e?.message || 'Lost the connection while reading the file.', done: 0, total };
    }
    flaky = 0;
    if (st?.failed?.length) {
      const saved = await getRecordExtraction(record.id).catch(() => ({ pages: [] }));
      return { status: 'error', error: st.failed[0]?.error || 'The file could not be read.', done: saved.pages?.length || 0, total };
    }
    if (st?.done) {
      const saved = await getRecordExtraction(record.id).catch(() => ({ pages: [] }));
      const pages = saved?.pages || [];
      if (!pages.length) return { status: 'skipped' };
      return { status: 'done', done: pages.length, total: total || pages.length };
    }
    if (Date.now() > deadline) {
      return { status: 'error', error: 'The OCR worker is taking too long — try again in a few minutes.', done: 0, total };
    }
  }
}

// The parse model trains/serves at a 2 MP pixel cap — render a bit under
// it so pages land at (roughly) the resolution the checkpoint expects and
// the base64 pages stay small.
const TARGET_PIXELS  = 1_600_000;
const JPEG_QUALITY   = 0.82;
const MAX_RENDER_SCALE = 2.5;

function drawScaled(source, srcW, srcH) {
  const scale = Math.min(MAX_RENDER_SCALE, Math.sqrt(TARGET_PIXELS / Math.max(1, srcW * srcH)));
  const canvas = document.createElement('canvas');
  canvas.width  = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';                       // PDFs paint on transparency — flatten to paper white
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const b64 = canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1];
  canvas.width = 0;                                // release the pixels eagerly
  return b64;
}

/** The text each page's own text layer carries (pdf.js text content, no
 *  rendering) — the cheap test for whether a PDF needs the parse model. */
export async function pdfPageTexts(pdf, { maxPages = MAX_RECORD_PAGES } = {}) {
  const total = Math.min(pdf.numPages, maxPages);
  const texts = [];
  for (let p = 1; p <= total; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    texts.push((tc.items || []).map((it) => String(it.str || '') + (it.hasEOL ? '\n' : ' ')).join(''));
  }
  return texts;
}

/** Render pages of an open pdf.js document to base64 JPEG pages
 *  (fromPage..maxPages; both 1-based page numbers). */
export async function rasterizePdfPages(pdf, { maxPages = MAX_RECORD_PAGES, onProgress, fromPage = 1 } = {}) {
  const total = Math.min(pdf.numPages, maxPages);
  const pages = [];
  for (let p = Math.max(1, fromPage); p <= total; p++) {
    const page = await pdf.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(MAX_RENDER_SCALE, Math.sqrt(TARGET_PIXELS / Math.max(1, base.width * base.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    // The page's REAL size (PDF points, 1/72 in) rides along, so the stored
    // extraction can map its 0-1000 boxes back to page coordinates.
    pages.push({
      pageNumber: p, imageBase64: canvas.toDataURL('image/jpeg', JPEG_QUALITY).split(',')[1],
      width: Math.round(base.width * 100) / 100, height: Math.round(base.height * 100) / 100, unit: 'pt',
    });
    canvas.width = 0;
    onProgress?.(p, total);
  }
  return pages;
}

/** One image record — fetched, downscaled to the pixel cap, base64 JPEG. */
export async function rasterizeImageFile(url) {
  const res = await fetchFileWithRetry(url);
  if (!res.ok) throw new Error(`Could not load the image (${res.status}).`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const imageBase64 = drawScaled(bmp, bmp.width, bmp.height);
  const size = { width: bmp.width, height: bmp.height, unit: 'px' };   // the original image's pixels
  bmp.close?.();
  return [{ pageNumber: 1, imageBase64, ...size }];
}

/**
 * Extraction at upload — the uploader's side.
 *
 * A PDF with a real text layer is NOT model-parsed: the API read that same
 * layer into pdf-text pages when the record registered (about a second),
 * and those pages are the document's text — citations carry their boxes.
 * Only scans (no usable text layer) and images go to the parse model,
 * right after the bytes land, in the background and with progress in the
 * Add sheet. A failed or closed run keeps every saved page; reopening or
 * retrying parses only the rest. A/V is transcribed by the API itself;
 * txt/md/csv/Office are read server-side and are not sent to the GPU.
 */
export async function autoExtractUpload(record) {
  try { await extractUpload(record); } catch { /* silent — the reader still offers if this never finished */ }
}

/**
 * extractUpload — the same run, reported: the Add record sheet shows its
 * progress and, when it fails, the error (with a retry) right where the
 * learner uploaded, instead of them finding out later in the reader.
 *
 * Resolves { status: 'skipped' } (nothing to parse: text files, A/V, docs),
 * { status: 'done', done, total } or { status: 'error', error, done, total }.
 * Retrying only parses pages not saved yet (the API caches per page).
 */
export async function extractUpload(record, { onProgress, isCancelled } = {}) {
  if (!record?.id || record.kind !== 'upload' || !record.fileUrl) return { status: 'skipped' };
  const isPdf   = record.mime === 'application/pdf' || /\.pdf$/i.test(record.name || '');
  const isImage = /^image\//.test(record.mime || '');
  if (!isPdf && !isImage) return { status: 'skipped' };   // text files read as-is; A/V is the API's lane

  const engine = await getExtractionEngine().catch(() => 'runpod');

  if (isImage) {
    if (engine === 'ocr') return runOcrWholeDocument(record, { total: 1, onProgress });
    let pages;
    try { pages = await rasterizeImageFile(record.fileUrl); }
    catch (e) { return { status: 'error', error: e?.message || 'Could not open the file to read it.', done: 0, total: 0 }; }
    if (!pages.length) return { status: 'skipped' };
    const res = await runRecordExtraction({
      recordId: record.id, pages, isCancelled, onProgress,
      readSaved: () => getRecordExtraction(record.id),
    });
    if (res.error && res.error !== 'Stopped.') return { status: 'error', error: res.error, done: res.pages.length, total: 1 };
    return { status: 'done', done: res.pages.length, total: 1 };
  }

  // PDF — loaded the way the reader loads it: PdfPages.jsx also points
  // pdf.js at its worker.
  let pdf;
  try {
    const { loadPdfDocument } = await import('./PdfPages.jsx');
    ({ pdf } = await loadPdfDocument(record.fileUrl));
  } catch (e) {
    return { status: 'error', error: e?.message || 'Could not open the file to read it.', done: 0, total: 0 };
  }
  const total = Math.min(pdf.numPages, MAX_RECORD_PAGES);
  if (!total) return { status: 'skipped' };

  // A real text layer needs no model: the API read the same layer into
  // pdf-text pages when the record registered, and those pages are the
  // document's text. Only a scan — no text at all, or a watermark repeated
  // on every page (lib/textLayer.js, the API's own rule) — is parsed.
  try {
    const texts = await pdfPageTexts(pdf, { maxPages: total });
    if (!looksScanned(texts)) return { status: 'skipped' };
  } catch { /* the text read failed — fall through to the model parse */ }

  // A scan on the OCR deployment: the server reads the stored file itself.
  if (engine === 'ocr') return runOcrWholeDocument(record, { total, onProgress });

  // Pages the MODEL already saved (an earlier run, or a retry) aren't sent
  // again. Free pdf-text pages don't count: on a scan they hold at most a
  // watermark, and model pages replace them as they land.
  const saved = await getRecordExtraction(record.id).catch(() => ({ pages: [] }));
  const have = new Set((saved?.pages || []).filter((p) => p.model !== 'pdf-text').map((p) => p.pageNumber));
  onProgress?.(have.size, total);
  const missing = [];
  for (let p = 1; p <= total; p++) if (!have.has(p)) missing.push(p);
  if (!missing.length) return { status: 'done', done: total, total };

  // Pipelined batches: the next batch renders while this one parses. The
  // API's claim allows one live batch per file, so submissions stay
  // serial — but the rendering hides behind the GPU time instead of
  // adding to it, and only missing pages are ever rendered.
  const slices = [];
  for (let i = 0; i < missing.length; i += EXTRACT_BATCH_PAGES) slices.push(missing.slice(i, i + EXTRACT_BATCH_PAGES));
  const renderSlice = (slice) => {
    const p = rasterizePdfPages(pdf, { fromPage: slice[0], maxPages: slice[slice.length - 1] });
    p.catch(() => {});   // an abandoned pre-render must not surface as an unhandled rejection
    return p;
  };
  let settledBase = have.size;   // pages settled before the current batch (the progress offset)
  let done = have.size;
  let pendingRender = renderSlice(slices[0]);
  for (let s = 0; s < slices.length; s++) {
    let rendered;
    try { rendered = await pendingRender; }
    catch (e) { return { status: 'error', error: e?.message || 'Could not open the file to read it.', done, total }; }
    if (s + 1 < slices.length) pendingRender = renderSlice(slices[s + 1]);
    const wanted = new Set(slices[s]);
    const pages = rendered.filter((p) => wanted.has(p.pageNumber));
    if (!pages.length) continue;
    const base = settledBase;
    const res = await runRecordExtraction({
      recordId: record.id, pages, isCancelled,
      onProgress: (d) => onProgress?.(Math.min(total, base + d), total),
      readSaved: () => getRecordExtraction(record.id),
    });
    done += res.pages.length;
    settledBase += res.pages.length + (res.failed?.length || 0);
    if (res.error && res.error !== 'Stopped.') return { status: 'error', error: res.error, done, total };
    if (res.error === 'Stopped.') return { status: 'done', done, total };
  }
  return { status: 'done', done, total };
}

/** runRecordExtraction — see lib/extractRun.js; bound to the real API here. */
export function runRecordExtraction(opts = {}) {
  return runExtraction({ submit: extractRecordPages, poll: getExtractionStatus, ...opts });
}
