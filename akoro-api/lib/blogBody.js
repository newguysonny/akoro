/**
 * lib/blogBody.js — pure blog-text helpers for the agent's blog research
 * tools. No db, no env — safe to import anywhere (including tests).
 *
 * Blog bodies are ordered JSONB block arrays ({type, text, items, src, alt})
 * rendered by the learner BlogPostPage. For the agent we flatten them back
 * to readable plain text: the model reads prose, not block JSON.
 */

export const BLOG_BODY_MAX_CHARS = 6000;
export const BLOG_QUERY_MAX_CHARS = 120;

const TAGS = /<\/?[a-z][^>]*>/gi;

const clean = (s) => String(s ?? "").replace(TAGS, "").replace(/[ \t]+/g, " ").trim();

/** One block → its text lines (image blocks contribute only their alt). */
export function blogBlockToLines(block) {
  if (!block || typeof block !== "object") return [];
  switch (block.type) {
    case "h":
      return clean(block.text) ? [`## ${clean(block.text)}`] : [];
    case "quote":
      return clean(block.text) ? [`> ${clean(block.text)}`] : [];
    case "list":
      return (Array.isArray(block.items) ? block.items : [])
        .map((it) => clean(it)).filter(Boolean).map((it) => `- ${it}`);
    case "image":
      return clean(block.alt) ? [`[image: ${clean(block.alt)}]`] : [];
    default: // 'p' and anything else text-ish
      return clean(block.text) ? [clean(block.text)] : [];
  }
}

/** Ordered block array → plain text the model can reason over. */
export function flattenBlogBody(body, maxChars = BLOG_BODY_MAX_CHARS) {
  const blocks = Array.isArray(body) ? body : [];
  const lines = blocks.flatMap(blogBlockToLines);
  const text = lines.join("\n\n");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

/**
 * The markdown-subset the blog editor writes → the ordered block array the
 * public blog renders (h / quote / list / p — the same types the marketing
 * posts use). Consecutive "- " lines group into one list block; ordered
 * lines keep their numbers in the item text. Code markers are stripped —
 * the public blog has no inline-code style, so backticks would read as noise.
 */
export function markdownToBlogBlocks(body) {
  const lines = String(body ?? "").split("\n");
  const blocks = [];
  let listBuf = [];
  const flushList = () => {
    if (listBuf.length) {
      blocks.push({ type: "list", items: listBuf });
      listBuf = [];
    }
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { flushList(); continue; }
    const bullet = line.match(/^-\s+(.*)$/);
    const ordered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet) { listBuf.push(stripInline(bullet[1])); continue; }
    if (ordered) { listBuf.push(`${ordered[1] ? line.slice(0, line.indexOf(ordered[1])) : ""}${stripInline(ordered[1] ?? line)}`.trim()); continue; }
    flushList();
    if (/^###\s+/.test(line)) { const t = stripInline(line.replace(/^###\s+/, "")); if (t) blocks.push({ type: "h", text: t }); continue; }
    if (/^##+\s+/.test(line)) { const t = stripInline(line.replace(/^##+\s+/, "")); if (t) blocks.push({ type: "h", text: t }); continue; }
    if (/^>\s?/.test(line)) { const t = stripInline(line.replace(/^>\s?/, "")); if (t) blocks.push({ type: "quote", text: t }); continue; }
    const t = stripInline(line);
    if (t) blocks.push({ type: "p", text: t });
  }
  flushList();
  return blocks;
}

/** Drop markdown emphasis/code markers the public renderer cannot style. */
function stripInline(s) {
  return String(s ?? "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]*)`/g, "$1").trim();
}

/** Rough read time the same way the marketing posts are sized (~200 wpm). */
export function blogReadMinutes(body) {
  const words = String(body ?? "").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

/**
 * Search terms become an ILIKE fragment — strip the characters that mean
 * things to PostgREST's .or() syntax (same escaping the public blog route
 * uses), then cap the length.
 */
export function sanitizeBlogQuery(raw) {
  const query = String(raw ?? "").replace(/[,()%*:\\]/g, " ").replace(/\s+/g, " ").trim();
  if (!query) return { ok: false, reason: "empty" };
  if (query.length > BLOG_QUERY_MAX_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, query };
}
