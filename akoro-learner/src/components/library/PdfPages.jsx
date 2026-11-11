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
import BlockTextLayer from './BlockTextLayer.jsx';
import './pdfTextLayer.css';
import { registerTextLayer } from '../../lib/textSelection.js';
import { BRAND } from '../../constants.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

/* Parsed documents stay in memory for the tab's life, keyed by src, so a
   learner who closes a topic and re-opens it (or goes back to the course
   and picks the PDF again) skips the re-download and re-parse — the two
   slowest steps on a multi-page course PDF. Bounded so a long study
   session over many documents never pins the whole shelf in RAM. */
const DOC_CACHE_MAX = 6;
const docCache = new Map();   // src -> { pdf, texts }, oldest-first for eviction

/** Load the document + extract each page's text. `src` is presigned — no auth needed. */
export async function loadPdfDocument(src, { credentials } = {}) {
  const cached = docCache.get(src);
  if (cached) {
    docCache.delete(src);      // refresh recency so the newest stays put
    docCache.set(src, cached);
    return cached;
  }
  const res = await fetch(src, credentials ? { credentials } : undefined);
  if (!res.ok) throw new Error(`Could not load the file (${res.status}).`);
  const data = new Uint8Array(await res.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const texts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    texts.push(tc.items.map((it) => it.str).join(' '));
  }
  const doc = { pdf, texts };
  docCache.set(src, doc);
  while (docCache.size > DOC_CACHE_MAX) {
    const oldest = docCache.keys().next().value;
    docCache.get(oldest)?.pdf.destroy?.().catch(() => {});
    docCache.delete(oldest);
  }
  return doc;
}

/* One PDF page. Renders lazily (IntersectionObserver from the parent
   viewer scroll container) and re-renders if it becomes visible again
   after the canvas was cleared by the browser.

   `blocks` (optional) — the AI extraction's layout blocks for this page
   (bbox_2d in normalized 0-1000 [left, top, right, bottom]). When present,
   a small "Layout" chip toggles an overlay that draws what the model read
   on top of the scan: text blocks in the brand tint, figures in amber —
   the learner can SEE the extraction matched the page.

   `selectionOverlay` (optional) — make the EXTRACTED MARKDOWN the selectable
   layer instead of the pdf.js text layer. Used for the RunPod-markdown vs
   pdf.js-text A/B: when true and this page has blocks, the pdf.js layer is
   hidden and BlockTextLayer mounts even on a text PDF (pages without blocks
   keep the pdf.js layer, so selection never goes dead mid-extraction). See
   akoro-pdf-extraction-ab(runpod-markdown-vs-pdfjs-text,library-vs-pharmd).md */
