/**
 * inkLines — find the printed lines inside one block of a drawn page.
 *
 * The parse model gives a paragraph as one box with no line breaks, and the
 * box alone cannot say where the printed lines break or how wide each is —
 * so the invisible text layer drifted off the words. The page is already
 * drawn on screen, though: a row profile of the dark pixels inside the box
 * gives each printed line's top and bottom, and the columns with ink give
 * its left and right. lib/blockLines.js then lays the block's words onto
 * exactly those lines.
 *
 * Pure: takes luminance (0-255) for the box's pixels, row-major.
 */

/** → [{ top, bottom, left, right }] in px within the box, top to bottom. */
export function findInkLines(lum, w, h) {
  if (!lum || !(w > 2) || !(h > 2) || lum.length < w * h) return [];
  // Paper is the bright majority: take a high percentile as the background
  // and call anything clearly darker ink (works on photos as well as scans).
  const sample = [];
  const stride = Math.max(1, Math.floor((w * h) / 4000));
  for (let i = 0; i < w * h; i += stride) sample.push(lum[i]);
  sample.sort((a, b) => a - b);
  const bg = sample[Math.floor(sample.length * 0.9)];
  const dark = Math.min(bg - 40, bg * 0.72);
  if (!(dark > 0)) return [];

  const rowInk = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0, o = y * w; x < w; x++, o++) if (lum[o] < dark) c++;
    rowInk[y] = c;
  }
  // A row is ink when several pixels are dark — one speck of noise is not.
  const minRow = Math.max(2, Math.round(w * 0.004));
  let bands = [];
  for (let y = 0; y < h; y++) {
    if (rowInk[y] >= minRow) {
      const last = bands[bands.length - 1];
      if (last && last.bottom === y) last.bottom = y + 1;
      else bands.push({ top: y, bottom: y + 1 });
    }
  }
  if (!bands.length) return [];

  // Merge slivers into their line: i-dots, accents, a descender's tail.
  // The typical line height: an upper quantile, so a few dots and accents
  // on a short block don't drag it down.
  const q75 = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.75)]; };
  const typical = q75(bands.map((b) => b.bottom - b.top));
  const merged = [];
  for (const b of bands) {
    const last = merged[merged.length - 1];
    const gap = last ? b.top - last.bottom : Infinity;
    const small = (b.bottom - b.top) < typical * 0.45 || (last && (last.bottom - last.top) < typical * 0.45);
    if (last && (gap <= Math.max(1, typical * 0.12) || (small && gap <= typical * 0.3))) last.bottom = b.bottom;
    else merged.push({ ...b });
  }
  const full = q75(merged.map((b) => b.bottom - b.top));
  bands = merged.filter((b) => (b.bottom - b.top) >= full * 0.35);

  return bands.map((b) => {
    let left = w, right = 0;
    for (let y = b.top; y < b.bottom; y++) {
      for (let x = 0, o = y * w; x < w; x++, o++) {
        if (lum[o] < dark) { if (x < left) left = x; if (x + 1 > right) right = x + 1; }
      }
    }
    return { top: b.top, bottom: b.bottom, left: Math.min(left, right), right };
  });
}
