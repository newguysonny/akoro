/**
 * markRects — where a selection sits on a drawn page (a PDF canvas or an
 * image), so an annotation or a hidden passage can be drawn back over it.
 *
 * Text pages mark the words themselves (the HTML is rewritten); drawn
 * pages have no HTML to rewrite, so the mark keeps the selection's boxes
 * as percentages of the page content — stable across zoom and resizing.
 */

const MAX_RECTS = 60;
const round = (v) => Math.round(v * 100) / 100;

/**
 * Client rects (range.getClientRects()) relative to the page content's
 * bounding rect → [{ x, y, w, h }] in percent (0-100). Slivers are dropped,
 * duplicates (nested spans report the same box) collapse, and boxes on
 * the same line that touch merge into one.
 */
export function selectionRects(clientRects, box) {
  if (!box || !(box.width > 0) || !(box.height > 0)) return [];
  const pct = [];
  for (const r of Array.from(clientRects || [])) {
    if (!(r.width > 1) || !(r.height > 1)) continue;
    const x = ((r.left - box.left) / box.width) * 100;
    const y = ((r.top - box.top) / box.height) * 100;
    const w = (r.width / box.width) * 100;
    const h = (r.height / box.height) * 100;
    if (x + w < 0 || y + h < 0 || x > 100 || y > 100) continue;
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    pct.push({ x: x0, y: y0, w: Math.min(x + w, 100) - x0, h: Math.min(y + h, 100) - y0 });
  }
  pct.sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const r of pct) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(last.y - r.y) < Math.min(last.h, r.h) * 0.5 && Math.abs(last.h - r.h) < Math.max(last.h, r.h) * 0.6;
    if (sameLine && r.x <= last.x + last.w + 0.8) {
      const right = Math.max(last.x + last.w, r.x + r.w);
      const top = Math.min(last.y, r.y), bottom = Math.max(last.y + last.h, r.y + r.h);
      last.x = Math.min(last.x, r.x); last.w = right - last.x; last.y = top; last.h = bottom - top;
      continue;
    }
    out.push({ ...r });
  }
  return out.slice(0, MAX_RECTS).map((r) => ({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) }));
}

/** Saved rects (untrusted) → valid ones only. */
export function cleanRects(rects) {
  if (!Array.isArray(rects)) return [];
  return rects
    .map((r) => ({ x: Number(r?.x), y: Number(r?.y), w: Number(r?.w), h: Number(r?.h) }))
    .filter((r) => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x <= 100 && r.y <= 100)
    .slice(0, MAX_RECTS);
}
