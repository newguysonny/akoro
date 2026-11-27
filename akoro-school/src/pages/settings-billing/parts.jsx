/**
 * SettingsBillingPage — constants + child components.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, SlidersHorizontal, Clock, ShieldCheck, Plug, Facebook, Send, Bell, Info, Sparkles, Settings2, Warehouse, Hash, MapPin, Fingerprint, GraduationCap, AlertTriangle, Palette, HelpCircle, Globe, CreditCard } from 'lucide-react';
import { Ico } from '../../theme/Ico.jsx';
import { PageLayout } from '../../components/Layout.jsx';
import { apiGet, apiPut, apiPost, API } from '../../services/api.js';
import { GREEN, BLUE, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { COUNTRIES as GEO_COUNTRIES, NG_STATES } from '../../data/locations.js';
import { LEARNER_URL } from '../../config/urls.js';
import { SettingsCard, SettingsGroup } from '../../shared/SettingsCard.jsx';
import { WalletPanel } from '../../shared/WalletShell.jsx';

const ACCENT = C.brand;


const EDUCATION_LEVELS = ['Nursery / Pre-school', 'Primary', 'Junior Secondary', 'Senior Secondary'];
const OWNERSHIP_TYPES  = ['Private', 'Public / Government', 'Faith-based / Mission', 'Community'];
const CURRICULA        = ['Nigerian (WAEC/NECO)', 'British / Cambridge', 'Montessori', 'American', 'International Baccalaureate', 'Mixed / Other'];
const GENDER_TYPES     = ['Mixed', 'Boys only', 'Girls only'];
const BOARDING_TYPES   = ['Day only', 'Boarding only', 'Day & Boarding'];
const STUDENT_BANDS    = ['1 – 100', '101 – 300', '301 – 600', '601 – 1,000', '1,000+'];

/* ── Tab config ──────────────────────────────────────────────────── */
// Public marketing site (Terms / Privacy / Contact live there) + support email,
// from env so they're not hard-coded to akoro.app.
const SITE_URL = LEARNER_URL;
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@akoro.app';

const TABS = [
  { key: 'profile',      label: 'School Profile',    icon: Building2, ti: 'ti-building' },
  { key: 'formats',      label: 'System & Formats',  icon: SlidersHorizontal, ti: 'ti-adjustments-horizontal' },
  { key: 'attendance',   label: 'Attendance',        icon: Clock, ti: 'ti-clock' },
  { key: 'security',     label: 'Privacy & Security', icon: ShieldCheck, ti: 'ti-shield-check' },
  { key: 'integrations', label: 'Integrations',      icon: Plug, ti: 'ti-plug' },
  { key: 'help',         label: 'Help & Support',    icon: HelpCircle, ti: 'ti-help-circle' },
  { key: 'about',        label: 'About',             icon: Info, ti: 'ti-info-circle' },
];
const EXTERNAL = [
  { key: 'billing',       label: 'Billing & Plan', icon: CreditCard, ti: 'ti-credit-card', external: true, to: '/settings-subscription' },
  { key: 'social',        label: 'Social Media',  icon: Facebook, ti: 'ti-brand-facebook', external: true, to: '/settings-social-media' },
  { key: 'telegram',      label: 'Telegram Bot',  icon: Send, ti: 'ti-send',     external: true, to: '/settings-telegram' },
  { key: 'domain',        label: 'Domain',        icon: Globe, ti: 'ti-world',    external: true, to: '/settings-domain' },
  { key: 'notifications', label: 'Notifications', icon: Bell, ti: 'ti-bell',     external: true, to: '/settings-notifications' },
];
const LANGUAGES = ['English', 'Yoruba', 'Igbo', 'Hausa', 'Pidgin', 'French', 'Arabic'];
const ACCENTS   = [C.brand, '#6C3BFF', '#3B82F6', '#10B981', '#EC4899', '#F59E0B', '#EF4444', '#8B5CF6'];
const COUNTRIES = ['Nigeria (+234)', 'Kenya (+254)', 'Ghana (+233)', 'South Africa (+27)', 'United States (+1)'];
const THEMES = [
  'Classic Dashboard (Legacy)', 'Action V2 (Clean)', 'Action V2 (Colorful)', 'Action V3 (Smart Auto-Arrange) ✨',
  'Mac OS Style (Informative & Active) 🍎', 'Futuristic Command Center (Extreme Data) 🚀',
  'Analytics Pro (Light & Colorful) 📊', 'Executive Pro (All-in-One Premium) ♦',
];
const CURRENCIES = ['Nigerian Naira (₦)', 'Indian Rupee (₹)', 'US Dollar ($)', 'Kenyan Shilling (KSh)', 'Ghanaian Cedi (₵)'];

