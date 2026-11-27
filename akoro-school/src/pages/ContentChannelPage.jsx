/**
 * ContentChannelPage — dedicated page for one social channel (opened from the
 * Content hub's External Channels cards). Connect via OAuth (one-click) or by
 * pasting credentials manually. Reuses the /api/instructor/social storage.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Facebook, Instagram, Twitter, Music2 } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { Btn, Inp } from '../components/Primitives.jsx';
import { apiGet, apiPost, apiDelete, API } from '../services/api.js';
import { GREEN, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

const META = {
  facebook:  { label: 'Facebook',    color: '#1877F2', Icon: Facebook, ti: 'ti-brand-facebook',  handle: 'Page URL' },
  instagram: { label: 'Instagram',   color: '#E4405F', Icon: Instagram, ti: 'ti-brand-instagram', handle: 'Profile URL' },
  twitter:   { label: 'X (Twitter)', color: '#0F1419', Icon: Twitter, ti: 'ti-brand-twitter',   handle: 'Profile URL' },
  tiktok:    { label: 'TikTok',      color: '#010101', Icon: Music2, ti: 'ti-music',     handle: 'Profile URL' },
};
const GUIDE = {
  facebook:  ['Connect authorizes Akoro to publish to your Facebook Page.', 'Manual: paste a Page access token from Meta Business settings.'],
  instagram: ['Instagram publishing works through a linked Facebook Page / Business account.', 'Manual: paste your Instagram Graph API access token.'],
  twitter:   ['Connect authorizes Akoro to post to your X account.', 'Manual: paste your API key, secret and access token from the X developer portal.'],
  tiktok:    ['Connect authorizes Akoro to publish to your TikTok account.', 'Manual: paste an access token from the TikTok developer portal.'],
};

export default function ContentChannelPage() {
  const { platform } = useParams();
  const navigate = useNavigate();
  const meta = META[platform];

  const [status, setStatus] = useState(null);   // { connected, profile_url }
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({ profileUrl: '', accessToken: '', apiKey: '', apiSecret: '', accountId: '' });
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(async () => {
    const r = await apiGet('/api/instructor/social');
    const row = (r?.data ?? []).find((x) => x.platform === platform);
    setStatus(row || { platform, connected: false });
  }, [platform]);

  // Handle OAuth return (?connected= / ?social_error=), then load status.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected')) showToast(`${meta?.label ?? platform} connected ✓`);
    if (params.get('social_error')) showToast(`Couldn't connect: ${params.get('social_error').replace(/_/g, ' ')}`);
    if (params.get('connected') || params.get('social_error')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    load().catch(() => setStatus({ platform, connected: false }));
  }, [load, meta, platform]);

  if (!meta) {
    return <PageLayout title="Channel"><p style={{ fontFamily: C.font, color: C.muted }}>Unknown channel.</p></PageLayout>;
  }

  // ?portal=school lets the API read the school session cookie (a full-page
  // navigation to the OAuth endpoint can't send the X-Akoro-Portal header).
  const startOAuth = () => { window.location.href = `${API}/api/school/social/auth/${platform}?portal=school`; };

  const saveManual = async () => {
    setBusy(true);
    try {
      await apiPost('/api/instructor/social/connect', {
        platform,
        profileUrl:  form.profileUrl.trim() || null,
        accessToken: form.accessToken.trim() || null,
        apiKey:      form.apiKey.trim() || null,
        apiSecret:   form.apiSecret.trim() || null,
        accountId:   form.accountId.trim() || null,
      });
      showToast(`${meta.label} connected ✓`); setManual(false); load();
    } catch (e) { showToast(e.message || 'Could not save credentials'); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    setBusy(true);
    try { await apiDelete(`/api/instructor/social/${platform}`); showToast(`${meta.label} disconnected`); load(); }
    catch (e) { showToast(e.message || 'Could not disconnect'); }
    finally { setBusy(false); }
  };

  const connected = !!status?.connected;
  const hasInput = form.profileUrl.trim() || form.accessToken.trim() || form.apiKey.trim();

  return (
    <PageLayout title={meta.label} subtitle="Connect this channel to publish content later">
      <div style={{ maxWidth: 640 }}>
        <BackButton onClick={() => navigate('/content?tab=channels')} label="Back to channels" />

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '22px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: tint(8, meta.color), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ico lucide={meta.Icon} ti={meta.ti} size={24} color={meta.color} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{meta.label}</div>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2, color: connected ? GREEN : C.muted, display: 'flex', alignItems: 'center', gap: 4, fontFamily: C.font }}>
                {status === null ? <Ico ti="ti-loader-2" size={12} style={{ animation: 'spin .8s linear infinite' }} /> : connected ? <><Ico ti="ti-circle-check" size={12} /> Connected</> : 'Not connected'}
              </div>
            </div>
            {connected && <Btn variant="ghost" onClick={disconnect} disabled={busy} style={{ color: C.muted }}>Disconnect</Btn>}
          </div>

          {!connected && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: manual ? 18 : 0 }}>
                <button onClick={startOAuth} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 20px', borderRadius: 10, border: 'none', background: meta.color, color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                  <Ico ti="ti-link" size={15} /> Connect with {meta.label}
                </button>
                <button onClick={() => setManual((m) => !m)} style={{ padding: '11px 20px', borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: C.font }}>
                  {manual ? 'Hide manual' : 'Enter credentials manually'}
                </button>
              </div>

              {manual && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
                  <Inp label={meta.handle} value={form.profileUrl} onChange={(e) => setForm((f) => ({ ...f, profileUrl: e.target.value }))} placeholder={`https://…`} />
                  <Inp label="Access token" value={form.accessToken} onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))} placeholder="Paste access token" />
                  {platform === 'twitter' && (
                    <>
                      <Inp label="API key (optional)" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder="Optional" />
                      <Inp label="API secret (optional)" value={form.apiSecret} onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value }))} placeholder="Optional" />
                    </>
                  )}
                  <Inp label="Account / Page ID (optional)" value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))} placeholder="Optional" />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Btn onClick={saveManual} disabled={busy || !hasInput}>{busy ? 'Saving…' : 'Save credentials'}</Btn>
                  </div>
                </div>
              )}
            </>
          )}

          {connected && status?.profile_url && (
            <div style={{ fontSize: 12.5, color: C.muted, fontFamily: C.font }}>Linked: <a href={status.profile_url} target="_blank" rel="noreferrer" style={{ color: BLUE }}>{status.profile_url}</a></div>
          )}
        </div>

        {/* Quick guide */}
        <div style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}22`, borderRadius: 14, padding: '14px 15px', marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <Ico ti="ti-book" size={15} color={BLUE} />
            <span style={{ fontSize: 12.5, fontWeight: 800, color: BLUE, fontFamily: C.font }}>Quick Guide</span>
          </div>
          {(GUIDE[platform] || []).map((g, i) => (
            <p key={i} style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, margin: i === 0 ? 0 : '8px 0 0', fontFamily: C.font }}>{g}</p>
          ))}
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
