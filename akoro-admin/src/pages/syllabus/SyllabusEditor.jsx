/**
 * SyllabusEditor — preview + edit a subject's extracted outline before/after
 * it's trusted. Loads the structured outline, lets the admin fix topics,
 * subtopics, content and objectives, then re-ingests (full replace + re-embed
 * via the same /ingest endpoint).
 */
import { useState, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { Modal, Btn, Skeleton } from '../../components/Primitives.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, RED, PURPLE, FONT } from '../../constants.js';

const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' };

// outline (from API) → editable draft (drop ids; ingest replaces by content)
function toDraft(o) {
  return {
    exam: o.exam || 'WASSCE', name: o.name || '', code: o.code || '', aims: o.aims || '',
    topics: (o.topics || []).map((t) => ({
      title: t.title || '',
      subtopics: (t.syllabus_subtopics || t.subtopics || [])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((s) => ({ title: s.title || '', content: s.content || '', objectives: (s.objectives || []).join('\n') })),
    })),
  };
}

// editable draft → ingest doc
function toDoc(d) {
  return {
    exam: d.exam, name: d.name.trim(), code: d.code.trim() || undefined, aims: d.aims.trim() || undefined,
    topics: d.topics.filter((t) => t.title.trim()).map((t) => ({
      title: t.title.trim(),
      subtopics: t.subtopics.filter((s) => s.title.trim()).map((s) => ({
        title: s.title.trim(),
        content: s.content.trim() || undefined,
        objectives: s.objectives.split('\n').map((x) => x.trim()).filter(Boolean),
      })),
    })),
  };
}

export default function SyllabusEditor({ slug, onClose, onSaved, show }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({}); // topic index → expanded

  useEffect(() => {
    let alive = true;
    apiGet(`/api/adaptive/syllabus/${slug}/outline`)
      .then((r) => { if (alive) { const d = toDraft(r?.data ?? r); setDraft(d); setOpen(Object.fromEntries(d.topics.map((_, i) => [i, i < 2]))); } })
      .catch((e) => { if (alive) { show?.(e.message || 'Failed to load', 'error'); onClose(); } });
    return () => { alive = false; };
  }, [slug]);

  const setMeta = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setTopic = (ti, title) => setDraft((d) => { const t = [...d.topics]; t[ti] = { ...t[ti], title }; return { ...d, topics: t }; });
  const addTopic = () => setDraft((d) => ({ ...d, topics: [...d.topics, { title: '', subtopics: [] }] }));
  const delTopic = (ti) => setDraft((d) => ({ ...d, topics: d.topics.filter((_, i) => i !== ti) }));
  const setSub = (ti, si, k, v) => setDraft((d) => { const t = [...d.topics]; const s = [...t[ti].subtopics]; s[si] = { ...s[si], [k]: v }; t[ti] = { ...t[ti], subtopics: s }; return { ...d, topics: t }; });
  const addSub = (ti) => setDraft((d) => { const t = [...d.topics]; t[ti] = { ...t[ti], subtopics: [...t[ti].subtopics, { title: '', content: '', objectives: '' }] }; return { ...d, topics: t }; });
  const delSub = (ti, si) => setDraft((d) => { const t = [...d.topics]; t[ti] = { ...t[ti], subtopics: t[ti].subtopics.filter((_, i) => i !== si) }; return { ...d, topics: t }; });

  const save = async () => {
    if (!draft.name.trim()) return show?.('Subject name is required', 'error');
    setBusy(true);
    try {
      const r = await apiPost('/api/adaptive/syllabus/ingest', { doc: toDoc(draft) });
      const d = r?.data ?? r;
      show?.(`Saved — ${d.topics} topics, ${d.subtopics} subtopics (re-embedded)`);
      onSaved?.(); onClose();
    } catch (e) { show?.(e.message || 'Save failed', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open onClose={() => !busy && onClose()} title="Preview & edit syllabus" width={720}>
      {!draft ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[1, 2, 3, 4].map((i) => <Skeleton key={i} height={40} />)}</div>
      ) : (
        <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 }}>
          {/* meta */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <input value={draft.name} onChange={(e) => setMeta('name', e.target.value)} placeholder="Subject name" style={{ ...inp, flex: 1 }} />
            <input value={draft.code} onChange={(e) => setMeta('code', e.target.value)} placeholder="Code" style={{ ...inp, flex: '0 0 120px' }} />
          </div>
          <textarea value={draft.aims} onChange={(e) => setMeta('aims', e.target.value)} placeholder="Aims (optional)" rows={2} style={{ ...inp, marginBottom: 14, resize: 'vertical' }} />

          {/* topics */}
          {draft.topics.map((t, ti) => (
            <div key={ti} style={{ border: `1px solid ${BORDER}`, borderRadius: 12, marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: LIGHT }}>
                <button onClick={() => setOpen((o) => ({ ...o, [ti]: !o[ti] }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, display: 'flex' }}>
                  {open[ti] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <input value={t.title} onChange={(e) => setTopic(ti, e.target.value)} placeholder={`Topic ${ti + 1}`} style={{ ...inp, fontWeight: 700, flex: 1 }} />
                <span style={{ fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{t.subtopics.length} sub</span>
                <button onClick={() => delTopic(ti)} title="Remove topic" style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, display: 'flex' }}><Trash2 size={15} /></button>
              </div>
              {open[ti] && (
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {t.subtopics.map((s, si) => (
                    <div key={si} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, padding: 10 }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <input value={s.title} onChange={(e) => setSub(ti, si, 'title', e.target.value)} placeholder="Subtopic title" style={{ ...inp, fontWeight: 600 }} />
                        <button onClick={() => delSub(ti, si)} title="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, display: 'flex', flexShrink: 0 }}><Trash2 size={14} /></button>
                      </div>
                      <textarea value={s.content} onChange={(e) => setSub(ti, si, 'content', e.target.value)} placeholder="Content / notes" rows={2} style={{ ...inp, marginBottom: 6, resize: 'vertical' }} />
                      <textarea value={s.objectives} onChange={(e) => setSub(ti, si, 'objectives', e.target.value)} placeholder="Objectives — one per line" rows={2} style={{ ...inp, fontSize: 12, resize: 'vertical' }} />
                    </div>
                  ))}
                  <button onClick={() => addSub(ti)} style={{ alignSelf: 'flex-start', background: 'none', border: `1px dashed ${BORDER}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', color: MUTED, fontSize: 12, fontWeight: 700, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={13} />Add subtopic</button>
                </div>
              )}
            </div>
          ))}
          <button onClick={addTopic} style={{ background: `${PURPLE}10`, border: `1px dashed ${PURPLE}`, borderRadius: 10, padding: '9px 14px', cursor: 'pointer', color: PURPLE, fontSize: 13, fontWeight: 700, fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center' }}><Plus size={15} />Add topic</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
        <Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn>
        <Btn variant="primary" onClick={save} disabled={busy || !draft}>{busy ? 'Saving…' : 'Save changes'}</Btn>
      </div>
    </Modal>
  );
}
