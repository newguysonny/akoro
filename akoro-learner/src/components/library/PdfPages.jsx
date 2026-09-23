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
   after the canvas was cleared by the browser. */
export function PdfPage({ pdf, pageNumber }) {
  const wrapRef  = useRef(null);
  const canvasRef = useRef(null);
  const [aspect, setAspect] = useState(1.414);          // A4-ish until measured
  const [gone, setGone]     = useState(false);          // render failed — honest fallback

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
    return () => { cancelled = true; io.disconnect(); };
  }, [pdf, pageNumber]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%', background: '#fff' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `1 / ${aspect}` }}/>
      <div className="pdf-text-layer" style={{ position: 'absolute', inset: 0, overflow: 'hidden',
        lineHeight: 1, textAlign: 'initial', unicodeBidi: 'isolate',
        /* transparent but selectable — the pdf.js approach: the spans carry
           the real words aligned to the glyphs; dragging selects them. */
        color: 'transparent', WebkitUserSelect: 'text', userSelect: 'text' }}/>
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
