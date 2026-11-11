/**
 * BlockTextLayer — extracted text laid invisibly over a drawn page.
 *
 * Each layout block (bbox_2d, normalized 0-1000) sits transparently over
 * the spot it was read from, so the words on a scan or a photo can be
 * selected (Ask / Annotate / Hide). The model returns a paragraph as one
 * block with no line breaks, so the reader finds the PRINTED lines in the
 * drawn page's own pixels (lib/inkLines.js) and lays the block's words onto
 * them (lib/blockLines.js), each line stretched to its printed width — the
 * pdf.js approach. Letting the browser wrap the text instead put the
 * selectable words up to ~190px from the printed ones. Without readable
 * pixels (still drawing, a cross-origin image) the lines are estimated
 * from the box.
 *
 * `surface` — the drawn page (a <canvas>, an <img> or an ImageBitmap) and
 * `surfaceKey` — changes when it is redrawn.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { layoutBlockLines } from '../../lib/blockLines.js';
import { findInkLines } from '../../lib/inkLines.js';
import { registerTextLayer } from '../../lib/textSelection.js';
import './pdfTextLayer.css';

const isFigure = (t) => String(t || '').trim() === '<image>';
const FAMILY = 'sans-serif';   // the spans and the measurements must agree

let ctx = null;

/* Layout survives a mount/unmount cycle. Pages are mounted only near the
   viewport now, so scrolling back re-mounts this layer — remeasuring every
   word and re-scanning the page pixels each time would bring the hang back. */
const inkCache = new WeakMap();      // blocks → Map("WxH" → per-block ink lines)
const layoutCache = new WeakMap();   // blocks → Map("WxH:ink?" → laid spans)
function measure(text, fontPx) {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${fontPx}px ${FAMILY}`;
  return ctx.measureText(text).width;
}

/** The page drawn at the layer's CSS size → per-block printed lines, or null. */
function readInk(surface, width, height, list) {
  if (!surface || !(width > 0) || !(height > 0)) return null;
  try {
    const W = Math.round(width), H = Math.round(height);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(surface, 0, 0, W, H);
    const data = g.getImageData(0, 0, W, H).data;   // throws on a tainted (cross-origin) surface
    return list.map((b) => {
      const [x1, y1, x2, y2] = b.bbox_2d.map(Number);
      const L = Math.max(0, Math.floor((x1 / 1000) * W)), T = Math.max(0, Math.floor((y1 / 1000) * H));
      const R = Math.min(W, Math.ceil((x2 / 1000) * W)), B = Math.min(H, Math.ceil((y2 / 1000) * H));
      const w = R - L, h = B - T;
      if (w < 3 || h < 3) return null;
      const lum = new Uint8ClampedArray(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = ((T + y) * W + (L + x)) * 4;
          lum[y * w + x] = (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
        }
      }
      // Lines in the box's own px (the crop starts at the box's rounded edge).
      const dx = L - (x1 / 1000) * W, dy = T - (y1 / 1000) * H;
      return findInkLines(lum, w, h).map((l) => ({ top: l.top + dy, bottom: l.bottom + dy, left: l.left + dx, right: l.right + dx }));
    });
  } catch {
    return null;
  }
}

export default function BlockTextLayer({ blocks, height, surface = null, surfaceKey = 0 }) {
  const rootRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [ink, setInk] = useState(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    setWidth(root.clientWidth || 0);
    const ro = new ResizeObserver(() => setWidth(root.clientWidth || 0));
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  // The extraction's array is the cache key (it is stable while the parse is);
  // the filtered list is derived from it, not the other way round.
  const cacheKey = Array.isArray(blocks) ? blocks : null;
  const list = useMemo(() => (Array.isArray(blocks) ? blocks : []).filter((b) =>
    Array.isArray(b?.bbox_2d) && b.bbox_2d.length === 4 && !isFigure(b.text_content) && String(b.text_content || '').trim()), [blocks]);

  // Keeps a drag on the words it is over (lib/textSelection.js).
  const hasList = list.length > 0;
  useEffect(() => (hasList ? registerTextLayer(rootRef.current) : undefined), [hasList]);

  useEffect(() => {
    if (!list.length) { setInk(null); return; }
    // The page pixels only matter once, at a given size: a repaint (surfaceKey)
    // or a re-mount after scrolling reuses the stored lines instead of copying
    // the canvas and scanning it again.
    if (!cacheKey) { setInk(null); return; }
    const sizeKey = `${Math.round(width)}x${Math.round(height)}`;
    let bySize = inkCache.get(cacheKey);
    if (!bySize) { bySize = new Map(); inkCache.set(cacheKey, bySize); }
    if (bySize.has(sizeKey)) { setInk(bySize.get(sizeKey)); return; }
    // An evicted canvas has width 0 — never cache that as "no ink", or the
    // repaint would reuse it forever.
    const pixels = surface && (surface.width || surface.naturalWidth || 0) > 0;
    if (!pixels || !(width > 0) || !(height > 0)) { setInk(null); return; }
    const value = readInk(surface, width, height, list);
    bySize.set(sizeKey, value);
    setInk(value);
  }, [surface, surfaceKey, width, height, list, cacheKey]);

  const laid = useMemo(() => {
    if (!(width > 0) || !(height > 0)) return [];
    const sizeKey = `${Math.round(width)}x${Math.round(height)}:${ink ? 'ink' : 'est'}`;
    if (!cacheKey) return [];
    let bySize = layoutCache.get(cacheKey);
    if (!bySize) { bySize = new Map(); layoutCache.set(cacheKey, bySize); }
    const cached = bySize.get(sizeKey);
    if (cached) return cached;
    const out = list.map((b, i) => {
      const [x1, y1, x2, y2] = b.bbox_2d.map(Number);
      const w = (Math.max(0, x2 - x1) / 1000) * width;
      const h = (Math.max(0, y2 - y1) / 1000) * height;
      const text = String(b.text_content || '');
      // A short box with no line breaks is one printed line.
      const singleLine = !text.includes('\n') && h < 48;
      return { x1, y1, x2, y2, ...layoutBlockLines(text, w, h, measure, { singleLine, ink: ink?.[i] || null }) };
    });
    bySize.set(sizeKey, out);
    return out;
  }, [list, width, height, ink, cacheKey]);

  if (!list.length) return null;
  return (
    <div ref={rootRef} className="sel-layer" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
      {laid.map((b, i) => (
        <span key={i} style={{ position: 'absolute', left: `${b.x1 / 10}%`, top: `${b.y1 / 10}%`,
          width: `${Math.max(0.5, (b.x2 - b.x1) / 10)}%`, height: `${Math.max(0.5, (b.y2 - b.y1) / 10)}%`,
          color: 'transparent', pointerEvents: 'auto', cursor: 'text' }}>
          {b.lines.map((ln, j) => (
            <span key={j} style={{ position: 'absolute', left: `${ln.left}px`, top: `${ln.top}px`, height: `${ln.height}px`,
              fontFamily: FAMILY, fontSize: `${ln.fontPx}px`, lineHeight: `${ln.height}px`, whiteSpace: 'pre',
              transform: `scaleX(${ln.scaleX})`, transformOrigin: '0 0' }}>
              {j < b.lines.length - 1 ? `${ln.text} ` : ln.text}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
