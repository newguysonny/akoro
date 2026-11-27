/**
 * HomePage — constants + child components.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Facebook, Instagram, Twitter, Music2, Share2 } from 'lucide-react';
import { Ico } from '../../theme/Ico.jsx';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Toast, Skeleton, Modal, Inp } from '../../components/Primitives.jsx';
import { useStatsAPI } from '../../hooks/useStatsAPI.js';
import { useCoursesAPI } from '../../hooks/useCoursesAPI.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { apiGet, apiPost, apiDelete, API } from '../../services/api.js';
import { GREEN, PURPLE, BLUE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';

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

const SOCIAL_META = {
  facebook:  { label: 'Facebook',    color: '#1877F2', Icon: Facebook, ti: 'ti-brand-facebook' },
  instagram: { label: 'Instagram',   color: '#E4405F', Icon: Instagram, ti: 'ti-brand-instagram' },
  twitter:   { label: 'X (Twitter)', color: '#0F1419', Icon: Twitter, ti: 'ti-brand-twitter' },
  tiktok:    { label: 'TikTok',      color: '#010101', Icon: Music2, ti: 'ti-music' },
};
const SOCIAL_KEYS = ['facebook', 'instagram', 'twitter', 'tiktok'];

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
function StatCard({ icon: Icon, ti, label, value, sub, color = C.brand, loading }) {
  if (loading) return (
    <div style={{ background: C.surface, borderRadius: 16, padding: '20px', border: `1px solid ${C.border}` }}>
      <Skeleton height={14} width={80} style={{ marginBottom: 12 }} />
      <Skeleton height={32} width={60} style={{ marginBottom: 6 }} />
      <Skeleton height={12} width={100} />
    </div>
  );
  return (
    <div style={{
      background: C.surface, borderRadius: 16, padding: '20px',
      border: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: tint(8, color),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Ico lucide={Icon} ti={ti} size={18} color={color} />
        </div>
        <span style={{ fontSize: 12, color: C.muted, fontWeight: 500, fontFamily: C.font }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: C.ink, fontFamily: C.font, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.muted, fontFamily: C.font }}>{sub}</div>}
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
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
        padding: '16px', cursor: 'pointer', textAlign: 'left',
        display: 'flex', flexDirection: 'column', gap: 8, transition: 'all .15s',
        fontFamily: C.font,
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = color}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 10, background: tint(8, color),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Ico lucide={Icon} ti={ti} size={18} color={color} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{label}</div>
      <div style={{ fontSize: 11, color: C.muted }}>{desc}</div>
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

  // Full-page redirect to the provider's consent screen. The ?portal=school
  // lets the API pick the school session cookie (a navigation can't send the
  // X-Akoro-Portal header).
  const startOAuth = (platform) => { window.location.href = `${API}/api/meeting/auth/${platform}?portal=school`; };

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


/* ── Social platforms panel (credential storage) ─────────────────────── */
function SocialPanel({ onToast }) {
  const [state, setState] = useState(null);         // null = loading
  const [busy, setBusy] = useState(null);
  const [connectFor, setConnectFor] = useState(null); // platform key for the credentials modal
  const [form, setForm] = useState({ profileUrl: '', accessToken: '', apiKey: '', apiSecret: '', accountId: '' });

  const resetForm = () => setForm({ profileUrl: '', accessToken: '', apiKey: '', apiSecret: '', accountId: '' });

  const load = useCallback(async () => {
    const res = await apiGet('/api/instructor/social');
    const rows = res?.data ?? [];
    const map = Object.fromEntries(rows.map((r) => [r.platform, r]));
    setState(SOCIAL_KEYS.map((p) => ({
      platform:    p,
      connected:   !!map[p]?.connected,
      profile_url: map[p]?.profile_url ?? null,
    })));
  }, []);

  useEffect(() => {
    load().catch(() => setState(SOCIAL_KEYS.map((p) => ({ platform: p, connected: false }))));
  }, [load]);

  const disconnect = async (p) => {
    setBusy(p.platform);
    setState((ps) => ps.map((x) => x.platform === p.platform ? { ...x, connected: false } : x));
    try {
      await apiDelete(`/api/instructor/social/${p.platform}`);
      onToast?.(`${SOCIAL_META[p.platform]?.label} disconnected`, 'info');
    } catch {
      onToast?.('Could not update account', 'error');
      load();
    } finally { setBusy(null); }
  };

  const submit = async () => {
    const platform = connectFor;
    setBusy(platform);
    try {
      await apiPost('/api/instructor/social/connect', {
        platform,
        profileUrl:  form.profileUrl.trim() || null,
        accessToken: form.accessToken.trim() || null,
        apiKey:      form.apiKey.trim() || null,
        apiSecret:   form.apiSecret.trim() || null,
        accountId:   form.accountId.trim() || null,
      });
      setState((ps) => ps.map((x) => x.platform === platform
        ? { ...x, connected: true, profile_url: form.profileUrl.trim() || null } : x));
      onToast?.(`${SOCIAL_META[platform]?.label} connected`, 'success');
      setConnectFor(null); resetForm();
    } catch {
      onToast?.('Could not save credentials', 'error');
    } finally { setBusy(null); }
  };

  const hasInput = form.profileUrl.trim() || form.accessToken.trim() || form.apiKey.trim();

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: '20px', fontFamily: C.font }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Ico ti="ti-share" size={16} color={C.brand} />
        <h3 style={{ fontSize: 14, fontWeight: 700, color: C.ink, margin: 0 }}>Social Platforms</h3>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {state === null
          ? [0, 1, 2].map((i) => <Skeleton key={i} height={44} />)
          : state.map((p) => {
            const meta = SOCIAL_META[p.platform] ?? { label: p.platform, color: C.muted, Icon: Share2, ti: 'ti-share' };
            const Icon = meta.Icon;
            return (
              <div key={p.platform} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 12 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: tint(8, meta.color), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Ico lucide={Icon} ti={meta.ti} size={15} color={meta.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>{meta.label}</div>
                  <div style={{ fontSize: 10.5, color: p.connected ? GREEN : C.muted, display: 'flex', alignItems: 'center', gap: 3 }}>
                    {p.connected && <Ico ti="ti-circle-check" size={10} />}{p.connected ? 'Connected' : 'Not connected'}
                  </div>
                </div>
                {p.connected ? (
                  <Btn size="sm" variant="ghost" disabled={busy === p.platform} onClick={() => disconnect(p)} style={{ color: C.muted }}>
                    {busy === p.platform ? '…' : 'Disconnect'}
                  </Btn>
                ) : (
                  <Btn size="sm" variant="outline" onClick={() => { resetForm(); setConnectFor(p.platform); }}>Connect</Btn>
                )}
              </div>
            );
          })}
      </div>

      <Modal open={!!connectFor} onClose={() => { setConnectFor(null); resetForm(); }}
        title={`Connect ${SOCIAL_META[connectFor]?.label ?? ''}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 12.5, color: C.muted, margin: 0, fontFamily: C.font, lineHeight: 1.5 }}>
            Store your {SOCIAL_META[connectFor]?.label ?? 'account'} credentials so the school can post and generate
            content later. Fill in what you have — everything is optional and stored securely.
          </p>
          <Inp label={connectFor === 'facebook' ? 'Page URL' : 'Profile URL'} value={form.profileUrl}
            onChange={(e) => setForm((f) => ({ ...f, profileUrl: e.target.value }))}
            placeholder={
              connectFor === 'facebook'  ? 'https://facebook.com/yourschool'
              : connectFor === 'instagram' ? 'https://instagram.com/yourschool'
              : connectFor === 'twitter'   ? 'https://x.com/yourschool'
              : 'https://tiktok.com/@yourschool'
            } />
          <Inp label="Access token" value={form.accessToken}
            onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))} placeholder="Paste access token" />
          <Inp label={connectFor === 'facebook' || connectFor === 'instagram' ? 'App ID (optional)' : 'API key (optional)'} value={form.apiKey}
            onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder="Optional" />
          <Inp label="API secret (optional)" value={form.apiSecret}
            onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value }))} placeholder="Optional" />
          <Inp label={connectFor === 'facebook' ? 'Page ID (optional)' : 'Account ID (optional)'} value={form.accountId}
            onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))} placeholder="Optional" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn variant="secondary" onClick={() => { setConnectFor(null); resetForm(); }}>Cancel</Btn>
            <Btn onClick={submit} disabled={busy === connectFor || !hasInput}>{busy === connectFor ? 'Saving…' : 'Save credentials'}</Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export { MOCK_STATS, STREAM_META, SOCIAL_META, MOCK_PROFILE, MOCK_SESSIONS, StatCard, SessionItem, QuickAction, PLATFORM_KEYS, STREAM_ERRORS, StreamingPanel, SocialPanel };
