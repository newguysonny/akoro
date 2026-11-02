/*
 * LearnersStuckPanel — "Where learners are stuck" in the chat's Tasks tab
 * (Grand Plan Phase 11, D39): the classes this teacher teaches in their
 * school, from GET /api/school/mgmt/learning/struggles. Only linked
 * learners appear; sensitive types never do — a learner who may need support
 * shows a flag, and opening it is logged on the server. Learners with nothing
 * open take no space. Instructors with no school (404) don't see the tab.
 */
import { useEffect, useState } from 'react';
import { apiGet } from '../../services/api.js';
import { C } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

/** → { data, error, available } — available is false when no school is linked. */
export function useStruggles() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState(null);
  const load = () => apiGet('/api/school/mgmt/learning/struggles')
    .then((r) => { setData(r?.data || null); setAvailable(true); setError(''); })
    .catch((e) => { if (e?.status === 404 || e?.status === 403) setAvailable(false); else { setAvailable(true); setError(e?.message || 'Could not load'); } });
  useEffect(() => { load(); }, []);
  return { data, error, available, reload: load };
}

const ago = (iso) => {
  const d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
  return Number.isFinite(d) ? (d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`) : '';
};

export default function LearnersStuckPanel({ state }) {
  const [classId, setClassId] = useState(null);
  const [support, setSupport] = useState(null);
  const { data, error } = state;
  if (!data && !error) return <div className="skeleton" style={{ height: 62, borderRadius: 12 }} />;
  if (error) return <p style={{ fontSize: 12, color: '#EF4444', margin: 0 }}>{error}</p>;
  const classes = (data?.classes || []).filter((c) => c.linked > 0 || c.open > 0);
  const learners = (data?.learners || []).filter((l) => !classId || l.classId === classId);
  const shownClasses = classId ? classes.filter((c) => c.classId === classId) : classes;

  const openSupport = async (l) => {
    setSupport({ name: l.name, loading: true });
    try {
      const r = await apiGet(`/api/school/mgmt/learning/struggles/${encodeURIComponent(l.studentId)}/support`);
      setSupport({ name: l.name, items: r?.data?.struggles || [] });
    } catch (e) { setSupport({ name: l.name, error: e?.message || 'Could not open' }); }
  };

  return (
    <div data-learners-stuck="" style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: C.font }}>
      {classes.length > 1 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[{ classId: null, name: 'All classes' }, ...classes].map((c) => (
            <button key={c.classId || 'all'} type="button" onClick={() => setClassId(c.classId)}
              style={{ border: `1px solid ${classId === c.classId ? C.brand : C.border}`, background: classId === c.classId ? 'var(--ak-brand-tint, rgba(124,58,237,.08))' : 'transparent', color: classId === c.classId ? C.brand : C.muted, borderRadius: 20, padding: '4px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
              {c.name || 'Class'}
            </button>
          ))}
        </div>
      )}
      {shownClasses.map((c) => (
        <div key={c.classId} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{c.name || 'Class'}</div>
            <div style={{ fontSize: 12, color: C.muted }}>{c.learnersStruggling} of {c.linked} stuck{c.unlinked ? ` · ${c.unlinked} not linked` : ''}</div>
          </div>
          {(c.topTopics || []).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {c.topTopics.map((tp) => <span key={tp.topic} style={{ fontSize: 11.5, fontWeight: 700, color: C.ink, background: 'var(--ak-surface-hover)', borderRadius: 20, padding: '3px 9px' }}>{tp.topic} · {tp.learners}</span>)}
            </div>
          )}
          {(c.topTypes || []).length > 0 && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{c.topTypes.map((ty) => `${ty.label} (${ty.learners})`).join(' · ')}</div>}
          {c.mayNeedSupport > 0 && <div style={{ fontSize: 12, color: '#B45309', fontWeight: 700, marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}><Ico ti="ti-heart-handshake" size={13} color="#B45309" />{c.mayNeedSupport} may need support</div>}
        </div>
      ))}
      {learners.length === 0 ? (
        <div style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 16, padding: '36px 24px', textAlign: 'center' }}>
          <Ico ti="ti-mood-check" size={32} color={C.muted} style={{ marginBottom: 10 }} />
          <p style={{ fontSize: 14, color: C.muted, margin: 0 }}>No learner in your classes is stuck right now.</p>
        </div>
      ) : learners.map((l) => (
        <div key={l.studentId} data-stuck-learner="" style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{l.name || 'Learner'} <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>· {l.className}</span></div>
            {l.supportFlag && (
              <button type="button" onClick={() => openSupport(l)} style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid #F59E0B', background: 'rgba(245,158,11,.08)', color: '#B45309', borderRadius: 20, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
                <Ico ti="ti-heart-handshake" size={12} color="#B45309" />May need support
              </button>
            )}
          </div>
          {l.open.map((s, i) => (
            <div key={i} style={{ fontSize: 12.5, color: C.ink, marginTop: 6 }}>
              <strong>{s.label}</strong>{s.topic ? ` — ${s.topic}` : ''} <span style={{ color: C.muted }}>· {ago(s.detectedAt)}</span>
            </div>
          ))}
          {l.resolved.slice(0, 2).map((s, i) => (
            <div key={`r${i}`} style={{ fontSize: 12, color: C.muted, marginTop: 4, display: 'flex', gap: 5, alignItems: 'center' }}>
              <Ico ti="ti-circle-check" size={12} color="#10B981" />{s.label}{s.topic ? ` — ${s.topic}` : ''}{s.whatWorked ? ` · what worked: ${s.whatWorked}` : ''}
            </div>
          ))}
        </div>
      ))}
      {support && (
        <div role="dialog" aria-label="Support detail" style={{ background: C.surface, border: '1px solid #F59E0B', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{support.name || 'Learner'}: may need support</div>
            <button type="button" aria-label="Close" onClick={() => setSupport(null)} style={{ border: 0, background: 'transparent', cursor: 'pointer' }}><Ico ti="ti-x" size={16} color={C.muted} /></button>
          </div>
          {support.loading ? <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Opening…</div>
            : support.error ? <div style={{ fontSize: 12, color: '#EF4444', marginTop: 6 }}>{support.error}</div>
              : (support.items || []).map((s, i) => <div key={i} style={{ fontSize: 12.5, color: C.ink, marginTop: 6 }}>{s.label}{s.topic ? ` — ${s.topic}` : ''} <span style={{ color: C.muted }}>· {ago(s.detectedAt)}</span></div>)}
          <div style={{ fontSize: 11.5, color: C.muted, marginTop: 8 }}>Opening this is recorded. Follow your school's support process.</div>
        </div>
      )}
    </div>
  );
}
