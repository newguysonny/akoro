/**
 * MarketplacePage — constants + child components.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Check, Lock, Loader2, Plus, Trash2, Upload, FileText } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { apiGet, apiPost, API } from '../../services/api.js';
import { uploadAndOcr } from '../../services/uploadApi.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, GREEN, RED, FONT } from '../../constants.js';


const BRAND = AMBER;
const FONTF = FONT;
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

const TEMPLATE_TARGETS = [
  { value: 'lesson_plan', label: 'Lesson Plan' },
  { value: 'worksheet',   label: 'Worksheet' },
  { value: 'report',      label: 'Report' },
  { value: 'exam_prep',   label: 'Exam / Assessment' },
  { value: 'generic',     label: 'Other' },
];

/* ─── Create-template modal (upload sample → OCR → save) ──────────── */
function CreateTemplateModal({ onClose, onSaved }) {
  const fileRef = useRef(null);
  const [stage, setStage]   = useState('upload');   // upload | extracting | review
  const [fileName, setFile] = useState('');
  const [text, setText]     = useState('');
  const [title, setTitle]   = useState('');
  const [target, setTarget] = useState('worksheet');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const pick = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f.name); setError(''); setStage('extracting');
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    try {
      const ocr = await uploadAndOcr(f);
      setText(ocr || '');
      setStage('review');
    } catch (err) {
      setError(err.message || 'Could not read that file'); setStage('upload');
    }
  };

  const save = async () => {
    if (!title.trim() || !text.trim()) { setError('Add a title and some sample content.'); return; }
    setSaving(true); setError('');
    try {
      const res = await apiPost('/api/instructor/tools/templates', { title: title.trim(), toolTarget: target, sourceText: text });
      onSaved(res.template);
    } catch (err) {
      setError(err.message || 'Could not save template'); setSaving(false);
    }
  };

  const inp = { width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13.5, fontFamily: FONTF, color: INK, boxSizing: 'border-box' };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ zIndex: 3100, width: '100%', background: '#fff', borderRadius: 22, padding: '20px 18px 28px', boxShadow: '0 12px 48px rgba(0,0,0,.22)', animation: 'sheet-up .25s ease', fontFamily: FONTF, maxHeight: '90vh', overflowY: 'auto', maxWidth: 520 }}>
        <p style={{ fontSize: 16, fontWeight: 900, color: INK, margin: '0 0 4px' }}>Create a template</p>
        <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 18px', lineHeight: 1.5 }}>Upload a photo of your existing notes, worksheet or report. We’ll turn it into a reusable template your agent copies when generating new material.</p>

        <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={pick} />

        {stage !== 'review' && (
          <div onClick={() => stage !== 'extracting' && fileRef.current?.click()} style={{ border: `2px dashed ${BORDER}`, borderRadius: 16, padding: '30px 20px', textAlign: 'center', cursor: stage === 'extracting' ? 'default' : 'pointer', marginBottom: 16 }}>
            {stage === 'extracting' ? (
              <>
                <Loader2 size={26} color={BRAND} style={{ animation: 'spin .8s linear infinite', marginBottom: 8 }} />
                <p style={{ fontSize: 13.5, fontWeight: 700, color: INK, margin: 0 }}>Reading {fileName}…</p>
                <p style={{ fontSize: 12, color: MUTED2, margin: '4px 0 0' }}>Extracting the structure</p>
              </>
            ) : (
              <>
                <Upload size={26} color={MUTED2} style={{ marginBottom: 8 }} />
                <p style={{ fontSize: 13.5, fontWeight: 800, color: INK, margin: 0 }}>Tap to upload a sample</p>
                <p style={{ fontSize: 12, color: MUTED2, margin: '4px 0 0' }}>Image or PDF · lesson notes, worksheet, report…</p>
              </>
            )}
          </div>
        )}

        {stage === 'review' && (
          <>
            <label style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>Template name</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inp, marginTop: 6, marginBottom: 14 }} placeholder="e.g. My weekly worksheet format" />

            <label style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>Use for</label>
            <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ ...inp, marginTop: 6, marginBottom: 14, cursor: 'pointer' }}>
              {TEMPLATE_TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

            <label style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>Extracted content — edit if needed</label>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} style={{ ...inp, marginTop: 6, resize: 'vertical', lineHeight: 1.55 }} />
          </>
        )}

        {error && <p style={{ fontSize: 12.5, fontWeight: 600, color: RED, margin: '12px 0 0' }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '13px', borderRadius: 14, border: `1.5px solid ${BORDER}`, background: LIGHT, fontSize: 13, fontWeight: 800, color: MUTED, cursor: 'pointer', fontFamily: FONTF }}>Cancel</button>
          {stage === 'review' && (
            <button onClick={save} disabled={saving} style={{ flex: 1.5, padding: '13px', borderRadius: 14, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg,${BRAND},#D4651E)`, color: saving ? '#9CA3AF' : '#fff', fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONTF }}>
              {saving ? 'Saving…' : 'Save template'}
            </button>
          )}
        </div>
      </div>
      </div>
    </>
  );
}

