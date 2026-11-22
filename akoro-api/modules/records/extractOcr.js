// DeepSeek OCR lane — the document is recognised SERVER-SIDE.
//
// POST https://api.deepseek.com/v1/tools/ocr with the stored file returns one
// text per page. With rich_layout_recognition the text carries layout tokens
// (the API uses full-width bars, ｜ref｜):
//   <|ref|>label<|/ref|><|box|>[[x1,y1,x2,y2]]<|/box|> CONTENT
// Coordinates are 0-1000 normalised — the same bbox_2d the RunPod lane produced,
// so citations keep their boxes and the reader's text overlay works.
//
// Compared with the chat-vision lane this needs no page rendering, is billed
// per page ($0.225 / 1000) and is a single request per document.

import { readFileObject } from "./lib/storage.js";
import { claimContentJob, finishContentJob, saveExtractionPages } from "./extractLib.js";
import { indexByContentKey } from "./searchLib.js";

const BASE = (process.env.DEEPSEEK_OCR_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");

export const ocrConfigured = () => Boolean(process.env.DEEPSEEK_API_KEY);

/**
 * One page's raw OCR text → { blocks: [{bbox_2d, text_content}], markdown }.
 * The label between ref tokens is a type ("text", "sub_title"); the text after
 * the box is the actual page content for that box, ending at the next ref.
 */
export function parseOcrPage(text) {
  const source = String(text || "").replace(/\uFF5C/g, "|");
  const blocks = [];
  // Built from strings so the ref/box slashes need no regex escaping:
  // <|ref|>label<|/ref|><|box|>[[x,y,x,y]]<|/box|> CONTENT …
  const withBox = new RegExp(
    "<\\|ref\\|>([\\s\\S]*?)<\\|/ref\\|>\\s*<\\|box\\|>([\\s\\S]*?)<\\|/box\\|>\\s*([\\s\\S]*?)(?=<\\|ref\\|>|$)",
    "g",
  );

  let m;
  while ((m = withBox.exec(source))) {
    let bbox = null;
    try {
      const arr = JSON.parse(m[2].trim());
      if (Array.isArray(arr?.[0]) && arr[0].length === 4) bbox = arr[0].map(Number);
      else if (Array.isArray(arr) && arr.length === 4) bbox = arr.map(Number);
    } catch { /* keep the text without a box */ }
    const label = String(m[1] || "").trim();
    const body = String(m[3] || "").trim() || label;
    const figure = FIGURE_TEXT.test(body) || (!String(m[3] || "").trim() && /image|figure|picture|diagram/i.test(label));
    if (!body && !figure) continue;
    blocks.push({ bbox_2d: bbox, text_content: figure ? "*[figure]*" : body });
  }

  if (!blocks.length) {
    // Plain text extraction (Word/PPT without images): one unboxed block.
    const plain = source.replace(/<\|[^>]*\|>/g, "").replace(/[ \t]+\n/g, "\n").trim();
    return { blocks: plain ? [{ bbox_2d: null, text_content: plain }] : [], markdown: plain };
  }
  return {
    blocks: blocks.filter((b) => Array.isArray(b.bbox_2d)),
    markdown: normaliseTables(blocks.map((b) => b.text_content).join("\n\n")),
  };
}


const FIGURE_TEXT = /^\s*(?:\[?(?:figure|fig\.?|image|diagram|chart|graph|photo|illustration)\]?)\s*[.:]?\s*$/i;

/** HTML <table> blocks from the OCR provider → GFM, so grounding cites a
    table instead of raw <tr><td> soup. Unsafe/irregular tables are kept
    verbatim (prefixed [table]) rather than guessed. */
export function normaliseTables(markdown) {
  const src = String(markdown || "");
  if (!/<table[\s>]/i.test(src)) return src;
  return src.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = [];
    for (const row of table.matchAll(/<tr[\s>][\s\S]*?<\/tr>/gi)) {
      const cells = [...row[0].matchAll(/<(td|th)[\s>][\s\S]*?<\/\1>/gi)]
        .map((c) => c[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return "[table] " + table.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const width = Math.max(...rows.map((r) => r.length));
    if (rows.some((r) => r.length !== width)) {
      return "[table] " + rows.map((r) => r.join(" | ")).join("; ");
    }
    const line = (r) => `| ${r.join(" | ")} |`;
    return [line(rows[0]), `| ${rows[0].map(() => "---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n");
  });
}

/** Recognise a buffer (PDF/Office/image) page by page. Returns normalised pages. */
export async function runDeepseekOcr({ buffer, filename = "document.pdf", purpose = "rich_layout_recognition", fetchImpl = null }) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw Object.assign(new Error("DeepSeek OCR is not configured (DEEPSEEK_API_KEY)"), { status: 501 });
  if (!buffer?.length) throw new Error("No file to recognise.");

  const form = new FormData();
  form.append("purpose", purpose);
  form.append("file", new Blob([buffer], { type: "application/pdf" }), filename);

  const fx = fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 190_000);   // API allows 180 s total
  let json;
  try {
    const res = await fx(`${BASE}/v1/tools/ocr`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      // 402 balance, 413 size, 429 too many in progress, 503/504 transient.
      throw Object.assign(new Error(`DeepSeek OCR HTTP ${res.status}: ${body.slice(0, 200)}`), { status: res.status });
    }
    json = JSON.parse(body.trim() || "{}");
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("DeepSeek OCR did not finish in time (180 s).");
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (json?.error) throw new Error(`DeepSeek OCR: ${json.error.message || json.error.code || "failed"}`);
  const pages = Array.isArray(json?.pages) ? json.pages : [];
  if (!pages.length) throw new Error("DeepSeek OCR returned no pages.");
  return {
    model: "deepseek-ocr",
    pageCount: Number(json.page_count) || pages.length,
    pages: pages.map((p) => {
      const parsed = parseOcrPage(p.text);
      return {
        pageNumber: Number(p.index) + 1,
        blocks: parsed.blocks,
        markdown: parsed.markdown,
        truncated: p.finish_reason === "length",
      };
    }),
  };
}

/**
 * Start the whole-document OCR for a freshly uploaded scan, off the request
 * path. Upload used to rely on the Add sheet's browser run: if the learner
 * opened the record first (or the sheet closed), the reader offered "Read
 * this PDF with AI?" even though extraction was meant to be automatic. The
 * claim means the browser's run (or a reader tap) polls this job instead of
 * paying for a second recognition.
 */
export async function startRecordScanExtraction({ userId = null, contentKey, name = "" } = {}) {
  if (!ocrConfigured() || !contentKey) return false;
  // Claim BEFORE returning: the upload response is what the client uses to
  // poll. If the claim landed after the response, the first status read said
  // done:true/pages:[] (a race) and the Add sheet closed while OCR was only
  // just starting.
  let claimed = false;
  try { claimed = await claimContentJob(contentKey, "parse", userId); }
  catch { return false; }
  if (!claimed) return false;
  void (async () => {
    try {
      const { body } = await readFileObject(contentKey);
      const out = await runOcrWithFallback({ buffer: body, filename: name || "document.pdf" });
      await saveExtractionPages({ contentKey, pages: out.pages, model: out.model });
      await indexByContentKey({ contentKey, pages: out.pages, bill: false });
      await finishContentJob(contentKey, "parse", "done", { mode: "ocr", model: out.model, pages: out.pages.length });
    } catch (err) {
      await finishContentJob(contentKey, "parse", "failed", { mode: "ocr", error: String(err?.message || err) }).catch(() => {});
    }
  })();
  return true;
}

/** How much usable text an OCR answer actually carries. Exported for tests. */
export function ocrQuality(pages) {
  const list = Array.isArray(pages) ? pages : [];
  const chars = list.reduce((n, p) => n + String(p?.markdown || "").trim().length, 0);
  const unreadable = list.reduce((n, p) => n + (String(p?.markdown || "").match(/\[unreadable\]/gi) || []).length, 0);
  const perPage = list.length ? chars / list.length : 0;
  const unreadableShare = chars ? (unreadable * 12) / chars : 0;
  return {
    pages: list.length,
    chars,
    perPage: Math.round(perPage),
    unreadable,
    unreadableShare: Number(unreadableShare.toFixed(3)),
    weak: list.length === 0 || perPage < 12 || unreadableShare > 0.08,
  };
}

const isPdfBuffer = (buffer, name = "") =>
  /pdf/i.test(String(name || "")) || buffer?.subarray?.(0, 4)?.toString?.() === "%PDF";

/**
 * OCR, with a quality gate and a model-lane fallback.
 *
 * The provider is a black box: an empty answer, a few characters, or a page
 * of [unreadable] tokens happens. When that happens AND a vision model is
 * configured, render the PDF and parse the pages with the model lane; keep the
 * OCR answer when the fallback is unavailable or also fails (some text beats
 * none). Images are not rendered here — their OCR answer is returned as-is.
 * Set RECORDS_OCR_FALLBACK=off to make the lane strictly OCR.
 */
export async function runOcrWithFallback({ buffer, filename = "document.pdf", deps = {} } = {}) {
  const ocr = deps.ocr || runDeepseekOcr;
  let first = null;
  let firstErr = null;
  try { first = await ocr({ buffer, filename }); } catch (err) { firstErr = err; }

  const quality = first ? ocrQuality(first.pages) : null;
  const enabled = process.env.RECORDS_OCR_FALLBACK !== "off";
  if (first && (!quality.weak || !enabled)) return { ...first, lane: "ocr", quality };
  if (!enabled || !isPdfBuffer(buffer, filename)) {
    if (first) return { ...first, lane: "ocr", quality };
    throw firstErr || new Error("OCR returned no usable text.");
  }

  try {
    const render = deps.render || (await import("./preview.js")).renderPdfPages;
    const parseModel = deps.parseModel || (await import("./extractModel.js")).parsePagesWithModel;
    const { extractModelId } = await import("./extractEngine.js");
    const rendered = await render(buffer, { from: 1, to: 40, width: 1100 });
    if (!rendered.length) throw new Error("No pages could be rendered for the fallback.");
    const model = extractModelId();
    const parsed = await parseModel({
      pages: rendered.map((p) => ({ pageNumber: p.pageNumber, b64: p.jpeg.toString("base64") })),
      model,
    });
    const pages = parsed.filter((p) => !p.error).map((p) => ({
      pageNumber: p.pageNumber, blocks: [], markdown: p.markdown || "", model: p.model || model,
    }));
    if (!pages.length) throw new Error("The fallback model returned no text.");
    return {
      model, pageCount: pages.length, pages, lane: "model-fallback", quality,
      ocrError: firstErr ? String(firstErr.message || firstErr).slice(0, 200) : null,
    };
  } catch (err) {
    if (first) return { ...first, lane: "ocr", quality, fallbackError: String(err?.message || err).slice(0, 200) };
    throw firstErr || err;
  }
}
