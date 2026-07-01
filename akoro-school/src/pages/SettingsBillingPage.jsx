import { useState } from 'react';
import {
  Building2, SlidersHorizontal, Clock, ShieldCheck, Plug, Facebook, Send,
  Bell, BookOpen, Info, Sparkles, Save, ExternalLink, Upload,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, FONT } from '../constants.js';

/* ── Tab config ──────────────────────────────────────────────────── */
const TABS = [
  { key: 'profile',      label: 'School Profile',   icon: Building2 },
  { key: 'formats',      label: 'System & Formats', icon: SlidersHorizontal },
  { key: 'attendance',   label: 'Attendance',       icon: Clock },
  { key: 'security',      label: 'Security',        icon: ShieldCheck },
  { key: 'integrations', label: 'Integrations',     icon: Plug },
];
const EXTERNAL = [
  { key: 'social',        label: 'Social Media',  icon: Facebook, external: true },
  { key: 'telegram',      label: 'Telegram Bot',  icon: Send,     external: true },
  { key: 'notifications', label: 'Notifications', icon: Bell,     external: true },
];

/* Mock school record (replace with GET /api/school later) */
const MOCK = {
  name: 'Yug International', acronym: 'YIS', email: 'contact@akoro.app',
  phone: '+234 803 000 0000', principal: 'Amara Osei', country: 'Nigeria (+234)',
  address: 'D20/6, IT Park, Victoria Island, Lagos, 101241',
};
const COUNTRIES = ['Nigeria (+234)', 'Kenya (+254)', 'Ghana (+233)', 'South Africa (+27)', 'United States (+1)'];

