import { useState, useEffect } from 'react';
import {Star, Info, Search, Braces, Droplet, Share2, Layers, Save, Loader2, GripVertical, Facebook, Twitter, Instagram, Youtube, Linkedin, MessageCircle, Palette } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPut, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

/* ── Reusable bits ───────────────────────────────────────────────────────── */
const inputStyle = { width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box' };
function Card({ icon: Icon, iconColor, title, children }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
        <Icon size={16} color={iconColor || AMBER} />
        <span style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontFamily: FONT }}>{title}</span>
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
  { key: 'facebook', icon: Facebook, placeholder: 'Facebook URL' },
  { key: 'twitter', icon: Twitter, placeholder: 'Twitter URL' },
  { key: 'instagram', icon: Instagram, placeholder: 'Instagram URL' },
  { key: 'youtube', icon: Youtube, placeholder: 'Youtube URL' },
  { key: 'linkedin', icon: Linkedin, placeholder: 'Linkedin URL' },
  { key: 'whatsapp', icon: MessageCircle, placeholder: 'Whatsapp number' },
];
const DEFAULT_SECTIONS = [
  { key: 'hero', label: 'Hero', on: true }, { key: 'about', label: 'About', on: true },
  { key: 'notices', label: 'Notices', on: true }, { key: 'events', label: 'Events', on: true },
  { key: 'gallery', label: 'Gallery', on: true }, { key: 'contact', label: 'Contact', on: true },
  { key: 'stats', label: 'Stats', on: false },
];

