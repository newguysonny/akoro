/**
 * HomePage — constants + child components.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Toast, Skeleton, Modal, Inp } from '../../components/Primitives.jsx';
import { useStatsAPI } from '../../hooks/useStatsAPI.js';
import { useCoursesAPI } from '../../hooks/useCoursesAPI.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { apiGet, apiPost, apiDelete, API } from '../../services/api.js';
import { GREEN, PURPLE, BLUE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';


/* ── Mock fallback data (matches backend snake_case shape) ──────────── */

const MOCK_STATS = {
  total_students: 48,
  active_courses: 3,
  total_courses:  5,
  total_revenue:  234000,
  agent_xp:       1840,
  agent_level:    4,
  streak_days:    6,
};

const STREAM_META = {
  zoom:    { label: 'Zoom',        color: '#2D8CFF' },
  meet:    { label: 'Google Meet', color: '#00897B' },
  teams:   { label: 'MS Teams',    color: '#6264A7' },
  youtube: { label: 'YouTube Live', color: '#FF0000' },
};

const MOCK_PROFILE = {
  agentName: 'Prof. Aria',
  agentStatus: 'active',
  agentDescription: 'Your AI teaching assistant handles student questions 24/7.',
  totalResponses: 342,
  studentsSatisfied: 94,
};

const MOCK_SESSIONS = [
  { id: 1, title: 'Advanced React Patterns', startTime: new Date().toISOString(), platform: 'zoom', enrolledCount: 14 },
  { id: 2, title: 'State Management Deep Dive', startTime: new Date(Date.now() + 3600000).toISOString(), platform: 'meet', enrolledCount: 9 },
];

/* ── Stat card ──────────────────────────────────────────────────────── */
function StatCard({ icon: Icon, ti, label, value, sub, color = C.brand, loading, progress = 0.75 }) {
  if (loading) return (
    <div style={{ background: C.surface, borderRadius: 10, padding: '18px', border: `1px solid ${C.bxBorder}` }}>
      <Skeleton height={14} width={80} style={{ marginBottom: 12 }} />
      <Skeleton height={32} width={60} style={{ marginBottom: 6 }} />
      <Skeleton height={12} width={100} />
    </div>
  );
  const r = 22, c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, progress)));
  return (
    <div style={{
      background: C.surface, borderRadius: 10, padding: '18px',
      border: `1px solid ${C.bxBorder}`,
      display: 'flex', alignItems: 'center', gap: 12,
      fontFamily: C.bxFont,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: C.bxMuted, fontWeight: 500, marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: C.bxInk, lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 11, color: C.bxMuted, marginTop: 4 }}>{sub}</div>}
      </div>
      <svg width="52" height="52" viewBox="0 0 52 52" style={{ flexShrink: 0 }}>
        <circle cx="26" cy="26" r={r} fill="none" stroke={C.bxTrack} strokeWidth="5" />
        <circle cx="26" cy="26" r={r} fill="none" stroke={C.bxPrimary} strokeWidth="5"
          strokeLinecap="round" strokeDasharray={c.toFixed(1)} strokeDashoffset={offset.toFixed(1)}
          transform="rotate(-90 26 26)" />
        <foreignObject x="17" y="17" width="18" height="18">
          <Ico ti={ti} size={18} color={C.bxPrimary} />
        </foreignObject>
      </svg>
    </div>
  );
}

/* ── Today's sessions ───────────────────────────────────────────────── */
function SessionItem({ session }) {
  const time = new Date(session.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', background: C.surface, borderRadius: 12,
      border: `1px solid ${C.border}`,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, background: tint(8),
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Ico ti="ti-video" size={18} color={C.brand} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, fontFamily: C.font, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {session.title}
        </div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: C.font, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Ico ti="ti-clock" size={10} /> {time} · {session.enrolledCount || 0} enrolled
        </div>
      </div>
      <Btn size="sm" variant="outline">Join</Btn>
    </div>
  );
}

