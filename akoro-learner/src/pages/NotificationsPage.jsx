import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiDelete } from '../services/api.js';
import { pushSupported, getPushStatus, enablePush, disablePush } from '../services/pushApi.js';
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

function NotifRow({ n, onMarkRead, onDelete, onOpen }) {
  const { emoji, color } = getMeta(n.type);
  return (
    <div onClick={() => onOpen(n)} style={{
      display: 'flex', gap: 12, padding: '13px 15px', cursor: 'pointer',
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
            <button onClick={(e) => { e.stopPropagation(); onMarkRead(n.id); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: BRAND, fontSize: 11, fontWeight: 800, fontFamily: "'Nunito',sans-serif", padding: 0 }}>
              Mark read
            </button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(n.id); }}
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

  // ── Web Push (PWA) opt-in ──────────────────────────────────────────────────
  const [push, setPush] = useState({ supported: false, subscribed: false, permission: 'default' });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  useEffect(() => { if (pushSupported()) getPushStatus().then(setPush); }, []);

  const togglePush = async () => {
    setPushBusy(true); setPushError('');
    try {
      if (push.subscribed) { await disablePush(); }
      else { await enablePush(); }
      setPush(await getPushStatus());
    } catch (e) {
      setPushError(e?.message || 'Could not update push notifications.');
    } finally { setPushBusy(false); }
  };

  // Tapping a card marks it read and, if it carries a deep link, navigates there.
  const openNotif = (n) => {
    if (!n.is_read) markRead(n.id);
    if (n.link) navigate(n.link);
  };

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

        {/* Web Push opt-in (PWA) */}
        {push.supported && push.permission !== 'denied' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, padding: '10px 12px', background: push.subscribed ? '#ECFDF5' : '#F0EBFF', border: `1px solid ${push.subscribed ? '#A7F3D0' : '#DDD3FF'}`, borderRadius: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ak-text)' }}>
                {push.subscribed ? '🔔 Push notifications on' : '🔕 Enable push notifications'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ak-text-muted)' }}>
                {push.subscribed ? 'Get alerts even when the app is closed.' : 'Be notified of purchases, classes and replies.'}
              </div>
            </div>
            <button onClick={togglePush} disabled={pushBusy}
              style={{ flexShrink: 0, background: push.subscribed ? 'transparent' : BRAND, color: push.subscribed ? BRAND : '#fff', border: push.subscribed ? `1px solid ${BRAND}` : 'none', borderRadius: 100, padding: '7px 14px', cursor: pushBusy ? 'default' : 'pointer', fontSize: 11.5, fontWeight: 800, fontFamily: "'Nunito',sans-serif" }}>
              {pushBusy ? '…' : push.subscribed ? 'Turn off' : 'Turn on'}
            </button>
          </div>
        )}
        {pushError && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: 12, fontSize: 11.5, color: '#991B1B', fontWeight: 700, lineHeight: 1.45 }}>
            {pushError}
          </div>
        )}
        {push.supported && push.permission === 'denied' && (
          <div style={{ marginTop: 12, padding: '10px 12px', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 12, fontSize: 11.5, color: '#92400E', fontWeight: 700 }}>
            Push is blocked in your browser settings. Allow notifications for this site to turn it on.
          </div>
        )}
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
            {displayed.map(n => <NotifRow key={n.id} n={n} onMarkRead={markRead} onDelete={del} onOpen={openNotif} />)}
          </div>
        )}
      </div>
    </div>
  );
}
