/**
 * modules/records/textLayer.js — does a PDF's text layer hold the document, or
 * only a watermark? (2026-10-25)
 *
 * Exam papers downloaded from past-question sites are often scans whose only
 * text is the site's watermark or running header, the same on every page. The
 * old rule (≥ 20 characters a page) took that for a text PDF, so the scan was
 * never parsed: two WAEC Chemistry Paper 2 files were saved as 15 pages of an
 * identical 83-character line, and their read found no topics.
 *
 * Now a piece of text that repeats on most pages doesn't count; what is left
 * must average MIN_REAL_CHARS_PER_PAGE. The same rule runs in the learner app
 * (akoro-learner/src/lib/textLayer.js) before it decides to skip the parse.
 * Pure — covered by textLayer.contract.test.mjs.
 */
export const TEXT_LAYER_RULES = Object.freeze({
  MIN_REAL_CHARS_PER_PAGE: 20,   // the old rule's floor — now counted without the repeated text
  REPEAT_SHARE: 0.6,             // on at least this share of the pages…
  REPEAT_MIN_PAGES: 3,           // …and at least this many: a watermark, not content
});

const pieces = (text) => String(text || "").split(/\n+|\s{2,}/).map((s) => s.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean);

/** Per-page texts → the characters that aren't repeated across most pages, per page. */
export function realCharsPerPage(pageTexts = []) {
  const pages = pageTexts.map(pieces);
  const n = pages.length;
  const seenOn = new Map();
  for (const ps of pages) for (const p of new Set(ps)) seenOn.set(p, (seenOn.get(p) || 0) + 1);
  const repeatAt = Math.max(TEXT_LAYER_RULES.REPEAT_MIN_PAGES, Math.ceil(n * TEXT_LAYER_RULES.REPEAT_SHARE));
  return pages.map((ps) => ps.filter((p) => n < TEXT_LAYER_RULES.REPEAT_MIN_PAGES || (seenOn.get(p) || 0) < repeatAt).join("").replace(/\s+/g, "").length);
}

/** True when the text layer is too thin to be the document: send it to the parser. */
export function looksScanned(pageTexts = []) {
  if (!pageTexts.length) return true;
  const real = realCharsPerPage(pageTexts).reduce((a, b) => a + b, 0);
  return real < TEXT_LAYER_RULES.MIN_REAL_CHARS_PER_PAGE * pageTexts.length;
}