export function PdfPage({ pdf, pageNumber, blocks = null, selectionOverlay = false }) {
  const wrapRef  = useRef(null);
  const canvasRef = useRef(null);
  const [aspect, setAspect] = useState(1.414);          // A4-ish until measured
  const [gone, setGone]     = useState(false);          // render failed — honest fallback
  const [showBlocks, setShowBlocks] = useState(false);  // the extraction overlay
  const [wrapW, setWrapW]   = useState(0);              // measured CSS width — sizes the extraction text layer
  const [drawn, setDrawn]   = useState(0);              // bumps after each paint — the text layer reads the pixels
  const [hasText, setHasText] = useState(null);         // the PDF's own words on this page (null = not read yet)

  useEffect(() => {
    let cancelled = false;
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas || !pdf) return;
    let unguard = () => {};
    let busy = false;
    let drawnW = 0;
    let layerGen = 0;

    /* The words only. The canvas is drawn once, supersampled for the reader's
       MAX zoom (below) — so a zoom or a phone turn changes the page's CSS
       width without changing a single pixel of the picture. Rebuilding JUST
       the text layer at the new width keeps every span on its glyphs and is
       fast enough to stay inside the first drag after the zoom; re-rendering
       the page canvas took seconds and left the layer empty while it ran, so
       the words under the mouse were unselectable exactly when the learner
       tried to highlight them. */
    const relayTextLayer = async (cssWidth) => {
      const layer = wrap.querySelector('.pdf-text-layer');
      if (!layer) return;
      const gen = ++layerGen;
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      if (cancelled || gen !== layerGen) return;   // a newer width won
      const cssScale = cssWidth / base.width;      // CSS-pixel scale
      unguard();
      layer.innerHTML = '';
      layer.style.setProperty('--scale-factor', String(cssScale));
      const tl = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: layer,
        viewport: page.getViewport({ scale: cssScale }),
      });
      await tl.render();
      if (cancelled || gen !== layerGen) return;
      // Keeps a drag on the words it is over (lib/textSelection.js).
      unguard = registerTextLayer(layer);
      setHasText(textContent.items.some((it) => String(it.str || '').trim()));
    };

    let pending = false;
    const render = async () => {
      // Once drawn, a page stays drawn: redrawing (and so rebuilding the
      // text layer) under a live selection would drop it.
      if (busy) { pending = true; return; }   // a width change arrived mid-render — redo after it finishes
      if (canvas.width > 0 && wrap.dataset.drawn === '1') return;
      busy = true;
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const cssWidth = wrap.clientWidth || 640;
        const cssScale = cssWidth / base.width;               // CSS-pixel scale
        // Draw at DEVICE resolution for the reader's MAX zoom. A canvas drawn
        // only at the on-screen width (and dpr capped at 2) was what made pages
        // look blurry — and much worse as you zoomed in. Supersampling to
        // dpr × maxZoom keeps the page crisp at every zoom level, so the
        // canvas never has to be redrawn when the reader zooms.
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const MAX_ZOOM = 1.5;                                 // SessionReaderModal's zoom cap
        let renderScale = cssScale * dpr * MAX_ZOOM;
        const MAX_PIXELS = 6_000_000;                         // keep a page's backing store < ~6 MP
        if (base.width * renderScale * base.height * renderScale > MAX_PIXELS) {
          renderScale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
        }
        const viewport = page.getViewport({ scale: renderScale });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        setAspect(base.height / base.width);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (!cancelled) setDrawn((n) => n + 1);

        // Text layer — transparent spans aligned to the glyphs, so selection
        // highlights the real words on the page. pdf.js sizes spans through a
        // --scale-factor custom property on the container (CSS-pixel scale).
        await relayTextLayer(cssWidth);
        if (cancelled) return;
        wrap.dataset.drawn = '1';
        drawnW = cssWidth;
      } catch {
        if (!cancelled) setGone(true);
      } finally {
        busy = false;
        if (pending) { pending = false; delete wrap.dataset.drawn; render(); }   // width changed mid-render → redo at the new width
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
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth || 0;
      setWrapW(w);
      if (!drawnW || Math.abs(w - drawnW) <= 2) return;
      // A new width (zoom, a phone turned): the canvas is already sharp at
      // every zoom level, so only the words move — no page re-render, and the
      // layer is rebuilt before the learner's next drag, not seconds after it.
      drawnW = w;
      if (wrap.dataset.drawn === '1') relayTextLayer(w);
      else render();
    });
    ro.observe(wrap);
    setWrapW(wrap.clientWidth || 0);
    // Eager-render the opener pages. A restored reading position jumps the
    // reader past them before the observer ever sees them intersect, which
    // left the first pages with NO text layer — unselectable until a refresh.
    // Rendering them up front is cheap and additive: render() returns at once
    // for a page that is already drawn, so a working page is never touched.
    if (pageNumber <= 2) render();
    return () => { cancelled = true; io.disconnect(); ro.disconnect(); unguard(); delete wrap.dataset.drawn; };
  }, [pdf, pageNumber]);

  const blockList = Array.isArray(blocks) ? blocks.filter((b) => Array.isArray(b?.bbox_2d) && b.bbox_2d.length === 4) : [];
  const hasBlocks = blockList.length > 0;
  const isFigure = (t) => String(t || '').trim() === '<image>';

  return (
    <div ref={wrapRef} className="sel-page" style={{ position: 'relative', width: '100%', background: '#fff' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto', aspectRatio: `1 / ${aspect}` }}/>
      {/* Transparent words aligned to the glyphs — the pdf.js approach. Only
          the spans select (pdfTextLayer.css); the gaps between them belong
          to the end marker, so a drag never runs off to the page's end.
          Hidden when the A/B toggle selects with the extracted layer instead. */}
      <div className="pdf-text-layer sel-layer" style={{ position: 'absolute', inset: 0, overflow: 'hidden',
        lineHeight: 1, textAlign: 'initial', unicodeBidi: 'isolate', color: 'transparent',
        ...(selectionOverlay && hasBlocks ? { display: 'none' } : null) }}/>
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
      {/* Only for a page with no words of its own (a scan), OR when the A/B
          toggle asks for the extracted-markdown layer on a text page. */}
      {wrapW > 0 && (hasText === false || (selectionOverlay && hasBlocks)) && <BlockTextLayer blocks={blockList} height={wrapW * aspect}
        surface={drawn ? canvasRef.current : null} surfaceKey={drawn}/>}
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
