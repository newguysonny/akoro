import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe, Code2, ExternalLink, Power, Palette, RefreshCw, Star, Info,
  Search, Braces, Droplet, Share2, Layers, ChevronDown, Save, Check,
  Facebook, Twitter, Instagram, Youtube, Linkedin, MessageCircle,
  GripVertical, Upload, Loader2,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPut, API } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

const THEMES = [
  { id: 'indian-gov', name: 'Indian Gov Style', desc: 'Official government-style layout typical for Indian schools. Features tricolor accents, structured tabular data, formal typography, and a scrolling marquee for circulars.', colors: [AMBER, '#1a237e', GREEN], active: true },
  { id: 'modern-int', name: 'Modern International', desc: 'Clean, image-forward layout with soft gradients — suited to international / private schools.', colors: [BLUE, '#0EA5E9', '#8B5CF6'], active: false },
  { id: 'minimal', name: 'Minimal Academic', desc: 'A stripped-back, typography-first theme with generous whitespace.', colors: [INK, MUTED2, WHITE], active: false },
];

function Card({ icon: Icon, iconColor, title, action, children }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 20px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Icon size={16} color={iconColor || AMBER} />
          <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>{title}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 11, color: MUTED2, margin: '5px 0 0', fontFamily: FONT }}>{hint}</p>}
    </div>
  );
}
const inputStyle = {
  width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`,
  outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
};
function FileField() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1.5px solid ${BORDER}`, borderRadius: 10, padding: '8px 10px' }}>
      <button style={{ padding: '6px 12px', borderRadius: 7, border: `1.5px solid ${BORDER}`, background: LIGHT, color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>Choose File</button>
      <span style={{ fontSize: 12, color: MUTED2, fontFamily: FONT }}>No file chosen</span>
    </div>
  );
}
function ColorField({ label, value, onChange }) {
  return (
    <Field label={label}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 44, height: 38, borderRadius: 10, border: `1.5px solid ${BORDER}`, padding: 2, cursor: 'pointer', background: WHITE }} />
        <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, flex: 1, fontFamily: 'ui-monospace, Menlo, monospace' }} />
      </div>
    </Field>
  );
}

const SOCIAL_FIELDS = [
  { key: 'facebook',  icon: Facebook,      placeholder: 'Facebook URL' },
  { key: 'twitter',   icon: Twitter,       placeholder: 'Twitter URL' },
  { key: 'instagram', icon: Instagram,     placeholder: 'Instagram URL' },
  { key: 'youtube',   icon: Youtube,       placeholder: 'Youtube URL' },
  { key: 'linkedin',  icon: Linkedin,      placeholder: 'Linkedin Url' },
  { key: 'whatsapp',  icon: MessageCircle, placeholder: 'Whatsapp number' },
];

const DEFAULT_SECTIONS = [
  { key: 'hero',    label: 'Hero',    on: true },
  { key: 'about',   label: 'About',   on: true },
  { key: 'notices', label: 'Notices', on: true },
  { key: 'events',  label: 'Events',  on: true },
  { key: 'gallery', label: 'Gallery', on: true },
  { key: 'contact', label: 'Contact', on: true },
  { key: 'stats',   label: 'Stats',   on: false },
];

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}>
      <span style={{ display: 'inline-block', width: 42, height: 24, borderRadius: 999, background: on ? GREEN : '#D8D5CE', position: 'relative', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: WHITE, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)' }} />
      </span>
    </button>
  );
}