/* ─── View-template modal (structure + fillable body) ────────────── */
function ViewTemplateModal({ tpl, onClose }) {
  const s = tpl.structure || {};
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto', background: '#fff', borderRadius: 22, padding: '22px 20px 26px', boxShadow: '0 12px 48px rgba(0,0,0,.22)', fontFamily: FONTF, animation: 'sheet-up .25s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <p style={{ fontSize: 16, fontWeight: 900, color: INK, margin: 0 }}>{tpl.title}</p>
          {tpl.is_sample && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: `${GREEN}15`, color: GREEN }}>SAMPLE</span>}
        </div>
        <p style={{ fontSize: 12, color: MUTED2, margin: '0 0 16px' }}>{(TEMPLATE_TARGETS.find((x) => x.value === tpl.tool_target) || {}).label || tpl.tool_target}</p>

        {s.sections?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 900, color: BRAND, letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 7px' }}>Structure</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {s.sections.map((sec, i) => <span key={i} style={{ fontSize: 12, fontWeight: 700, color: INK, background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '4px 10px' }}>{i + 1}. {sec}</span>)}
            </div>
            {s.style && <p style={{ fontSize: 12.5, color: MUTED, margin: '10px 0 0' }}><b>Style:</b> {s.style}</p>}
          </div>
        )}

        {tpl.body_markdown && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 900, color: BRAND, letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 7px' }}>Template body (AI fills this)</p>
            <pre style={{ fontSize: 12.5, color: INK, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px', margin: 0, fontFamily: 'ui-monospace, Menlo, monospace' }}>{tpl.body_markdown}</pre>
          </div>
        )}

        <button onClick={onClose} style={{ width: '100%', marginTop: 18, padding: '12px', borderRadius: 14, border: `1.5px solid ${BORDER}`, background: LIGHT, fontSize: 13, fontWeight: 800, color: MUTED, cursor: 'pointer', fontFamily: FONTF }}>Close</button>
      </div>
    </div>
  );
}

/* ─── Item card ───────────────────────────────────────────────────── */
function ItemCard({ item, busy, onBuy }) {
  return (
    <div style={{ background: '#fff', borderRadius: 16, border: `1px solid ${item.owned ? `${GREEN}40` : BORDER}`, boxShadow: '0 1px 4px rgba(0,0,0,.05)', padding: '14px 16px', display: 'flex', gap: 13, alignItems: 'flex-start' }}>
      <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, background: `${BRAND}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>{item.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: INK, margin: 0 }}>{item.name}</p>
          {item.tag && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: `${BRAND}12`, color: BRAND }}>{item.tag}</span>}
        </div>
        <p style={{ fontSize: 12.5, color: MUTED, margin: '5px 0 10px', lineHeight: 1.55 }}>{item.description}</p>
        <span style={{ fontSize: 14, fontWeight: 900, color: item.price === 0 ? GREEN : INK }}>
          {item.price === 0 ? 'Free' : naira(item.price)}
        </span>
      </div>
      {/* Owned badge or Unlock button */}
      {item.owned ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 10, background: `${GREEN}15`, color: GREEN, fontSize: 12, fontWeight: 800, flexShrink: 0, marginTop: 2 }}>
          <Check size={13} /> Unlocked
        </span>
      ) : (
        <button onClick={() => onBuy(item)} disabled={busy}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: busy ? '#E5E7EB' : `linear-gradient(135deg,${BRAND},#D4651E)`, color: busy ? '#9CA3AF' : '#fff', fontSize: 12.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: FONTF, flexShrink: 0, marginTop: 2 }}>
          {busy ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Lock size={12} />}
          {item.price === 0 ? 'Get' : 'Unlock'}
        </button>
      )}
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────── */

export { BRAND, FONTF, naira, TEMPLATE_TARGETS, CreateTemplateModal, ViewTemplateModal, ItemCard };
