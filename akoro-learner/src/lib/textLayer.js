/**
 * textLayer.js — does a PDF's text layer hold the document, or only a
 * watermark? The same rule as the API's modules/records/textLayer.js (keep the
 * two in step; a contract test compares them).
 *
 * Scanned exam papers from past-question sites often carry the site's watermark
 * as their only text, identical on every page; the old "≥ 20 characters a page"
 * rule took that for a text PDF and never sent the scan to the parser.
 */
export const TEXT_LAYER_RULES = Object.freeze({
  MIN_REAL_CHARS_PER_PAGE: 20,
  REPEAT_SHARE: 0.6,
  REPEAT_MIN_PAGES: 3,
});

const pieces = (text) => String(text || '').split(/\n+|\s{2,}/).map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);

export function realCharsPerPage(pageTexts = []) {
  const pages = pageTexts.map(pieces);
  const n = pages.length;
  const seenOn = new Map();
  for (const ps of pages) for (const p of new Set(ps)) seenOn.set(p, (seenOn.get(p) || 0) + 1);
  const repeatAt = Math.max(TEXT_LAYER_RULES.REPEAT_MIN_PAGES, Math.ceil(n * TEXT_LAYER_RULES.REPEAT_SHARE));
  return pages.map((ps) => ps.filter((p) => n < TEXT_LAYER_RULES.REPEAT_MIN_PAGES || (seenOn.get(p) || 0) < repeatAt).join('').replace(/\s+/g, '').length);
}

export function looksScanned(pageTexts = []) {
  if (!pageTexts.length) return true;
  const real = realCharsPerPage(pageTexts).reduce((a, b) => a + b, 0);
  return real < TEXT_LAYER_RULES.MIN_REAL_CHARS_PER_PAGE * pageTexts.length;
}
