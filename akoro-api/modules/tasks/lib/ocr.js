/**
 * modules/tasks/lib/ocr.js
 * Extracts text from uploaded files using OpenAI vision for images.
 */

import https     from "https";
import http      from "http";
import { openai, OPENAI_MODEL } from "../../../lib/aiModel.js";

const IMAGE_TYPES = new Set(["image/jpeg","image/jpg","image/png","image/webp","image/gif","image/bmp"]);
const TEXT_TYPES  = new Set(["text/plain","text/markdown","text/csv","text/html","application/json"]);

export async function extractTextFromUrl(fileUrl, mimeType, fileName) {
  try {
    if (TEXT_TYPES.has(mimeType)) {
      const text = await fetchText(fileUrl);
      return { success: true, text, method: "text" };
    }
    if (IMAGE_TYPES.has(mimeType)) {
      const text = await extractWithVision(fileUrl, fileName);
      return { success: true, text, method: "vision" };
    }
    // OpenAI chat vision handles images only; PDFs aren't supported here.
    // OCR is best-effort background enrichment, so we skip rather than fail hard.
    return { success: false, error: `Unsupported file type for OCR: ${mimeType}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function fetchText(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    let data = "";
    client.get(url, (res) => {
      res.on("data", (chunk) => { data += chunk; });
      res.on("end",  () => resolve(data));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function extractWithVision(fileUrl, fileName) {
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL, max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        { type: "text",      text: `Extract all text from this file "${fileName}". Return only the extracted text, no commentary.` },
        { type: "image_url", image_url: { url: fileUrl } },
      ],
    }],
  });
  return response.choices?.[0]?.message?.content ?? "";
}
