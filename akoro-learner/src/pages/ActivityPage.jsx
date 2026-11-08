import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMyActivities, fetchMyStreak } from '../services/activityApi.js';
import { Icon } from '../components/common/Icons.jsx';
import { BRAND, RED, GREEN, GOLD } from '../constants.js';
import { AppShell } from '../components/AppShell.jsx';
import { APP_HOME } from '../config/target.js';

/* Emoji + accent per activity kind (matches the learner app's emoji style) */
const TYPE_META = {
  assignment:  { emoji: 'ti-edit', color: BRAND    },
  project:     { emoji: 'ti-folder', color: GREEN    },
  battle:      { emoji: 'ti-swords', color: RED      },
  multi_stage: { emoji: 'ti-puzzle', color: '#A855F7' },
  multistage:  { emoji: 'ti-puzzle', color: '#A855F7' },  // legacy key
  self_study:  { emoji: 'ti-book-2', color: GOLD     },
  live_course: { emoji: 'ti-device-tv', color: '#E11D48' },
};

const KINDS = [
  { key: 'all',        label: 'All'        },
  { key: 'assignment', label: 'Assignments' },
  { key: 'project',    label: 'Projects'    },
  { key: 'multi_stage', label: 'Multi stage' },
  { key: 'self_study', label: 'Self study'  },
  { key: 'live_course', label: 'Live courses' },
];

/* Stage categories — where each activity sits in the submit → grade flow.
   Derived from real status: open work is pending; finished work is awaiting
   grading (no grading data exists yet); `graded` is the seam that flips the
   moment grading lands on an activity. */
const STAGES = [
  { key: 'pending',  label: 'Pending',  empty: 'Nothing pending — submit what is due' },
  { key: 'awaiting', label: 'Awaiting', empty: 'Nothing awaiting grading right now' },
  { key: 'graded',   label: 'Graded',   empty: 'No graded activity yet' },
];

function stageOf(a) {
  if (a.graded) return 'graded';
  if (a.status === 'complete') return 'awaiting';
  return 'pending';
}

/* Same status map the self-study list uses, so a card reads the same in
   both places. */
const STATUS = {
  assigned: { label: 'Not started', color: '#6B7280', bg: 'rgba(107,114,128,.10)' },
  started:  { label: 'In progress', color: BRAND,     bg: `${BRAND}12` },
  complete: { label: 'Done',        color: GREEN,     bg: 'rgba(16,185,129,.10)' },
};

const getMeta  = (kind)   => TYPE_META[kind]   || { emoji: 'ti-clipboard', color: '#9CA3AF' };
const getStatus = (stat)  => STATUS[stat]      || STATUS.assigned;

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function dueLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.ceil((d - Date.now()) / 86_400_000);
  if (days < 0)   return { text: `Overdue by ${Math.abs(days)}d`, overdue: true };
  if (days === 0) return { text: 'Due today',    overdue: false };
  if (days === 1) return { text: 'Due tomorrow', overdue: false };
  return { text: `Due in ${days} days`, overdue: false };
}

