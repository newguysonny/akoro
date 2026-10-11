/**
 * blockLines — lay an extracted block's text out as the lines it was
 * PRINTED in, so an invisible selectable layer sits on the real words.
 *
 * The parse model returns a paragraph as ONE block: a box and its text,
 * with no line breaks. Letting the browser wrap that text at a guessed font
 * size put the invisible words up to ~190px from the printed ones (measured
 * in a real browser), so selections, notes and hidden passages on scans
 * and photos landed in the wrong place.
 *
 * Best case — `ink` (lib/inkLines.js): the printed lines found in the drawn
 * page's pixels. Each line's row and width are then known exactly, and the
 * words are dealt onto the lines in proportion to each line's printed
 * width. Fallback — no pixels (still drawing, cross-origin image): the line
 * count is estimated from the box (the text, at the font size a line pitch
 * implies, should fill ≈ n − ½ box widths) and the words wrapped evenly.
 * Explicit "\n" lines (lists, key-value rows) are kept as given.
 *
 * Pure: `measure(text, fontPx)` → natural width in px is injected (canvas
 * measureText in the reader, a fake in tests).
 */

export const FONT_TO_LINE = 0.8;   // printed font size ≈ 0.8 × line pitch
const FONT_TO_INK = 0.9;           // ink band (ascender→descender) ≈ 1.1 × font size
const MAX_LINES = 60;

function wrap(words, capacity, measure, fontPx) {
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next, fontPx) > capacity) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Deal words onto lines in proportion to each line's printed width. */
export function dealByWidth(words, widths, measure, fontPx) {
  const n = widths.length;
  if (n === 1) return [words.join(' ')];
  const space = measure(' ', fontPx);
  const ww = words.map((w) => measure(w, fontPx));
  const total = ww.reduce((a, b) => a + b, 0) + space * (words.length - 1);
  const inkTotal = widths.reduce((a, b) => a + b, 0) || 1;
  const bounds = [];
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += widths[i]; bounds.push((acc / inkTotal) * total); }
  const out = Array.from({ length: n }, () => []);
  let x = 0;
  words.forEach((w, i) => {
    const mid = x + ww[i] / 2;
    let line = bounds.findIndex((b) => mid < b);
    if (line < 0) line = n - 1;
    out[line].push(w);
    x += ww[i] + space;
  });
  // Never leave a printed line empty: borrow from a neighbour.
  for (let i = 0; i < n; i++) {
    if (out[i].length) continue;
    const from = i > 0 && out[i - 1].length > 1 ? i - 1 : (out[i + 1]?.length > 1 ? i + 1 : -1);
    if (from >= 0) out[i] = from < i ? [out[from].pop()] : [out[from].shift()];
  }
  return out.map((l) => l.join(' '));
}

/**
 * → { lines: [{ text, top, height, left, width, fontPx, scaleX }] }
 * All px are inside the block's box. `width` is the printed width the line
 * is stretched to (scaleX = width / natural width).
 */
export function layoutBlockLines(text, boxW, boxH, measure, { singleLine = false, ink = null } = {}) {
  const clean = String(text || '').replace(/<\/?hw>/g, '');
  if (!(boxW > 0) || !(boxH > 0) || !clean.trim()) return { lines: [] };
  const explicit = clean.includes('\n') ? clean.split('\n').map((l) => l.trim()).filter(Boolean) : null;
  const words = clean.trim().split(/\s+/);

  // ── Seen lines: rows and widths straight from the page's pixels ────────
  const seen = Array.isArray(ink) ? ink.filter((l) => l.bottom > l.top && l.right > l.left) : [];
  if (seen.length && (!explicit || explicit.length === seen.length) && seen.length <= words.length) {
    const fontPx = Math.max(4, Math.min(...seen.map((l) => l.bottom - l.top)) * FONT_TO_INK);
    const texts = explicit || dealByWidth(words, seen.map((l) => l.right - l.left), measure, fontPx);
    return {
      lines: texts.map((t, i) => {
        const l = seen[i];
        const width = l.right - l.left;
        return { text: t, top: l.top, height: l.bottom - l.top, left: l.left, width, fontPx,
          scaleX: width / Math.max(1, measure(t, fontPx)) };
      }),
    };
  }

  // ── Estimated lines: from the box alone ────────────────────────────────
  let texts;
  if (singleLine) {
    texts = [words.join(' ')];
  } else if (explicit) {
    texts = explicit;
  } else {
    let best = 1, bestErr = Infinity;
    for (let n = 1; n <= Math.min(MAX_LINES, words.length); n++) {
      const natural = measure(clean, FONT_TO_LINE * (boxH / n));
      const err = Math.abs(Math.log(Math.max(1e-6, natural) / ((n - 0.5) * boxW)));
      if (err < bestErr) { bestErr = err; best = n; }
    }
    const f = FONT_TO_LINE * (boxH / best);
    // The narrowest capacity that still gives `best` lines (even lines) —
    // measured closest to print among the box-only estimates.
    let lo = 1, hi = measure(clean, f) + 1, lines = [clean];
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const got = wrap(words, mid, measure, f);
      if (got.length > best) lo = mid; else { hi = mid; lines = got; }
    }
    texts = lines;
  }
  const n = texts.length;
  const lineHeight = boxH / n;
  const fontPx = FONT_TO_LINE * lineHeight;
  const widest = Math.max(...texts.map((t) => measure(t, fontPx)), 1);
  const scaleX = boxW / widest;
  return {
    lines: texts.map((t, i) => ({ text: t, top: i * lineHeight, height: lineHeight, left: 0,
      width: measure(t, fontPx) * scaleX, fontPx, scaleX })),
  };
}
