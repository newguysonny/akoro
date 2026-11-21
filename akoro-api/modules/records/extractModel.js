// Direct-model page parsing: a vision model turns one rendered page into
// markdown. Same output contract as the RunPod lane (markdown + model), so the
// save path, cache, claim and reader are unchanged.
//
// The prompt is deliberately strict: transcription only, reading order,
// GFM tables, figure sentinels, and an explicit marker for anything illegible
// so a scan never turns into invented textbook prose.

import { meteredChat } from "../../lib/aiModel.js";

export const MODEL_PARSE_PROMPT = `You transcribe ONE page of a study document into clean markdown.

Rules
- Output markdown only: no preamble, no commentary, no code fences.
- Reading order: columns, then tables, then footnotes.
- Headings become markdown headings at their visual level; lists become markdown lists.
- Tables become GFM tables with the header row and every data cell.
- Diagrams, photos and figures become a line: ![figure N](figure) — never describe them.
- Keep formulas as inline LaTeX when they are readable; otherwise transcribe them as text.
- Write [unreadable] for any word or cell you cannot read. Never guess, never invent content.
- Ignore page furniture: running headers, footers, page numbers, watermarks.`;

/** One page → { markdown, model } via the configured vision model.
 *  No layout blocks: a general vision model cannot give trustworthy coordinates,
 *  so citations from this lane are page-level (bbox null) rather than boxed. */
export async function parsePageWithModel({ imageBase64, pageNumber, userId = null, model }) {
  const url = String(imageBase64 || "").startsWith("data:")
    ? String(imageBase64)
    : `data:image/jpeg;base64,${String(imageBase64 || "")}`;
  if (!url || url.length < 64) throw new Error("No page image was provided.");

  const res = await meteredChat({
    userId,
    feature: "records_extract",
    model,
    max_tokens: 4000,
    temperature: 0,
    messages: [
      { role: "system", content: MODEL_PARSE_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Page ${pageNumber}.` },
          { type: "image_url", image_url: { url, detail: "high" } },
        ],
      },
    ],
  });

  let markdown = String(res?.choices?.[0]?.message?.content || "").trim();
  // Models sometimes wrap the answer in a fence despite the prompt.
  markdown = markdown.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();
  if (!markdown) throw new Error("The model returned no text for this page.");
  return { markdown, model };
}

/** Parse a batch of pages with bounded concurrency, preserving order. */
export async function parsePagesWithModel({ pages, userId, model, concurrency = 4, onPage = null }) {
  const results = new Array(pages.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, pages.length) }, async () => {
    while (next < pages.length) {
      const index = next++;
      const page = pages[index];
      try {
        const parsed = await parsePageWithModel({ imageBase64: page.b64, pageNumber: page.pageNumber, userId, model });
        results[index] = { pageNumber: page.pageNumber, size: page.size || null, ...parsed };
        onPage?.(results[index]);
      } catch (err) {
        results[index] = { pageNumber: page.pageNumber, size: page.size || null, error: err?.message || String(err) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
