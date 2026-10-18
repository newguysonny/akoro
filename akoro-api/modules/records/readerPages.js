/*
 * readerPages.js — how the session reader cuts text into pages: paragraphs
 * (split on blank lines) gathered up to ~2600 characters a page, after the
 * material's cover (page 1). The server uses the SAME cut for pasted text,
 * so a citation's page is the page the reader shows. Kept byte-identical in
 * akoro-learner/src/lib and akoro-api/modules/records (a contract test checks).
 */
export const CHARS_PER_PAGE = 2600;

export const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function textToParagraphBlocks(text) {
  return String(text ?? "")
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => `<p>${escapeHtml(b).replace(/\n/g, "<br>")}</p>`);
}

export function paginateBlocks(blocks, perPage = CHARS_PER_PAGE) {
  const pages = [];
  let cur = [];
  let count = 0;
  for (const b of blocks) {
    const len = b.replace(/<[^>]+>/g, "").length;
    if (count > 0 && count + len > perPage) { pages.push(cur); cur = []; count = 0; }
    cur.push(b);
    count += len;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

const unescape = (s) => s.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Pasted text → the reader's content pages: [{ pageNumber, text }] — page 1 is the cover, so they start at 2. */
export function pastedTextPages(text) {
  return paginateBlocks(textToParagraphBlocks(text)).map((blocks, i) => ({
    pageNumber: i + 2,
    text: blocks.map(unescape).join("\n\n"),
  }));
}
