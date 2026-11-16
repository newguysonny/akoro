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
    if (/^-{3,}$/.test(line) || /^\*{3,}$/.test(line)) { blocks.push({ type: 'hr' }); continue; }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'h', level: heading[1].length, pieces: inlinePieces(heading[2], citations) });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d{1,2}[.)]\s+(.*)$/);
    const kind = bullet ? 'ul' : numbered ? 'ol' : null;
    const content = (bullet || numbered)?.[1] ?? line;
    const pieces = inlinePieces(content, citations);
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

/** A chip's label: "p. 4", "12:05", or the passage number. A folder
 *  citation names its document first — the page is inside THAT document. */
export function citeLabel(cite) {
  const base = Number.isInteger(cite?.pageNumber) ? `p. ${cite.pageNumber}`
    : Number.isFinite(cite?.startMs) ? fmtTime(cite.startMs)
    : `#${cite?.n ?? ''}`;
  return cite?.sourceName ? `${cite.sourceName} · ${base}` : base;
}

/** The reader's citeJump shape (0-based page) — or null when there's nowhere to go.
 *  A folder citation keeps its source document: the jump goes there instead. */
export function toReaderCite(cite) {
  const source = cite?.sourceRecordId ? { sourceRecordId: cite.sourceRecordId, sourceName: cite.sourceName || null } : {};
  if (Number.isInteger(cite?.pageNumber)) {
    return { page: cite.pageNumber - 1, ...(Array.isArray(cite.bbox) && cite.bbox.length === 4 ? { bbox: cite.bbox } : {}), ...source };
  }
  if (Number.isFinite(cite?.startMs)) return { startMs: cite.startMs, ...source };
  return Object.keys(source).length ? { ...source } : null;
}
