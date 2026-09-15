/*
 * WhiteboardModal — a freeform sketchpad for the session, opened from the
 * composer's board tool (beside the reader tool). Frontend only: strokes
 * live in component state and nowhere else — nothing is uploaded, nothing
 * persists past close.
 *
 * Pointer events (pen / touch / mouse) with pointer capture, stroke-stack
 * undo, and an eraser that truly erases (destination-out).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Undo2, Trash2, Pencil, Eraser } from 'lucide-react';
import { BRAND } from '../../constants.js';

const PALETTE = ['#FFFFFF', BRAND, '#F59E0B', '#10B981', '#EF4444', '#EC4899'];
const WIDTHS  = [2.5, 5, 9];
const BOARD_BG = '#101225';

export default function WhiteboardModal({ topic, subject, onClose }) {
  const canvasRef = useRef(null);
  const wrapRef  = useRef(null);
  // One flat stack of strokes; erased areas are strokes with mode 'erase'.
  const strokesRef = useRef([]);
  const liveRef    = useRef(null);   // the stroke in progress
  const [tool, setTool]   = useState({ mode: 'pen', color: PALETTE[0], width: WIDTHS[1] });
  const [canUndo, setCanUndo] = useState(false);

  /* Redraw everything — sized for the device pixel ratio so lines stay crisp. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const drawStroke = (st) => {
      if (!st.points.length) return;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = st.width;
      if (st.mode === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.strokeStyle = st.color;
      }
      ctx.beginPath();
      ctx.moveTo(st.points[0].x, st.points[0].y);
      for (let i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i].x, st.points[i].y);
      if (st.points.length === 1) ctx.lineTo(st.points[0].x + 0.1, st.points[0].y); // a dot
      ctx.stroke();
      ctx.restore();
    };
    strokesRef.current.forEach(drawStroke);
    if (liveRef.current) drawStroke(liveRef.current);
  }, []);

  useEffect(() => {
    redraw();
    const onResize = () => redraw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [redraw]);

  const posOf = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    liveRef.current = {
      mode: tool.mode, color: tool.color, width: tool.width,
      points: [posOf(e)],
    };
    redraw();
  };
  const onMove = (e) => {
    if (!liveRef.current) return;
    e.preventDefault();
    liveRef.current.points.push(posOf(e));
    redraw();
  };
  const onUp = () => {
    if (!liveRef.current) return;
    strokesRef.current.push(liveRef.current);
    liveRef.current = null;
    setCanUndo(true);
    redraw();
  };

  const undo = () => {
    strokesRef.current.pop();
    setCanUndo(strokesRef.current.length > 0);
    redraw();
  };
  const clear = () => {
    strokesRef.current = [];
    setCanUndo(false);
    redraw();
  };

  const toolBtn = (active) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    width: 34, height: 34, borderRadius: 9, cursor: 'pointer', flexShrink: 0,
    border: `1px solid ${active ? BRAND : 'transparent'}`,
    background: active ? `${BRAND}22` : 'transparent',
    color: active ? BRAND : 'rgba(255,255,255,.55)',
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3400, background: 'rgba(4,4,12,.72)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', padding: 'calc(env(safe-area-inset-top, 0px) + 10px) 10px 10px', fontFamily: "'Nunito',sans-serif" }}>
      {/* Header: what we're sketching about + the tools */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: '#fff' }}>🎨 Whiteboard</div>
          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.55)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subject ? `${subject} — ${topic}` : topic || 'Sketch it out'} · stays on your device
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 12, padding: 5, flexWrap: 'wrap' }}>
          <button type="button" title="Pen" onClick={() => setTool(t => ({ ...t, mode: 'pen' }))} style={toolBtn(tool.mode === 'pen')}>
            <Pencil size={15} />
          </button>
          <button type="button" title="Eraser" onClick={() => setTool(t => ({ ...t, mode: 'erase', width: WIDTHS[2] }))} style={toolBtn(tool.mode === 'erase')}>
            <Eraser size={15} />
          </button>

          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.14)', margin: '0 2px' }} />

          {PALETTE.map(c => (
            <button key={c} type="button" title={`Pen colour`}
              onClick={() => setTool(t => ({ ...t, mode: 'pen', color: c }))}
              style={{ ...toolBtn(tool.mode === 'pen' && tool.color === c), width: 24, height: 24, borderRadius: '50%', background: c, border: `2px solid ${tool.mode === 'pen' && tool.color === c ? BRAND : 'rgba(255,255,255,.25)'}` }} />
          ))}

          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.14)', margin: '0 2px' }} />

          {WIDTHS.map(w => (
            <button key={w} type="button" title={`${w}px stroke`} onClick={() => setTool(t => ({ ...t, width: w }))}
              style={{ ...toolBtn(tool.width === w), width: 28, height: 28 }}>
              <span style={{ display: 'block', width: w + 4, height: w + 4, borderRadius: '50%', background: tool.mode === 'erase' ? 'rgba(255,255,255,.55)' : tool.color }} />
            </button>
          ))}

          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,.14)', margin: '0 2px' }} />

          <button type="button" title="Undo" onClick={undo} disabled={!canUndo}
            style={{ ...toolBtn(false), opacity: canUndo ? 1 : 0.35, cursor: canUndo ? 'pointer' : 'default' }}>
            <Undo2 size={15} />
          </button>
          <button type="button" title="Clear the board" onClick={clear} style={toolBtn(false)}>
            <Trash2 size={15} />
          </button>
          <button type="button" title="Close the whiteboard" onClick={onClose} style={{ ...toolBtn(false), background: 'rgba(239,68,68,.15)' }}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* The board */}
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,.14)', background: BOARD_BG, position: 'relative' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          style={{ display: 'block', touchAction: 'none', cursor: tool.mode === 'erase' ? 'cell' : 'crosshair' }}
        />
        {strokesRef.current.length === 0 && !liveRef.current && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ color: 'rgba(255,255,255,.22)', fontSize: 14, fontWeight: 800 }}>
              Draw it — a diagram beats a paragraph
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
