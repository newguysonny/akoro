/*
 * SubmissionMarkup — mark up a learner's submission PDF while grading.
 *
 * The PDF is drawn with pdf.js, one canvas per page, with a layer on top
 * for the grader's marks:
 *   ✓ Tick and ✗ Cross — click where they go
 *   Comment            — click to drop a numbered pin, then type the note
 *   Highlight          — drag a box over a passage
 *   Select             — click a mark to edit (comments) or delete it
 * Marks are stored as fractions of the page (0-1 from the top-left), so
 * they hold at any width. The parent owns them (`marks`, `onChange`) and
 * saves; on publish the API draws them into the marked copy.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Check, X, MessageSquare, Highlighter, MousePointer2, Undo2, Trash2, Loader2 } from 'lucide-react';
import { PURPLE, GREEN, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const TOOLS = [
  { id: 'select',    label: 'Select',    Icon: MousePointer2, ti: 'ti-pointer', key: 'v' },
  { id: 'tick',      label: 'Tick',      Icon: Check,         ti: 'ti-check', key: 't', color: GREEN },
  { id: 'cross',     label: 'Cross',     Icon: X,             ti: 'ti-x', key: 'x', color: RED },
  { id: 'comment',   label: 'Comment',   Icon: MessageSquare, ti: 'ti-message', key: 'c', color: PURPLE },
  { id: 'highlight', label: 'Highlight', Icon: Highlighter,   ti: 'ti-highlight', key: 'h', color: '#CA8A04' },
];

let seq = 0;
const newId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;
const clamp = (v) => Math.min(1, Math.max(0, v));

/** Comment pins numbered in reading order (page, then top to bottom) — the
 *  same order the marked copy's comment list uses. */
export function commentNumbers(marks) {
  const map = new Map();
  (marks || []).filter((m) => m.type === 'comment')
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
    .forEach((m, i) => map.set(m.id, i + 1));
  return map;
}

