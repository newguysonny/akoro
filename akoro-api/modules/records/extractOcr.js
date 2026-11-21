// DeepSeek OCR lane — the document is recognised SERVER-SIDE.
//
// POST https://api.deepseek.com/v1/tools/ocr with the stored file returns one
// text per page. With rich_layout_recognition the text carries layout tokens:
//   <|ref|>Title<|/ref|><|box|>[[52, 40, 948, 96]]<|/box|>
// coordinates are 0-1000 normalised, i.e. the same bbox_2d the RunPod lane
// produced — so citations keep their boxes and the text overlay works.
//
// Compared with the chat-vision lane this needs no page rendering, is billed
// per page ($0.225 / 1000) and is a single request per document.

const BASE = (process.env.DEEPSEEK_OCR_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");

export const ocrConfigured = () => Boolean(process.env.DEEPSEEK_API_KEY);

/** One page's raw OCR text → { blocks: [{bbox_2d, text_content}], markdown }. */
export function parseOcrPage(text) {
  const source = String(text || "");
  const blocks = [];
  // Rich layout emits: <|ref|>text<|/ref|><|box|>[[x1,y1,x2,y2]]<|/box|>
  // (the closing tag sometimes repeats <|ref|> — accept both shapes).
  const re = /<\|ref\|>([\s\S]*?)<\|\/ref\|>\s*(?:<\|box\|>\s*(\[\[[\s\S]*?\]\])\s*<\|\/box\|>)?/g;
  let m;
  while ((m = re.exec(source))) {
    const body = String(m[1] || "").trim();
    if (!body) continue;
    let bbox = null;
    if (m[2]) {
      try {
        const arr = JSON.parse(m[2]);
        if (Array.isArray(arr?.[0]) && arr[0].length === 4) bbox = arr[0].map(Number);
        else if (Array.isArray(arr) && arr.length === 4) bbox = arr.map(Number);
      } catch { /* keep the text without a box */ }
    }
    blocks.push({ bbox_2d: bbox, text_content: body });
  }

  if (!blocks.length) {
    // No tokens: plain text extraction (Word/PPT without images, or an image
    // without layout). Keep it as one unboxed block so it renders as text.
    const plain = source.replace(/<\|[^>]*\|>/g, "").replace(/\s+\n/g, "\n").trim();
    return { blocks: plain ? [{ bbox_2d: null, text_content: plain }] : [], markdown: plain };
  }

  const markdown = blocks.map((b) => b.text_content).join("\n\n");
  return { blocks: blocks.filter((b) => Array.isArray(b.bbox_2d)), markdown };
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
      // 402 = balance, 413 = size, 429 = too many concurrent, 503/504 transient.
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