/* ── Small building blocks ───────────────────────────────────────── */
function Field({ label, required, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT }}>
        {label} {required && <span style={{ color: '#EF4444' }}>*</span>}
      </label>
      {children}
    </div>
  );
}
const inputStyle = {
  width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${BORDER}`,
  outline: 'none', fontSize: 13.5, fontFamily: FONT, color: INK, background: WHITE, boxSizing: 'border-box',
};
function SectionHeader({ color, icon: Icon, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: `${color}10`, borderLeft: `3px solid ${color}`, borderRadius: 8, padding: '11px 14px', marginBottom: 18 }}>
      <Icon size={16} color={color} />
      <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: .6, color, fontFamily: FONT, textTransform: 'uppercase' }}>{title}</span>
    </div>
  );
}
function UploadTile({ label, preview }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontFamily: FONT }}>{label}</span>
      <div style={{ width: 96, height: 96, borderRadius: 12, border: `1.5px dashed ${BORDER}`, background: LIGHT, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {preview || <Upload size={20} color={MUTED2} />}
      </div>
      <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
        <Upload size={12} /> Browse
      </button>
    </div>
  );
}

/* ── School Profile panel ────────────────────────────────────────── */
function SchoolProfilePanel() {
  const [form, setForm] = useState(MOCK);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div>
      <SectionHeader color={BLUE} icon={Info} title="General Information" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
        <Field label="School Name" required><input style={inputStyle} value={form.name} onChange={set('name')} /></Field>
        <Field label="Short Name / Acronym"><input style={inputStyle} value={form.acronym} onChange={set('acronym')} /></Field>
        <Field label="School Email" required><input style={inputStyle} value={form.email} onChange={set('email')} /></Field>
        <Field label="Phone Number"><input style={inputStyle} value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Principal Name"><input style={inputStyle} value={form.principal} onChange={set('principal')} /></Field>
        <Field label="Country">
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.country} onChange={set('country')}>
            {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Address"><textarea rows={2} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} value={form.address} onChange={set('address')} /></Field>
        </div>
      </div>

      <SectionHeader color={AMBER} icon={Sparkles} title="Branding & Appearance" />
      <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap' }}>
        <UploadTile label="School Logo" />
        <UploadTile label="Favicon (.ico, .png)" />
        <UploadTile label="Principal Signature" />
      </div>
    </div>
  );
}

/* ── Generic placeholder panel (not built yet) ───────────────────── */
function PlaceholderPanel({ tab }) {
  const copy = {
    formats:      { title: 'System & Formats', desc: 'Academic session, date & currency formats, admission number pattern, timezone and grading scale.' },
    attendance:   { title: 'Attendance',       desc: 'Attendance mode (daily / period-wise), biometric device sync, and late-mark thresholds.' },
    security:     { title: 'Security',          desc: 'Password policy, two-factor authentication, session timeout and login IP restrictions.' },
    integrations: { title: 'Integrations',     desc: 'Payment gateway, SMS provider, email service and third-party API keys.' },
  }[tab] || { title: 'Settings', desc: 'Coming soon.' };
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center', border: `1.5px dashed ${BORDER}`, borderRadius: 14, background: LIGHT }}>
      <p style={{ fontSize: 15, fontWeight: 800, color: INK, margin: '0 0 6px', fontFamily: FONT }}>{copy.title}</p>
      <p style={{ fontSize: 13, color: MUTED, margin: 0, fontFamily: FONT, lineHeight: 1.6, maxWidth: 420, marginInline: 'auto' }}>{copy.desc}</p>
      <span style={{ display: 'inline-block', marginTop: 14, fontSize: 11, fontWeight: 800, color: MUTED2, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 20, padding: '5px 12px', fontFamily: FONT }}>Coming soon</span>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
export default function SettingsBillingPage() {
  const [tab, setTab] = useState('profile');

  const TabButton = ({ t }) => {
    const on = tab === t.key;
    return (
      <button onClick={() => !t.external && setTab(t.key)} style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '11px 13px', borderRadius: 10, border: 'none', cursor: 'pointer',
        background: on ? BLUE : 'transparent', color: on ? WHITE : MUTED,
        fontSize: 13.5, fontWeight: on ? 700 : 600, fontFamily: FONT, transition: 'all .12s',
      }}
        onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = LIGHT; }}
        onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
        <t.icon size={16} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{t.label}</span>
        {t.external && <ExternalLink size={13} color={MUTED2} />}
      </button>
    );
  };

  return (
    <PageLayout title="Settings & Billing" subtitle="Manage your school profile, formats and integrations">
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left tab rail */}
        <aside style={{ width: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {TABS.map((t) => <TabButton key={t.key} t={t} />)}
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: MUTED2, padding: '12px 13px 6px', fontFamily: FONT }}>EXTERNAL CHANNELS</div>
            {EXTERNAL.map((t) => <TabButton key={t.key} t={t} />)}
          </div>

          {/* Quick Guide */}
          <div style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}22`, borderRadius: 14, padding: '14px 15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <BookOpen size={15} color={BLUE} />
              <span style={{ fontSize: 12.5, fontWeight: 800, color: BLUE, fontFamily: FONT }}>Quick Guide</span>
            </div>
            <p style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6, margin: 0, fontFamily: FONT }}>
              <b style={{ color: INK }}>Acronyms:</b> Short names (e.g. “YIS”) are used in automated SMS templates to save characters and reduce carrier costs.
            </p>
            <p style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6, margin: '8px 0 0', fontFamily: FONT }}>
              <b style={{ color: INK }}>Images:</b> Always use transparent PNGs. The favicon is auto-resized to 16×16, and the principal signature is stamped onto report cards.
            </p>
          </div>
        </aside>

        {/* Right content card */}
        <section style={{ flex: 1, minWidth: 300, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '22px 24px' }}>
          {tab === 'profile' ? <SchoolProfilePanel /> : <PlaceholderPanel tab={tab} />}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 26, paddingTop: 18, borderTop: `1px solid ${BORDER}` }}>
            <button style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, boxShadow: `0 4px 14px ${AMBER}44` }}>
              <Save size={15} /> Save Settings
            </button>
          </div>
        </section>
      </div>
    </PageLayout>
  );
}
