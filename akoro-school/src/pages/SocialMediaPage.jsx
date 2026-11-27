import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Facebook, Instagram, Megaphone, Calendar, Image } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiGet, apiPatch } from '../services/api.js';
import { GREEN, RED, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
const BRAND = C.brand;

const PROVIDER_META = {
  facebook:  { icon: Facebook, ti: 'ti-brand-facebook',  color: '#1877F2' },
  instagram: { icon: Instagram, ti: 'ti-brand-instagram', color: '#E1306C' },
};

const CONTENT_TYPES = [
  { key: 'notices',  label: 'School Notices',  icon: Megaphone, ti: 'ti-speakerphone', fb: 'Text Post',    ig: '— Text only — no image' },
  { key: 'events',   label: 'Events & Holidays', icon: Calendar, ti: 'ti-calendar', fb: 'Text Post',  ig: '— Text only — no image' },
  { key: 'gallery',  label: 'Gallery Albums',  icon: Image, ti: 'ti-photo', fb: 'Photo Post',   ig: 'Photo Post' },
];

function StepList() {
  const steps = [
    ['Step 1:', 'Click “Connect with Facebook” to authorize your school’s Facebook Page.'],
    ['Step 2:', 'Log in with the Facebook account that manages your school’s Page.'],
    ['Step 3:', 'Grant all requested permissions (Page management, posting, etc.).'],
    ['Step 4:', 'Select the Facebook Page to connect if you manage multiple pages.'],
    ['Step 5:', 'Done! When creating notices, events, or uploading gallery photos, you’ll see checkboxes to auto-post to social media.'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {steps.map(([label, text]) => (
        <p key={label} style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: 0, fontFamily: C.font }}>
          <b style={{ color: C.ink }}>{label}</b> {text}
        </p>
      ))}
    </div>
  );
}