/* ── Appearance editor (site-wide look) with live landing preview ────────── */
export default function AppearancePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [templateActive, setTemplateActive] = useState(false); // full-doc home page drives the site
  const [f, setF] = useState({
    heroTitle: '', heroSubtitle: '', aboutText: '',
    metaTitle: '', metaKeywords: '', metaDescription: '',
    headerScripts: '', footerScripts: '',
    primaryColor: '#1a56db', secondaryColor: '#6b7280', accentColor: '#f59e0b', bgMode: 'Light',
    socialLinks: {}, sections: DEFAULT_SECTIONS, customCss: '',
    templateColors: {},
  });
  const [tplVars, setTplVars] = useState([]);   // the active template's own CSS colour variables
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const setSoc = (k) => (e) => setF((p) => ({ ...p, socialLinks: { ...p.socialLinks, [k]: e.target.value } }));
  const toggleSection = (key) => setF((p) => ({ ...p, sections: p.sections.map((s) => (s.key === key ? { ...s, on: !s.on } : s)) }));

  useEffect(() => {
    apiGet('/api/school/website').then((r) => {
      const d = r.data || {};
      setF((p) => ({
        ...p,
        heroTitle: d.heroTitle || '', heroSubtitle: d.heroSubtitle || p.heroSubtitle, aboutText: d.aboutText || '',
        metaTitle: d.metaTitle || '', metaKeywords: d.metaKeywords || p.metaKeywords, metaDescription: d.metaDescription || '',
        headerScripts: d.headerScripts || '', footerScripts: d.footerScripts || '',
        primaryColor: d.primaryColor || p.primaryColor, secondaryColor: d.secondaryColor || p.secondaryColor,
        accentColor: d.accentColor || p.accentColor, bgMode: d.bgMode || 'Light',
        socialLinks: d.socialLinks || {}, sections: (Array.isArray(d.sections) && d.sections.length) ? d.sections : DEFAULT_SECTIONS,
        customCss: d.customCss || '',
        templateColors: d.templateColors || {},
      }));
      setTemplateActive(!!d.homeIsDocument);
      setTplVars(Array.isArray(d.templateColorVars) ? d.templateColorVars : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Pixel-perfect landing preview through the real renderer, debounced.
  useEffect(() => {
    if (loading) return;
    setPreviewing(true);
    const t = setTimeout(() => {
      apiPost('/api/school/website/preview-site', f).then((r) => setPreviewHtml(r.html || '')).catch(() => {}).finally(() => setPreviewing(false));
    }, 500);
    return () => clearTimeout(t);
  }, [f, loading]);

  const save = async () => {
    setSaving(true);
    try {
      await apiPut('/api/school/website', {
        heroTitle: f.heroTitle, heroSubtitle: f.heroSubtitle, aboutText: f.aboutText,
        metaTitle: f.metaTitle, metaKeywords: f.metaKeywords, metaDescription: f.metaDescription,
        headerScripts: f.headerScripts, footerScripts: f.footerScripts,
        primaryColor: f.primaryColor, secondaryColor: f.secondaryColor, accentColor: f.accentColor, bgMode: f.bgMode,
        socialLinks: f.socialLinks, sections: f.sections, customCss: f.customCss,
        templateColors: f.templateColors,
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

  return (
    <PageLayout title="Appearance" subtitle="Design your website's home page and global look — with a live preview">
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        {saved && <span style={{ fontSize: 12.5, fontWeight: 700, color: GREEN, fontFamily: FONT }}>Saved ✓</span>}
        <button onClick={save} disabled={saving || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 10, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
          {saving ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={15} />} {saving ? 'Saving…' : 'Save Appearance'}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT }}><Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Left: panels */}
          <div style={{ flex: '1 1 380px', minWidth: 320, maxWidth: 480, maxHeight: 'calc(100vh - 170px)', overflowY: 'auto', paddingRight: 4 }}>
            {templateActive && (
              <div style={{ background: `${BLUE}0C`, border: `1px solid ${BLUE}33`, borderRadius: 12, padding: '13px 16px', marginBottom: 14, fontFamily: FONT }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, marginBottom: 4 }}><Palette size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />A template is powering your site</div>
                <p style={{ fontSize: 12, color: MUTED, margin: 0, lineHeight: 1.6 }}>
                  Your pages come from the active template, so the theme's Hero, About, Sections and Colors don't apply —
                  edit your pages in <b>Website Builder → Pages</b> instead. Tracking scripts and Custom CSS below are
                  injected into <b>every template page</b>.
                </p>
              </div>
            )}
            {templateActive && tplVars.length > 0 && (
              <Card icon={Droplet} iconColor="#0EA5E9" title="Brand Colors">
                <p style={{ fontSize: 12, color: MUTED2, margin: '0 0 12px', fontFamily: FONT }}>
                  Your template's colour palette — change these to match your school's brand. Applies to every page.
                </p>
                {tplVars.map((v) => {
                  const current = f.templateColors[v.name] || v.value;
                  // <input type=color> needs #rrggbb — expand shorthand hex for the picker.
                  const hex6 = /^#[0-9a-fA-F]{3}$/.test(current) ? `#${current.slice(1).split('').map((c) => c + c).join('')}` : current;
                  const label = v.name.replace(/^--/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                  return (
                    <ColorField key={v.name} label={label}
                      value={/^#[0-9a-fA-F]{6}$/.test(hex6) ? hex6 : '#000000'}
                      onChange={(val) => setF((p) => ({ ...p, templateColors: { ...p.templateColors, [v.name]: val } }))} />
                  );
                })}
                {Object.keys(f.templateColors).length > 0 && (
                  <button onClick={() => setF((p) => ({ ...p, templateColors: {} }))} style={{ marginTop: 4, padding: '7px 12px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                    Reset to template colours
                  </button>
                )}
              </Card>
            )}
            {!templateActive && (<>
            <Card icon={Star} iconColor="#F59E0B" title="Hero Section">
              <Field label="Hero Title" hint="Leave blank to use school name"><input value={f.heroTitle} onChange={set('heroTitle')} placeholder="Welcome to our school" style={inputStyle} /></Field>
              <Field label="Hero Subtitle"><textarea rows={2} value={f.heroSubtitle} onChange={set('heroSubtitle')} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} /></Field>
            </Card>

            <Card icon={Info} iconColor={BLUE} title="About Section">
              <Field label="About Your School"><textarea rows={4} value={f.aboutText} onChange={set('aboutText')} placeholder="Tell visitors about your school, mission, and values…" style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }} /></Field>
            </Card>
            </>)}

            <Card icon={Search} iconColor={GREEN} title="SEO Settings">
              <Field label="Meta Title"><input value={f.metaTitle} onChange={set('metaTitle')} style={inputStyle} /></Field>
              <Field label="Meta Keywords"><input value={f.metaKeywords} onChange={set('metaKeywords')} style={inputStyle} /></Field>
              <Field label="Meta Description"><textarea rows={2} value={f.metaDescription} onChange={set('metaDescription')} placeholder="A brief description for search engines…" style={{ ...inputStyle, resize: 'vertical' }} /></Field>
            </Card>

            <Card icon={Braces} iconColor="#7C3AED" title="Tracking & Scripts">
              <Field label="Header Scripts (<head>)" hint="Google Analytics, Tag Manager, Facebook Pixel, etc."><textarea rows={3} value={f.headerScripts} onChange={set('headerScripts')} placeholder="<!-- Analytics, Pixel… -->" style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} /></Field>
              <Field label="Footer Scripts (before </body>)" hint="Chat widgets, custom JavaScript."><textarea rows={3} value={f.footerScripts} onChange={set('footerScripts')} placeholder="<!-- Tawk.to, Crisp, custom JS -->" style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} /></Field>
            </Card>

            {!templateActive && (
            <Card icon={Droplet} iconColor="#0EA5E9" title="Color Theme">
              <ColorField label="Primary Color" value={f.primaryColor} onChange={(v) => setF((p) => ({ ...p, primaryColor: v }))} />
              <ColorField label="Secondary Color" value={f.secondaryColor} onChange={(v) => setF((p) => ({ ...p, secondaryColor: v }))} />
              <ColorField label="Accent Color" value={f.accentColor} onChange={(v) => setF((p) => ({ ...p, accentColor: v }))} />
              <Field label="Background Mode"><select value={f.bgMode} onChange={set('bgMode')} style={{ ...inputStyle, maxWidth: 200, cursor: 'pointer' }}><option>Light</option><option>Dark</option><option>Auto</option></select></Field>
            </Card>
            )}

            <Card icon={Share2} iconColor="#EC4899" title="Social Links">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {SOCIAL_FIELDS.map((s) => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: LIGHT, border: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><s.icon size={15} color={MUTED} /></div>
                    <input value={f.socialLinks[s.key] || ''} onChange={setSoc(s.key)} placeholder={s.placeholder} style={inputStyle} />
                  </div>
                ))}
              </div>
            </Card>

            {!templateActive && (
            <Card icon={Layers} iconColor="#F59E0B" title="Sections">
              <p style={{ fontSize: 12, color: MUTED2, margin: '0 0 12px', fontFamily: FONT }}>Uncheck to hide a section from the home page.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {f.sections.map((s) => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', border: `1px solid ${BORDER}`, borderRadius: 9, background: s.on ? WHITE : LIGHT }}>
                    <GripVertical size={14} color={MUTED2} style={{ flexShrink: 0 }} />
                    <input type="checkbox" checked={s.on} onChange={() => toggleSection(s.key)} style={{ width: 15, height: 15, accentColor: AMBER, cursor: 'pointer' }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: s.on ? INK : MUTED2, fontFamily: FONT }}>{s.label}</span>
                  </div>
                ))}
              </div>
            </Card>
            )}

            <Card icon={Braces} iconColor={MUTED} title="Custom CSS">
              <textarea rows={5} value={f.customCss} onChange={set('customCss')} placeholder="/* Advanced: custom CSS overrides */" style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
            </Card>
          </div>

          {/* Right: live preview */}
          <div style={{ flex: '2 1 480px', minWidth: 320, display: 'flex', flexDirection: 'column', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', background: WHITE, position: 'sticky', top: 16, minHeight: 560 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderBottom: `1px solid ${BORDER}`, background: LIGHT }}>
              <span style={{ display: 'inline-flex', gap: 5 }}>{[RED, AMBER, GREEN].map((c) => <span key={c} style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: MUTED2, fontFamily: FONT }}>Live Preview · Home page</span>
              {previewing && <Loader2 size={12} color={MUTED2} style={{ animation: 'spin .8s linear infinite', marginLeft: 'auto' }} />}
            </div>
            {/* sandbox is required, not cosmetic: srcDoc inherits THIS origin,
                so any <script> in the site's own HTML (header/footer scripts,
                imported template markup) would run with the portal's origin and
                its localStorage. An empty sandbox renders CSS and images while
                keeping scripts and same-origin access off. */}
            <iframe title="Website preview" srcDoc={previewHtml} sandbox=""
              style={{ flex: 1, width: '100%', border: 'none', minHeight: 520, background: WHITE }} />
          </div>
        </div>
      )}
    </PageLayout>
  );
}
