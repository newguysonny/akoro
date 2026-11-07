/**
 * Confusion pairs — §7.15.1: wrong options that 5 or more learners picked for
 * the same concept, from Agent Checks. Anonymous counts only. An admin marks
 * each one: content fixed, noted, or ignored (open until reviewed).
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, EyeOff, RefreshCw, StickyNote } from 'lucide-react';

import { PageLayout } from '../components/Layout.jsx';
import { Btn, Sel, Skeleton, Toast } from '../components/Primitives.jsx';
import { apiGet, apiPatch } from '../services/api.js';
import { AMBER, BORDER, FONT, GREEN, INK, LIGHT, MUTED, WHITE } from '../constants.js';

const unwrap = (d) => d?.data ?? d;
const when = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');
const STATUS = {
  open: { label: 'Open', color: AMBER },
  content_fixed: { label: 'Content fixed', color: GREEN },
  noted: { label: 'Noted', color: '#2563EB' },
  ignored: { label: 'Ignored', color: MUTED },
};
const card = { background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18 };
const th = { textAlign: 'left', fontFamily: FONT, fontSize: 11, fontWeight: 700, color: MUTED, padding: '8px 10px', borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap' };
const td = { fontFamily: FONT, fontSize: 13, color: INK, padding: '10px', borderBottom: `1px solid ${BORDER}`, verticalAlign: 'top' };

export default function ConfusionPairsPage() {
  const [status, setStatus] = useState('open');
  const [pairs, setPairs] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const load = useCallback(() => {
    setError('');
    apiGet(`/api/admin/confusion-pairs${status ? `?status=${status}` : ''}`)
      .then((d) => setPairs(unwrap(d)?.pairs || []))
      .catch((e) => { setPairs([]); setError(e?.message || 'Could not load.'); });
  }, [status]);
  useEffect(load, [load]);

  const mark = async (p, next) => {
    try {
      await apiPatch('/api/admin/confusion-pairs', { subject: p.subject, concept: p.concept, confusedWith: p.confusedWith, status: next });
      setToast({ message: `Marked ${STATUS[next].label.toLowerCase()}`, type: 'success' });
      load();
    } catch (e) { setToast({ message: e?.message || 'Could not save.', type: 'error' }); }
  };

  return (
    <PageLayout title="Confusion pairs" subtitle="Wrong answers 5 or more learners picked for the same idea — fix the content, note it, or set it aside"
      action={<Btn variant="secondary" size="sm" onClick={load}><RefreshCw size={14} /> Refresh</Btn>}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <div style={{ marginBottom: 14, maxWidth: 220 }}>
        <Sel value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Sel>
      </div>
      <div style={card}>
        {error && <p style={{ fontFamily: FONT, fontSize: 13, color: '#EF4444', margin: '0 0 10px' }}>{error}</p>}
        {!pairs ? <Skeleton height={120} /> : pairs.length === 0 ? (
          <p style={{ fontFamily: FONT, fontSize: 13, color: MUTED, margin: 0 }}>Nothing here yet. A pair appears once 5 learners pick the same wrong answer.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Subject · idea</th><th style={th}>Wrong answer picked</th><th style={th}>Learners</th><th style={th}>Last seen</th><th style={th}>Status</th><th style={th} /></tr></thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={`${p.subject}|${p.concept}|${p.confusedWith}`} data-confusion-pair="">
                    <td style={td}><div style={{ fontWeight: 700 }}>{p.concept || '—'}</div><div style={{ fontSize: 11.5, color: MUTED }}>{p.subject || '—'}</div></td>
                    <td style={td}>{p.confusedWith}</td>
                    <td style={td}>{p.learners} <span style={{ color: MUTED, fontSize: 11.5 }}>({p.times}×)</span></td>
                    <td style={td}>{when(p.lastSeen)}</td>
                    <td style={td}><span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 999, background: LIGHT, color: STATUS[p.status]?.color, fontSize: 11, fontWeight: 700 }}>{STATUS[p.status]?.label}</span></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <Btn size="sm" variant="secondary" onClick={() => mark(p, 'content_fixed')}><CheckCircle2 size={13} /> Fixed</Btn>{' '}
                      <Btn size="sm" variant="secondary" onClick={() => mark(p, 'noted')}><StickyNote size={13} /> Note</Btn>{' '}
                      <Btn size="sm" variant="secondary" onClick={() => mark(p, 'ignored')}><EyeOff size={13} /> Ignore</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
