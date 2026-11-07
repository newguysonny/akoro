/**
 * extractPages.js — client-side page rasterization for the reader's AI
 * text extraction (hanji-parse-4b on RunPod, via /api/records/extract).
 *
 * The READER already renders PDFs (pdf.js) and images, so rasterization
 * happens right here in the browser: each page is drawn to a canvas at a
 * little under the parse model's 2-megapixel training cap, flattened to
 * white-background JPEG, and handed to the API in ≤8-page batches. The
 * server side never needs a PDF renderer, and nothing leaves the device
 * except the page images the model has to see anyway.
 *
 * Batching keeps each request small and progress honest; a failed batch
 * keeps everything parsed before it (the API upserts per page, so
 * re-running only parses what's missing).
 */
import * as pdfjsLib from 'pdfjs-dist';
import { extractRecordPages, getExtractionStatus, getRecordExtraction } from '../../services/recordsApi.js';
import { runExtraction } from '../../lib/extractRun.js';
import { fetchFileWithRetry } from '../../lib/fetchFile.js';
import { looksScanned } from '../../lib/textLayer.js';

export const MAX_RECORD_PAGES = 60;   // matches the API's cap

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

/** Render every page of an open pdf.js document to base64 JPEG pages. */
export async function rasterizePdfPages(pdf, { maxPages = MAX_RECORD_PAGES, onProgress } = {}) {
  const total = Math.min(pdf.numPages, maxPages);
  const pages = [];
  for (let p = 1; p <= total; p++) {
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
 * autoExtractUpload — the "always extract" rule, uploader's side.
 *
 * The moment a PDF or image record is registered (right after the bytes
 * land in the bucket), the uploader's browser rasterizes and parses it in
 * the background — no reader, no waiting. By the time anyone opens the
 * record (the uploader included) the extraction is cached under the file's
 * key, the teaching session grounds instantly, and the search index has
 * real text to chew on. A/V uploads don't come through here: the API
 * transcribes those itself at registration. Everything fails silent — a
 * half-finished run has still cached every batch that worked, and the
 * reader's offer remains as the manual retry for the rest.
 */
export async function autoExtractUpload(record) {
  try { await extractUpload(record); } catch { /* silent — the reader still offers if this never finished */ }
}

/**
 * extractUpload — the same run, reported: the Add record sheet shows its
 * progress and, when it fails, the error (with a retry) right where the
 * learner uploaded, instead of them finding out later in the reader.
 *
 * Resolves { status: 'skipped' } (nothing to parse: text PDF, A/V, docs),
 * { status: 'done', done, total } or { status: 'error', error, done, total }.
 * Retrying only parses pages not saved yet (the API caches per page).
 */
export async function extractUpload(record, { onProgress, isCancelled } = {}) {
  if (!record?.id || record.kind !== 'upload' || !record.fileUrl) return { status: 'skipped' };
  const isPdf   = record.mime === 'application/pdf' || /\.pdf$/i.test(record.name || '');
  const isImage = /^image\//.test(record.mime || '');
  if (!isPdf && !isImage) return { status: 'skipped' };   // text files read as-is; A/V is the API's lane
  let pages;
  let scan = false;
  try {
    if (isPdf) {
      // Loaded the way the reader loads it: PdfPages.jsx also points pdf.js
      // at its worker.
      const { loadPdfDocument } = await import('./PdfPages.jsx');
      const { pdf, texts } = await loadPdfDocument(record.fileUrl);
      // A PDF with a real text layer is read by the server for free at
      // registration — only a scan needs the paid parse. A watermark repeated
      // on every page is not a text layer (lib/textLayer.js).
      if (!looksScanned(texts || [])) return { status: 'skipped' };
      scan = true;
      pages = await rasterizePdfPages(pdf);
    } else {
      pages = await rasterizeImageFile(record.fileUrl);
    }
  } catch (e) {
    return { status: 'error', error: e?.message || 'Could not open the file to read it.', done: 0, total: 0 };
  }
  if (!pages.length) return { status: 'skipped' };
  // Pages already saved (an earlier run, or a retry) aren't sent again.
  const saved = await getRecordExtraction(record.id).catch(() => ({ pages: [] }));
  // A scan's saved text-layer pages (the watermark, read before this rule) are parsed again.
  const have = new Set((saved?.pages || []).filter((p) => !(scan && p.model === 'pdf-text')).map((p) => p.pageNumber));
  const toSend = pages.filter((p) => !have.has(p.pageNumber));
  const total = pages.length;
  onProgress?.(have.size, total);
  if (!toSend.length) return { status: 'done', done: total, total };
  const res = await runRecordExtraction({
    recordId: record.id, pages: toSend, isCancelled,
    onProgress: (done) => onProgress?.(have.size + done, total),
    readSaved: () => getRecordExtraction(record.id),
  });
  const done = have.size + res.pages.length;
  if (res.error && res.error !== 'Stopped.') return { status: 'error', error: res.error, done, total };
  return { status: 'done', done, total };
}

/** runRecordExtraction — see lib/extractRun.js; bound to the real API here. */
export function runRecordExtraction(opts = {}) {
  return runExtraction({ submit: extractRecordPages, poll: getExtractionStatus, ...opts });
}
