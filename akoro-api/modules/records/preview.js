// Server-side page-1 previews.
//
// The API already ships pdfjs-dist and @napi-rs/canvas for document work, so
// the first page can be rendered without a browser. Used by the generate
// endpoint (upload-time previews) and the backfill script.
//
// pdfjs needs a canvas factory in Node; @napi-rs/canvas provides the 2D
// context and JPEG encoding without a native build step.

import { createCanvas } from "@napi-rs/canvas";

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
