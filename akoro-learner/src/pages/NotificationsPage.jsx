import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiDelete } from '../services/api.js';
import { BRAND, RED, GREEN, GOLD } from '../constants.js';

/* Emoji + accent per notification type (matches the learner app's emoji style) */
const TYPE_META = {
  enrolled_in_course:  { emoji: '🎓', color: GREEN },
  enrollment_new:      { emoji: '🎓', color: GREEN },
  purchase_success:    { emoji: '🧾', color: GREEN },
  order_processing:    { emoji: '⏳', color: BRAND },
  purchase_refunded:   { emoji: '↩️', color: GOLD  },
  agent_unlocked:      { emoji: '🤖', color: BRAND },
  session_scheduled:   { emoji: '📅', color: BRAND },
  session_reminder:    { emoji: '⏰', color: BRAND },
  session_started:     { emoji: '🔴', color: RED   },
  session_cancelled:   { emoji: '🚫', color: RED   },
  session_rescheduled: { emoji: '🔄', color: GOLD  },
  battle_invite:       { emoji: '⚔️', color: '#A855F7' },
  battle_started:      { emoji: '⚔️', color: '#A855F7' },
  teacher_message:     { emoji: '💬', color: BRAND },
  task_complete:       { emoji: '✅', color: GREEN },
  decay_alert:         { emoji: '🧠', color: GOLD  },
  review_new:          { emoji: '⭐', color: GOLD  },
  system:              { emoji: '🔔', color: '#9CA3AF' },
};

const getMeta = (type) => TYPE_META[type] || { emoji: '🔔', color: '#9CA3AF' };

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function NotifRow({ n, onMarkRead, onDelete }) {
  const { emoji, color } = getMeta(n.type);
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '13px 15px',
      background: n.is_read ? 'var(--ak-surface)' : '#F5F1FF',
      borderRadius: 14, border: `1px solid ${n.is_read ? 'var(--ak-border)' : '#DDD3FF'}`,
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
          <div style={{ fontSize: 13.5, fontWeight: n.is_read ? 700 : 900, color: 'var(--ak-text)', fontFamily: "'Nunito',sans-serif" }}>
            {n.title}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ak-text-muted)', flexShrink: 0, fontFamily: "'Nunito',sans-serif" }}>
            {timeAgo(n.created_at)}
          </div>
        </div>
        {n.content && (
          <div style={{ fontSize: 12, color: 'var(--ak-text-muted)', marginTop: 3, lineHeight: 1.5, fontFamily: "'Nunito',sans-serif" }}>
            {n.content}
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, marginTop: 7 }}>
          {!n.is_read && (
            <button onClick={() => onMarkRead(n.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: BRAND, fontSize: 11, fontWeight: 800, fontFamily: "'Nunito',sans-serif", padding: 0 }}>
              Mark read
            </button>
          )}
          <button onClick={() => onDelete(n.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 11, fontWeight: 800, fontFamily: "'Nunito',sans-serif", padding: 0 }}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [unread, setUnread]   = useState(0);
  const [filter, setFilter]   = useState('all');

  const load = useCallback(async () => {
    try {
      const res = await apiGet('/api/notifications?limit=50');
      setItems(res.data ?? []);
      setUnread(res.unread ?? 0);
    } catch {
      setItems([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id) => {
    try {
      // Replay-safe + fire-and-forget → queue it if we're offline, apply the UI
      // change optimistically either way.
      await apiPost('/api/notifications/mark-read', { ids: [id] }, { queueOffline: true });
      setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnread(u => Math.max(0, u - 1));
    } catch {}
  };

  const markAllRead = async () => {
    try {
      await apiPost('/api/notifications/mark-read', { all: true }, { queueOffline: true });
      setItems(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnread(0);
    } catch {}
  };

  const del = async (id) => {
    try {
      await apiDelete(`/api/notifications/${id}`);
      const n = items.find(x => x.id === id);
      setItems(prev => prev.filter(x => x.id !== id));
      if (n && !n.is_read) setUnread(u => Math.max(0, u - 1));
    } catch {}
  };

  const displayed = filter === 'unread' ? items.filter(n => !n.is_read) : items;

  const TAB = (active) => ({
    padding: '6px 16px', borderRadius: 100, border: 'none', cursor: 'pointer',
    fontFamily: "'Nunito',sans-serif", fontSize: 12, fontWeight: active ? 800 : 600,
    background: active ? BRAND : '#F0EBFF', color: active ? '#fff' : '#9CA3AF',
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
              <p style={{ fontSize: 16, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>Notifications</p>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--ak-text-muted)', margin: 0 }}>
                {unread > 0 ? `${unread} unread` : 'All caught up'}
              </p>
            </div>
          </div>
          {unread > 0 && (
            <button onClick={markAllRead}
              style={{ background: '#F0EBFF', border: '1px solid #DDD3FF', borderRadius: 100, padding: '6px 14px', cursor: 'pointer', color: BRAND, fontSize: 11, fontWeight: 800, fontFamily: "'Nunito',sans-serif" }}>
              Mark all read
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <button style={TAB(filter === 'all')}    onClick={() => setFilter('all')}>All</button>
          <button style={TAB(filter === 'unread')} onClick={() => setFilter('unread')}>
            Unread {unread > 0 && `(${unread})`}
          </button>
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
            <div style={{ fontSize: 40, marginBottom: 10 }}>🔔</div>
            <p style={{ fontSize: 14, color: 'var(--ak-text-muted)', fontWeight: 700 }}>
              {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {displayed.map(n => <NotifRow key={n.id} n={n} onMarkRead={markRead} onDelete={del} />)}
          </div>
        )}
      </div>
    </div>
  );
}
