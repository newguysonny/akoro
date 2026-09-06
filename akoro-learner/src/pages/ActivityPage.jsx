import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMyActivities } from '../services/activityApi.js';
import { BRAND, RED, GREEN, GOLD } from '../constants.js';

/* Emoji + accent per activity kind (matches the learner app's emoji style) */
const TYPE_META = {
  assignment: { emoji: '📝', color: BRAND    },
  project:    { emoji: '📂', color: GREEN    },
  multistage: { emoji: '🧩', color: '#A855F7' },
  self_study: { emoji: '📖', color: GOLD     },
};

const KINDS = [
  { key: 'all',        label: 'All'        },
  { key: 'assignment', label: 'Assignments' },
  { key: 'project',    label: 'Projects'    },
  { key: 'multistage', label: 'Multi stage' },
  { key: 'self_study', label: 'Self study'  },
];

/* Same status map the self-study list uses, so a card reads the same in
   both places. */
const STATUS = {
  assigned: { label: 'Not started', color: '#6B7280', bg: 'rgba(107,114,128,.10)' },
  started:  { label: 'In progress', color: BRAND,     bg: `${BRAND}12` },
  complete: { label: 'Done',        color: GREEN,     bg: 'rgba(16,185,129,.10)' },
};

const getMeta  = (kind)   => TYPE_META[kind]   || { emoji: '📋', color: '#9CA3AF' };
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

function ActivityCard({ a }) {
  const { emoji, color } = getMeta(a.kind);
  const st = getStatus(a.status);
  const open = a.status !== 'complete';
  const due = dueLabel(a.dueAt);
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '13px 15px',
      background: open ? '#F5F1FF' : 'var(--ak-surface)',
      borderRadius: 14, border: `1px solid ${open ? '#DDD3FF' : 'var(--ak-border)'}`,
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
        background: `${color}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>
        {emoji}
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
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      setItems(await fetchMyActivities());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCount = items.filter(a => a.status !== 'complete').length;

  const displayed = filter === 'all' ? items : items.filter(a => a.kind === filter);
  const activeLabel = KINDS.find(k => k.key === filter)?.label || 'Activity';

  const TAB = (active) => ({
    padding: '6px 16px', borderRadius: 100, border: 'none', cursor: 'pointer',
    fontFamily: "'Nunito',sans-serif", fontSize: 12, fontWeight: active ? 800 : 600,
    background: active ? BRAND : '#F0EBFF', color: active ? '#fff' : '#9CA3AF',
    flexShrink: 0, whiteSpace: 'nowrap',
  });

  return (
    <div style={{ width: '100vw', height: '100vh', fontFamily: "'Nunito',sans-serif", background: 'var(--ak-bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER */}
      <div style={{ background: 'var(--ak-surface)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px', zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate('/app')}
              style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, width: 34, height: 34, cursor: 'pointer', color: BRAND, fontSize: 16, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ‹
            </button>
            <div>
              <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Activity</p>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0 }}>
                {openCount > 0 ? `${openCount} open` : 'All caught up'}
              </p>
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
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3,4].map(i => <div key={i} style={{ height: 70, borderRadius: 14, background: 'var(--ak-border)', opacity: .4 }} />)}
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>{getMeta(filter).emoji}</div>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>
              {filter === 'all' ? 'No activities yet' : `No ${activeLabel.toLowerCase()} yet`}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {displayed.map(a => <ActivityCard key={a.id} a={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}
