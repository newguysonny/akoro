import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet, apiPost } from '../services/api.js';
import { BRAND, RED, GREEN, GOLD } from '../constants.js';
import Toast from '../components/common/Toast.jsx';

const FONT = "'Nunito', sans-serif";

const STATUS_META = {
  live:      { label: 'LIVE',      color: RED,    bg: 'rgba(239,68,68,.12)' },
  scheduled: { label: 'Upcoming',  color: GOLD,   bg: 'rgba(245,158,11,.12)' },
  ended:     { label: 'Ended',     color: 'var(--ak-text-sub)', bg: 'var(--ak-tag-bg)' },
  recorded:  { label: 'Recorded',  color: BRAND,  bg: 'rgba(108,59,255,.10)' },
  cancelled: { label: 'Cancelled', color: 'var(--ak-text-muted)', bg: 'var(--ak-tag-bg)' },
};
const fmtDay  = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

function StatusPill({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.scheduled;
  return (
    <span style={{ fontSize: 10, fontWeight: 800, color: m.color, background: m.bg, padding: '2px 8px', borderRadius: 20, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {status === 'live' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.color, animation: 'pulse-dot 1.6s infinite' }} />}
      {m.label}
    </span>
  );
}

function MaterialLinks({ materials }) {
  if (!materials?.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {materials.map((m) => {
        const icon = m.kind === 'link' ? '🔗' : m.kind === 'note' ? '📝' : '📎';
        const body = <>{icon} {m.title}</>;
        return m.url
          ? <a key={m.id} href={m.url} target="_blank" rel="noreferrer" style={chip(true)}>{body}</a>
          : <span key={m.id} style={chip(false)}>{body}</span>;
      })}
    </div>
  );
}

function TopicRow({ session, onJoin, joining }) {
  const isLive = session.status === 'live';
  const hasReplay = (session.status === 'ended' || session.status === 'recorded') && session.recording_url;
  return (
    <div style={{ background: 'var(--ak-surface)', border: `1px solid ${isLive ? 'rgba(239,68,68,.4)' : 'var(--ak-border)'}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)', fontFamily: FONT }}>{session.title || session.topic || 'Live session'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--ak-text-sub)', fontFamily: FONT, marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span>📅 {fmtDay(session.scheduled_start)}</span>
            <span>🕐 {fmtTime(session.scheduled_start)}{session.scheduled_end ? `–${fmtTime(session.scheduled_end)}` : ''}</span>
            <span style={{ textTransform: 'capitalize' }}>{session.platform}</span>
          </div>
          <MaterialLinks materials={session.materials} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <StatusPill status={session.status} />
          {isLive && (
            <button onClick={() => onJoin(session)} disabled={joining === session.id}
              style={{ background: RED, color: '#fff', border: 'none', borderRadius: 10, padding: '7px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
              {joining === session.id ? '…' : 'Join now'}
            </button>
          )}
          {hasReplay && (
            <a href={session.recording_url} target="_blank" rel="noreferrer"
              style={{ background: 'rgba(108,59,255,.10)', color: BRAND, borderRadius: 10, padding: '7px 14px', fontSize: 12, fontWeight: 800, textDecoration: 'none', fontFamily: FONT }}>
              ▶ Replay
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LiveClassesPage() {
  const navigate = useNavigate();
  const { courseId } = useParams();
  const [data, setData] = useState(null);     // curriculum (course mode) or list (hub mode)
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (courseId) {
        const res = await apiGet(`/api/courses/${courseId}/curriculum`);
        setData(res?.data ?? null);
      } else {
        const res = await apiGet('/api/user/sessions');
        setData({ upcoming: res?.data ?? [] });
      }
    } catch (e) {
      setToast({ message: e.message || 'Could not load classes', type: 'error' });
      setData(courseId ? null : { upcoming: [] });
    } finally { setLoading(false); }
  }, [courseId]);

  useEffect(() => { load(); }, [load]);

  const join = async (session) => {
    setJoining(session.id);
    try {
      const res = await apiPost(`/api/live-sessions/${session.id}/join`, {});
      const url = res?.data?.meeting_url;
      if (url) window.open(url, '_blank', 'noopener');
      else setToast({ message: 'No meeting link available yet', type: 'error' });
    } catch (e) {
      setToast({ message: e.message || 'Could not join session', type: 'error' });
    } finally { setJoining(null); }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--ak-bg)', fontFamily: FONT }}>
      <style>{`@keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* Header */}
      <div style={{ background: 'var(--ak-surface)', borderBottom: '1px solid var(--ak-border)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={() => courseId ? navigate('/live') : navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--ak-text-sub)' }}>←</button>
        <h1 style={{ fontSize: 17, fontWeight: 900, color: 'var(--ak-text)', margin: 0 }}>
          {courseId ? (data?.course?.title || 'Curriculum') : 'Live Classes'}
        </h1>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '16px 16px 48px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map((i) => <div key={i} style={{ height: 80, background: 'var(--ak-surface)', borderRadius: 12, opacity: .6 }} />)}
          </div>
        ) : courseId ? (
          /* ── Course curriculum mode ── */
          <CurriculumView data={data} onJoin={join} joining={joining} />
        ) : (
          /* ── Hub mode: upcoming across enrolled courses ── */
          <HubView upcoming={data?.upcoming ?? []} onJoin={join} joining={joining} navigate={navigate} />
        )}
      </div>

      {toast && <Toast msg={toast.message} color={toast.type === 'error' ? RED : GREEN} onDone={() => setToast(null)} />}
    </div>
  );
}

