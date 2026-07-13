import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Code2, ExternalLink, Power, Paintbrush, Loader2, RefreshCw } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPut, API } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, FONT } from '../constants.js';

function Card({ icon: Icon, iconColor, title, children }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 20px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
        <Icon size={16} color={iconColor || AMBER} />
        <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}>
      <span style={{ display: 'inline-block', width: 42, height: 24, borderRadius: 999, background: on ? GREEN : '#D8D5CE', position: 'relative', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: WHITE, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
      </span>
    </button>
  );
}

const linkBtn = (color) => ({ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${color}55`, background: `${color}0C`, color, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT });

export default function SchoolWebsitePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [enabledSaving, setEnabledSaving] = useState(false);
  const [sync, setSync] = useState(false);
  const [syncSaving, setSyncSaving] = useState(false);
  const [slug, setSlug] = useState('');
  const [siteUrl, setSiteUrl] = useState('');       // public wildcard/custom-domain URL

  useEffect(() => {
    apiGet('/api/school/website').then((r) => {
      const d = r.data || {};
      setSlug(d.slug || '');
      setSiteUrl(d.siteUrl || '');
      setEnabled(!!d.enabled);
      setSync(!!d.syncSchoolInfo);
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

  return (
    <PageLayout title="School Website" subtitle="Publish your website and jump into the builder">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/website-builder/appearance')} style={linkBtn(AMBER)}><Paintbrush size={14} /> Appearance</button>
        <button onClick={() => navigate('/settings-website/templates')} style={linkBtn(BLUE)}><Code2 size={14} /> Templates</button>
        {/* Published → open the real public URL (wildcard/custom domain).
            Unpublished → API preview route so it renders before going live. */}
        <button onClick={() => (enabled && siteUrl) ? window.open(siteUrl, '_blank', 'noopener') : slug && window.open(`${API}/api/school/site/${slug}?preview=1`, '_blank', 'noopener')} disabled={!slug} title={enabled ? 'Opens your live website' : 'Preview even before publishing'} style={{ ...linkBtn(GREEN), cursor: slug ? 'pointer' : 'not-allowed', opacity: slug ? 1 : 0.6 }}>
          <ExternalLink size={14} /> {enabled ? 'Open Website' : 'Preview Website'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /> Loading…
        </div>
      ) : (
        <>
          <Card icon={Power} iconColor={GREEN} title="Enable School Website">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
              <p style={{ fontSize: 12.5, color: MUTED, margin: 0, fontFamily: FONT, lineHeight: 1.6, maxWidth: 480 }}>
                When enabled, visitors to your domain see your public website instead of the login page.
                <span style={{ display: 'block', marginTop: 4, color: MUTED2, fontSize: 11.5 }}>This switch saves instantly — no need to press Save.</span>
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {enabledSaving && <Loader2 size={15} color={MUTED2} style={{ animation: 'spin .8s linear infinite' }} />}
                <Toggle on={enabled} onChange={toggleEnabled} />
              </div>
            </div>
          </Card>

          <Card icon={RefreshCw} iconColor={BLUE} title="Sync with School Settings">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
              <p style={{ fontSize: 12.5, color: MUTED, margin: 0, fontFamily: FONT, lineHeight: 1.6, maxWidth: 480 }}>
                When enabled, your website's identity — school name, logo, address, phone, principal and contact email —
                always follows <b>Settings → School Profile</b>. Change it there and the website updates automatically.
                <span style={{ display: 'block', marginTop: 4, color: MUTED2, fontSize: 11.5 }}>
                  While on, the hero and browser titles use your school name (custom titles set in Appearance are ignored). Saves instantly.
                </span>
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {syncSaving && <Loader2 size={15} color={MUTED2} style={{ animation: 'spin .8s linear infinite' }} />}
                <Toggle on={sync} onChange={toggleSync} />
              </div>
            </div>
          </Card>

          <Card icon={Globe} iconColor={BLUE} title="Your Website Address">
            <p style={{ fontSize: 13, color: INK, margin: 0, fontFamily: FONT }}>
              {siteUrl ? <a href={siteUrl} target="_blank" rel="noreferrer" style={{ color: BLUE, fontWeight: 700 }}>{siteUrl.replace(/^https?:\/\//, '')}</a> : '—'}
            </p>
            <p style={{ fontSize: 11.5, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>Your free subdomain. Add a custom domain in Settings → Domain.</p>
          </Card>

          <Card icon={Paintbrush} iconColor={AMBER} title="Edit your website">
            <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 14px', fontFamily: FONT, lineHeight: 1.6 }}>
              All website editing now lives in the <b>Website Builder</b> — design the home page and global look in <b>Appearance</b>, write content in <b>Pages</b>, and build navigation in <b>Menus</b>.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => navigate('/website-builder/appearance')} style={linkBtn(AMBER)}><Paintbrush size={14} /> Appearance</button>
              <button onClick={() => navigate('/website-builder/pages')} style={linkBtn(BLUE)}>Pages</button>
              <button onClick={() => navigate('/website-builder/menus')} style={linkBtn(GREEN)}>Menus</button>
            </div>
          </Card>
        </>
      )}
    </PageLayout>
  );
}
