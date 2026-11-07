/*
 * LearnerStrugglesPage — "Where learners are stuck" in the school portal
 * (Grand Plan Phase 11, D39; preview approved 2026-11-07). Reads
 * GET /api/school/mgmt/learning/struggles: linked learners only, class totals,
 * what is overcome and what worked. Sensitive types (wellbeing, confidence…)
 * are COUNTED, never described; only a learner's "may need support" flag can
 * be opened, and the server records every opening before it answers.
 */
import { useEffect, useState } from 'react';
import { HeartHandshake, CheckCircle2, X, ShieldCheck, Smile, RefreshCw } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet } from '../services/api.js';
import { INK, MUTED, MUTED2, BORDER, WHITE, GREEN, RED, BRAND, GOLD, FONT } from '../constants.js';

const ago = (iso) => {
  const d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
  return Number.isFinite(d) ? (d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`) : '';
};
const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 16px' };
const chip = { fontSize: 12, fontWeight: 700, color: INK, background: '#F4F1EC', borderRadius: 20, padding: '3px 10px' };
const stat = (n, label, color = INK) => (
  <div style={{ minWidth: 78 }}>
    <div style={{ fontSize: 20, fontWeight: 800, color }}>{n}</div>
    <div style={{ fontSize: 11.5, color: MUTED }}>{label}</div>
  </div>
);

export default function LearnerStrugglesPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [classId, setClassId] = useState(null);
  const [support, setSupport] = useState(null);
  const load = () => {
    setError('');
    apiGet('/api/school/mgmt/learning/struggles')
      .then((r) => setData(r?.data || { classes: [], learners: [] }))
      .catch((e) => setError(e?.status === 403 ? 'Only the school admin and teachers of a class can see this.' : (e?.message || 'Could not load.')));
  };
  useEffect(load, []);

  const classes = (data?.classes || []).filter((c) => c.linked > 0 || c.open > 0 || c.unlinked > 0);
  const shownClasses = classId ? classes.filter((c) => c.classId === classId) : classes;
  const learners = (data?.learners || []).filter((l) => !classId || l.classId === classId);

  const openSupport = async (l) => {
    setSupport({ name: l.name, loading: true });
    try {
      const r = await apiGet(`/api/school/mgmt/learning/struggles/${encodeURIComponent(l.studentId)}/support`);
      setSupport({ name: r?.data?.name || l.name, items: r?.data?.struggles || [], openedAt: new Date() });
    } catch (e) { setSupport({ name: l.name, error: e?.message || 'Could not open.' }); }
  };

  return (
    <PageLayout title="Learner struggles" subtitle="Where learners with a linked Akoro account are stuck — and what helped them through."
      action={<button type="button" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${BORDER}`, background: WHITE, borderRadius: 10, padding: '8px 12px', fontFamily: FONT, fontWeight: 700, fontSize: 13, cursor: 'pointer', color: INK }}><RefreshCw size={14}/>Refresh</button>}>
      <div data-school-struggles="" style={{ display: 'flex', flexDirection: 'column', gap: 14, fontFamily: FONT, maxWidth: 920 }}>
        {error && <div role="alert" style={{ ...card, color: RED, fontSize: 13, fontWeight: 600 }}>{error}</div>}
        {!data && !error && <div style={{ ...card, color: MUTED, fontSize: 13 }}>Loading…</div>}

        {classes.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[{ classId: null, name: 'All classes' }, ...classes].map((c) => (
              <button key={c.classId || 'all'} type="button" onClick={() => setClassId(c.classId)}
                style={{ border: `1px solid ${classId === c.classId ? BRAND : BORDER}`, background: classId === c.classId ? `${BRAND}12` : WHITE, color: classId === c.classId ? BRAND : MUTED, borderRadius: 20, padding: '5px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                {c.name || 'Class'}
              </button>
            ))}
          </div>
        )}

        {shownClasses.map((c) => (
          <div key={c.classId} data-struggle-class="" style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: INK }}>{c.name || 'Class'}</div>
              <div style={{ fontSize: 12, color: MUTED }}>{c.linked} linked{c.unlinked ? ` · ${c.unlinked} without an Akoro account (no data)` : ''}</div>
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10 }}>
              {stat(c.learnersStruggling, 'struggling')}
              {stat(c.open, 'open')}
              {stat(c.resolved, 'overcome (30 days)', GREEN)}
              {c.mayNeedSupport > 0 && stat(c.mayNeedSupport, 'may need support', '#B45309')}
            </div>
            {(c.topTypes || []).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: MUTED2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Most common</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{c.topTypes.map((ty) => <span key={ty.type} style={chip}>{ty.label} · {ty.learners} learner{ty.learners === 1 ? '' : 's'}</span>)}</div>
              </div>
            )}
            {(c.topTopics || []).length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: MUTED2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Topics</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{c.topTopics.map((tp) => <span key={tp.topic} style={chip}>{tp.topic} · {tp.learners}</span>)}</div>
              </div>
            )}
            {c.sensitiveOpen > 0 && (
              <div data-sensitive-count="" style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 10, fontSize: 12, color: MUTED, lineHeight: 1.45 }}>
                <ShieldCheck size={14} color={MUTED} style={{ flexShrink: 0, marginTop: 1 }}/>
                {c.sensitiveOpen} personal struggle{c.sensitiveOpen === 1 ? '' : 's'} (wellbeing, confidence) counted here but never described. Only a learner's "may need support" flag can be opened, and each opening is recorded.
              </div>
            )}
          </div>
        ))}

        {data && (
          <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginTop: 4 }}>Learners</div>
        )}
        {data && learners.length === 0 && (
          <div style={{ ...card, borderStyle: 'dashed', textAlign: 'center', padding: '32px 20px' }}>
            <Smile size={30} color={MUTED2}/>
            <p style={{ fontSize: 13.5, color: MUTED, margin: '8px 0 0' }}>No learner {classId ? 'in this class ' : ''}is stuck right now.</p>
          </div>
        )}
        {learners.map((l) => (
          <div key={l.studentId} data-struggle-learner="" style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{l.name || 'Learner'} <span style={{ fontSize: 12, color: MUTED, fontWeight: 600 }}>· {l.className || 'Class'}</span></div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: l.open.length ? RED : GREEN }}>{l.open.length ? `${l.open.length} open` : `${l.resolved.length} overcome`}</span>
            </div>
            {l.open.map((s, i) => (
              <div key={i} style={{ fontSize: 13, color: INK, marginTop: 6 }}>
                <strong>{s.label}</strong>{s.topic ? ` · ${s.topic}` : ''}{s.subject ? ` · ${s.subject}` : ''} <span style={{ color: MUTED }}>· {ago(s.detectedAt)}</span>
              </div>
            ))}
            {l.resolved.slice(0, 3).map((s, i) => (
              <div key={`r${i}`} style={{ fontSize: 12.5, color: MUTED, marginTop: 5, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <CheckCircle2 size={14} color={GREEN} style={{ flexShrink: 0, marginTop: 1 }}/>
                <span>{s.label}{s.topic ? ` · ${s.topic}` : ''} · overcome {ago(s.resolvedAt)}{s.whatWorked ? `. What worked: ${s.whatWorked}` : ''}</span>
              </div>
            ))}
            {l.supportFlag && (
              <button type="button" onClick={() => openSupport(l)} style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${GOLD}`, background: 'rgba(245,158,11,.08)', color: '#B45309', borderRadius: 20, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                <HeartHandshake size={14}/>May need support — open (recorded)
              </button>
            )}
          </div>
        ))}

        {support && (
          <div role="dialog" aria-label="Support detail" data-support-detail="" style={{ ...card, border: `1px solid ${GOLD}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>{support.name || 'Learner'} — support</div>
              <button type="button" aria-label="Close" onClick={() => setSupport(null)} style={{ border: 0, background: 'transparent', cursor: 'pointer', display: 'flex' }}><X size={16} color={MUTED}/></button>
            </div>
            {support.openedAt && <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>You opened this on {support.openedAt.toLocaleString()}. Your school can see who opened it.</div>}
            {support.loading ? <div style={{ fontSize: 12.5, color: MUTED, marginTop: 8 }}>Opening…</div>
              : support.error ? <div style={{ fontSize: 12.5, color: RED, marginTop: 8 }}>{support.error}</div>
                : (support.items || []).map((s, i) => <div key={i} style={{ fontSize: 13, color: INK, marginTop: 7 }}><strong>{s.label}</strong>{s.topic ? ` · ${s.topic}` : ''} <span style={{ color: MUTED }}>· {ago(s.detectedAt)}</span></div>)}
            <div style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>Only the type and date are kept — no notes or words from the learner. Follow your school's support process.</div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