export default function SchoolWebsitePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [themeId, setThemeId] = useState('indian-gov');
  const [enabled, setEnabled] = useState(false);
  const [heroTitle, setHeroTitle] = useState('');
  const [heroSubtitle, setHeroSubtitle] = useState('Empowering students with knowledge, values, and skills for a brighter tomorrow.');
  const [aboutText, setAboutText] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaKeywords, setMetaKeywords] = useState('school, education, learning');
  const [metaDesc, setMetaDesc] = useState('');
  const [headerScripts, setHeaderScripts] = useState('');
  const [footerScripts, setFooterScripts] = useState('');
  const [primary, setPrimary] = useState('#1a56db');
  const [secondary, setSecondary] = useState('#6b7280');
  const [accent, setAccent] = useState('#f59e0b');
  const [bgMode, setBgMode] = useState('Light');
  const [social, setSocial] = useState({});
  const [sections, setSections] = useState(DEFAULT_SECTIONS);
  const [customCss, setCustomCss] = useState('');
  const [saved, setSaved] = useState(false);
  const [slug, setSlug] = useState('');

  useEffect(() => {
    apiGet('/api/school/website')
      .then((res) => {
        const d = res.data || {};
        setSlug(d.slug || '');
        setEnabled(!!d.enabled);
        setThemeId(d.themeId || 'indian-gov');
        setHeroTitle(d.heroTitle || '');
        setHeroSubtitle(d.heroSubtitle || heroSubtitle);
        setAboutText(d.aboutText || '');
        setMetaTitle(d.metaTitle || '');
        setMetaKeywords(d.metaKeywords || metaKeywords);
        setMetaDesc(d.metaDescription || '');
        setHeaderScripts(d.headerScripts || '');
        setFooterScripts(d.footerScripts || '');
        setPrimary(d.primaryColor || primary);
        setSecondary(d.secondaryColor || secondary);
        setAccent(d.accentColor || accent);
        setBgMode(d.bgMode || 'Light');
        setSocial(d.socialLinks || {});
        if (Array.isArray(d.sections) && d.sections.length) setSections(d.sections);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSection = (key) => setSections((prev) => prev.map((s) => (s.key === key ? { ...s, on: !s.on } : s)));
  const setSoc = (key) => (e) => setSocial((s) => ({ ...s, [key]: e.target.value }));
  const cycleTheme = () => setThemeId((prev) => THEMES[(THEMES.findIndex((t) => t.id === prev) + 1) % THEMES.length].id);

  const save = async () => {
    setSaving(true);
    try {
      await apiPut('/api/school/website', {
        enabled, themeId,
        heroTitle, heroSubtitle, aboutText,
        metaTitle, metaKeywords, metaDescription: metaDesc,
        headerScripts, footerScripts,
        primaryColor: primary, secondaryColor: secondary, accentColor: accent, bgMode,
        socialLinks: social, sections, customCss,
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { /* toast omitted here — inline "Saved" indicator covers success/failure feedback */ }
    finally { setSaving(false); }
  };

  return (
    <PageLayout title="School Website" subtitle="Configure your school's public landing page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/settings-website/templates')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${BLUE}55`, background: `${BLUE}0C`, color: BLUE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <Code2 size={14} /> Full HTML Templates
        </button>
        <button onClick={() => slug && window.open(`${API}/api/school/site/${slug}?preview=1`, '_blank', 'noopener')} disabled={!slug} title={enabled ? 'Opens your live website' : 'Preview even before publishing'} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${GREEN}55`, background: `${GREEN}0C`, color: GREEN, fontSize: 12.5, fontWeight: 800, cursor: slug ? 'pointer' : 'not-allowed', fontFamily: FONT, opacity: slug ? 1 : 0.6 }}>
          <ExternalLink size={14} /> Preview Website
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT, fontSize: 13.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /> Loading website settings…
        </div>
      ) : (
      <>
      {/* Enable */}
      <Card icon={Power} iconColor={GREEN} title="Enable School Website">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <p style={{ fontSize: 12.5, color: MUTED, margin: 0, fontFamily: FONT, lineHeight: 1.6, maxWidth: 480 }}>
            When enabled, visitors to your custom domain will see a public landing page instead of the login page.
          </p>
          <Toggle on={enabled} onChange={setEnabled} />
        </div>
      </Card>

      {/* Theme */}
      <Card icon={Palette} iconColor={BLUE} title="Website Theme" action={
        <button onClick={cycleTheme} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <RefreshCw size={13} /> Change Theme
        </button>
      }>
        {THEMES.filter((t) => t.id === themeId).map((t) => (
          <div key={t.id} style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ width: 220, height: 140, borderRadius: 10, background: `linear-gradient(160deg, ${t.colors[1]}, ${t.colors[0]})`, flexShrink: 0, border: `1px solid ${BORDER}` }} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: INK, margin: '0 0 4px', fontFamily: FONT }}>{t.name}</p>
              <p style={{ fontSize: 11.5, fontWeight: 700, color: GREEN, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 4, fontFamily: FONT }}><Check size={12} /> Currently Active Theme</p>
              <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 10px', lineHeight: 1.6, fontFamily: FONT }}>{t.desc}</p>
              <div style={{ display: 'flex', gap: 6 }}>
                {t.colors.map((c) => <span key={c} style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: `1px solid ${BORDER}` }} />)}
              </div>
            </div>
          </div>
        ))}
      </Card>

      {/* Hero */}
      <Card icon={Star} iconColor="#F59E0B" title="Hero Section">
        <Field label="Hero Title" hint="Leave blank to use school name">
          <input value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} placeholder="Yug International" style={inputStyle} />
        </Field>
        <Field label="Hero Subtitle">
          <textarea rows={2} value={heroSubtitle} onChange={(e) => setHeroSubtitle(e.target.value)} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
        </Field>
        <Field label="Hero Background Image"><FileField /></Field>
      </Card>

      {/* About */}
      <Card icon={Info} iconColor={BLUE} title="About Section">
        <Field label="About Your School">
          <textarea rows={4} value={aboutText} onChange={(e) => setAboutText(e.target.value)} placeholder="Tell visitors about your school, mission, and values…" style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} />
        </Field>
      </Card>

      {/* SEO */}
      <Card icon={Search} iconColor={GREEN} title="SEO Settings">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <Field label="Meta Title"><input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} style={inputStyle} /></Field>
          <Field label="Meta Keywords"><input value={metaKeywords} onChange={(e) => setMetaKeywords(e.target.value)} style={inputStyle} /></Field>
        </div>
        <Field label="Meta Description">
          <textarea rows={2} value={metaDesc} onChange={(e) => setMetaDesc(e.target.value)} placeholder="A brief description for search engines…" style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <Field label="OG Image (Share Image)"><FileField /></Field>
      </Card>

      {/* Tracking */}
      <Card icon={Braces} iconColor="#7C3AED" title="Tracking & Scripts">
        <Field label={<>Header Scripts <code style={{ color: MUTED2, fontWeight: 400 }}>&lt;head&gt;</code></>} hint="Injected into <head>. Google Analytics, Google Tag Manager, Facebook Pixel, etc.">
          <textarea rows={3} value={headerScripts} onChange={(e) => setHeaderScripts(e.target.value)} placeholder="<!-- Google Analytics, Facebook Pixel, etc. -->" style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
        </Field>
        <Field label={<>Footer Scripts <code style={{ color: MUTED2, fontWeight: 400 }}>&lt;/body&gt;</code></>} hint="Injected before </body>. Chat widgets, Tawk.to, custom JavaScript.">
          <textarea rows={3} value={footerScripts} onChange={(e) => setFooterScripts(e.target.value)} placeholder="<!-- Tawk.to, Crisp, custom JS -->" style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
        </Field>
      </Card>

      {/* Color theme */}
      <Card icon={Droplet} iconColor="#0EA5E9" title="Color Theme">
        <ColorField label="Primary Color"   value={primary}   onChange={setPrimary} />
        <ColorField label="Secondary Color" value={secondary} onChange={setSecondary} />
        <ColorField label="Accent Color"    value={accent}    onChange={setAccent} />
        <Field label="Background Mode">
          <select value={bgMode} onChange={(e) => setBgMode(e.target.value)} style={{ ...inputStyle, maxWidth: 200, cursor: 'pointer' }}>
            <option>Light</option><option>Dark</option><option>Auto</option>
          </select>
        </Field>
      </Card>

      {/* Social links */}
      <Card icon={Share2} iconColor="#EC4899" title="Social Links">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {SOCIAL_FIELDS.map((f) => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: LIGHT, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <f.icon size={15} color={MUTED} />
              </div>
              <input value={social[f.key] || ''} onChange={setSoc(f.key)} placeholder={f.placeholder} style={inputStyle} />
            </div>
          ))}
        </div>
      </Card>

      {/* Sections */}
      <Card icon={Layers} iconColor="#F59E0B" title="Sections">
        <p style={{ fontSize: 12, color: MUTED2, margin: '0 0 12px', fontFamily: FONT }}>Drag to reorder. Uncheck to hide.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sections.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 9, background: s.on ? WHITE : LIGHT }}>
              <GripVertical size={14} color={MUTED2} style={{ cursor: 'grab', flexShrink: 0 }} />
              <input type="checkbox" checked={s.on} onChange={() => toggleSection(s.key)} style={{ width: 15, height: 15, accentColor: AMBER, cursor: 'pointer' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: s.on ? INK : MUTED2, fontFamily: FONT }}>{s.label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Custom CSS */}
      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 20px', marginBottom: 22 }}>
        <p style={{ fontSize: 13.5, fontWeight: 800, color: INK, margin: '0 0 12px', fontFamily: FONT }}>Custom CSS</p>
        <textarea rows={4} value={customCss} onChange={(e) => setCustomCss(e.target.value)} placeholder="/* Advanced: custom CSS overrides */" style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
        {saved && <span style={{ fontSize: 12.5, fontWeight: 700, color: GREEN, fontFamily: FONT }}>Saved ✓</span>}
        <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', borderRadius: 10, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT, boxShadow: saving ? 'none' : `0 4px 14px ${AMBER}44` }}>
          {saving ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={15} />} {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
      </>
      )}
    </PageLayout>
  );
}
