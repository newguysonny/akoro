/**
 * pdfRender.js — rasterise a PDF's pages to PNG data URLs (for vision OCR).
 *
 * Uses pdfjs-dist + @napi-rs/canvas (prebuilt binary, no native build → works
 * on Railway). The font config below is essential: without it pdfjs skips
 * non-embedded standard fonts (Times/Helvetica) and the page renders blank text.
 *   useSystemFonts:false + standardFontDataUrl + disableFontFace:true
 */
import { createRequire } from "node:module";
import path from "node:path";

// @napi-rs/canvas (native binary) and pdfjs are imported LAZILY inside the
// render function — not at module load — so a canvas/pdfjs load failure on the
// host can never crash API startup. Only the vision-PDF feature would degrade.
const require = createRequire(import.meta.url);

/**
 * @param {Buffer} buffer  PDF bytes
 * @param {object} [opts]
 * @param {number} [opts.maxPages=15]  cap pages sent to vision (bounds cost)
 * @param {number} [opts.scale=2]      render scale (higher = crisper text)
 * @returns {Promise<string[]>} array of PNG data URLs (one per page)
 */
export async function renderPdfToImages(buffer, { maxPages = 15, scale = 2 } = {}) {
  const [{ createCanvas }, { getDocument }] = await Promise.all([
    import("@napi-rs/canvas"),
    import("pdfjs-dist/legacy/build/pdf.mjs"),
  ]);
  // Resolve pdfjs's bundled standard fonts regardless of cwd.
  const STANDARD_FONTS = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + path.sep;

  const doc = await getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: STANDARD_FONTS,
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise;

  const n = Math.min(doc.numPages, maxPages);
  const images = [];
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    images.push(`data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`);
    page.cleanup();
  }
  await doc.destroy();
  return { images, totalPages: doc.numPages, rendered: n };
}
