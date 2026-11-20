/*
 * WhiteboardModal — a freeform sketchpad for the session, opened from the
 * composer's board tool (beside the reader tool). Frontend only: strokes
 * live in component state and nowhere else — nothing is uploaded, nothing
 * persists past close.
 *
 * Pointer events (pen / touch / mouse) with pointer capture, stroke-stack
 * undo, and an eraser that truly erases (destination-out).
 *
 * An assignment's answer box opens it too, with onAttach: "Attach to answer"
 * hands back the drawing as a PNG (board colour included) and its strokes,
 * so reopening the attached drawing picks up where the learner left off.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Undo2, Trash2, Pencil, Eraser, Paperclip, Presentation } from 'lucide-react';
import { BRAND } from '../../../constants.js';

// Light board: ink first, then the brand and bright colours.
const PALETTE = ['#1A1A2E', BRAND, '#F59E0B', '#10B981', '#EF4444', '#3B82F6'];
const WIDTHS  = [2.5, 5, 9];
const BOARD_BG = '#FFFFFF';
const INK = '#1A1A2E';
const MUTED = '#6B7280';
const LINE = '#E2E5ED';

export default function WhiteboardModal({ topic, subject, onClose, title = 'Whiteboard', initialStrokes = null, onAttach = null, attachLabel = 'Attach to answer' }) {
  const canvasRef = useRef(null);
  const wrapRef  = useRef(null);
  // One flat stack of strokes; erased areas are strokes with mode 'erase'.
  const strokesRef = useRef(Array.isArray(initialStrokes) ? initialStrokes.map((st) => ({ ...st, points: [...st.points] })) : []);
  const liveRef    = useRef(null);   // the stroke in progress
  const [tool, setTool]   = useState({ mode: 'pen', color: PALETTE[0], width: WIDTHS[1] });
  const [canUndo, setCanUndo] = useState(strokesRef.current.length > 0);
  const [attaching, setAttaching] = useState(false);

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

  /* The drawing as a PNG on the board colour — what the teacher sees. */
  const attach = () => {
    const canvas = canvasRef.current;
    if (!canvas || !onAttach || !strokesRef.current.length || attaching) return;
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    setAttaching(true);
    out.toBlob((blob) => {
      Promise.resolve(blob ? onAttach(blob, strokesRef.current.map((st) => ({ ...st, points: [...st.points] }))) : null)
        .finally(() => setAttaching(false));
    }, 'image/png');
  };

  const toolBtn = (active) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    width: 34, height: 34, borderRadius: 9, cursor: 'pointer', flexShrink: 0,
    border: `1px solid ${active ? BRAND : 'transparent'}`,
    background: active ? `${BRAND}14` : 'transparent',
    color: active ? BRAND : MUTED,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3400, background: '#F4F5F9', display: 'flex', flexDirection: 'column', padding: 'calc(env(safe-area-inset-top, 0px) + 10px) 10px 10px', fontFamily: "'Nunito',sans-serif" }}>
      {/* Header: what we're sketching about + the tools */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 900, color: INK, display: 'flex', alignItems: 'center', gap: 7 }}>
            {onAttach ? <Pencil size={15} color={BRAND} /> : <Presentation size={15} color={BRAND} />} {title}
          </div>
          <div style={{ fontSize: 10.5, color: MUTED, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subject ? `${subject} — ${topic}` : topic || 'Sketch it out'} · {onAttach ? 'attach it when it\'s ready' : 'stays on your device'}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#FFFFFF', border: `1px solid ${LINE}`, borderRadius: 12, padding: 5, boxShadow: '0 2px 8px rgba(30,41,59,.06)', flexWrap: 'wrap' }}>
          <button type="button" title="Pen" onClick={() => setTool(t => ({ ...t, mode: 'pen' }))} style={toolBtn(tool.mode === 'pen')}>
            <Pencil size={15} />
          </button>
          <button type="button" title="Eraser" onClick={() => setTool(t => ({ ...t, mode: 'erase', width: WIDTHS[2] }))} style={toolBtn(tool.mode === 'erase')}>
            <Eraser size={15} />
          </button>

          <div style={{ width: 1, height: 20, background: LINE, margin: '0 2px' }} />

          {PALETTE.map(c => (
            <button key={c} type="button" title={`Pen colour`}
              onClick={() => setTool(t => ({ ...t, mode: 'pen', color: c }))}
              style={{ ...toolBtn(tool.mode === 'pen' && tool.color === c), width: 24, height: 24, borderRadius: '50%', background: c, border: `2px solid ${tool.mode === 'pen' && tool.color === c ? BRAND : '#fff'}`, boxShadow: `0 0 0 1px ${LINE}` }} />
          ))}

          <div style={{ width: 1, height: 20, background: LINE, margin: '0 2px' }} />

          {WIDTHS.map(w => (
            <button key={w} type="button" title={`${w}px stroke`} onClick={() => setTool(t => ({ ...t, width: w }))}
              style={{ ...toolBtn(tool.width === w), width: 28, height: 28 }}>
              <span style={{ display: 'block', width: w + 4, height: w + 4, borderRadius: '50%', background: tool.mode === 'erase' ? '#9CA3AF' : tool.color }} />
            </button>
          ))}

          <div style={{ width: 1, height: 20, background: LINE, margin: '0 2px' }} />

          <button type="button" title="Undo" onClick={undo} disabled={!canUndo}
            style={{ ...toolBtn(false), opacity: canUndo ? 1 : 0.35, cursor: canUndo ? 'pointer' : 'default' }}>
            <Undo2 size={15} />
          </button>
          <button type="button" title="Clear the board" onClick={clear} style={toolBtn(false)}>
            <Trash2 size={15} />
          </button>
          {onAttach && (
            <button type="button" onClick={attach} disabled={!canUndo || attaching}
              style={{ height: 34, padding: '0 13px', borderRadius: 9, border: 'none', background: BRAND, color: '#fff', fontSize: 12, fontWeight: 900, fontFamily: "'Nunito',sans-serif", cursor: canUndo && !attaching ? 'pointer' : 'default', opacity: canUndo ? 1 : 0.45, display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <Paperclip size={14} /> {attaching ? 'Attaching…' : attachLabel}
            </button>
          )}
          <button type="button" title="Close the whiteboard" onClick={onClose} style={{ ...toolBtn(false), background: 'rgba(239,68,68,.10)', color: '#DC2626' }}>
            <X size={16} />
          </button>
        </div>
      </div>

      {/* The board */}
      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, borderRadius: 16, overflow: 'hidden', border: `1px solid ${LINE}`, background: BOARD_BG, position: 'relative', boxShadow: '0 4px 18px rgba(30,41,59,.07)' }}>
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
            <span style={{ color: '#B8BECC', fontSize: 14, fontWeight: 800 }}>
              Draw it — a diagram beats a paragraph
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