function ActivityCard({ a, onOpen }) {
  const { emoji, color } = getMeta(a.kind);
  const st = getStatus(a.status);
  const open = a.status !== 'complete';
  const due = dueLabel(a.dueAt);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen?.(); }}
    style={{
      display: 'flex', gap: 12, padding: '13px 15px',
      background: open ? '#F5F1FF' : 'var(--ak-surface)',
      borderRadius: 14, border: `1px solid ${open ? '#DDD3FF' : 'var(--ak-border)'}`,
      alignItems: 'flex-start', cursor: 'pointer',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
        background: `${color}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>
        {emoji?.startsWith('ti-') ? <Icon name={emoji} size={18}/> : emoji}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: open ? 900 : 700, color: 'var(--ak-text)', fontFamily: "'Nunito',sans-serif" }}>
            {a.title}
          </div>
          <div style={{ fontSize: 11, color: due?.overdue ? RED : 'var(--ak-text-muted)', fontWeight: due?.overdue ? 800 : 400, flexShrink: 0, fontFamily: "'Nunito',sans-serif" }}>
            {due ? due.text : 'No due date'}
          </div>
        </div>
        {a.subtitle && (
          <div style={{ fontSize: 12, color: 'var(--ak-text-muted)', marginTop: 3, lineHeight: 1.5, fontFamily: "'Nunito',sans-serif" }}>
            {a.subtitle}
          </div>
        )}
        {a.details && (
          <div style={{ fontSize: 12, color: 'var(--ak-text-muted)', marginTop: 3, lineHeight: 1.5, fontFamily: "'Nunito',sans-serif" }}>
            {a.details}
          </div>
        )}
        {/* Journey roadmap — sequential unlocking: ✓ done · ▶ your turn ·
            🔒 waiting for the stage before it. */}
        {a.stages?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8, padding: '8px 10px', background: 'rgba(168,85,247,.07)', borderRadius: 10, border: '1px solid rgba(168,85,247,.18)' }}>
            {a.stages.map((st, i) => {
              const glyph = st.status === 'complete' ? '✓' : st.status === 'active' ? '▶' : st.status === 'locked' ? '🔒' : '·';
              const tint = st.status === 'complete' ? GREEN : st.status === 'active' ? BRAND : 'var(--ak-text-muted)';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontFamily: "'Nunito',sans-serif" }}>
                  <span style={{ width: 16, textAlign: 'center', color: tint, fontWeight: 900, flexShrink: 0 }}>{glyph}</span>
                  <span style={{ flexShrink: 0 }}>{st.emoji || '📌'}</span>
                  <span style={{ color: st.status === 'locked' ? 'var(--ak-text-muted)' : 'var(--ak-text)', fontWeight: st.status === 'active' ? 900 : 600,
                    opacity: st.status === 'locked' ? 0.72 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {st.title || st.kind}
                  </span>
                  {st.status === 'active' && (
                    <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 900, color: BRAND, background: `${BRAND}14`, borderRadius: 100, padding: '2px 8px', flexShrink: 0 }}>NOW</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 7 }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: st.color, background: st.bg, borderRadius: 100, padding: '2px 9px', fontFamily: "'Nunito',sans-serif" }}>
            {st.label}
          </span>
          {a.assignedBy && (
            <span style={{ fontSize: 11, color: 'var(--ak-text-muted)', fontFamily: "'Nunito',sans-serif" }}>
              from {a.assignedBy}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ActivityPage() {
  const navigate = useNavigate();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('all');
  const [stage, setStage]     = useState('pending');   // default: what's due
  const [streak, setStreak]   = useState(0);

  const load = useCallback(async () => {
    try {
      setItems(await fetchMyActivities());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchMyStreak().then(setStreak).catch(() => {}); }, []);

  // An assigned activity announces itself in real time (the dashboard's
  // ambient socket); refetch so the new card is here when the learner looks.
  useEffect(() => {
    const onChange = () => load();
    window.addEventListener('ak:activity-changed', onChange);
    return () => window.removeEventListener('ak:activity-changed', onChange);
  }, [load]);

  const openCount = items.filter(a => a.status !== 'complete').length;

  const displayed = (filter === 'all' ? items : items.filter(a => a.kind === filter))
    .filter(a => stageOf(a) === stage);
  const activeLabel = KINDS.find(k => k.key === filter)?.label || 'Activity';
  const stageCount = (key) => (filter === 'all' ? items : items.filter(a => a.kind === filter))
    .filter(a => stageOf(a) === key).length;

  const TAB = (active) => ({
    padding: '6px 16px', borderRadius: 100, border: 'none', cursor: 'pointer',
    fontFamily: "'Nunito',sans-serif", fontSize: 12, fontWeight: active ? 800 : 600,
    background: active ? BRAND : '#F0EBFF', color: active ? '#fff' : '#9CA3AF',
    flexShrink: 0, whiteSpace: 'nowrap',
  });

  return (
    <AppShell>
    <div style={{ width: '100%', height: '100%', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER */}
      <div style={{ background: 'var(--ak-surface)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px', zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate(APP_HOME)}
              style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: BRAND, fontSize: 16, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ‹
            </button>
            <div>
              <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Activity</p>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0 }}>
                {openCount > 0 ? `${openCount} open` : 'All caught up'}
              </p>
            </div>
            {/* Streak — consecutive days with at least one completed activity.
                Derived from real completions, so it only shows what the
                learner actually did. */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
              background: streak > 0 ? '#FFF1E7' : 'var(--ak-bg)', border: `1px solid ${streak > 0 ? '#FFD9BF' : 'var(--ak-border)'}`,
              borderRadius: 100, padding: '6px 13px' }}
              title={streak > 0 ? `${streak}-day streak — complete an activity every day to keep it going` : 'Complete an activity today to start a streak'}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>🔥</span>
              <span style={{ fontSize: 14, fontWeight: 900, color: streak > 0 ? '#C2410C' : 'var(--ak-text-muted)', lineHeight: 1 }}>{streak}</span>
            </div>
          </div>
        </div>

        {/* Pills — scrollable area of activity types */}
        <div style={{ display: 'flex', gap: 6, marginTop: 12, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {KINDS.map(k => <button key={k.key} style={TAB(filter === k.key)} onClick={() => setFilter(k.key)}>{k.label}</button>)}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 80px' }}>
        {/* Stage categories — pending → awaiting grading → graded */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {STAGES.map(st => (
            <button key={st.key} style={{ ...TAB(stage === st.key), display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => setStage(st.key)}>
              {st.label}
              <span style={{ fontSize: 10, fontWeight: 900, background: stage === st.key ? 'rgba(255,255,255,.25)' : '#E4DBFF',
                borderRadius: 100, padding: '1px 7px' }}>{stageCount(st.key)}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3,4].map(i => <div key={i} style={{ height: 70, borderRadius: 14, background: 'var(--ak-border)', opacity: .4 }} />)}
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10, color: getMeta(filter).color }}>
              <Icon name={getMeta(filter).emoji} size={40}/>
            </div>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>
              {STAGES.find(x => x.key === stage)?.empty || 'No activities yet'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {displayed.map(a => <ActivityCard key={a.id} a={a} onOpen={() => navigate(`/activities/${a.id}`)} />)}
          </div>
        )}
      </div>
    </div>
    </AppShell>
  );
}
