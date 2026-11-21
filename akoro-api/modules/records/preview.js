// Server-side page-1 previews.
//
// The API already ships pdfjs-dist and @napi-rs/canvas for document work, so
// the first page can be rendered without a browser. Used by the generate
// endpoint (upload-time previews) and the backfill script.
//
// pdfjs needs a canvas factory in Node; @napi-rs/canvas provides the 2D
// context and JPEG encoding without a native build step.

import { createCanvas, loadImage } from "@napi-rs/canvas";

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}

class NapiCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(target, width, height) {
    target.canvas.width = width;
    target.canvas.height = height;
  }
  destroy(target) {
    if (!target) return;
    target.canvas.width = 0;
    target.canvas.height = 0;
    target.canvas = null;
    target.context = null;
  }
}

/** Pages of a PDF as JPEG buffers (1-indexed, inclusive), for extraction
    comparisons and backfills that need the same rasteriser the previews use. */
export async function renderPdfPages(buffer, { from = 1, to = 1, width = 1200 } = {}) {
  if (!buffer?.length) return [];
  const lib = await loadPdfjs();
  const factory = new NapiCanvasFactory();
  let doc = null;
  const out = [];
  try {
    doc = await lib.getDocument({ data: new Uint8Array(buffer), canvasFactory: factory, disableFontFace: true, useSystemFonts: true, isEvalSupported: false }).promise;
    const last = Math.min(to, doc.numPages);
    for (let n = Math.max(1, from); n <= last; n += 1) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, width / base.width);
      const viewport = page.getViewport({ scale });
      const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: context, viewport }).promise;
      out.push({ pageNumber: n, jpeg: await canvas.encode("jpeg", 82) });
    }
  } finally {
    try { await doc?.destroy(); } catch { /* already gone */ }
  }
  return out;
}

/** A downscaled JPEG of an image upload (the picture IS the preview). */
export async function renderImagePreview(buffer, { width = 360 } = {}) {
  if (!buffer?.length) return null;
  try {
    const img = await loadImage(buffer);
    const scale = Math.min(1, width / img.width);
    const canvas = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvas.encode("jpeg", 80);
  } catch (err) {
    console.error("[preview] image render failed:", err?.message || err);
    return null;
  }
}

/** The first page of a text/markdown note, drawn as a document. */
export async function renderTextPreview(text, { width = 360, height = 480 } = {}) {
  const source = String(text || "").replace(/\r/g, "").trim();
  if (!source) return null;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // A slim accent bar so a note still reads as Akoro, not a blank page.
  ctx.fillStyle = "#6C3BFF";
  ctx.fillRect(0, 0, 6, height);

  const pad = 22;
  const lineHeight = 17;
  const maxLines = Math.floor((height - pad * 2) / lineHeight);
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#1c1c28";
  ctx.textBaseline = "top";

  // Wrap on words; markdown noise is stripped so headings read as text.
  const clean = source
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ");
  const lines = [];
  // Keep paragraph breaks: wrap each source line, and a blank line stays blank.
  for (const sourceLine of clean.split("\n")) {
    if (!sourceLine.trim()) { lines.push(""); continue; }
    let current = "";
    for (const word of sourceLine.trim().split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width > width - pad * 2) {
        if (current) lines.push(current);
        current = word;
        if (lines.length >= maxLines) break;
      } else current = candidate;
    }
    if (current && lines.length < maxLines) lines.push(current);
    if (lines.length >= maxLines) break;
  }

  lines.forEach((textLine, i) => {
    const y = pad + i * lineHeight;
    ctx.fillText(i === lines.length - 1 && lines.length === maxLines ? `${textLine.slice(0, -1)}…` : textLine, pad, y);
  });
  return await canvas.encode("jpeg", 80);
}

/** Pick the right renderer for an upload: PDF page, image, or text page. */
export async function renderPreview({ mime = "", name = "", body } = {}) {
  if (!body?.length) return null;
  const lower = String(name || "").toLowerCase();
  const type = String(mime || "").toLowerCase();
  const isPdf = type.includes("pdf") || lower.endsWith(".pdf") || body.subarray(0, 4).toString() === "%PDF";
  if (isPdf) return renderPdfFirstPage(body);
  const isImage = type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp)$/.test(lower);
  if (isImage) return renderImagePreview(body);
  const isText = type.startsWith("text/") || /\.(txt|md|markdown)$/.test(lower);
  if (isText) return renderTextPreview(body.toString("utf8"));
  return null;
}

/** Page 1 of a PDF as a JPEG buffer, or null when it cannot be rendered. */
export async function renderPdfFirstPage(buffer, { width = 360, quality = 0.72 } = {}) {
  if (!buffer?.length) return null;
  const lib = await loadPdfjs();
  const factory = new NapiCanvasFactory();
  let doc = null;
  try {
    doc = await lib.getDocument({
      data: new Uint8Array(buffer),
      canvasFactory: factory,
      disableFontFace: true,
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, width / base.width);
    const viewport = page.getViewport({ scale });
    const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: context, viewport }).promise;
    return await canvas.encode("jpeg", Math.round(quality * 100));
  } catch (err) {
    console.error("[preview] render failed:", err?.message || err);
    return null;
  } finally {
    try { await doc?.destroy(); } catch { /* already gone */ }
  }
}
