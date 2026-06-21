import { useState, useEffect, useCallback } from 'react';
import { Bell, Check, CheckCheck, Trash2, BookOpen, Users, Swords, Calendar, MessageSquare, CheckSquare, Settings, Info, Video } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Toast } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiDelete } from '../services/api.js';
import { AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../constants.js';

const TYPE_META = {
  student_enrolled:      { icon: Users,        color: GREEN,  label: 'Student enrolled'   },
  student_removed:       { icon: Users,        color: RED,    label: 'Student removed'    },
  course_created:        { icon: BookOpen,     color: BLUE,   label: 'Course created'     },
  course_updated:        { icon: BookOpen,     color: AMBER,  label: 'Course updated'     },
  course_deleted:        { icon: Trash2,       color: RED,    label: 'Course deleted'     },
  session_reminder:      { icon: Calendar,     color: AMBER,  label: 'Session scheduled'  },
  session_updated:       { icon: Calendar,     color: AMBER,  label: 'Session updated'    },
  session_deleted:       { icon: Trash2,       color: RED,    label: 'Session deleted'    },
  battle_created:        { icon: Swords,       color: PURPLE, label: 'Battle created'     },
  battle_started:        { icon: Swords,       color: PURPLE, label: 'Battle started'     },
  battle_updated:        { icon: Swords,       color: AMBER,  label: 'Battle updated'     },
  battle_deleted:        { icon: Trash2,       color: RED,    label: 'Battle deleted'     },
  profile_updated:       { icon: Settings,     color: BLUE,   label: 'Profile updated'    },
  settings_updated:      { icon: Settings,     color: BLUE,   label: 'Settings updated'   },
  streaming_connected:   { icon: Video,        color: GREEN,  label: 'Streaming connected'    },
  streaming_disconnected:{ icon: Video,        color: MUTED,  label: 'Streaming disconnected' },
  task_complete:         { icon: CheckSquare,  color: GREEN,  label: 'Task complete'      },
  message:               { icon: MessageSquare,color: BLUE,   label: 'Message'            },
  system:                { icon: Settings,     color: MUTED,  label: 'System'             },
};

function getMeta(type) {
  return TYPE_META[type] || { icon: Info, color: MUTED, label: type };
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
  const { icon: Icon, color } = getMeta(n.type);
  return (
    <div style={{
      display: 'flex', gap: 14, padding: '14px 16px',
      background: n.is_read ? WHITE : `${AMBER}06`,
      borderRadius: 12, border: `1px solid ${n.is_read ? BORDER : `${AMBER}30`}`,
      transition: 'all .15s', position: 'relative',
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
        background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={16} color={color} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: n.is_read ? 500 : 700, color: INK, fontFamily: FONT }}>
            {n.title}
          </div>
          <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT, flexShrink: 0 }}>
            {timeAgo(n.created_at)}
          </div>
        </div>
        {n.content && (
          <div style={{ fontSize: 12, color: MUTED, fontFamily: FONT, marginTop: 3, lineHeight: 1.5 }}>
            {n.content}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'flex-start' }}>
        {!n.is_read && (
          <button
            onClick={() => onMarkRead(n.id)}
            title="Mark as read"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: AMBER, padding: 4 }}
          >
            <Check size={14} />
          </button>
        )}
        <button
          onClick={() => onDelete(n.id)}
          title="Delete"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 4 }}
        >
          <Trash2 size={14} />
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
    fontFamily: FONT, fontSize: 12, fontWeight: active ? 700 : 500,
    background: active ? AMBER : 'transparent', color: active ? WHITE : MUTED,
    transition: 'all .15s',
  });

  return (
    <PageLayout
      title="Notifications"
      subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}
      action={
        unread > 0 && (
          <Btn size="sm" variant="secondary" onClick={markAllRead}>
            <CheckCheck size={14} /> Mark all read
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
            <div key={i} style={{ height: 72, borderRadius: 12, background: BORDER, opacity: .4 }} />
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div style={{
          background: WHITE, border: `1px dashed ${BORDER}`, borderRadius: 16,
          padding: '56px', textAlign: 'center',
        }}>
          <Bell size={32} color={MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: 0 }}>
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
