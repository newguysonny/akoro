/*
 * GradebookPage — the lowerEd report card, live: the learner's assigned work
 * organised subject by subject, with what is submitted, what was missed, and
 * what still waits. Same page language as the Activities feed (full-screen,
 * pill rows, cards), wearing Akoro's brand.
 *
 * Marks are states, not invented numbers: ✓ submitted · X missed (past due,
 * still open) · – pending. A numeric score slots into the same badge the day
 * grading exists.
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMyGradebook, TYPE_LABEL, TYPE_DOT } from '../services/gradebookApi.js';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, GREEN, RED } from '../constants.js';

/* Work-type pills, second row — mirrors the reference's type filter. */
const TYPES = [
  { key: 'all',        label: 'All types' },
  { key: 'self_study', label: 'Self study' },
  { key: 'assignment', label: 'Assignment' },
  { key: 'project',    label: 'Project' },
  { key: 'multi_stage', label: 'Journey' },
];

const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/* The mark badge — bands ready for real scores, states for today. */
function Mark({ mark }) {
  const style =
    mark === 'X' ? { color: RED,     background: 'rgba(239,68,68,.10)' }
    : mark === '✓' ? { color: GREEN, background: 'rgba(16,185,129,.10)' }
    : typeof mark === 'number' ? (
        mark >= 80 ? { color: GREEN, background: 'rgba(16,185,129,.10)' }
        : mark >= 60 ? { color: '#B45309', background: 'rgba(232,163,61,.14)' }
        : { color: RED, background: 'rgba(239,68,68,.10)' }
      )
    : { color: 'var(--ak-text-muted)', background: 'var(--ak-bg)' };
  return (
    <span style={{ ...style, fontSize: 12, fontWeight: 900, borderRadius: 100,
      padding: '4px 12px', minWidth: 44, textAlign: 'center', fontFamily: "'Nunito',sans-serif" }}>
      {mark}
    </span>
  );
}

function Row({ a }) {
  const date = fmtDate(a.date);
  const overdue = a.mark === 'X';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      padding: '11px 2px', borderBottom: '1px solid var(--ak-border)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ak-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'Nunito',sans-serif" }}>
          {a.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, fontSize: 10.5, fontWeight: 700, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: TYPE_DOT[a.type] || 'var(--ak-text-muted)', flexShrink: 0 }} />
          {TYPE_LABEL[a.type] || a.type}
          {date && <span style={{ opacity: overdue ? 0 : 1 }}>· {date}</span>}
          {overdue && <span style={{ color: RED, fontWeight: 900 }}>· was due {date}</span>}
        </div>
      </div>
      <Mark mark={a.mark} />
    </div>
  );
}

