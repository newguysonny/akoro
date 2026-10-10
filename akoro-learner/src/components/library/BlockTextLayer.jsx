/**
 * BlockTextLayer — extracted text laid invisibly over a drawn page.
 *
 * Each layout block (bbox_2d, normalized 0-1000) sits transparently over
 * the spot it was read from, so the words on a scan or a photo can be
 * selected (Ask / Annotate / Hide). A one-line block is stretched to its
 * box's width (the pdf.js approach): the selection, and any mark made from
 * it, then covers the printed words rather than the invisible font's own
 * narrower or wider run. Taller blocks wrap inside their box.
 */
import { useLayoutEffect, useRef } from 'react';

const isFigure = (t) => String(t || '').trim() === '<image>';

export default function BlockTextLayer({ blocks, height }) {
  const rootRef = useRef(null);
  const list = (Array.isArray(blocks) ? blocks : []).filter((b) =>
    Array.isArray(b?.bbox_2d) && b.bbox_2d.length === 4 && !isFigure(b.text_content) && String(b.text_content || '').trim());

  // Stretch one-line blocks to their box. Measured after layout; written
  // straight to the DOM so measuring never loops through a re-render.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll('[data-fit]').forEach((inner) => {
      inner.style.transform = '';
      const natural = inner.offsetWidth;
      const box = inner.parentElement.clientWidth;
      if (natural > 0 && box > 0) inner.style.transform = `scaleX(${box / natural})`;
    });
  });

  if (!list.length || !(height > 0)) return null;
  return (
    <div ref={rootRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
      {list.map((b, i) => {
        const [x1, y1, x2, y2] = b.bbox_2d.map(Number);
        const hPx = (Math.max(0, y2 - y1) / 1000) * height;
        const text = String(b.text_content || '').replace(/<\/?hw>/g, '');
        const oneLine = !text.includes('\n') && hPx < 48;
        const fontSize = oneLine ? Math.max(6, Math.min(40, hPx * 0.82)) : Math.max(7, Math.min(30, hPx * 0.6));
        return (
          <span key={i} style={{ position: 'absolute', left: `${x1 / 10}%`, top: `${y1 / 10}%`,
            width: `${Math.max(0.5, (x2 - x1) / 10)}%`, height: `${Math.max(0.5, (y2 - y1) / 10)}%`,
            fontSize: `${fontSize}px`, lineHeight: oneLine ? `${hPx}px` : 1.15,
            color: 'transparent', WebkitUserSelect: 'text', userSelect: 'text',
            whiteSpace: oneLine ? 'pre' : 'pre-wrap', overflow: oneLine ? 'visible' : 'hidden',
            pointerEvents: 'auto', cursor: 'text' }}>
            {oneLine
              ? <span data-fit="" style={{ display: 'inline-block', transformOrigin: '0 0' }}>{text}</span>
              : text}
          </span>
        );
      })}
    </div>
  );
}
