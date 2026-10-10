/**
 * askAnswer.js — turn an Ask answer into renderable pieces (pure, tested).
 *
 * The API answers in light markdown with [n] citation markers. The reader
 * renders paragraphs and bullet lists, **bold**, and each [n] as a chip that
 * jumps to the cited page/box or recording moment. A marker with no matching
 * citation stays plain text.
 */

/** "**a** [2] b" → [{type:'text'|'bold', text} | {type:'cite', n, cite}] */
export function inlinePieces(text, citations = []) {
  const byN = new Map((citations || []).map((c) => [c.n, c]));
  const out = [];
  const parts = String(text || '').split(/(\*\*[^*]+\*\*|\[\d{1,3}\])/g);
  for (const part of parts) {
    if (!part) continue;
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    const cite = part.match(/^\[(\d{1,3})\]$/);
    if (bold) out.push({ type: 'bold', text: bold[1] });
    else if (cite && byN.has(Number(cite[1]))) out.push({ type: 'cite', n: Number(cite[1]), cite: byN.get(Number(cite[1])) });
    else out.push({ type: 'text', text: part });
  }
  return out;
}

/** The answer as blocks: [{type:'p', pieces} | {type:'ul'|'ol', items:[pieces]}]. */
export function answerBlocks(answer, citations = []) {
  const blocks = [];
  for (const raw of String(answer || '').split('\n')) {
    const line = raw.trim();
    if (!line) { blocks.push(null); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d{1,2}[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const kind = bullet ? 'ul' : numbered ? 'ol' : null;
    const content = (bullet || numbered || heading)?.[1] ?? line;
    const pieces = inlinePieces(heading ? `**${content}**` : content, citations);
    const prev = blocks[blocks.length - 1];
    if (kind && prev && prev.type === kind) prev.items.push(pieces);
    else if (kind) blocks.push({ type: kind, items: [pieces] });
    else blocks.push({ type: 'p', pieces });
  }
  return blocks.filter(Boolean);
}

const fmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A chip's label: "p. 4", "12:05", or the passage number. */
export function citeLabel(cite) {
  if (Number.isInteger(cite?.pageNumber)) return `p. ${cite.pageNumber}`;
  if (Number.isFinite(cite?.startMs)) return fmtTime(cite.startMs);
  return `#${cite?.n ?? ''}`;
}

/** The reader's citeJump shape (0-based page) — or null when there's nowhere to go. */
export function toReaderCite(cite) {
  if (Number.isInteger(cite?.pageNumber)) {
    return { page: cite.pageNumber - 1, ...(Array.isArray(cite.bbox) && cite.bbox.length === 4 ? { bbox: cite.bbox } : {}) };
  }
  if (Number.isFinite(cite?.startMs)) return { startMs: cite.startMs };
  return null;
}
