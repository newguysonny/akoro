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
    const body = String(m[3] || "").trim() || String(m[1] || "").trim();
    if (!body) continue;
    blocks.push({ bbox_2d: bbox, text_content: body });
  }

  if (!blocks.length) {
    // Plain text extraction (Word/PPT without images): one unboxed block.
    const plain = source.replace(/<\|[^>]*\|>/g, "").replace(/[ \t]+\n/g, "\n").trim();
    return { blocks: plain ? [{ bbox_2d: null, text_content: plain }] : [], markdown: plain };
  }
  return {
    blocks: blocks.filter((b) => Array.isArray(b.bbox_2d)),
    markdown: blocks.map((b) => b.text_content).join("\n\n"),
  };
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
