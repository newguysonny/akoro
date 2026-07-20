/**
 * DrawPage — AI illustration prototype with engine comparison.
 *   • SVG        — rich "teacher at the whiteboard" illustration, drawn on
 *                  stroke-by-stroke. Best visual fidelity (not editable).
 *   • Excalidraw — editable hand-drawn shapes.
 *   • Mermaid    — structured flow/mind diagrams.
 * Loads a hand-authored SVG sample on first paint so quality is visible before
 * any live generation.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';
import { apiPost } from '../services/api.js';
import { BRAND } from '../constants.js';
import { SAMPLES } from './draw/samples.js';

const FONT = "'Nunito', sans-serif";
const MODES = [
  { key: 'svg',        label: '🎨 Illustration (SVG)' },
  { key: 'excalidraw', label: '✏️ Editable (Excalidraw)' },
  { key: 'mermaid',    label: '📊 Flowchart (Mermaid)' },
];
const CHIPS = ['How electromagnetic induction works', 'How photosynthesis works', 'The structure of an atom', 'The water cycle', 'How a neuron fires'];

// Strip any <script>/on* from SVG before injecting (defence-in-depth; the
// backend already refuses scripts).
const sanitizeSvg = (svg) => (svg || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/\son\w+="[^"]*"/gi, '');

export default function DrawPage() {
  const navigate = useNavigate();
  const [api, setApi]       = useState(null);
  const [mode, setMode]     = useState('svg');
  const [prompt, setPrompt] = useState(SAMPLES[0].prompt);
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);
  const [svg, setSvg]       = useState(SAMPLES[0].svg);   // current SVG illustration
  const [drawKey, setDrawKey] = useState(0);              // bump to replay draw-on
  const svgWrapRef = useRef(null);

  // Render Excalidraw elements onto the canvas.
  const renderElements = useCallback((elements, files) => {
    if (!api) return;
    const els = convertToExcalidrawElements(elements);
    api.updateScene({ elements: els });
    if (files) api.addFiles(Object.values(files));
    api.scrollToContent(els, { fitToContent: true, animate: true });
  }, [api]);

  const generate = useCallback(async (text) => {
    const q = (text ?? prompt).trim();
    if (!q || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await apiPost('/api/adaptive/draw', { prompt: q, mode });
      const d = res?.data ?? res;
      if (mode === 'svg') {
        if (!d?.svg) throw new Error('No illustration returned');
        setSvg(d.svg); setDrawKey((k) => k + 1);
      } else if (mode === 'mermaid') {
        const { elements, files } = await parseMermaidToExcalidraw(d.mermaid, { fontSize: 16 });
        renderElements(elements, files);
      } else {
        renderElements(d.elements);
      }
    } catch (e) {
      setError(e?.message || 'Could not draw that. Try rephrasing.');
    } finally { setBusy(false); }
  }, [prompt, busy, mode, renderElements]);

  // When switching INTO a canvas mode, seed with the sample so it's not blank.
  useEffect(() => {
    if (mode === 'excalidraw' && api) renderElements(SAMPLES[0].elements);
  }, [mode, api, renderElements]);

  const showSvg = mode === 'svg';

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', fontFamily: FONT, background: 'var(--ak-bg)' }}>
      <style>{DRAW_ON_CSS}</style>

      {/* Controls */}
      <div style={{ flexShrink: 0, padding: '10px 12px', borderBottom: '1px solid var(--ak-border)', background: 'var(--ak-surface)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate(-1)} aria-label="Back"
            style={{ flexShrink: 0, background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: BRAND, fontSize: 16, fontWeight: 900 }}>‹</button>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') generate(); }}
            placeholder="Describe what to illustrate…  e.g. “how a neuron fires”"
            style={{ flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 12, border: '1.5px solid var(--ak-border2)', outline: 'none', fontSize: 14, fontFamily: FONT, color: 'var(--ak-text)', background: 'var(--ak-bg)' }}
          />
          <button onClick={() => generate()} disabled={busy || !prompt.trim()}
            style={{ flexShrink: 0, background: busy || !prompt.trim() ? '#C9BEFF' : BRAND, color: '#fff', border: 'none', borderRadius: 12, padding: '11px 18px', cursor: busy ? 'default' : 'pointer', fontSize: 14, fontWeight: 800, fontFamily: FONT }}>
            {busy ? 'Drawing…' : '✨ Draw'}
          </button>
        </div>

        {/* Engine toggle */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MODES.map((m) => (
            <button key={m.key} onClick={() => setMode(m.key)}
              style={{ background: mode === m.key ? BRAND : 'var(--ak-bg)', color: mode === m.key ? '#fff' : 'var(--ak-text-sub)', border: `1px solid ${mode === m.key ? BRAND : 'var(--ak-border2)'}`, borderRadius: 100, padding: '6px 13px', cursor: 'pointer', fontSize: 12, fontWeight: 800, fontFamily: FONT }}>
              {m.label}
            </button>
          ))}
          {showSvg && <button onClick={() => setDrawKey((k) => k + 1)} title="Replay the drawing"
            style={{ marginLeft: 'auto', background: 'var(--ak-bg)', color: 'var(--ak-text-sub)', border: '1px solid var(--ak-border2)', borderRadius: 100, padding: '6px 13px', cursor: 'pointer', fontSize: 12, fontWeight: 800, fontFamily: FONT }}>↻ Replay</button>}
        </div>

        {/* Concept chips */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {CHIPS.map((c) => (
            <button key={c} onClick={() => { setPrompt(c); generate(c); }} disabled={busy}
              style={{ flexShrink: 0, background: 'var(--ak-bg)', border: '1px solid var(--ak-border2)', borderRadius: 100, padding: '5px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--ak-text-sub)', fontFamily: FONT }}>
              {c}
            </button>
          ))}
        </div>
        {error && <div style={{ fontSize: 12, color: '#EF4444', fontWeight: 700 }}>{error}</div>}
      </div>

      {/* Stage */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* SVG illustration layer */}
        <div style={{ position: 'absolute', inset: 0, display: showSvg ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', padding: 16, overflow: 'auto', background: '#fff' }}>
          <div key={drawKey} ref={svgWrapRef} className="ak-draw"
            style={{ width: '100%', maxWidth: 900 }}
            dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }} />
        </div>
        {/* Excalidraw / Mermaid canvas layer */}
        <div style={{ position: 'absolute', inset: 0, display: showSvg ? 'none' : 'block' }}>
          <Excalidraw excalidrawAPI={(a) => setApi(a)} />
        </div>
      </div>
    </div>
  );
}

// Draw-on animation: every stroke path/line starts fully "un-drawn"
// (dashoffset 1 on a normalised pathLength) and fills in, staggered.
const DRAW_ON_CSS = `
@keyframes akDrawOn { to { stroke-dashoffset: 0; } }
@keyframes akFadeIn { from { opacity: 0 } to { opacity: 1 } }
.ak-draw svg { width: 100%; height: auto; }
.ak-draw path.stroke, .ak-draw line.stroke, .ak-draw circle.stroke {
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: akDrawOn .7s ease forwards;
}
.ak-draw text, .ak-draw rect:not(.stroke), .ak-draw ellipse, .ak-draw circle:not(.stroke) {
  animation: akFadeIn .5s ease forwards;
}
.ak-draw .stroke:nth-of-type(2){animation-delay:.15s}
.ak-draw .stroke:nth-of-type(3){animation-delay:.3s}
.ak-draw .stroke:nth-of-type(4){animation-delay:.45s}
.ak-draw .stroke:nth-of-type(5){animation-delay:.6s}
.ak-draw .stroke:nth-of-type(6){animation-delay:.75s}
.ak-draw .stroke:nth-of-type(n+7){animation-delay:.9s}
`;