/* ── Small building blocks ───────────────────────────────────────── */
function Field({ label, required, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, fontFamily: C.font }}>
        {label} {required && <span style={{ color: '#EF4444' }}>*</span>}
      </label>
      {children}
    </div>
  );
}
const inputStyle = {
  width: '100%', padding: '10px 13px', borderRadius: 10, border: `1.5px solid ${C.border}`,
  outline: 'none', fontSize: 13.5, fontFamily: C.font, color: C.ink, background: C.surface, boxSizing: 'border-box',
};
function Section({ color, icon: Icon, ti, title, children }) {
  return (
    <SettingsGroup
      title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ico lucide={Icon} ti={ti} size={13} color={color} />{title}</span>}
      style={{ marginBottom: 18 }}
    >
      {children}
    </SettingsGroup>
  );
}
function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 4px', border: 'none',
      background: 'transparent', cursor: 'pointer', fontFamily: C.font,
    }}>
      <span style={{
        width: 42, height: 24, borderRadius: 999, background: on ? GREEN : C.borderSoft,
        position: 'relative', transition: 'background .15s', flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18,
          borderRadius: '50%', background: C.surface, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
        }} />
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 800, color: on ? GREEN : C.muted2 }}>{on ? 'ON' : 'OFF'}</span>
    </button>
  );
}
function Banner({ tone = 'warn', children }) {
  const colors = { warn: '#F59E0B', info: BLUE };
  const c = colors[tone];
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: tint(7, c), border: `1px solid ${c}33`, borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: C.ink, lineHeight: 1.55, fontFamily: C.font }}>
      <Ico ti="ti-alert-triangle" size={15} color={c} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}
function UploadTile({ label, preview, kind, onUploaded, onToast }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const r = await fetch(`${API}/api/school/settings/profile/upload`, {
        method: 'POST', credentials: 'include', headers: { 'X-Akoro-Portal': 'school' }, body: fd,
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Upload failed');
      onUploaded?.(j.data.url);
      onToast?.('Uploaded ✓');
    } catch (err) { onToast?.(err.message || 'Upload failed'); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, fontFamily: C.font }}>{label}</span>
      <div style={{ width: 96, height: 96, borderRadius: 12, border: `1.5px dashed ${C.border}`, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {busy ? <Ico ti="ti-loader-2" size={20} color={C.muted2} style={{ animation: 'spin .8s linear infinite' }} /> : (preview || <Ico ti="ti-upload" size={20} color={C.muted2} />)}
      </div>
      <input ref={ref} type="file" accept="image/*" onChange={pick} style={{ display: 'none' }} />
      <button onClick={() => ref.current?.click()} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: C.font }}>
        <Ico ti="ti-upload" size={12} /> {busy ? 'Uploading…' : 'Browse'}
      </button>
    </div>
  );
}

