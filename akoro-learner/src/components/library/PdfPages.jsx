/**
 * PdfPages.jsx — real PDF pages inside the session reader.
 *
 * The record's actual PDF renders here: pdf.js draws each page to canvas
 * at device pixel ratio (crisp on phones), pages stay lazy — a page
 * renders when it scrolls near the viewport, not before — and a
 * transparent pdf.js text layer sits over each canvas so text selection
 * (and therefore "Ask the tutor" / "Quiz me" / "Cards" / "Note" on a
 * selection) works on the real file, not a reconstruction.
 *
 * The page text is also extracted per page (getTextContent) so the
 * reader's Generate tools — summary, quiz, flashcards — derive from the
 * document's actual sentences.
 */

import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BRAND } from '../../constants.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/** Load the document + extract each page's text. `src` is presigned — no auth needed. */
export async function loadPdfDocument(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Could not load the file (${res.status}).`);
  const data = new Uint8Array(await res.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const texts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    texts.push(tc.items.map((it) => it.str).join(' '));
  }
  return { pdf, texts };
}

/* One PDF page. Renders lazily (IntersectionObserver from the parent
   viewer scroll container) and re-renders if it becomes visible again
   after the canvas was cleared by the browser.

   `blocks` (optional) — the AI extraction's layout blocks for this page
   (bbox_2d in normalized 0-1000 [left, top, right, bottom]). When present,
   a small "Layout" chip toggles an overlay that draws what the model read
   on top of the scan: text blocks in the brand tint, figures in amber —
   the learner can SEE the extraction matched the page. */
export function PdfPage({ pdf, pageNumber, blocks = null }) {
  const wrapRef  = useRef(null);
  const canvasRef = useRef(null);
  const [aspect, setAspect] = useState(1.414);          // A4-ish until measured
  const [gone, setGone]     = useState(false);          // render failed — honest fallback
  const [showBlocks, setShowBlocks] = useState(false);  // the extraction overlay
  const [wrapW, setWrapW]   = useState(0);              // measured CSS width — sizes the extraction text layer

  useEffect(() => {
    let cancelled = false;
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas || !pdf) return;

    const render = async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const cssWidth = wrap.clientWidth || 640;
        const cssScale = cssWidth / base.width;               // CSS-pixel scale
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * dpr });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        setAspect(base.height / base.width);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        // Text layer — transparent spans aligned to the glyphs, so selection
        // highlights the real words on the page. pdf.js sizes spans through a
        // --scale-factor custom property on the container (CSS-pixel scale).
        const layer = wrap.querySelector('.pdf-text-layer');
        if (layer) {
          layer.innerHTML = '';
          layer.style.setProperty('--scale-factor', String(cssScale));
          const tl = new pdfjsLib.TextLayer({
            textContentSource: await page.getTextContent(),
            container: layer,
            viewport: page.getViewport({ scale: cssScale }),
          });
          await tl.render();
        }
      } catch {
        if (!cancelled) setGone(true);
      }
    };

    // Render when the page is near the viewport — a 200-page PDF must not
    // render all at once.
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) render(); });
    }, { root: wrap.closest('.pdf-scroll') || null, rootMargin: '400px 0px' });
    io.observe(wrap);
    // The extraction text layer sizes its type from the laid-out width —
    // keep it honest across container resizes.
    const ro = new ResizeObserver(() => setWrapW(wrap.clientWidth || 0));
    ro.observe(wrap);
    setWrapW(wrap.clientWidth || 0);
    return () => { cancelled = true; io.disconnect(); ro.disconnect(); };
  }, [pdf, pageNumber]);

  const blockList = Array.isArray(blocks) ? blocks.filter((b) => Array.isArray(b?.bbox_2d) && b.bbox_2d.length === 4) : [];
  const isFigure = (t) => String(t || '').trim() === '<image>';

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', background: '#fff' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `1 / ${aspect}` }}/>
      <div className="pdf-text-layer" style={{ position: 'absolute', inset: 0, overflow: 'hidden',
        lineHeight: 1, textAlign: 'initial', unicodeBidi: 'isolate',
        /* transparent but selectable — the pdf.js approach: the spans carry
           the real words aligned to the glyphs; dragging selects them. */
        color: 'transparent', WebkitUserSelect: 'text', userSelect: 'text' }}/>
      {/* AI-extraction layout overlay — bboxes are normalized 0-1000, so
          percent = value/10. Figures (<image> sentinel) tint amber. */}
      {showBlocks && blockList.length > 0 && blockList.map((b, i) => {
        const [x1, y1, x2, y2] = b.bbox_2d;
        const fig = isFigure(b.text_content);
        return (
          <div key={`blk-${i}`} title={fig ? 'figure' : String(b.text_content || '').slice(0, 120)}
            style={{ position: 'absolute', left: `${x1 / 10}%`, top: `${y1 / 10}%`,
              width: `${Math.max(0.4, (x2 - x1) / 10)}%`, height: `${Math.max(0.4, (y2 - y1) / 10)}%`,
              border: `1.5px solid ${fig ? 'rgba(245,158,11,.85)' : 'rgba(76,29,204,.55)'}`,
              background: fig ? 'rgba(245,158,11,.14)' : 'rgba(76,29,204,.08)',
              borderRadius: 3, pointerEvents: 'auto' }}/>
        );
      })}
      {/* The extraction AS a text layer: each block's text sits transparently
          over its own bbox, so scans become selectable/searchable exactly
          like pdf.js text pages. Container ignores pointers; the spans
          capture only where text actually is. */}
      {blockList.length > 0 && wrapW > 0 && (
        <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
          {blockList.filter((b) => !isFigure(b.text_content) && String(b.text_content || '').trim()).map((b, i) => {
            const [x1, y1, x2, y2] = b.bbox_2d;
            const hPx = (Math.max(0, y2 - y1) / 1000) * (wrapW * aspect);
            return (
              <span key={`btxt-${i}`} style={{ position: 'absolute', left: `${x1 / 10}%`, top: `${y1 / 10}%`,
                width: `${Math.max(0.5, (x2 - x1) / 10)}%`, height: `${Math.max(0.5, (y2 - y1) / 10)}%`,
                fontSize: `${Math.max(7, Math.min(30, hPx * 0.6))}px`, lineHeight: 1.15,
                color: 'transparent', WebkitUserSelect: 'text', userSelect: 'text',
                whiteSpace: 'pre-wrap', overflow: 'hidden', pointerEvents: 'auto', cursor: 'text' }}>
                {String(b.text_content || '')}
              </span>
            );
          })}
        </div>
      )}
      {blockList.length > 0 && (
        <button onClick={() => setShowBlocks((v) => !v)}
          style={{ position: 'absolute', top: 8, right: 8, zIndex: 3, border: '1px solid rgba(15,23,42,.12)',
            borderRadius: 99, padding: '4px 10px', fontSize: 10.5, fontWeight: 900, fontFamily: "'Nunito',sans-serif",
            background: showBlocks ? 'rgba(76,29,204,.92)' : 'rgba(255,255,255,.92)',
            color: showBlocks ? '#fff' : '#4C1DCC', cursor: 'pointer', boxShadow: '0 2px 8px rgba(15,23,42,.12)' }}>
          {showBlocks ? `Layout ✓ ${blockList.length}` : `Layout ${blockList.length}`}
        </button>
      )}
      {gone && (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: "'Nunito',sans-serif" }}>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: '#6B7280', margin: 0 }}>
            Page {pageNumber} could not be rendered.
          </p>
        </div>
      )}
    </div>
  );
}

/** Placeholder page while the document loads — keeps the reader's shape. */
export function PdfLoadingPage() {
  return (
    <div style={{ width: '100%', aspectRatio: '1 / 1.414', background: '#fff', display: 'flex',
      alignItems: 'center', justifyContent: 'center', fontFamily: "'Nunito',sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9CA3AF', fontSize: 12, fontWeight: 800 }}>
        <span className="ti ti-file-text" style={{ fontSize: 16, color: BRAND }}/>
        Rendering page…
      </div>
    </div>
  );
}
