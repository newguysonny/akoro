import { useState, useEffect, useCallback } from 'react';
import { Trash2, BookOpen, Users, Swords, Calendar, MessageSquare, CheckSquare, Settings, Info, Video, DollarSign, Wallet, Star, Wrench, ShieldCheck } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Toast } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiDelete } from '../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const TYPE_META = {
  student_enrolled:      { icon: Users, ti: 'ti-users',        color: GREEN,  label: 'Student enrolled'   },
  student_removed:       { icon: Users, ti: 'ti-users',        color: RED,    label: 'Student removed'    },
  course_created:        { icon: BookOpen, ti: 'ti-book',     color: BLUE,   label: 'Course created'     },
  course_updated:        { icon: BookOpen, ti: 'ti-book',     color: C.brand,  label: 'Course updated'     },
  course_deleted:        { icon: Trash2, ti: 'ti-trash',       color: RED,    label: 'Course deleted'     },
  session_reminder:      { icon: Calendar, ti: 'ti-calendar',     color: C.brand,  label: 'Session scheduled'  },
  session_updated:       { icon: Calendar, ti: 'ti-calendar',     color: C.brand,  label: 'Session updated'    },
  session_deleted:       { icon: Trash2, ti: 'ti-trash',       color: RED,    label: 'Session deleted'    },
  battle_created:        { icon: Swords, ti: 'ti-swords',       color: PURPLE, label: 'Battle created'     },
  battle_started:        { icon: Swords, ti: 'ti-swords',       color: PURPLE, label: 'Battle started'     },
  battle_updated:        { icon: Swords, ti: 'ti-swords',       color: C.brand,  label: 'Battle updated'     },
  battle_deleted:        { icon: Trash2, ti: 'ti-trash',       color: RED,    label: 'Battle deleted'     },
  profile_updated:       { icon: Settings, ti: 'ti-settings',     color: BLUE,   label: 'Profile updated'    },
  settings_updated:      { icon: Settings, ti: 'ti-settings',     color: BLUE,   label: 'Settings updated'   },
  streaming_connected:   { icon: Video, ti: 'ti-video',        color: GREEN,  label: 'Streaming connected'    },
  streaming_disconnected:{ icon: Video, ti: 'ti-video',        color: C.muted,  label: 'Streaming disconnected' },
  task_complete:         { icon: CheckSquare, ti: 'ti-checkbox',  color: GREEN,  label: 'Task complete'      },
  message:               { icon: MessageSquare, ti: 'ti-message',color: BLUE,   label: 'Message'            },
  // Commerce
  sale_new:              { icon: DollarSign, ti: 'ti-currency-dollar',   color: GREEN,  label: 'New sale'           },
  payout_completed:      { icon: Wallet, ti: 'ti-wallet',       color: GREEN,  label: 'Payout sent'        },
  payout_failed:         { icon: Wallet, ti: 'ti-wallet',       color: RED,    label: 'Payout failed'      },
  review_new:            { icon: Star, ti: 'ti-star',         color: C.brand,  label: 'New review'         },
  tool_unlocked:         { icon: Wrench, ti: 'ti-tool',       color: BLUE,   label: 'Tool unlocked'      },
  course_approved:       { icon: ShieldCheck, ti: 'ti-shield-check',  color: GREEN,  label: 'Course approved'    },
  course_rejected:       { icon: BookOpen, ti: 'ti-book',     color: RED,    label: 'Course needs changes' },
  system:                { icon: Settings, ti: 'ti-settings',     color: C.muted,  label: 'System'             },
};

function getMeta(type) {
  return TYPE_META[type] || { icon: Info, ti: 'ti-info-circle', color: C.muted, label: type };
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function NotificationItem({ n, onMarkRead, onDelete }) {
  const { icon: Icon, ti, color } = getMeta(n.type);
  return (
    <div style={{
      display: 'flex', gap: 14, padding: '14px 16px',
      background: n.is_read ? C.surface : tint(2),
      borderRadius: 12, border: `1px solid ${n.is_read ? C.border : tint(19)}`,
      transition: 'all .15s', position: 'relative',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
        background: tint(9, color), display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Ico ti={ti} size={16} color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: n.is_read ? 500 : 700, color: C.ink, fontFamily: C.font }}>
            {n.title}
          </div>
          <div style={{ fontSize: 11, color: C.muted, fontFamily: C.font, flexShrink: 0 }}>
            {timeAgo(n.created_at)}
          </div>
        </div>
        {n.content && (
          <div style={{ fontSize: 12, color: C.muted, fontFamily: C.font, marginTop: 3, lineHeight: 1.5 }}>
            {n.content}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'flex-start' }}>
        {!n.is_read && (
          <button
            onClick={() => onMarkRead(n.id)}
            title="Mark as read"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.brand, padding: 4 }}
          >
            <Ico ti="ti-check" size={14} />
          </button>
        )}
        <button
          onClick={() => onDelete(n.id)}
          title="Delete"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, padding: 4 }}
        >
          <Ico ti="ti-trash" size={14} />
        </button>
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const [notifications, setNotifs] = useState([]);
  const [loading, setLoading]      = useState(true);
  const [unread, setUnread]        = useState(0);
  const [toast, setToast]          = useState(null);
  const [filter, setFilter]        = useState('all'); // 'all' | 'unread'

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const res = await apiGet('/api/notifications?limit=50');
      setNotifs(res.data ?? []);
      setUnread(res.unread ?? 0);
    } catch {
      setNotifs([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id) => {
    try {
      await apiPost('/api/notifications/mark-read', { ids: [id] });
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
      setUnread(u => Math.max(0, u - 1));
    } catch { showToast('Failed to mark as read', 'error'); }
  };

  const markAllRead = async () => {
    try {
      await apiPost('/api/notifications/mark-read', { all: true });
      setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnread(0);
      showToast('All notifications marked as read');
    } catch { showToast('Failed to mark all as read', 'error'); }
  };

  const deleteNotif = async (id) => {
    try {
      await apiDelete(`/api/notifications/${id}`);
      const n = notifications.find(x => x.id === id);
      setNotifs(prev => prev.filter(x => x.id !== id));
      if (n && !n.is_read) setUnread(u => Math.max(0, u - 1));
    } catch { showToast('Failed to delete', 'error'); }
  };

  const displayed = filter === 'unread' ? notifications.filter(n => !n.is_read) : notifications;

  const TAB = (active) => ({
    padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
    fontFamily: C.font, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? C.brand : 'transparent', color: active ? '#fff' : C.muted,
    transition: 'all .15s',
  });

  return (
    <PageLayout
      title="Notifications"
      subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}
      action={
        unread > 0 && (
          <Btn size="sm" variant="secondary" onClick={markAllRead}>
            <Ico ti="ti-checks" size={14} /> Mark all read
          </Btn>
        )
      }
    >
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        <button style={TAB(filter === 'all')}   onClick={() => setFilter('all')}>All</button>
        <button style={TAB(filter === 'unread')} onClick={() => setFilter('unread')}>
          Unread {unread > 0 && `(${unread})`}
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3,4,5].map(i => (
            <div key={i} style={{ height: 72, borderRadius: 12, background: C.border, opacity: .4 }} />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div style={{
          background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 16,
          padding: '56px', textAlign: 'center',
        }}>
          <Ico ti="ti-bell" size={32} color={C.muted} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: C.muted, fontFamily: C.font, margin: 0 }}>
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {displayed.map(n => (
            <NotificationItem key={n.id} n={n} onMarkRead={markRead} onDelete={deleteNotif} />
          ))}
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
