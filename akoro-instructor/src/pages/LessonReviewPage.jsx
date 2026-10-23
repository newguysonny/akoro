/**
 * LessonReviewPage — review AI-generated lesson ladders.
 *
 * Reviewing NEVER blocks a learner: these lessons are already being served.
 * Approving/editing improves what every FUTURE learner on that topic receives.
 * Sorted by use_count so the most-used lessons get reviewed first.
 */
import { useState, useEffect, useCallback } from 'react';
import { Loader2, Check, X, Pencil, Plus, Trash2, BookOpen, Users } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPatch } from '../services/api.js';
import { GREEN, RED } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const TABS = [
  { key: 'pending_review', label: 'Pending' },
  { key: 'approved',       label: 'Approved' },
  { key: 'rejected',       label: 'Rejected' },
];

const PROV = {
  scheme_of_work: { label: "School's scheme of work", c: GREEN },
  syllabus:       { label: 'Aligned to exam syllabus', c: C.brand },
  ai:             { label: 'AI-generated', c: C.muted2 },
};

export default function LessonReviewPage() {
  const [tab, setTab]         = useState('pending_review');
  const [ladders, setLadders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState(null);
  const [editing, setEditing] = useState(null);   // { id, subtopics: [] }
  const [toast, setToast]     = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    apiGet(`/api/adaptive/teaching/ladders?status=${tab}`)
      .then((r) => setLadders(r.ladders || []))
      .catch(() => setLadders([]))
      .finally(() => setLoading(false));
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const review = async (l, status) => {
    setBusyId(l.id);
    try {
      const body = { status };
      if (editing?.id === l.id) {
        body.subtopics = editing.subtopics.map((s) => s.trim()).filter(Boolean);
        if (!body.subtopics.length) { showToast('Add at least one subtopic'); setBusyId(null); return; }
      }
      await apiPatch(`/api/adaptive/teaching/ladders/${l.id}`, body);
      setEditing(null);
      showToast(status === 'approved' ? 'Approved ✓ — future learners get this version' : 'Rejected — it will be regenerated');
      load();
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setBusyId(null); }
  };

  const startEdit = (l) => setEditing({ id: l.id, subtopics: [...(l.subtopics || [])] });
  const setStep = (i, v) => setEditing((e) => ({ ...e, subtopics: e.subtopics.map((s, j) => j === i ? v : s) }));
  const addStep = () => setEditing((e) => ({ ...e, subtopics: [...e.subtopics, ''] }));
  const delStep = (i) => setEditing((e) => ({ ...e, subtopics: e.subtopics.filter((_, j) => j !== i) }));

  return (
    <PageLayout title="Review Generated Lessons" subtitle="Approve or correct AI-built lesson plans — students are never blocked while you review">
      <div style={{ maxWidth: 860, fontFamily: C.font }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => { setTab(t.key); setEditing(null); }}
              style={{ padding: '8px 15px', borderRadius: 100, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: C.font,
                border: `1px solid ${tab === t.key ? C.brand : C.border}`, background: tab === t.key ? tint(7) : C.surface, color: tab === t.key ? '#B45309' : C.ink }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 50, textAlign: 'center', color: C.muted2 }}><Ico lucide={Loader2} ti="ti-loader-2" size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : ladders.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', background: C.surface, border: `1.5px dashed ${C.border}`, borderRadius: 14, color: C.muted2, fontSize: 13.5 }}>
            {tab === 'pending_review' ? 'Nothing to review — every lesson your students used is already trusted.' : 'Nothing here yet.'}
          </div>
        ) : ladders.map((l) => {
          const prov = PROV[l.provenance] || PROV.ai;
          const isEditing = editing?.id === l.id;
          const steps = isEditing ? editing.subtopics : (l.subtopics || []);
          return (
            <div key={l.id} style={{ background: C.surface, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 15.5, fontWeight: 900, color: C.ink }}>{l.topic}</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ico lucide={BookOpen} ti="ti-book" size={13} /> {l.subject}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ico lucide={Users} ti="ti-users" size={13} /> used {l.use_count || 0}×</span>
                  </div>
                </div>
                <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 800, color: prov.c, background: tint(8, prov.c), border: `1px solid ${tint(20, prov.c)}`, borderRadius: 100, padding: '4px 10px' }}>{prov.label}</span>
              </div>

              {Array.isArray(l.refs) && l.refs.length > 0 && (
                <div style={{ fontSize: 11.5, color: C.muted2, marginBottom: 10 }}>
                  Sources: {l.refs.map((r) => r.topic || r.source).filter(Boolean).join(' · ')}
                </div>
              )}

              <ol style={{ margin: '0 0 14px', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {steps.map((s, i) => (
                  <li key={i} style={{ fontSize: 13.5, color: C.ink }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input value={s} onChange={(e) => setStep(i, e.target.value)}
                          style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: C.font, color: C.ink }} />
                        <button onClick={() => delStep(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED }}><Ico lucide={Trash2} ti="ti-trash" size={15} /></button>
                      </div>
                    ) : s}
                  </li>
                ))}
              </ol>
              {isEditing && (
                <button onClick={addStep} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: C.brand, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', marginBottom: 12, fontFamily: C.font }}>
                  <Ico lucide={Plus} ti="ti-plus" size={14} /> Add step
                </button>
              )}

              {tab === 'pending_review' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                  <button onClick={() => review(l, 'approved')} disabled={busyId === l.id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: GREEN, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                    {busyId === l.id ? <Ico lucide={Loader2} ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico lucide={Check} ti="ti-check" size={14} />} {isEditing ? 'Save & approve' : 'Approve'}
                  </button>
                  <button onClick={() => isEditing ? setEditing(null) : startEdit(l)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
                    <Ico lucide={Pencil} ti="ti-pencil" size={13} /> {isEditing ? 'Cancel edit' : 'Edit'}
                  </button>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => review(l, 'rejected')} disabled={busyId === l.id}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 9, border: `1px solid ${RED}55`, background: `${RED}0C`, color: RED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
                    <Ico lucide={X} ti="ti-x" size={14} /> Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, fontFamily: C.font }}>{toast}</div>}
    </PageLayout>
  );
}