/* ── School Profile panel (controlled) ───────────────────────────── */
function SchoolProfilePanel({ value, onChange, onToast }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  // Tolerate legacy defaults like "Nigeria (+234)" so the State/LGA dropdowns work.
  const isNigeria = /^nigeria\b/i.test(value.country || '');
  const ngStates = isNigeria ? Object.keys(NG_STATES) : [];
  const lgaOptions = isNigeria ? (NG_STATES[value.state] || []) : [];
  const levels = Array.isArray(value.educationLevels) ? value.educationLevels : [];
  const toggleLevel = (l) => onChange({ ...value, educationLevels: levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l] });
  return (
    <div>
      <Section color={BLUE} icon={Info} ti="ti-info-circle" title="General Information">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
        <Field label="School Name" required><input style={inputStyle} value={value.name || ''} onChange={set('name')} /></Field>
        <Field label="Short Name / Acronym"><input style={inputStyle} value={value.acronym || ''} onChange={set('acronym')} /></Field>
        <Field label="School Email" required><input style={{ ...inputStyle, background: C.bg, color: C.muted }} value={value.email || ''} disabled title="Change your login email from Privacy & Security" /></Field>
        <Field label="Phone Number"><input style={inputStyle} value={value.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Principal Name"><input style={inputStyle} value={value.principal || ''} onChange={set('principal')} /></Field>
      </div>
      </Section>

      <Section color={BLUE} icon={MapPin} ti="ti-map-pin" title="Location">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 16 }}>
        <Field label="Country">
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={value.country || 'Nigeria'} onChange={(e) => onChange({ ...value, country: e.target.value, state: '', lga: '' })}>
            {GEO_COUNTRIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="State / Region">
          {ngStates.length
            ? <select style={{ ...inputStyle, cursor: 'pointer' }} value={value.state || ''} onChange={(e) => onChange({ ...value, state: e.target.value, lga: '' })}><option value="">Select…</option>{ngStates.map((s) => <option key={s}>{s}</option>)}</select>
            : <input style={inputStyle} value={value.state || ''} onChange={set('state')} />}
        </Field>
        <Field label="LGA / District">
          {lgaOptions.length
            ? <select style={{ ...inputStyle, cursor: value.state ? 'pointer' : 'not-allowed', opacity: value.state ? 1 : 0.6 }} value={value.lga || ''} disabled={!value.state} onChange={set('lga')}><option value="">{value.state ? 'Select…' : 'Pick a state'}</option>{lgaOptions.map((l) => <option key={l}>{l}</option>)}</select>
            : <input style={inputStyle} value={value.lga || ''} onChange={set('lga')} />}
        </Field>
        <Field label="Town / City"><input style={inputStyle} value={value.city || ''} onChange={set('city')} /></Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Street Address"><textarea rows={2} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} value={value.address || ''} onChange={set('address')} /></Field>
        </div>
      </div>
      </Section>

      <Section color={GREEN} icon={GraduationCap} ti="ti-school" title="Academics">
      <Field label="Education Levels Offered">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {EDUCATION_LEVELS.map((l) => {
            const on = levels.includes(l);
            return <button key={l} type="button" onClick={() => toggleLevel(l)} style={{ padding: '8px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${on ? C.brand : C.border}`, background: on ? C.brand : C.surface, color: on ? '#fff' : C.muted, fontFamily: C.font }}>{l}</button>;
          })}
        </div>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginTop: 6, marginBottom: 24 }}>
        <Field label="School Type">
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={value.ownershipType || ''} onChange={set('ownershipType')}><option value="">Select…</option>{OWNERSHIP_TYPES.map((o) => <option key={o}>{o}</option>)}</select>
        </Field>
        <Field label="Curriculum">
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={value.curriculum || ''} onChange={set('curriculum')}><option value="">Select…</option>{CURRICULA.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label="Year Established"><input type="number" style={inputStyle} value={value.yearEstablished || ''} onChange={set('yearEstablished')} placeholder="1998" /></Field>
        <Field label="Students Are">
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={value.genderType || ''} onChange={set('genderType')}><option value="">Select…</option>{GENDER_TYPES.map((g) => <option key={g}>{g}</option>)}</select>
        </Field>
        <Field label="Boarding">
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={value.boardingType || ''} onChange={set('boardingType')}><option value="">Select…</option>{BOARDING_TYPES.map((b) => <option key={b}>{b}</option>)}</select>
        </Field>
        <Field label="No. of Students">
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={value.studentBand || ''} onChange={set('studentBand')}><option value="">Select…</option>{STUDENT_BANDS.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
      </div>
      </Section>

      <Section color={C.brand} icon={Sparkles} ti="ti-sparkles" title="Branding & Appearance">
      <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap' }}>
        <UploadTile label="School Logo" kind="logo" onToast={onToast} onUploaded={(url) => onChange({ ...value, logoUrl: url })} preview={value.logoUrl ? <img src={value.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null} />
        <UploadTile label="Favicon (.ico, .png)" kind="favicon" onToast={onToast} onUploaded={(url) => onChange({ ...value, faviconUrl: url })} preview={value.faviconUrl ? <img src={value.faviconUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null} />
        <UploadTile label="Principal Signature" kind="signature" onToast={onToast} onUploaded={(url) => onChange({ ...value, signatureUrl: url })} preview={value.signatureUrl ? <img src={value.signatureUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null} />
      </div>
      </Section>
    </div>
  );
}

/* ── System & Formats panel (controlled) ─────────────────────────── */
function SystemFormatsPanel({ formats, onFormatsChange, personalisation, onPersonalisationChange }) {
  const f = formats || {};
  const p = personalisation || {};
  const setF = (k) => (e) => onFormatsChange({ ...f, [k]: e.target.value });
  const setP = (k) => (val) => onPersonalisationChange({ ...p, [k]: val });

  return (
    <div>
      <Section color={BLUE} icon={Settings2} ti="ti-settings" title="System & Academic Settings">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="School Code / UDISE"><input style={inputStyle} value={f.udise || ''} onChange={setF('udise')} /></Field>
        <Field label="Affiliated By"><input style={inputStyle} value={f.affiliatedBy || ''} onChange={setF('affiliatedBy')} /></Field>
      </div>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, margin: '0 0 4px', fontFamily: C.font }}>Dashboard Design Theme</p>
      <p style={{ fontSize: 12, color: C.muted, margin: '0 0 14px', fontFamily: C.font }}>Choose the visual layout of your administration dashboard.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 26 }}>
        {THEMES.map((t) => {
          const on = (f.theme || THEMES[1]) === t;
          return (
            <button key={t} onClick={() => onFormatsChange({ ...f, theme: t })} style={{
              textAlign: 'left', padding: 0, border: `2px solid ${on ? BLUE : C.border}`, borderRadius: 12,
              background: C.surface, cursor: 'pointer', overflow: 'hidden', fontFamily: C.font, position: 'relative',
            }}>
              <div style={{ height: 60, background: `linear-gradient(135deg, ${tint(13)}, ${BLUE}22)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {on && <span style={{ background: BLUE, color: '#fff', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-check" size={13} /></span>}
              </div>
              <p style={{ fontSize: 11.5, fontWeight: 700, color: C.ink, margin: 0, padding: '8px 10px' }}>{t}</p>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="Currency" required>
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={f.currency || CURRENCIES[0]} onChange={setF('currency')}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Default Fee Receipt Template">
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={f.receiptTemplate || 'auto'} onChange={setF('receiptTemplate')}>
            <option value="auto">Default Fee Receipt (Auto-Generated)</option>
            <option value="minimal">Minimal Receipt</option>
            <option value="detailed">Detailed Receipt</option>
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Mobile App Receipt Template">
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={f.mobileReceiptTemplate || ''} onChange={setF('mobileReceiptTemplate')}>
              <option value="">-- Same as default (auto) --</option>
              <option value="compact">Compact (phone-optimized)</option>
            </select>
          </Field>
          <p style={{ fontSize: 11.5, color: C.muted2, margin: '6px 0 0', fontFamily: C.font }}>PDF shown to parents/students in the mobile app. Leave blank to reuse the default.</p>
        </div>
      </div>
      </Section>

      <Section color={C.brand} icon={Warehouse} ti="ti-building-warehouse" title="Inventory Tax Settings">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 22 }}>
        <div>
          <Field label="Tax Label (e.g. GST, VAT, Tax)"><input style={inputStyle} value={f.taxLabel || ''} onChange={setF('taxLabel')} /></Field>
          <p style={{ fontSize: 11.5, color: C.muted2, margin: '6px 0 0', fontFamily: C.font }}>Used as the column header for taxes in the inventory module.</p>
        </div>
        <div>
          <Field label="Tax ID Label (e.g. GSTIN, VAT No.)"><input style={inputStyle} value={f.taxId || ''} onChange={setF('taxId')} /></Field>
          <p style={{ fontSize: 11.5, color: C.muted2, margin: '6px 0 0', fontFamily: C.font }}>Used on supplier forms and invoices.</p>
        </div>
      </div>
      </Section>

      <Section color={BLUE} icon={Hash} ti="ti-hash" title="Fee Receipt Numbering">
      <div style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}22`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, fontFamily: C.font }}>
        Live Preview: <b style={{ color: BLUE }}>{f.receiptPrefix || 'SCH'}-2027-2028-JUL26-0005</b>
      </div>
      <Field label="Receipt Prefix"><input style={{ ...inputStyle, maxWidth: 260 }} value={f.receiptPrefix || ''} onChange={setF('receiptPrefix')} /></Field>
      </Section>

      <div style={{ marginTop: 26 }}>
        <Section color={C.brand} icon={Palette} ti="ti-palette" title="Personalisation">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <SettingsCard
            color={ACCENT}
            icon={<Ico ti="ti-language" size={17} color={ACCENT} />}
            title="Language"
            subtitle={p.language || 'English'}
            chevron={
              <select value={p.language || 'English'} onChange={(e) => setP('language')(e.target.value)}
                style={{ border: `1.5px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontFamily: C.font, fontSize: 13, background: C.surface, color: C.ink, cursor: 'pointer' }}>
                {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
              </select>
            }
          />
          <SettingsCard
            color={ACCENT}
            icon={<Ico ti="ti-moon" size={17} color={ACCENT} />}
            title="Dark Mode"
            subtitle="Currently in preview"
            chevron={<Toggle on={!!p.darkMode} onChange={(v) => setP('darkMode')(v)} />}
          />
          <SettingsCard
            color={ACCENT}
            icon={<Ico ti="ti-palette" size={17} color={ACCENT} />}
            title="Accent Colour"
            chevron={
              <div style={{ display: 'flex', gap: 6 }}>
                {ACCENTS.map((c) => (
                  <div key={c} onClick={() => setP('accentColour')(c)} style={{
                    width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer',
                    outline: (p.accentColour || C.brand) === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
                  }} />
                ))}
              </div>
            }
          />
        </div>
        </Section>
      </div>
    </div>
  );
}

/* ── Attendance panel (controlled) ───────────────────────────────── */
function AttendancePanel({ value, onChange }) {
  const v = value || {};
  const set = (k) => (e) => onChange({ ...v, [k]: e.target.value });

  return (
    <div>
      <Section color={BLUE} icon={MapPin} ti="ti-map-pin" title="Staff Geolocation & Time Settings">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: C.font }}>Enable Geolocation Restrictions for Staff App Punch In/Out</span>
        <Toggle on={!!v.geoRestriction} onChange={(on) => onChange({ ...v, geoRestriction: on })} />
      </div>
      <p style={{ fontSize: 11.5, color: C.muted2, margin: '0 0 20px', fontFamily: C.font }}>Toggle whether mobile app attendance relies on physical GPS distance to the school.</p>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, margin: '0 0 12px', fontFamily: C.font }}>Global Campus Coordinates</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="Latitude"><input style={inputStyle} value={v.latitude || ''} onChange={set('latitude')} /></Field>
        <Field label="Longitude"><input style={inputStyle} value={v.longitude || ''} onChange={set('longitude')} /></Field>
        <Field label="Radius (Meters)"><input style={inputStyle} value={v.radiusMeters || ''} onChange={set('radiusMeters')} /></Field>
      </div>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, margin: '0 0 12px', fontFamily: C.font }}>Allowed Punch Time Windows</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 26 }}>
        <Field label="Punch In Start"><input type="time" style={inputStyle} value={v.punchInStart || ''} onChange={set('punchInStart')} /></Field>
        <Field label="Punch In End"><input type="time" style={inputStyle} value={v.punchInEnd || ''} onChange={set('punchInEnd')} /></Field>
        <Field label="Punch Out Start"><input type="time" style={inputStyle} value={v.punchOutStart || ''} onChange={set('punchOutStart')} /></Field>
        <Field label="Punch Out End"><input type="time" style={inputStyle} value={v.punchOutEnd || ''} onChange={set('punchOutEnd')} /></Field>
      </div>
      </Section>

      <Section color={C.brand} icon={Fingerprint} ti="ti-fingerprint" title="Biometric Attendance Settings">
      <p style={{ fontSize: 12, color: C.muted, margin: '0 0 16px', fontFamily: C.font, lineHeight: 1.55 }}>
        Configure how biometric device punches are mapped to Clock-In / Clock-Out. If left empty, the system uses smart fallback (first punch = in, last punch = out).
      </p>
      <p style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, margin: '0 0 12px', fontFamily: C.font }}>Biometric Punch Time Windows</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="Punch In Start"><input type="time" style={inputStyle} value={v.bioPunchInStart || ''} onChange={set('bioPunchInStart')} /></Field>
        <Field label="Punch In End"><input type="time" style={inputStyle} value={v.bioPunchInEnd || ''} onChange={set('bioPunchInEnd')} /></Field>
        <Field label="Punch Out Start"><input type="time" style={inputStyle} value={v.bioPunchOutStart || ''} onChange={set('bioPunchOutStart')} /></Field>
        <Field label="Punch Out End"><input type="time" style={inputStyle} value={v.bioPunchOutEnd || ''} onChange={set('bioPunchOutEnd')} /></Field>
      </div>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: C.ink, margin: '0 0 12px', fontFamily: C.font }}>Late Detection</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <div>
          <Field label="School Start Time"><input type="time" style={inputStyle} value={v.schoolStartTime || ''} onChange={set('schoolStartTime')} /></Field>
          <p style={{ fontSize: 11, color: C.muted2, margin: '6px 0 0', fontFamily: C.font }}>Used to auto-detect “Late” status for biometric attendance.</p>
        </div>
        <div>
          <Field label="Grace Period (Minutes)"><input style={inputStyle} value={v.gracePeriodMinutes || ''} onChange={set('gracePeriodMinutes')} /></Field>
          <p style={{ fontSize: 11, color: C.muted2, margin: '6px 0 0', fontFamily: C.font }}>Minutes after school start time before marking as Late.</p>
        </div>
      </div>
      </Section>
    </div>
  );
}

/* ── Security panel (controlled) ─────────────────────────────────── */
function ChangePasswordModal({ onClose, onToast }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (next.length < 8) { onToast?.('New password must be at least 8 characters'); return; }
    if (next !== confirm) { onToast?.('Passwords don’t match'); return; }
    setBusy(true);
    try {
      await apiPost('/api/auth/change-password', { currentPassword: cur, newPassword: next });
      onToast?.('Password changed ✓'); onClose();
    } catch (e) { onToast?.(e.message || 'Could not change password'); }
    finally { setBusy(false); }
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 400, background: C.surface, borderRadius: 16, padding: '20px 22px', fontFamily: C.font }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>Change Password</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.muted2 }}><Ico ti="ti-x" size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Current password" style={inputStyle} />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (min 8 chars)" style={inputStyle} />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" style={inputStyle} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, border: `1.5px solid ${C.border}`, background: C.surface, color: C.ink, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>Cancel</button>
          <button onClick={submit} disabled={busy || !cur || !next} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, border: 'none', background: busy || !cur || !next ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: busy || !cur || !next ? C.muted2 : '#fff', fontSize: 12.5, fontWeight: 800, cursor: busy || !cur || !next ? 'default' : 'pointer', fontFamily: C.font }}>{busy ? 'Saving…' : 'Update'}</button>
        </div>
      </div>
    </div>
  );
}

function SecurityPanel({ value, onChange, onToast }) {
  const v = value || {};
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <div>
      <Section color="#F59E0B" icon={AlertTriangle} ti="ti-alert-triangle" title="Website Maintenance Mode">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: C.font }}>Enable Maintenance Mode</span>
        <Toggle on={!!v.maintenanceMode} onChange={(on) => onChange({ ...v, maintenanceMode: on })} />
      </div>
      <p style={{ fontSize: 12, color: C.muted, margin: '0 0 26px', fontFamily: C.font, lineHeight: 1.6 }}>
        When active, a <b style={{ color: C.ink }}>maintenance banner</b> is shown across your public school website so visitors know some information may be temporarily unavailable. Your admin panel is unaffected.
      </p>
      </Section>

      <Section color={C.brand} icon={ShieldCheck} ti="ti-shield-check" title="Account Security">
      <SettingsCard
        icon={<Ico ti="ti-key" size={17} color={ACCENT} />}
        title="Change Password"
        subtitle="Update your admin login password"
        onClick={() => setPwOpen(true)}
      />

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} onToast={onToast} />}
      </Section>
    </div>
  );
}

/* ── Integrations panel (controlled) ─────────────────────────────── */
function IntegrationsPanel({ apiKey, onRegenerate, regenerating }) {
  const [reveal, setReveal] = useState(false);
  const masked = apiKey ? '•'.repeat(Math.max(24, apiKey.length)) : 'No API key generated yet';
  return (
    <div>
      <Section color={BLUE} icon={Fingerprint} ti="ti-fingerprint" title="Biometric API Access">
      <p style={{ fontSize: 12.5, color: C.muted, margin: '0 0 18px', fontFamily: C.font, lineHeight: 1.6 }}>
        This API Key is used by the Windows Biometric Sync Agent to communicate with the server. Keep it secret.
      </p>
      <Field label="Current API Key">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ ...inputStyle, flex: 1, minWidth: 220, fontFamily: 'ui-monospace, Menlo, monospace', color: C.muted, background: C.bg, display: 'flex', alignItems: 'center' }}>
            {reveal ? (apiKey || '—') : masked}
          </div>
          <button onClick={() => setReveal((r) => !r)} disabled={!apiKey} style={{ padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.surface, color: C.muted, cursor: apiKey ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center' }}>
            {reveal ? <Ico ti="ti-eye-off" size={15} /> : <Ico ti="ti-eye" size={15} />}
          </button>
          <button onClick={onRegenerate} disabled={regenerating} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 10, border: 'none', background: regenerating ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: regenerating ? C.muted2 : '#fff', fontSize: 12.5, fontWeight: 800, cursor: regenerating ? 'default' : 'pointer', fontFamily: C.font, whiteSpace: 'nowrap' }}>
            {regenerating ? <Ico ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-refresh" size={13} />} Generate New Key
          </button>
        </div>
      </Field>

      <div style={{ marginTop: 20 }}>
        <Banner tone="warn">
          <b>Warning:</b> Generating a new key will instantly disconnect any Windows Agents using the old key. You must update the <code style={{ color: C.brandDeep, background: tint(7), padding: '1px 5px', borderRadius: 4 }}>appsettings.json</code> file on your Windows machine immediately.
        </Banner>
      </div>
      </Section>
    </div>
  );
}

/* ── Help & Support panel ────────────────────────────────────────── */
function HelpSupportPanel() {
  return (
    <div>
      <Section color={BLUE} icon={HelpCircle} ti="ti-help-circle" title="Help & Support">
        <SettingsCard icon={<Ico ti="ti-help-circle" size={17} color={ACCENT} />} title="Help Centre" subtitle="Browse guides and FAQs" onClick={() => window.open(`${SITE_URL}/contact`, '_blank', 'noopener')} />
        <SettingsCard icon={<Ico ti="ti-bug" size={17} color={ACCENT} />} title="Report a Bug" subtitle="Something not working right?" onClick={() => { window.location.href = `mailto:${SUPPORT_EMAIL}?subject=Bug%20report%20(School%20app)`; }} />
        <SettingsCard icon={<Ico ti="ti-message-circle" size={17} color={ACCENT} />} title="Contact Us" subtitle="Talk to the Akoro team" onClick={() => { window.location.href = `mailto:${SUPPORT_EMAIL}?subject=School%20support`; }} />
      </Section>
    </div>
  );
}

/* ── About panel ──────────────────────────────────────────────────── */
function AboutPanel() {
  return (
    <div>
      <Section color={C.brand} icon={Info} ti="ti-info-circle" title="About">
        <SettingsCard icon={<Ico ti="ti-file-text" size={17} color={ACCENT} />} title="Terms of Service" onClick={() => window.open(`${SITE_URL}/terms`, '_blank', 'noopener')} />
        <SettingsCard icon={<Ico ti="ti-file-text" size={17} color={ACCENT} />} title="Privacy Policy" onClick={() => window.open(`${SITE_URL}/privacy`, '_blank', 'noopener')} />
        <SettingsCard icon={<Ico ti="ti-info-circle" size={17} color={ACCENT} />} title="App Version" hint="1.0.0" chevron={false} />
      </Section>
    </div>
  );
}

const QUICK_GUIDE = {
  profile: [
    { t: 'Acronyms', d: 'Short names (e.g. “YIS”) are used in automated SMS templates to save characters and reduce carrier costs.' },
    { t: 'Images', d: 'Always use transparent PNGs. The favicon is auto-resized to 16×16, and the principal signature is stamped onto report cards.' },
  ],
  formats: [
    { t: 'Currency Locks', d: 'Changing the currency code here instantly updates the symbol across all historical and future financial receipts. Do this before your first transaction.' },
    { t: 'Receipt Engine', d: 'You can hot-swap the physical printing layout of fee receipts. Existing financial data remains completely unharmed.' },
    { t: 'Custom Receipt Format', d: 'Combine a prefix, academic session, date, and a sequential counter with your choice of separator.' },
    { t: 'Auto-Reset', d: 'The counter automatically resets to 1 when the active academic session changes.' },
  ],
  attendance: [
    { t: 'Smart Attendance', d: 'If enabled, staff members attempting to punch-in via their smartphone are mathematically verified against the Global Radius provided. They must physically be inside the campus GPS geofence to successfully log attendance.' },
    { t: 'Punch Windows', d: 'Staff cannot clock-in before the “Start” time or after the “End” time, strictly enforcing shift discipline.' },
    { t: 'Hardware Biometrics', d: 'Hardware scanners send thousands of raw “punches”. The system uses the School Start Time and Grace Period to automatically decide if the first punch of the morning should be labeled Late.' },
  ],
  security: [
    { t: 'Maintenance Mode', d: 'A “Panic Button”. Instantly drops all active sessions for Parents and Students and locks them out. Use this when running grading algorithms or financial rollouts.' },
    { t: 'Account', d: 'Change admin login password in My Settings.' },
  ],
  integrations: [
    { t: 'API Key', d: 'Never share this key. It is the cryptographic handshake that allows your physical Windows terminal to sync securely directly into this cloud database.' },
  ],
  help: [
    { t: 'Response Time', d: 'Our team typically replies to support tickets within one business day.' },
    { t: 'Bug Reports', d: 'Include screenshots and steps to reproduce so we can fix it faster.' },
  ],
  about: [
    { t: 'Updates', d: 'Akoro School is updated regularly — check back here for the latest app version.' },
  ],
};

function QuickGuide({ tab }) {
  const items = QUICK_GUIDE[tab] || QUICK_GUIDE.profile;
  return (
    <WalletPanel style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}22`, padding: '14px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <Ico ti="ti-book" size={15} color={BLUE} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: BLUE, fontFamily: C.font }}>Quick Guide</span>
      </div>
      {items.map((it, i) => (
        <p key={it.t} style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, margin: i === 0 ? '0 0 0' : '10px 0 0', fontFamily: C.font, ...(i > 0 ? { paddingTop: 10, borderTop: `1px solid ${BLUE}18` } : {}) }}>
          <b style={{ color: C.ink }}>{it.t}:</b> {it.d}
        </p>
      ))}
    </WalletPanel>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
const VALID_TABS = ['profile', 'formats', 'attendance', 'security', 'integrations', 'help', 'about'];
const NO_SAVE_TABS = ['integrations', 'help', 'about']; // these persist via their own actions, not the footer button


export { EDUCATION_LEVELS, OWNERSHIP_TYPES, CURRICULA, GENDER_TYPES, BOARDING_TYPES, STUDENT_BANDS, TABS, EXTERNAL, LANGUAGES, ACCENTS, COUNTRIES, THEMES, CURRENCIES, Field, inputStyle, Section, Toggle, Banner, UploadTile, SchoolProfilePanel, SystemFormatsPanel, AttendancePanel, SecurityPanel, IntegrationsPanel, HelpSupportPanel, AboutPanel, QUICK_GUIDE, QuickGuide, VALID_TABS, NO_SAVE_TABS };
