/**
 * DrawPage — AI diagram prototype.
 * Type a concept → backend (Claude/LLM) returns Mermaid → we convert it to
 * editable Excalidraw shapes on the canvas. Prototype: generate + edit only.
 */
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';
// NB: @excalidraw/excalidraw 0.17.x bundles its CSS into the JS — no separate
// stylesheet import is needed (that changed in 0.18+).
import { apiPost } from '../services/api.js';
import { BRAND } from '../constants.js';

const FONT = "'Nunito', sans-serif";
const CHIPS = ['Photosynthesis', 'How a bill becomes law', 'The water cycle', 'Electromagnetic induction', 'Cell structure'];

export default function DrawPage() {
  const navigate = useNavigate();
  const [api, setApi]       = useState(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState(null);

  const generate = useCallback(async (text) => {
    const q = (text ?? prompt).trim();
    if (!q || busy || !api) return;
    setBusy(true); setError(null);
    try {
      const res = await apiPost('/api/adaptive/draw', { prompt: q });
      const mermaid = res?.data?.mermaid ?? res?.mermaid;
      if (!mermaid) throw new Error('No diagram returned');

      const { elements, files } = await parseMermaidToExcalidraw(mermaid, { fontSize: 16 });
      const els = convertToExcalidrawElements(elements);
      api.updateScene({ elements: els });
      if (files) api.addFiles(Object.values(files));
      api.scrollToContent(els, { fitToContent: true, animate: true });
    } catch (e) {
      setError(e?.message || 'Could not draw that. Try rephrasing.');
    } finally { setBusy(false); }
  }, [prompt, busy, api]);

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', fontFamily: FONT, background: 'var(--ak-bg)' }}>
      {/* Prompt bar */}
      <div style={{ flexShrink: 0, padding: '10px 12px', borderBottom: '1px solid var(--ak-border)', background: 'var(--ak-surface)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigate(-1)} aria-label="Back"
            style={{ flexShrink: 0, background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: BRAND, fontSize: 16, fontWeight: 900 }}>‹</button>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') generate(); }}
            placeholder="Describe a diagram to draw…  e.g. “how photosynthesis works”"
            style={{ flex: 1, minWidth: 0, padding: '11px 14px', borderRadius: 12, border: '1.5px solid var(--ak-border2)', outline: 'none', fontSize: 14, fontFamily: FONT, color: 'var(--ak-text)', background: 'var(--ak-bg)' }}
          />
          <button onClick={() => generate()} disabled={busy || !prompt.trim()}
            style={{ flexShrink: 0, background: busy || !prompt.trim() ? '#C9BEFF' : BRAND, color: '#fff', border: 'none', borderRadius: 12, padding: '11px 18px', cursor: busy ? 'default' : 'pointer', fontSize: 14, fontWeight: 800, fontFamily: FONT }}>
            {busy ? 'Drawing…' : '✨ Draw'}
          </button>
        </div>
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

      {/* Canvas */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Excalidraw excalidrawAPI={(a) => setApi(a)} />
      </div>
    </div>
  );
}