export default function GradebookPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('all');
  const [type, setType] = useState('all');
  const [sortDir, setSortDir] = useState('asc');   // by due date

  useEffect(() => {
    fetchMyGradebook().then(setData).finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => {
    if (!data) return [];
    let rows = subject === 'all'
      ? data.subjects.flatMap(s => s.assignments)
      : (data.subjects.find(s => s.id === subject)?.assignments ?? []);
    if (type !== 'all') rows = rows.filter(a => a.type === type);
    return [...rows].sort((x, y) => sortDir === 'asc'
      ? String(x.date || '9999').localeCompare(String(y.date || '9999'))
      : String(y.date || '9999').localeCompare(String(x.date || '9999')));
  }, [data, subject, type, sortDir]);

  /* Stats for the chip + cards, scoped to the chosen subject. */
  const scoped = subject === 'all'
    ? (data?.totals ?? { submitted: 0, missed: 0, total: 0 })
    : (data?.subjects.find(s => s.id === subject) ?? { submitted: 0, missed: 0, total: 0 });
  const pct = scoped.total ? Math.round((scoped.submitted / scoped.total) * 100) : 0;

  const TAB = (active) => ({
    padding: '6px 14px', borderRadius: 100, border: 'none', cursor: 'pointer',
    fontFamily: "'Nunito',sans-serif", fontSize: 11.5, fontWeight: active ? 800 : 600,
    background: active ? BRAND : '#F0EBFF', color: active ? '#fff' : '#9CA3AF',
    flexShrink: 0, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6,
  });
  const subjectCount = (id) => id === 'all'
    ? (data?.totals?.total ?? 0)
    : (data?.subjects.find(s => s.id === id)?.assignments.length ?? 0);

  return (
    <div style={{ width: '100vw', height: '100vh', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER — the Activities page's header, gradebook edition */}
      <div style={{ background: 'var(--ak-surface)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px', zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate('/app')}
              style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: BRAND, fontSize: 16, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ‹
            </button>
            <div>
              <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Gradebook</p>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0 }}>
                {loading ? 'Loading…' : scoped.total ? `${scoped.submitted} of ${scoped.total} submitted` : 'No work assigned yet'}
              </p>
            </div>
          </div>
          {/* Submitted chip — the gradebook's headline number */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#F0FFF8', border: '1px solid #BBF7D0', borderRadius: 100, padding: '6px 13px' }}
            title="Submitted work across your subjects">
            <span style={{ fontSize: 14, lineHeight: 1 }}>✅</span>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#15803D', lineHeight: 1 }}>{loading ? '–' : `${pct}%`}</span>
          </div>
        </div>

        {/* Subject pills — the sidebar of the school report, phone-shaped */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {loading
            ? [1, 2, 3].map(i => <span key={i} style={{ ...TAB(false), background: 'var(--ak-border)', color: 'transparent' }}>····</span>)
            : (
              <>
                <button style={TAB(subject === 'all')} onClick={() => setSubject('all')}>All subjects</button>
                {(data?.subjects ?? []).map(s => (
                  <button key={s.id} style={TAB(subject === s.id)} onClick={() => setSubject(s.id)}>
                    {s.name}
                    <span style={{ fontSize: 10, fontWeight: 900, background: subject === s.id ? 'rgba(255,255,255,.25)' : '#E4DBFF', borderRadius: 100, padding: '1px 7px' }}>
                      {s.assignments.length}
                    </span>
                  </button>
                ))}
              </>
            )}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 80px' }}>
        {/* Summary — submitted / missed, per scope */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 14, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: .5, color: 'var(--ak-text-muted)', textTransform: 'uppercase' }}>Submitted</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: GREEN, marginTop: 2 }}>{loading ? '–' : scoped.submitted}<span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)' }}> of {scoped.total}</span></div>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--ak-border)', overflow: 'hidden', marginTop: 7 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${BRAND}, ${GREEN})`, transition: 'width .3s' }} />
            </div>
          </div>
          <div style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 14, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: .5, color: 'var(--ak-text-muted)', textTransform: 'uppercase' }}>Missed</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: scoped.missed ? RED : 'var(--ak-text-muted)', marginTop: 2 }}>
              {loading ? '–' : scoped.missed}
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ak-text-muted)' }}> {scoped.missed === 1 ? 'activity' : 'activities'}</span>
            </div>
            {scoped.missed > 0 && (
              <div style={{ fontSize: 10, fontWeight: 700, color: RED, marginTop: 5, opacity: .8 }}>Past due — still open</div>
            )}
          </div>
        </div>

        {/* Work-type pills + date sort */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', alignItems: 'center' }}>
          {TYPES.map(t => <button key={t.key} style={TAB(type === t.key)} onClick={() => setType(t.key)}>{t.label}</button>)}
          <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
            style={{ ...TAB(false), marginLeft: 'auto', border: '1px solid var(--ak-border)', background: 'var(--ak-surface)', color: 'var(--ak-text-muted)' }}
            title="Sort by due date">
            Date {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        {/* Rows */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map(i => <div key={i} style={{ height: 56, borderRadius: 12, background: 'var(--ak-border)', opacity: .4 }} />)}
          </div>
        ) : shown.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 20px' }}>
            <div style={{ fontSize: 38, marginBottom: 10 }}><Icon name="ti-books" size={38} /></div>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700, margin: 0 }}>
              Nothing here yet
            </p>
            <p style={{ fontSize: 12, color: 'var(--ak-text-muted)', margin: '4px 0 0', opacity: .8 }}>
              Work your teachers assign shows up here, subject by subject.
            </p>
          </div>
        ) : (
          <div style={{ background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 14, padding: '4px 14px' }}>
            {shown.map(a => <Row key={a.id} a={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}