export default function SocialMediaPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [busyId, setBusyId]     = useState(null);
  const [toast, setToast]       = useState('');

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    apiGet('/api/school/social-accounts')
      .then((res) => setAccounts(res.data || []))
      .catch((e) => showToast(e.message || 'Could not load social accounts'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (acc) => {
    setBusyId(acc.id);
    try {
      await apiPatch(`/api/school/social-accounts/${acc.id}`, { active: !acc.active });
      setAccounts((prev) => prev.map((a) => (a.id === acc.id ? { ...a, active: !a.active } : a)));
      showToast(acc.active ? 'Disconnected' : 'Reconnected ✓');
    } catch (e) { showToast(e.message || 'Could not update'); }
    finally { setBusyId(null); }
  };

  const btn = (bg, color = C.surface) => ({
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9,
    border: 'none', background: bg, color, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font,
  });

  return (
    <PageLayout title="Social Media Autopost" subtitle="Connect and manage your school's social accounts">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <BackButton onClick={() => navigate('/settings-notifications')} label="Back to Notifications" />
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Main column */}
        <div style={{ flex: '2 1 420px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Connected accounts */}
          <div style={{ background: C.surface, border: `1.5px solid ${GREEN}44`, borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Ico ti="ti-circle-check" size={16} color={GREEN} />
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Connected Accounts</span>
            </div>

            {loading ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: C.muted2, fontSize: 12.5, fontFamily: C.font }}><Ico ti="ti-loader-2" size={16} style={{ animation: 'spin .8s linear infinite' }} /></div>
            ) : accounts.length === 0 ? (
              <div style={{ padding: '18px', border: `1.5px dashed ${C.border}`, borderRadius: 10, textAlign: 'center', color: C.muted2, fontSize: 12.5, fontFamily: C.font, marginBottom: 16 }}>
                No social accounts connected yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {accounts.map((a) => {
                  const meta = PROVIDER_META[a.provider] || PROVIDER_META.facebook;
                  return (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 14px', flexWrap: 'wrap' }}>
                      <div style={{ width: 34, height: 34, borderRadius: 8, background: tint(8, meta.color), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Ico lucide={meta.icon} ti={meta.ti} size={16} color={meta.color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <p style={{ fontSize: 13, fontWeight: 800, color: C.ink, margin: 0, fontFamily: C.font }}>{a.pageName}</p>
                        <p style={{ fontSize: 11, color: C.muted2, margin: '2px 0 0', fontFamily: C.font }}>{a.provider === 'instagram' ? 'IG User ID' : 'Page ID'}: {a.pageId}</p>
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 8, background: a.active ? `${GREEN}15` : `${RED}12`, color: a.active ? GREEN : RED, fontSize: 11.5, fontWeight: 800, fontFamily: C.font }}>
                        <Ico ti="ti-circle-check" size={12} /> {a.active ? 'Active' : 'Disconnected'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {accounts[0] && (
              <p style={{ fontSize: 11, color: C.muted2, margin: '0 0 14px', fontFamily: C.font }}>
                Connected: {new Date(accounts[0].connectedAt).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {accounts[0].expiresAt && <> &nbsp;|&nbsp; Token expires: {new Date(accounts[0].expiresAt).toLocaleDateString()}</>}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {accounts.map((a) => (
                <button key={a.id} onClick={() => toggleActive(a)} disabled={busyId === a.id} style={btn(a.active ? RED : GREEN)}>
                  {busyId === a.id ? <Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> : a.active ? <Ico ti="ti-circle-x" size={13} /> : <Ico ti="ti-refresh" size={13} />}
                  {a.active ? `Disconnect ${a.provider === 'instagram' ? 'Instagram' : 'Facebook'}` : `Reconnect ${a.provider === 'instagram' ? 'Instagram' : 'Facebook'}`}
                </button>
              ))}
              <button style={btn('#0EA5E9')}><Ico ti="ti-send" size={13} /> Send Test Post</button>
            </div>
          </div>

          {/* Autopost behavior */}
          <div style={{ background: C.surface, border: `1.5px solid ${BLUE}33`, borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ display: 'flex' }}><Ico ti="ti-robot" size={15} /></span>
              <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Autopost Behavior</span>
            </div>
            <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 14px', lineHeight: 1.6, fontFamily: C.font }}>
              When creating content, you’ll see checkboxes to cross-post to your social media accounts. The following content types support autopost:
            </p>

            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: C.font }}>
                <thead>
                  <tr style={{ background: C.bg }}>
                    <th style={{ textAlign: 'left', padding: '9px 10px', fontSize: 11.5, fontWeight: 800, color: C.muted2 }}>Content Type</th>
                    <th style={{ textAlign: 'left', padding: '9px 10px', fontSize: 11.5, fontWeight: 800, color: C.muted2 }}>Facebook</th>
                    <th style={{ textAlign: 'left', padding: '9px 10px', fontSize: 11.5, fontWeight: 800, color: C.muted2 }}>Instagram</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTENT_TYPES.map((c) => (
                    <tr key={c.key} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '9px 10px', fontSize: 12.5, color: C.ink, fontWeight: 600 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Ico lucide={c.icon} ti={c.ti} size={13} color={BRAND} /> {c.label}</span></td>
                      <td style={{ padding: '9px 10px', fontSize: 12, color: GREEN, fontWeight: 700 }}>✓ {c.fb}</td>
                      <td style={{ padding: '9px 10px', fontSize: 12, color: c.ig.startsWith('—') ? C.muted2 : GREEN, fontWeight: c.ig.startsWith('—') ? 500 : 700 }}>{c.ig.startsWith('—') ? c.ig : `✓ ${c.ig}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', gap: 9, background: `${BLUE}08`, border: `1px solid ${BLUE}22`, borderRadius: 10, padding: '11px 13px' }}>
              <Ico ti="ti-info-circle" size={14} color={BLUE} style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: C.ink, margin: 0, lineHeight: 1.55, fontFamily: C.font }}>
                Instagram requires an image. Text-only content (notices, events) will only be posted to Facebook. Gallery albums with a cover image will post to both.
              </p>
            </div>
          </div>
        </div>

        {/* Setup guide sidebar */}
        <div style={{ flex: '1 1 260px', minWidth: 260, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ background: BLUE, borderRadius: '14px 14px 0 0', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Ico ti="ti-info-circle" size={15} color="#fff" />
            <span style={{ fontSize: 13, fontWeight: 800, color: '#fff', fontFamily: C.font }}>Setup Guide</span>
          </div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '16px 16px 18px', marginTop: -14 }}>
            <StepList />
            <div style={{ height: 1, background: C.border, margin: '16px 0' }} />
            <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, margin: 0, fontFamily: C.font }}>
              <b style={{ color: C.ink, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Ico ti="ti-camera" size={13} /> Instagram:</b> Your Facebook Page must have a linked <a href="#" style={{ color: C.brand, fontWeight: 700, textDecoration: 'none' }}>Instagram Business Account</a> for IG posting to work.
            </p>
          </div>

          <div style={{ background: tint(5), border: `1px solid ${tint(20)}`, borderLeft: `3px solid ${C.brand}`, borderRadius: 10, padding: '13px 15px', display: 'flex', gap: 9 }}>
            <Ico ti="ti-shield-check" size={15} color={C.brand} style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, margin: 0, fontFamily: C.font }}>
              <b style={{ color: C.ink }}>Security:</b> Your tokens are encrypted at rest. Only this school’s admin can manage the connection. Tokens auto-refresh before expiry.
            </p>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
