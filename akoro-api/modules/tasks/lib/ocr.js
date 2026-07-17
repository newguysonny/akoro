/**
 * modules/tasks/lib/ocr.js
 * Extracts text from uploaded files using Claude Vision for images/PDFs.
 */

import Anthropic from "@anthropic-ai/sdk";
import https     from "https";
import http      from "http";
import { ANTHROPIC_MODEL } from "../../../lib/aiModel.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const IMAGE_TYPES = new Set(["image/jpeg","image/jpg","image/png","image/webp","image/gif","image/bmp"]);
const TEXT_TYPES  = new Set(["text/plain","text/markdown","text/csv","text/html","application/json"]);

export async function extractTextFromUrl(fileUrl, mimeType, fileName) {
  try {
    if (TEXT_TYPES.has(mimeType)) {
      const text = await fetchText(fileUrl);
      return { success: true, text, method: "text" };
    }
    if (IMAGE_TYPES.has(mimeType) || mimeType === "application/pdf") {
      const text = await extractWithVision(fileUrl, mimeType, fileName);
      return { success: true, text, method: "vision" };
    }
    return { success: false, error: `Unsupported file type: ${mimeType}` };
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

async function extractWithVision(fileUrl, mimeType, fileName) {
  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL, max_tokens: 4096,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "url", url: fileUrl } },
        { type: "text",  text: `Extract all text from this file "${fileName}". Return only the extracted text, no commentary.` },
      ],
    }],
  });
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}