/* ── Quick action card ──────────────────────────────────────────────── */
function QuickAction({ icon: Icon, ti, label, desc, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: C.surface, border: `1px solid ${C.bxBorder}`, borderRadius: 10,
        padding: '16px', cursor: 'pointer', textAlign: 'left',
        display: 'flex', flexDirection: 'column', gap: 8, transition: 'all .15s',
        fontFamily: C.bxFont,
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = color}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10, background: tint(8, color),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Ico ti={ti} size={18} color={color} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.bxInk }}>{label}</div>
      <div style={{ fontSize: 12, color: C.bxMuted }}>{desc}</div>
    </button>
  );
}

/* ── Streaming platforms panel (connected) ──────────────────────────── */
const PLATFORM_KEYS = ['zoom', 'meet', 'teams', 'youtube'];
const STREAM_ERRORS = {
  invalid_state:         'Security check failed — please try connecting again.',
  provider_mismatch:     'Security check failed — please try connecting again.',
  missing_code:          'Authorization was cancelled.',
  token_exchange_failed: 'The platform rejected the connection. Please retry.',
};

function StreamingPanel({ onToast }) {
  // Per-platform: { connected, method: 'oauth'|'link'|null, meeting_url }
  const [state, setState] = useState(null); // null = loading
  const [busy, setBusy] = useState(null);
  const [connectFor, setConnectFor] = useState(null); // platform key for the "link" modal
  const [roomUrl, setRoomUrl] = useState('');
  const [hostEmail, setHostEmail] = useState('');

  const load = useCallback(async () => {
    // Merge OAuth status (/api/meeting/status) with paste-link status (/api/instructor/streaming).
    const [oauthRes, linkRes] = await Promise.allSettled([
      apiGet('/api/meeting/status'),
      apiGet('/api/instructor/streaming'),
    ]);
    const oauth = oauthRes.status === 'fulfilled' ? (oauthRes.value?.data ?? {}) : {};
    const links = linkRes.status === 'fulfilled' ? (linkRes.value?.data ?? []) : [];
    const linkMap = Object.fromEntries(links.map((l) => [l.platform, l]));

    setState(PLATFORM_KEYS.map((p) => {
      const oauthConnected = !!oauth[p]?.connected;
      const link = linkMap[p];
      return {
        platform:    p,
        connected:   oauthConnected || !!link?.connected,
        method:      oauthConnected ? 'oauth' : link?.connected ? 'link' : null,
        meeting_url: link?.meeting_url ?? null,
      };
    }));
  }, []);

  // Handle the OAuth return (?connected= / ?streaming_error=) then load status.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const error = params.get('streaming_error');
    if (connected || error) {
      if (connected) onToast?.(`${STREAM_META[connected]?.label ?? connected} connected`, 'success');
      if (error) {
        const base = error.split(':')[0];
        const googleCode = error.split(':')[1];
        const msg = STREAM_ERRORS[base]
          || (googleCode ? `Connection failed: ${googleCode.replace(/_/g, ' ')}` : 'Could not connect platform');
        onToast?.(msg, 'error');
      }
      params.delete('connected'); params.delete('streaming_error');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
    load().catch(() => setState(PLATFORM_KEYS.map((p) => ({ platform: p, connected: false, method: null }))));
  }, [load, onToast]);

  // Full-page redirect to the provider's consent screen.
  // ?portal=instructor lets the API pick the instructor session cookie (a
  // full-page navigation to the OAuth endpoint can't send the X-Akoro-Portal header).
  const startOAuth = (platform) => { window.location.href = `${API}/api/meeting/auth/${platform}?portal=instructor`; };

  const disconnect = async (p) => {
    setBusy(p.platform);
    setState((ps) => ps.map((x) => x.platform === p.platform ? { ...x, connected: false, method: null } : x));
    try {
      if (p.method === 'oauth') await apiDelete(`/api/meeting/disconnect/${p.platform}`);
      else                      await apiDelete(`/api/instructor/streaming/${p.platform}`);
      onToast?.(`${STREAM_META[p.platform]?.label} disconnected`, 'info');
    } catch {
      onToast?.('Could not update platform', 'error');
      load();
    } finally { setBusy(null); }
  };

  const submitLink = async () => {
    const platform = connectFor;
    setBusy(platform);
    try {
      await apiPost('/api/instructor/streaming/connect', {
        platform,
        meetingUrl: roomUrl.trim() || null,
        hostEmail:  hostEmail.trim() || null,
      });
      setState((ps) => ps.map((x) => x.platform === platform
        ? { ...x, connected: true, method: 'link', meeting_url: roomUrl.trim() || null } : x));
      onToast?.(`${STREAM_META[platform]?.label} connected`, 'success');
      setConnectFor(null); setRoomUrl(''); setHostEmail('');
    } catch {
      onToast?.('Could not connect platform', 'error');
    } finally { setBusy(null); }
  };

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: '20px', fontFamily: C.font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Ico ti="ti-video" size={16} color={C.brand} />
        <h3 style={{ fontSize: 14, fontWeight: 700, color: C.ink, margin: 0 }}>Streaming Platforms</h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {state === null
          ? [0, 1, 2].map((i) => <Skeleton key={i} height={44} />)
          : state.map((p) => {
            const meta = STREAM_META[p.platform] ?? { label: p.platform, color: C.muted };
            const sub = p.connected
              ? (p.method === 'oauth' ? 'Connected · OAuth' : 'Connected · Manual link')
              : 'Not connected';
            return (
              <div key={p.platform} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: tint(8, meta.color), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Ico ti="ti-video" size={15} color={meta.color} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{meta.label}</div>
                  <div style={{ fontSize: 10.5, color: p.connected ? GREEN : C.muted, display: 'flex', alignItems: 'center', gap: 3 }}>
                    {p.connected && <Ico ti="ti-circle-check" size={10} />}{sub}
                  </div>
                </div>
                {p.connected ? (
                  <Btn size="sm" variant="ghost" disabled={busy === p.platform} onClick={() => disconnect(p)} style={{ color: C.muted }}>
                    {busy === p.platform ? '…' : 'Disconnect'}
                  </Btn>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Btn size="sm" variant="outline" onClick={() => startOAuth(p.platform)}>Connect</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setConnectFor(p.platform)} style={{ color: C.muted }}>Use link</Btn>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      <Modal open={!!connectFor} onClose={() => { setConnectFor(null); setRoomUrl(''); setHostEmail(''); }}
        title={`Connect ${STREAM_META[connectFor]?.label ?? ''} with a link`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 12.5, color: C.muted, margin: 0, fontFamily: C.font, lineHeight: 1.5 }}>
            Prefer <b>Connect</b> to authorize with your account so links are generated automatically.
            Or paste a personal meeting room link to reuse for every session.
          </p>
          <Inp label={connectFor === 'youtube' ? 'YouTube channel / live URL' : 'Personal meeting link'} value={roomUrl} onChange={(e) => setRoomUrl(e.target.value)}
            placeholder={
              connectFor === 'zoom'    ? 'https://zoom.us/j/your-pmi'
              : connectFor === 'meet'  ? 'https://meet.google.com/abc-defg-hij'
              : connectFor === 'youtube' ? 'https://youtube.com/@yourchannel/live'
              : 'https://teams.microsoft.com/l/meetup-join/…'
            } />
          {connectFor === 'zoom' && (
            <Inp label="Zoom host email (optional)" value={hostEmail} onChange={(e) => setHostEmail(e.target.value)}
              placeholder="you@example.com" />
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="secondary" onClick={() => { setConnectFor(null); setRoomUrl(''); setHostEmail(''); }}>Cancel</Btn>
            <Btn onClick={submitLink} disabled={busy === connectFor || !roomUrl.trim()}>{busy === connectFor ? 'Saving…' : 'Save link'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}


export { MOCK_STATS, STREAM_META, MOCK_PROFILE, MOCK_SESSIONS, StatCard, SessionItem, QuickAction, PLATFORM_KEYS, STREAM_ERRORS, StreamingPanel };
