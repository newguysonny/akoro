// Direct-model page parsing: a vision model turns rendered pages into
// markdown. Same output contract as the RunPod lane (markdown + model), so the
// save path, cache, claim and reader are unchanged.
//
// The prompt is deliberately strict: transcription only, reading order,
// GFM tables, figure sentinels, and an explicit marker for anything illegible
// so a scan never turns into invented textbook prose.
//
// Pages can be sent several per call (pagesPerCall): one request for 2–4 pages
// is where the wall-clock win is, since per-call provider latency dominates.
// The multi-page answer must carry a `<<<PAGE n>>>` marker per page; pages the
// model fails to mark are retried individually, so the contract stays exact.

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

export const MODEL_PARSE_PROMPT_MULTI = `${MODEL_PARSE_PROMPT}

You will receive SEVERAL pages in one message, each introduced by "Page N.".
Write one section per page and start every section with a marker line exactly:
<<<PAGE N>>>
where N is that page's number. No other commentary, no code fences.`;

const PAGE_MARKER = /<<<PAGE\s+(\d+)>>>/g;
const MIN_PAGE_URL = 64;

const dataUrl = (imageBase64) => (String(imageBase64 || "").startsWith("data:")
  ? String(imageBase64)
  : `data:image/jpeg;base64,${String(imageBase64 || "")}`);

const stripFence = (text) => String(text || "")
  .trim()
  .replace(/^```(?:markdown|md)?\s*\n?/i, "")
  .replace(/\n?```\s*$/, "")
  .trim();

/** Split a multi-page answer into a pageNumber → markdown map. */
export function splitPagedMarkdown(text) {
  const source = String(text || "");
  const marks = [...source.matchAll(PAGE_MARKER)];
  const out = new Map();
  for (let i = 0; i < marks.length; i += 1) {
    const pageNumber = Number(marks[i][1]);
    const start = marks[i].index + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index : source.length;
    const markdown = stripFence(source.slice(start, end));
    if (Number.isFinite(pageNumber) && markdown) out.set(pageNumber, markdown);
  }
  return out;
}

/** One page → { markdown, model } via the configured vision model.
 *  No layout blocks: a general vision model cannot give trustworthy coordinates,
 *  so citations from this lane are page-level (bbox null) rather than boxed. */
export async function parsePageWithModel({ imageBase64, pageNumber, userId = null, model }) {
  const url = dataUrl(imageBase64);
  if (!url || url.length < MIN_PAGE_URL) throw new Error("No page image was provided.");

  const call = meteredChat({
    userId,
    feature: "records_extract",
    // The platform pays (the RunPod lane never charged learners); without this
    // the request context's learner wallet is debited and can run dry.
    __payer: "platform",
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
  // A stuck provider call must not pin the batch (and its claim) forever.
  const res = await Promise.race([call, new Promise((_, reject) => setTimeout(() => reject(new Error("the model took too long on this page")), 120000))]);
  const markdown = stripFence(res?.choices?.[0]?.message?.content);
  if (!markdown) throw new Error("The model returned no text for this page.");
  return { markdown, model };
}

/** 2–4 pages in ONE call, split by markers; unmarked pages are retried alone. */
export async function parsePageGroupWithModel({ pages, userId = null, model }) {
  const call = meteredChat({
    userId,
    feature: "records_extract",
    __payer: "platform",
    model,
    max_tokens: Math.min(12000, 4000 * pages.length),
    temperature: 0,
    messages: [
      { role: "system", content: MODEL_PARSE_PROMPT_MULTI },
      {
        role: "user",
        content: pages.flatMap((p) => [
          { type: "text", text: `Page ${p.pageNumber}.` },
          { type: "image_url", image_url: { url: dataUrl(p.b64), detail: "high" } },
        ]),
      },
    ],
  });
  const res = await Promise.race([call, new Promise((_, reject) => setTimeout(() => reject(new Error("the model took too long on these pages")), 150000))]);
  const split = splitPagedMarkdown(res?.choices?.[0]?.message?.content);

  const marked = pages.filter((p) => split.has(p.pageNumber));
  const missing = pages.filter((p) => !split.has(p.pageNumber));
  const singles = await Promise.all(missing.map(async (p) => {
    try {
      return { pageNumber: p.pageNumber, ...(await parsePageWithModel({ imageBase64: p.b64, pageNumber: p.pageNumber, userId, model })) };
    } catch (err) {
      return { pageNumber: p.pageNumber, error: err?.message || String(err) };
    }
  }));
  return [
    ...marked.map((p) => ({ pageNumber: p.pageNumber, markdown: split.get(p.pageNumber), model })),
    ...singles,
  ];
}

/** Parse pages with bounded concurrency, preserving order. pagesPerCall 1
 *  keeps the old one-call-per-page behaviour; 2–4 batches and falls back. */
export async function parsePagesWithModel({ pages, userId, model, concurrency = 4, pagesPerCall = 1, onPage = null }) {
  const size = Math.min(4, Math.max(1, Math.floor(pagesPerCall) || 1));
  const groups = [];
  for (let i = 0; i < pages.length; i += size) groups.push(pages.slice(i, i + size));

  const results = new Array(pages.length);
  const indexOf = new Map(pages.map((page, i) => [page.pageNumber, i]));
  let served = 0;
  while (served < groups.length) {
    const wave = groups.slice(served, served + Math.max(1, concurrency));
    served += wave.length;
    await Promise.all(wave.map(async (group) => {
      let parsed;
      try {
        parsed = group.length === 1
          ? [{ pageNumber: group[0].pageNumber, ...(await parsePageWithModel({ imageBase64: group[0].b64, pageNumber: group[0].pageNumber, userId, model })) }]
          : await parsePageGroupWithModel({ pages: group, userId, model });
      } catch (err) {
        parsed = group.map((p) => ({ pageNumber: p.pageNumber, error: err?.message || String(err) }));
      }
      for (const r of parsed) {
        const i = indexOf.get(r.pageNumber);
        if (i === undefined) continue;
        results[i] = { ...r, size: pages[i].size || null };
        onPage?.(results[i]);
      }
    }));
  }
  return results;
}
