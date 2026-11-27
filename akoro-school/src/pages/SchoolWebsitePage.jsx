import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Power, Paintbrush, RefreshCw, Bot } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPut, API } from '../services/api.js';
import { GREEN, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

function Card({ icon: Icon, ti, iconColor, title, children }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
        <Ico lucide={Icon} ti={ti} size={16} color={iconColor || C.brand} />
        <span style={{ fontSize: 13.5, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}>
      <span style={{ display: 'inline-block', width: 42, height: 24, borderRadius: 999, background: on ? GREEN : C.borderSoft, position: 'relative', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: C.surface, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
      </span>
    </button>
  );
}

const linkBtn = (color) => ({ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${color}55`, background: tint(5, color), color, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font });

export default function SchoolWebsitePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [enabledSaving, setEnabledSaving] = useState(false);
  const [sync, setSync] = useState(false);
  const [syncSaving, setSyncSaving] = useState(false);
  const [aiBot, setAiBot] = useState(false);
  const [aiBotSaving, setAiBotSaving] = useState(false);
  const [slug, setSlug] = useState('');
  const [siteUrl, setSiteUrl] = useState('');       // public wildcard/custom-domain URL

  useEffect(() => {
    apiGet('/api/school/website').then((r) => {
      const d = r.data || {};
      setSlug(d.slug || '');
      setSiteUrl(d.siteUrl || '');
      setEnabled(!!d.enabled);
      setSync(!!d.syncSchoolInfo);
      setAiBot(!!d.aiChatEnabled);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Publish toggle saves instantly (partial update — only `enabled`).
  const toggleEnabled = async (val) => {
    setEnabled(val);
    setEnabledSaving(true);
    try { await apiPut('/api/school/website', { enabled: val }); }
    catch { setEnabled(!val); }
    finally { setEnabledSaving(false); }
  };

  // Sync toggle saves instantly too (partial update — only `syncSchoolInfo`).
  const toggleSync = async (val) => {
    setSync(val);
    setSyncSaving(true);
    try { await apiPut('/api/school/website', { syncSchoolInfo: val }); }
    catch { setSync(!val); }
    finally { setSyncSaving(false); }
  };

  // Sync AI Bot: adds the chat widget to every site page + an "AI Chat" page;
  // turning it off removes the widget and trashes the page.
  const toggleAiBot = async (val) => {
    setAiBot(val);
    setAiBotSaving(true);
    try { await apiPut('/api/school/website', { aiChatEnabled: val }); }
    catch { setAiBot(!val); }
    finally { setAiBotSaving(false); }
  };

  return (
    <PageLayout title="School Website" subtitle="Publish your website and jump into the builder">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/website-builder/appearance')} style={linkBtn(C.brand)}><Ico ti="ti-brush" size={14} /> Appearance</button>
        <button onClick={() => navigate('/settings-website/templates')} style={linkBtn(BLUE)}><Ico ti="ti-code" size={14} /> Templates</button>
        {/* Published → open the real public URL (wildcard/custom domain).
            Unpublished → API preview route so it renders before going live. */}
        <button onClick={() => (enabled && siteUrl) ? window.open(siteUrl, '_blank', 'noopener') : slug && window.open(`${API}/api/school/site/${slug}?preview=1`, '_blank', 'noopener')} disabled={!slug} title={enabled ? 'Opens your live website' : 'Preview even before publishing'} style={{ ...linkBtn(GREEN), cursor: slug ? 'pointer' : 'not-allowed', opacity: slug ? 1 : 0.6 }}>
          <Ico ti="ti-external-link" size={14} /> {enabled ? 'Open Website' : 'Preview Website'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: C.muted2, fontFamily: C.font, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Ico ti="ti-loader-2" size={22} style={{ animation: 'spin .8s linear infinite' }} /> Loading…
        </div>
      ) : (
        <>
          <Card icon={Power} ti="ti-power" iconColor={GREEN} title="Enable School Website">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
              <p style={{ fontSize: 12.5, color: C.muted, margin: 0, fontFamily: C.font, lineHeight: 1.6, maxWidth: 480 }}>
                When enabled, visitors to your domain see your public website instead of the login page.
                <span style={{ display: 'block', marginTop: 4, color: C.muted2, fontSize: 11.5 }}>This switch saves instantly — no need to press Save.</span>
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {enabledSaving && <Ico ti="ti-loader-2" size={15} color={C.muted2} style={{ animation: 'spin .8s linear infinite' }} />}
                <Toggle on={enabled} onChange={toggleEnabled} />
              </div>
            </div>
          </Card>

          <Card icon={RefreshCw} ti="ti-refresh" iconColor={BLUE} title="Sync with School Settings">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
              <p style={{ fontSize: 12.5, color: C.muted, margin: 0, fontFamily: C.font, lineHeight: 1.6, maxWidth: 480 }}>
                When enabled, your website's identity — school name, logo, address, phone, principal and contact email —
                always follows <b>Settings → School Profile</b>. Change it there and the website updates automatically.
                <span style={{ display: 'block', marginTop: 4, color: C.muted2, fontSize: 11.5 }}>
                  While on, the hero and browser titles use your school name (custom titles set in Appearance are ignored). Saves instantly.
                </span>
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {syncSaving && <Ico ti="ti-loader-2" size={15} color={C.muted2} style={{ animation: 'spin .8s linear infinite' }} />}
                <Toggle on={sync} onChange={toggleSync} />
              </div>
            </div>
          </Card>

          <Card icon={Bot} ti="ti-robot" iconColor="#7C3AED" title="Sync AI Bot">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
              <p style={{ fontSize: 12.5, color: C.muted, margin: 0, fontFamily: C.font, lineHeight: 1.6, maxWidth: 480 }}>
                When enabled, an AI chat bubble appears on the bottom-right of <b>every page</b> of your public website,
                and an <b>AI Chat</b> page is added to your site. Students, teachers and admins sign in through the
                widget and are taken to the school's AI Chat.
                <span style={{ display: 'block', marginTop: 4, color: C.muted2, fontSize: 11.5 }}>Turning it off removes the widget and moves the AI Chat page to Trash. Saves instantly.</span>
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {aiBotSaving && <Ico ti="ti-loader-2" size={15} color={C.muted2} style={{ animation: 'spin .8s linear infinite' }} />}
                <Toggle on={aiBot} onChange={toggleAiBot} />
              </div>
            </div>
          </Card>

          <Card icon={Globe} ti="ti-world" iconColor={BLUE} title="Your Website Address">
            <p style={{ fontSize: 13, color: C.ink, margin: 0, fontFamily: C.font }}>
              {siteUrl ? <a href={siteUrl} target="_blank" rel="noreferrer" style={{ color: BLUE, fontWeight: 700 }}>{siteUrl.replace(/^https?:\/\//, '')}</a> : '—'}
            </p>
            <p style={{ fontSize: 11.5, color: C.muted2, margin: '6px 0 0', fontFamily: C.font }}>Your free subdomain. Add a custom domain in Settings → Domain.</p>
          </Card>

          <Card icon={Paintbrush} ti="ti-brush" iconColor={C.brand} title="Edit your website">
            <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 14px', fontFamily: C.font, lineHeight: 1.6 }}>
              All website editing now lives in the <b>Website Builder</b> — design the home page and global look in <b>Appearance</b>, write content in <b>Pages</b>, and build navigation in <b>Menus</b>.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => navigate('/website-builder/appearance')} style={linkBtn(C.brand)}><Ico ti="ti-brush" size={14} /> Appearance</button>
              <button onClick={() => navigate('/website-builder/pages')} style={linkBtn(BLUE)}>Pages</button>
              <button onClick={() => navigate('/website-builder/menus')} style={linkBtn(GREEN)}>Menus</button>
            </div>
          </Card>
        </>
      )}
    </PageLayout>
  );
}