/* One page: the canvas, and the marks layer that takes the clicks. */
function MarkupPage({ pdf, pageNumber, width, tool, marks, numbers, selectedId, onAdd, onSelect, onCommentOpen }) {
  const canvasRef = useRef(null);
  const layerRef = useRef(null);
  const [aspect, setAspect] = useState(1.414);
  const [drag, setDrag] = useState(null);   // highlight being drawn: { x0, y0, x1, y1 }

  useEffect(() => {
    let cancelled = false, task = null;
    (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      setAspect(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      await task.promise.catch(() => {});
    })();
    return () => { cancelled = true; task?.cancel?.(); };
  }, [pdf, pageNumber, width]);

  const point = (e) => {
    const r = layerRef.current.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const onPointerDown = (e) => {
    if (e.button !== 0 || tool === 'select') { onSelect(null); return; }
    const p = point(e);
    if (tool === 'highlight') {
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    const mark = { id: newId(), page: pageNumber, type: tool, x: p.x, y: p.y, ...(tool === 'comment' ? { text: '' } : {}) };
    onAdd(mark);
    if (tool === 'comment') onCommentOpen(mark.id);
  };
  const onPointerMove = (e) => { if (drag) { const p = point(e); setDrag((d) => ({ ...d, x1: p.x, y1: p.y })); } };
  const onPointerUp = () => {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    setDrag(null);
    if (w > 0.01 && h > 0.006) onAdd({ id: newId(), page: pageNumber, type: 'highlight', x, y, w, h });
  };

  const size = Math.max(16, width * 0.032);
  return (
    <div data-markup-page={pageNumber} style={{ position: 'relative', width, height: width * aspect, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.25)', margin: '0 auto 14px' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <div ref={layerRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        style={{ position: 'absolute', inset: 0, cursor: tool === 'select' ? 'default' : tool === 'highlight' ? 'crosshair' : 'copy', touchAction: tool === 'highlight' ? 'none' : 'auto' }}>
        {marks.map((m) => {
          const sel = m.id === selectedId;
          const pick = (e) => { e.stopPropagation(); onSelect(m.id); if (m.type === 'comment') onCommentOpen(m.id); };
          if (m.type === 'highlight') {
            return <div key={m.id} data-mark={m.type} onPointerDown={pick} title="Highlight"
              style={{ position: 'absolute', left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%`, background: 'rgba(250,204,21,.32)', border: `1.5px solid ${sel ? PURPLE : 'rgba(234,179,8,.7)'}`, borderRadius: 2, cursor: 'pointer',
                // A highlight is a backdrop: pins, ticks and crosses land ON it.
                // It only takes clicks in Select mode.
                pointerEvents: tool === 'select' ? 'auto' : 'none' }} />;
          }
          const common = { position: 'absolute', left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: 'translate(-50%, -50%)', cursor: 'pointer', outline: sel ? `2px solid ${PURPLE}` : 'none', outlineOffset: 2, borderRadius: 6, lineHeight: 1 };
          if (m.type === 'comment') {
            return <div key={m.id} data-mark="comment" onPointerDown={pick} title={m.text || 'Comment'}
              style={{ ...common, width: size, height: size, borderRadius: '50%', background: PURPLE, color: '#fff', fontSize: size * 0.55, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: C.font, boxShadow: '0 2px 6px rgba(76,29,204,.35)' }}>
              {numbers.get(m.id) || '·'}
            </div>;
          }
          return <div key={m.id} data-mark={m.type} onPointerDown={pick} title={m.type === 'tick' ? 'Tick' : 'Cross'}
            style={{ ...common, color: m.type === 'tick' ? GREEN : RED, fontSize: size * 1.25, fontWeight: 900, fontFamily: 'Arial, sans-serif' }}>
            {m.type === 'tick' ? '✓' : '✗'}
          </div>;
        })}
        {drag && (
          <div style={{ position: 'absolute', left: `${Math.min(drag.x0, drag.x1) * 100}%`, top: `${Math.min(drag.y0, drag.y1) * 100}%`, width: `${Math.abs(drag.x1 - drag.x0) * 100}%`, height: `${Math.abs(drag.y1 - drag.y0) * 100}%`, background: 'rgba(250,204,21,.25)', border: '1.5px dashed rgba(234,179,8,.9)' }} />
        )}
      </div>
    </div>
  );
}

export default function SubmissionMarkup({ blob, marks, onChange, saveState = 'idle' }) {
  const wrapRef = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(0);
  const [tool, setTool] = useState('tick');
  const [selectedId, setSelectedId] = useState(null);
  const [editing, setEditing] = useState(null);   // comment id open in the editor
  const history = useRef([]);

  useEffect(() => {
    let alive = true, doc = null;
    setPdf(null); setError('');
    blob.arrayBuffer()
      .then((buf) => pdfjsLib.getDocument({ data: buf }).promise)
      .then((d) => { doc = d; if (alive) setPdf(d); })
      .catch(() => { if (alive) setError('This PDF could not be displayed for marking.'); });
    return () => { alive = false; doc?.destroy?.(); };
  }, [blob]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(Math.min(900, Math.max(280, el.clientWidth - 24))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const change = useCallback((next) => {
    history.current = [...history.current.slice(-49), marks];
    onChange(next);
  }, [marks, onChange]);
  const add = (m) => { change([...marks, m]); setSelectedId(m.id); };
  const remove = (id) => {
    change(marks.filter((m) => m.id !== id));
    if (selectedId === id) setSelectedId(null);
    if (editing === id) setEditing(null);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (prev) { onChange(prev); setSelectedId(null); setEditing(null); }
  };
  const setText = (id, text) => onChange(marks.map((m) => (m.id === id ? { ...m, text } : m)));
  const closeEditor = () => {
    const m = marks.find((x) => x.id === editing);
    if (m && !String(m.text || '').trim()) remove(m.id);   // an empty pin says nothing
    setEditing(null);
  };

  // Keyboard: tool letters, Delete removes the selection, Ctrl/Cmd+Z undoes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('textarea, input')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { e.preventDefault(); remove(selectedId); return; }
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (t && !e.ctrlKey && !e.metaKey) setTool(t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const numbers = useMemo(() => commentNumbers(marks), [marks]);
  const counts = useMemo(() => ({
    tick: marks.filter((m) => m.type === 'tick').length,
    cross: marks.filter((m) => m.type === 'cross').length,
    comment: marks.filter((m) => m.type === 'comment').length,
  }), [marks]);
  const editingMark = marks.find((m) => m.id === editing);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Toolbar */}
      <div role="toolbar" aria-label="Marking tools" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 2, background: C.surface, padding: '6px 0' }}>
        {TOOLS.map(({ id, label, Icon, ti, color, key }) => (
          <button key={id} type="button" onClick={() => setTool(id)} aria-pressed={tool === id} title={`${label} (${key.toUpperCase()})`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${tool === id ? PURPLE : C.border}`, background: tool === id ? '#F1ECFF' : C.surface, color: tool === id ? PURPLE : (color || C.muted), fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
            <Ico lucide={Icon} ti={ti} size={13} /> {label}
          </button>
        ))}
        <button type="button" onClick={undo} disabled={!history.current.length} title="Undo (Ctrl+Z)"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font, opacity: history.current.length ? 1 : .45 }}>
          <Ico lucide={Undo2} ti="ti-arrow-back-up" size={13} /> Undo
        </button>
        {selectedId && (
          <button type="button" onClick={() => remove(selectedId)} title="Delete the selected mark (Delete)"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: `1.5px solid ${RED}55`, background: C.surface, color: RED, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
            <Ico lucide={Trash2} ti="ti-trash" size={13} /> Delete mark
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: C.muted2, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {counts.tick} ✓ · {counts.cross} ✗ · {counts.comment} comment{counts.comment === 1 ? '' : 's'}
          <span style={{ color: saveState === 'error' ? RED : C.muted2 }}>
            {saveState === 'saving' ? '· saving…' : saveState === 'saved' ? '· marks saved' : saveState === 'error' ? '· not saved — retrying' : ''}
          </span>
        </span>
      </div>

      {/* Comment editor — floats over the pages (no layout shift: the pin
          stays where it was dropped while the note is typed). */}
      <div style={{ position: 'relative', height: 0, zIndex: 4 }}>
      {editingMark && (
        <div data-comment-editor="" style={{ position: 'absolute', top: 6, right: 12, width: 340, maxWidth: 'calc(100% - 24px)', border: `1.5px solid ${PURPLE}`, borderRadius: 10, padding: 10, background: '#FBFAFF', boxShadow: '0 12px 30px -10px rgba(33,31,53,.45)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: PURPLE, marginBottom: 6 }}>Comment {numbers.get(editingMark.id) || ''} · page {editingMark.page}</div>
          <textarea autoFocus value={editingMark.text || ''} maxLength={1000} rows={3}
            onChange={(e) => setText(editingMark.id, e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) closeEditor(); if (e.key === 'Escape') closeEditor(); }}
            placeholder="What should the learner see here?"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, color: C.ink, resize: 'vertical', outline: 'none' }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" onClick={() => remove(editingMark.id)} style={{ fontSize: 12, fontWeight: 800, color: RED, background: 'none', border: 'none', cursor: 'pointer', fontFamily: C.font }}>Delete</button>
            <button type="button" onClick={closeEditor} style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: PURPLE, border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: C.font }}>Done</button>
          </div>
        </div>
      )}
      </div>

      {/* Pages */}
      <div ref={wrapRef} style={{ background: '#525659', borderRadius: 10, padding: '12px 0', maxHeight: '76vh', overflowY: 'auto' }}>
        {error ? <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, padding: 20, textAlign: 'center' }}>{error}</div>
          : !pdf || !width ? <div style={{ color: '#ddd', fontSize: 13, fontWeight: 700, padding: 40, display: 'flex', justifyContent: 'center', gap: 8 }}><Ico lucide={Loader2} ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> Loading pages…</div>
          : Array.from({ length: pdf.numPages }, (_, i) => (
            <MarkupPage key={i + 1} pdf={pdf} pageNumber={i + 1} width={width} tool={tool}
              marks={marks.filter((m) => m.page === i + 1)} numbers={numbers} selectedId={selectedId}
              onAdd={add} onSelect={setSelectedId} onCommentOpen={setEditing} />
          ))}
      </div>
      <div style={{ fontSize: 11, color: C.muted2, fontWeight: 600 }}>
        Marks save as you go and reach the learner inside their marked copy when you publish the grade. Keys: V select · T tick · X cross · C comment · H highlight · Delete · Ctrl+Z.
      </div>
    </div>
  );
}