function CurriculumView({ data, onJoin, joining }) {
  if (!data) return <Empty text="Curriculum unavailable." />;
  const modules = data.modules ?? [];
  const unscheduled = data.unscheduled ?? [];
  if (modules.length === 0 && unscheduled.length === 0) return <Empty text="No sessions scheduled yet." />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {modules.map((m, i) => (
        <div key={m.id}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: BRAND, letterSpacing: .5 }}>MODULE {i + 1}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)' }}>{m.title}</span>
          </div>
          {m.description && <p style={{ fontSize: 12, color: 'var(--ak-text-sub)', margin: '0 0 8px' }}>{m.description}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {m.sessions.length === 0
              ? <p style={{ fontSize: 12, color: 'var(--ak-text-muted)', margin: 0 }}>No topics in this module yet.</p>
              : m.sessions.map((s) => <TopicRow key={s.id} session={s} onJoin={onJoin} joining={joining} />)}
          </div>
        </div>
      ))}
      {unscheduled.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)', marginBottom: 8 }}>Other sessions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {unscheduled.map((s) => <TopicRow key={s.id} session={s} onJoin={onJoin} joining={joining} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function HubView({ upcoming, onJoin, joining, navigate }) {
  if (upcoming.length === 0) return <Empty text="No upcoming live classes. Enrol in a live course to see its schedule here." />;

  // Group by course for the "view full schedule" links.
  const courses = [];
  const seen = new Set();
  for (const s of upcoming) {
    const c = s.courses;
    if (c && !seen.has(c.id)) { seen.add(c.id); courses.push(c); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)', marginBottom: 8 }}>Upcoming sessions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {upcoming.map((s) => <TopicRow key={s.id} session={s} onJoin={onJoin} joining={joining} />)}
        </div>
      </div>
      {courses.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ak-text)', marginBottom: 8 }}>Your live courses</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {courses.map((c) => (
              <button key={c.id} onClick={() => navigate(`/live/${c.id}`)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--ak-surface)', border: '1px solid var(--ak-border)', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', fontFamily: FONT, textAlign: 'left' }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ak-text)' }}>{c.title}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: BRAND }}>View schedule →</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ text }) {
  return (
    <div style={{ background: 'var(--ak-surface)', border: '1px dashed #DDD3FF', borderRadius: 16, padding: 36, textAlign: 'center', color: 'var(--ak-text-sub)', fontSize: 13.5, fontFamily: FONT }}>
      {text}
    </div>
  );
}

const chip = (clickable) => ({
  fontSize: 11, fontWeight: 700, color: clickable ? BRAND : 'var(--ak-text-sub)',
  background: clickable ? 'rgba(108,59,255,.08)' : 'var(--ak-tag-bg)',
  padding: '3px 8px', borderRadius: 8, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3,
});
