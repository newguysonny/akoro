/**
 * SelfStudyList — topics a teacher assigned for you to work through with your
 * own AI agent.
 *
 * It sits beside Sessions and Revisions because it is the same kind of work,
 * just started by somebody else: tapping Start opens the ordinary teaching
 * modal, and what comes out is an ordinary agent session — so it lands in
 * Sessions, feeds confidence, and comes back round as revision like everything
 * else here.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { BRAND, RED, GREEN, GOLD, SUBJECT_COLORS } from '../../constants.js';
import { Icon } from '../common/Icons.jsx';
import { apiGet, apiPost } from '../../services/api.js';

const STATUS = {
  assigned: { label: 'Not started', color: '#6B7280', bg: 'rgba(107,114,128,.10)' },
  started:  { label: 'In progress', color: BRAND,     bg: `${BRAND}12` },
  complete: { label: 'Done',        color: GREEN,     bg: 'rgba(16,185,129,.10)' },
};

function dueLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.ceil((d - Date.now()) / 86_400_000);
  if (days < 0)  return { text: `Overdue by ${Math.abs(days)}d`, overdue: true };
  if (days === 0) return { text: 'Due today', overdue: false };
  if (days === 1) return { text: 'Due tomorrow', overdue: false };
  return { text: `Due in ${days} days`, overdue: false };
}

export default function SelfStudyList({ onStart, subjectFilter = 'all' }) {
  const [items, setItems]   = useState([]);
  const [loading, setLoad]  = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError]   = useState('');

  const load = useCallback(() => {
    apiGet('/api/self-study/mine')
      // Live courses are a moment in the timetable, not an agent session —
      // they live in the Activity feed. Everything assigned starts here as
      // an agent session exactly like self study always has.
      // Locked journey stages wait their turn — they are not startable work yet.
      .then(d => setItems((d?.data ?? []).filter(a => (a.type || 'self_study') !== 'live_course' && !a.journey?.locked)))
      .catch(() => setItems([]))
      .finally(() => setLoad(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const start = async (a) => {
    setBusyId(a.id); setError('');
    try {
      const d = await apiPost(`/api/self-study/${a.id}/start`, {});
      const info = d?.data ?? {};
      onStart?.({
        selfStudyId: a.id,
        topic:       a.topic,
        subject:     a.subject,
        subtopics:   a.subtopics ?? [],
        objectives:  a.objectives ?? {},
        // An assignment already begun resumes rather than restarting.
        mode:        info.sessionId ? 'continuation' : 'fresh',
        sessionId:   info.sessionId ?? null,
      });
      setItems(is => is.map(x => x.id === a.id ? { ...x, status: x.status === 'assigned' ? 'started' : x.status } : x));
    } catch (e) {
      setError(e?.message || 'Could not open this assignment. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const shown = subjectFilter === 'all'
    ? items
    : items.filter(a => (a.subject || '').toLowerCase().includes(subjectFilter.toLowerCase()));

  if (loading) {
    return <div style={{ padding: '30px 24px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--ak-text-muted)' }}>Loading…</div>;
  }

  if (shown.length === 0) {
    return (
      <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <Icon name="ti-book-2" size={52} color="var(--ak-text-muted)" style={{ opacity: .2 }}/>
        <p style={{ fontSize: 15, fontWeight: 800, color: '#9CA3AF' }}>Nothing assigned yet</p>
        <p style={{ fontSize: 12, color: '#D1D5DB', textAlign: 'center', lineHeight: 1.5, maxWidth: 260 }}>
          When your teacher sets a self-study topic it appears here, and you work through it with your agent.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p style={{ fontSize: 12, fontWeight: 800, color: RED, margin: 0, padding: '10px 18px' }}>{error}</p>
      )}
      {shown.map(a => {
        const sc  = SUBJECT_COLORS[(a.subject || '').toLowerCase()] || BRAND;
        const st  = STATUS[a.status] || STATUS.assigned;
        const due = dueLabel(a.dueAt);
        const n   = (a.subtopics ?? []).length;
        const busy = busyId === a.id;

        return (
          <div key={a.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 18px',
            borderBottom: '1px solid var(--ak-border)', background: 'var(--ak-surface)',
          }}>
            <div style={{
              width: 46, height: 46, borderRadius: 14, flexShrink: 0, fontSize: 22,
              background: `${sc}14`, border: `1.5px solid ${sc}35`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}><Icon name="ti-book-2" size={18} color={BRAND}/></div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)' }}>{a.title}</span>
                <span style={{
                  fontSize: 9.5, fontWeight: 900, flexShrink: 0, padding: '2px 8px',
                  borderRadius: 20, background: st.bg, color: st.color,
                }}>{st.label}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: sc, background: `${sc}14`, borderRadius: 5, padding: '1px 7px' }}>
                  {a.subject}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ak-text-muted)' }}>
                  {a.topic}{n ? ` · ${n} subtopic${n === 1 ? '' : 's'}` : ''}
                </span>
              </div>

              {a.instructions && (
                <p style={{ fontSize: 11.5, color: 'var(--ak-text-sub)', margin: '0 0 6px', lineHeight: 1.45 }}>
                  “{a.instructions}”
                </p>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                {a.assignedBy && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ak-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="ti-chalkboard" size={11} color="var(--ak-text-muted)"/>{a.assignedBy}</span>
                )}
                {due && (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: due.overdue ? RED : GOLD, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="ti-calendar" size={11} color={due.overdue ? RED : GOLD}/>{due.text}</span>
                )}
              </div>

              {a.status !== 'complete' && (
                <button onClick={() => start(a)} disabled={busy} style={{
                  marginTop: 9, padding: '7px 16px', borderRadius: 20, border: 'none',
                  background: busy ? 'var(--ak-border2)' : `linear-gradient(135deg,${BRAND},#4C1DCC)`,
                  color: busy ? 'var(--ak-text-muted)' : '#fff',
                  fontSize: 11.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer',
                  fontFamily: "'Nunito',sans-serif",
                }}>
                  {busy ? 'Opening…' : a.status === 'started' ? <><Icon name="ti-player-play" size={11}/> Continue</> : <><Icon name="ti-player-play" size={11}/> Start studying</>}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
