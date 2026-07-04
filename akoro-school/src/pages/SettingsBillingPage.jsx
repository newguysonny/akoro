import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2, SlidersHorizontal, Clock, ShieldCheck, Plug, Facebook, Send,
  Bell, BookOpen, Info, Sparkles, Save, ExternalLink, Upload,
  Settings2, Warehouse, Hash, MapPin, Fingerprint, UserCog, GraduationCap,
  AlertTriangle, Eye, EyeOff, RefreshCw, Check, Languages, Moon, Palette,
  Key, Lock, PauseCircle, Trash2, HelpCircle, Bug, MessageCircle, FileText,
  ChevronRight, Globe, Loader2,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { apiGet, apiPut, apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, RED, FONT } from '../constants.js';
import { COUNTRIES as GEO_COUNTRIES, NG_STATES } from '../data/locations.js';

const EDUCATION_LEVELS = ['Nursery / Pre-school', 'Primary', 'Junior Secondary', 'Senior Secondary'];
const OWNERSHIP_TYPES  = ['Private', 'Public / Government', 'Faith-based / Mission', 'Community'];
const CURRICULA        = ['Nigerian (WAEC/NECO)', 'British / Cambridge', 'Montessori', 'American', 'International Baccalaureate', 'Mixed / Other'];
const GENDER_TYPES     = ['Mixed', 'Boys only', 'Girls only'];
const BOARDING_TYPES   = ['Day only', 'Boarding only', 'Day & Boarding'];
const STUDENT_BANDS    = ['1 – 100', '101 – 300', '301 – 600', '601 – 1,000', '1,000+'];

/* ── Tab config ──────────────────────────────────────────────────── */
const TABS = [
  { key: 'profile',      label: 'School Profile',    icon: Building2 },
  { key: 'formats',      label: 'System & Formats',  icon: SlidersHorizontal },
  { key: 'attendance',   label: 'Attendance',        icon: Clock },
  { key: 'security',     label: 'Privacy & Security', icon: ShieldCheck },
  { key: 'integrations', label: 'Integrations',      icon: Plug },
  { key: 'help',         label: 'Help & Support',    icon: HelpCircle },
  { key: 'about',        label: 'About',             icon: Info },
];
const EXTERNAL = [
  { key: 'social',        label: 'Social Media',  icon: Facebook, external: true, to: '/settings-social-media' },
  { key: 'telegram',      label: 'Telegram Bot',  icon: Send,     external: true, to: '/settings-telegram' },
  { key: 'domain',        label: 'Domain',        icon: Globe,    external: true, to: '/settings-domain' },
  { key: 'notifications', label: 'Notifications', icon: Bell,     external: true, to: '/settings-notifications' },
];
const LANGUAGES = ['English', 'Yoruba', 'Igbo', 'Hausa', 'Pidgin', 'French', 'Arabic'];
const ACCENTS   = [AMBER, '#6C3BFF', '#3B82F6', '#10B981', '#EC4899', '#F59E0B', '#EF4444', '#8B5CF6'];
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
function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 4px', border: 'none',
      background: 'transparent', cursor: 'pointer', fontFamily: FONT,
    }}>
      <span style={{
        width: 42, height: 24, borderRadius: 999, background: on ? GREEN : '#D8D5CE',
        position: 'relative', transition: 'background .15s', flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18,
          borderRadius: '50%', background: WHITE, transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.25)',
        }} />
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 800, color: on ? GREEN : MUTED2 }}>{on ? 'ON' : 'OFF'}</span>
    </button>
  );
}
function Banner({ tone = 'warn', children }) {
  const colors = { warn: '#F59E0B', info: BLUE };
  const c = colors[tone];
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: `${c}12`, border: `1px solid ${c}33`, borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: INK, lineHeight: 1.55, fontFamily: FONT }}>
      <AlertTriangle size={15} color={c} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
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

function Row({ icon: Icon, label, sublabel, right, onClick, danger, last }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '13px 4px',
        borderBottom: last ? 'none' : `1px solid ${BORDER}`, cursor: onClick ? 'pointer' : 'default',
        color: danger ? RED : INK, transition: 'background .1s', borderRadius: 8,
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = LIGHT; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {Icon && (
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: danger ? `${RED}15` : `${AMBER}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: danger ? RED : AMBER,
        }}>
          <Icon size={16} />
        </div>
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, fontFamily: FONT }}>{label}</div>
        {sublabel && <div style={{ fontSize: 11.5, color: MUTED2, fontFamily: FONT, marginTop: 2 }}>{sublabel}</div>}
      </div>
      {right ?? (onClick && <ChevronRight size={16} color={MUTED2} />)}
    </div>
  );
}

/* ── School Profile panel (controlled) ───────────────────────────── */
function SchoolProfilePanel({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const ngStates = value.country === 'Nigeria' ? Object.keys(NG_STATES) : [];
  const lgaOptions = value.country === 'Nigeria' ? (NG_STATES[value.state] || []) : [];
  const levels = Array.isArray(value.educationLevels) ? value.educationLevels : [];
  const toggleLevel = (l) => onChange({ ...value, educationLevels: levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l] });
  return (
    <div>
      <SectionHeader color={BLUE} icon={Info} title="General Information" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
        <Field label="School Name" required><input style={inputStyle} value={value.name || ''} onChange={set('name')} /></Field>
        <Field label="Short Name / Acronym"><input style={inputStyle} value={value.acronym || ''} onChange={set('acronym')} /></Field>
        <Field label="School Email" required><input style={{ ...inputStyle, background: LIGHT, color: MUTED }} value={value.email || ''} disabled title="Change your login email from Privacy & Security" /></Field>
        <Field label="Phone Number"><input style={inputStyle} value={value.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Principal Name"><input style={inputStyle} value={value.principal || ''} onChange={set('principal')} /></Field>
      </div>

      <SectionHeader color={BLUE} icon={MapPin} title="Location" />
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

      <SectionHeader color={GREEN} icon={GraduationCap} title="Academics" />
      <Field label="Education Levels Offered">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {EDUCATION_LEVELS.map((l) => {
            const on = levels.includes(l);
            return <button key={l} type="button" onClick={() => toggleLevel(l)} style={{ padding: '8px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1.5px solid ${on ? AMBER : BORDER}`, background: on ? AMBER : WHITE, color: on ? WHITE : MUTED, fontFamily: FONT }}>{l}</button>;
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

      <SectionHeader color={AMBER} icon={Sparkles} title="Branding & Appearance" />
      <div style={{ display: 'flex', gap: 36, flexWrap: 'wrap' }}>
        <UploadTile label="School Logo" preview={value.logoUrl ? <img src={value.logoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null} />
        <UploadTile label="Favicon (.ico, .png)" preview={value.faviconUrl ? <img src={value.faviconUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null} />
        <UploadTile label="Principal Signature" preview={value.signatureUrl ? <img src={value.signatureUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null} />
      </div>
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
      <SectionHeader color={BLUE} icon={Settings2} title="System & Academic Settings" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="School Code / UDISE"><input style={inputStyle} value={f.udise || ''} onChange={setF('udise')} /></Field>
        <Field label="Affiliated By"><input style={inputStyle} value={f.affiliatedBy || ''} onChange={setF('affiliatedBy')} /></Field>
      </div>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 4px', fontFamily: FONT }}>Dashboard Design Theme</p>
      <p style={{ fontSize: 12, color: MUTED, margin: '0 0 14px', fontFamily: FONT }}>Choose the visual layout of your administration dashboard.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 26 }}>
        {THEMES.map((t) => {
          const on = (f.theme || THEMES[1]) === t;
          return (
            <button key={t} onClick={() => onFormatsChange({ ...f, theme: t })} style={{
              textAlign: 'left', padding: 0, border: `2px solid ${on ? BLUE : BORDER}`, borderRadius: 12,
              background: WHITE, cursor: 'pointer', overflow: 'hidden', fontFamily: FONT, position: 'relative',
            }}>
              <div style={{ height: 60, background: `linear-gradient(135deg, ${AMBER}22, ${BLUE}22)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {on && <span style={{ background: BLUE, color: WHITE, borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={13} /></span>}
              </div>
              <p style={{ fontSize: 11.5, fontWeight: 700, color: INK, margin: 0, padding: '8px 10px' }}>{t}</p>
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
          <p style={{ fontSize: 11.5, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>PDF shown to parents/students in the mobile app. Leave blank to reuse the default.</p>
        </div>
      </div>

      <SectionHeader color={AMBER} icon={Warehouse} title="Inventory Tax Settings" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 22 }}>
        <div>
          <Field label="Tax Label (e.g. GST, VAT, Tax)"><input style={inputStyle} value={f.taxLabel || ''} onChange={setF('taxLabel')} /></Field>
          <p style={{ fontSize: 11.5, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>Used as the column header for taxes in the inventory module.</p>
        </div>
        <div>
          <Field label="Tax ID Label (e.g. GSTIN, VAT No.)"><input style={inputStyle} value={f.taxId || ''} onChange={setF('taxId')} /></Field>
          <p style={{ fontSize: 11.5, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>Used on supplier forms and invoices.</p>
        </div>
      </div>

      <SectionHeader color={BLUE} icon={Hash} title="Fee Receipt Numbering" />
      <div style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}22`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, fontFamily: FONT }}>
        Live Preview: <b style={{ color: BLUE }}>{f.receiptPrefix || 'SCH'}-2027-2028-JUL26-0005</b>
      </div>
      <Field label="Receipt Prefix"><input style={{ ...inputStyle, maxWidth: 260 }} value={f.receiptPrefix || ''} onChange={setF('receiptPrefix')} /></Field>

      <div style={{ marginTop: 26 }}>
        <SectionHeader color={AMBER} icon={Palette} title="Personalisation" />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Row
            icon={Languages}
            label="Language"
            sublabel={p.language || 'English'}
            right={
              <select value={p.language || 'English'} onChange={(e) => setP('language')(e.target.value)}
                style={{ border: `1.5px solid ${BORDER}`, borderRadius: 8, padding: '6px 10px', fontFamily: FONT, fontSize: 13, background: WHITE, color: INK, cursor: 'pointer' }}>
                {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
              </select>
            }
          />
          <Row
            icon={Moon}
            label="Dark Mode"
            sublabel="Currently in preview"
            right={<Toggle on={!!p.darkMode} onChange={(v) => setP('darkMode')(v)} />}
          />
          <Row
            icon={Palette}
            label="Accent Colour"
            last
            right={
              <div style={{ display: 'flex', gap: 6 }}>
                {ACCENTS.map((c) => (
                  <div key={c} onClick={() => setP('accentColour')(c)} style={{
                    width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer',
                    outline: (p.accentColour || AMBER) === c ? `2px solid ${c}` : 'none', outlineOffset: 2,
                  }} />
                ))}
              </div>
            }
          />
        </div>
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
      <SectionHeader color={BLUE} icon={MapPin} title="Staff Geolocation & Time Settings" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>Enable Geolocation Restrictions for Staff App Punch In/Out</span>
        <Toggle on={!!v.geoRestriction} onChange={(on) => onChange({ ...v, geoRestriction: on })} />
      </div>
      <p style={{ fontSize: 11.5, color: MUTED2, margin: '0 0 20px', fontFamily: FONT }}>Toggle whether mobile app attendance relies on physical GPS distance to the school.</p>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 12px', fontFamily: FONT }}>Global Campus Coordinates</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="Latitude"><input style={inputStyle} value={v.latitude || ''} onChange={set('latitude')} /></Field>
        <Field label="Longitude"><input style={inputStyle} value={v.longitude || ''} onChange={set('longitude')} /></Field>
        <Field label="Radius (Meters)"><input style={inputStyle} value={v.radiusMeters || ''} onChange={set('radiusMeters')} /></Field>
      </div>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 12px', fontFamily: FONT }}>Allowed Punch Time Windows</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 26 }}>
        <Field label="Punch In Start"><input type="time" style={inputStyle} value={v.punchInStart || ''} onChange={set('punchInStart')} /></Field>
        <Field label="Punch In End"><input type="time" style={inputStyle} value={v.punchInEnd || ''} onChange={set('punchInEnd')} /></Field>
        <Field label="Punch Out Start"><input type="time" style={inputStyle} value={v.punchOutStart || ''} onChange={set('punchOutStart')} /></Field>
        <Field label="Punch Out End"><input type="time" style={inputStyle} value={v.punchOutEnd || ''} onChange={set('punchOutEnd')} /></Field>
      </div>

      <SectionHeader color={AMBER} icon={Fingerprint} title="Biometric Attendance Settings" />
      <p style={{ fontSize: 12, color: MUTED, margin: '0 0 16px', fontFamily: FONT, lineHeight: 1.55 }}>
        Configure how biometric device punches are mapped to Clock-In / Clock-Out. If left empty, the system uses smart fallback (first punch = in, last punch = out).
      </p>
      <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 12px', fontFamily: FONT }}>Biometric Punch Time Windows</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="Punch In Start"><input type="time" style={inputStyle} value={v.bioPunchInStart || ''} onChange={set('bioPunchInStart')} /></Field>
        <Field label="Punch In End"><input type="time" style={inputStyle} value={v.bioPunchInEnd || ''} onChange={set('bioPunchInEnd')} /></Field>
        <Field label="Punch Out Start"><input type="time" style={inputStyle} value={v.bioPunchOutStart || ''} onChange={set('bioPunchOutStart')} /></Field>
        <Field label="Punch Out End"><input type="time" style={inputStyle} value={v.bioPunchOutEnd || ''} onChange={set('bioPunchOutEnd')} /></Field>
      </div>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 12px', fontFamily: FONT }}>Late Detection</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <div>
          <Field label="School Start Time"><input type="time" style={inputStyle} value={v.schoolStartTime || ''} onChange={set('schoolStartTime')} /></Field>
          <p style={{ fontSize: 11, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>Used to auto-detect “Late” status for biometric attendance.</p>
        </div>
        <div>
          <Field label="Grace Period (Minutes)"><input style={inputStyle} value={v.gracePeriodMinutes || ''} onChange={set('gracePeriodMinutes')} /></Field>
          <p style={{ fontSize: 11, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>Minutes after school start time before marking as Late.</p>
        </div>
      </div>
    </div>
  );
}

/* ── Security panel (controlled) ─────────────────────────────────── */
function SecurityPanel({ value, onChange }) {
  const v = value || {};
  return (
    <div>
      <SectionHeader color={BLUE} icon={UserCog} title="Admin Account Security" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: LIGHT, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px', marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${BLUE}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <UserCog size={18} color={BLUE} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ fontSize: 13.5, fontWeight: 800, color: INK, margin: '0 0 3px', fontFamily: FONT }}>Administrator Password & Profile</p>
          <p style={{ fontSize: 12, color: MUTED, margin: 0, fontFamily: FONT }}>Update your personal login password, profile picture, and account details.</p>
        </div>
        <button style={{ padding: '9px 16px', borderRadius: 9, border: 'none', background: BLUE, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>Manage My Account</button>
      </div>

      <SectionHeader color="#F59E0B" icon={AlertTriangle} title="Portal Status (Maintenance Mode)" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>Enable Maintenance Mode</span>
        <Toggle on={!!v.maintenanceMode} onChange={(on) => onChange({ ...v, maintenanceMode: on })} />
      </div>
      <p style={{ fontSize: 12, color: MUTED, margin: '0 0 26px', fontFamily: FONT, lineHeight: 1.6 }}>
        When active, <b style={{ color: INK }}>Students and Parents</b> will be blocked from accessing the portal and mobile app. Staff and Admins still have access to the panel.
      </p>

      <SectionHeader color={AMBER} icon={ShieldCheck} title="Privacy & Security" />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Row icon={Key}         label="Change Password" sublabel="Update your account password"     onClick={() => {}} />
        <Row icon={ShieldCheck} label="Two-Factor Auth"  sublabel="Add an extra layer of security"    onClick={() => {}} />
        <Row icon={Lock}        label="Active Sessions"  sublabel="View and revoke active sessions"   onClick={() => {}} />
        <Row icon={PauseCircle} label="Deactivate Account" sublabel="Temporarily disable your account" onClick={() => {}} danger />
        <Row icon={Trash2}      label="Delete Account"   sublabel="Permanently remove all your data"  onClick={() => {}} danger last />
      </div>
    </div>
  );
}

/* ── Integrations panel (controlled) ─────────────────────────────── */
function IntegrationsPanel({ apiKey, onRegenerate, regenerating }) {
  const [reveal, setReveal] = useState(false);
  const masked = apiKey ? '•'.repeat(Math.max(24, apiKey.length)) : 'No API key generated yet';
  return (
    <div>
      <SectionHeader color={BLUE} icon={Fingerprint} title="Biometric API Access" />
      <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 18px', fontFamily: FONT, lineHeight: 1.6 }}>
        This API Key is used by the Windows Biometric Sync Agent to communicate with the server. Keep it secret.
      </p>
      <Field label="Current API Key">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ ...inputStyle, flex: 1, minWidth: 220, fontFamily: 'ui-monospace, Menlo, monospace', color: MUTED, background: LIGHT, display: 'flex', alignItems: 'center' }}>
            {reveal ? (apiKey || '—') : masked}
          </div>
          <button onClick={() => setReveal((r) => !r)} disabled={!apiKey} style={{ padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, cursor: apiKey ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center' }}>
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button onClick={onRegenerate} disabled={regenerating} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 10, border: 'none', background: regenerating ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: regenerating ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: regenerating ? 'default' : 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}>
            {regenerating ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <RefreshCw size={13} />} Generate New Key
          </button>
        </div>
      </Field>

      <div style={{ marginTop: 20 }}>
        <Banner tone="warn">
          <b>Warning:</b> Generating a new key will instantly disconnect any Windows Agents using the old key. You must update the <code style={{ color: '#D4651E', background: `${AMBER}12`, padding: '1px 5px', borderRadius: 4 }}>appsettings.json</code> file on your Windows machine immediately.
        </Banner>
      </div>
    </div>
  );
}

/* ── Help & Support panel ────────────────────────────────────────── */
function HelpSupportPanel() {
  return (
    <div>
      <SectionHeader color={BLUE} icon={HelpCircle} title="Help & Support" />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Row icon={HelpCircle}    label="Help Centre"  sublabel="Browse guides and FAQs"       onClick={() => {}} />
        <Row icon={Bug}           label="Report a Bug" sublabel="Something not working right?"  onClick={() => {}} />
        <Row icon={MessageCircle} label="Contact Us"   sublabel="Talk to the Akoro team"        onClick={() => {}} last />
      </div>
    </div>
  );
}

/* ── About panel ──────────────────────────────────────────────────── */
function AboutPanel() {
  return (
    <div>
      <SectionHeader color={AMBER} icon={Info} title="About" />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Row icon={FileText} label="Terms of Service" onClick={() => {}} />
        <Row icon={FileText} label="Privacy Policy"   onClick={() => {}} />
        <Row icon={Info}     label="App Version"       last right={<span style={{ fontSize: 13, color: MUTED2, fontFamily: FONT }}>1.0.0</span>} />
      </div>
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
    <div style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}22`, borderRadius: 14, padding: '14px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <BookOpen size={15} color={BLUE} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: BLUE, fontFamily: FONT }}>Quick Guide</span>
      </div>
      {items.map((it, i) => (
        <p key={it.t} style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6, margin: i === 0 ? '0 0 0' : '10px 0 0', fontFamily: FONT, ...(i > 0 ? { paddingTop: 10, borderTop: `1px solid ${BLUE}18` } : {}) }}>
          <b style={{ color: INK }}>{it.t}:</b> {it.d}
        </p>
      ))}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
const VALID_TABS = ['profile', 'formats', 'attendance', 'security', 'integrations', 'help', 'about'];
const NO_SAVE_TABS = ['integrations', 'help', 'about']; // these persist via their own actions, not the footer button

export default function SettingsBillingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialTab = VALID_TABS.includes(params.get('tab')) ? params.get('tab') : 'profile';
  const [tab, setTab] = useState(initialTab);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [toast, setToast] = useState('');
  const [profile, setProfile] = useState({});
  const [formats, setFormats] = useState({});
  const [attendance, setAttendance] = useState({});
  const [security, setSecurity] = useState({});
  const [integrations, setIntegrations] = useState({});
  const [personalisation, setPersonalisation] = useState({});

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet('/api/school/settings')
      .then((res) => {
        const d = res.data || {};
        setProfile(d.profile || {});
        setFormats(d.systemFormats || {});
        setAttendance(d.attendance || {});
        setSecurity(d.security || {});
        setIntegrations(d.integrations || {});
        setPersonalisation(d.personalisation || {});
      })
      .catch((e) => showToast(e.message || 'Could not load settings'))
      .finally(() => setLoading(false));
  }, []);

  const regenerateKey = async () => {
    setRegenerating(true);
    try {
      const res = await apiPost('/api/school/settings/integrations/regenerate-key', {});
      setIntegrations((prev) => ({ ...prev, biometricApiKey: res.data.biometricApiKey }));
      showToast('New API key generated ✓');
    } catch (e) { showToast(e.message || 'Could not generate key'); }
    finally { setRegenerating(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      if (tab === 'profile') {
        await apiPut('/api/school/settings/profile', profile);
      } else if (tab === 'formats') {
        await apiPut('/api/school/settings/system-formats', formats);
        await apiPut('/api/school/settings/personalisation', personalisation);
      } else if (tab === 'attendance') {
        await apiPut('/api/school/settings/attendance', attendance);
      } else if (tab === 'security') {
        await apiPut('/api/school/settings/security', security);
      }
      showToast('Saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  const TabButton = ({ t }) => {
    const on = tab === t.key;
    const go = () => {
      if (t.external) { if (t.to && t.to !== '#') navigate(t.to); return; }
      setTab(t.key);
    };
    return (
      <button onClick={go} style={{
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
    <PageLayout title="School Settings" subtitle="Manage your school profile, formats and integrations">
      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left tab rail */}
        <aside style={{ width: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {TABS.map((t) => <TabButton key={t.key} t={t} />)}
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: MUTED2, padding: '12px 13px 6px', fontFamily: FONT }}>EXTERNAL CHANNELS</div>
            {EXTERNAL.map((t) => <TabButton key={t.key} t={t} />)}
          </div>

          {/* Quick Guide */}
          <QuickGuide tab={tab} />
        </aside>

        {/* Right content card */}
        <section style={{ flex: 1, minWidth: 300, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '22px 24px' }}>
          {loading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2, fontFamily: FONT, fontSize: 13.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /> Loading settings…
            </div>
          ) : (
            <>
              {tab === 'profile'      && <SchoolProfilePanel value={profile} onChange={setProfile} />}
              {tab === 'formats'      && <SystemFormatsPanel formats={formats} onFormatsChange={setFormats} personalisation={personalisation} onPersonalisationChange={setPersonalisation} />}
              {tab === 'attendance'   && <AttendancePanel value={attendance} onChange={setAttendance} />}
              {tab === 'security'     && <SecurityPanel value={security} onChange={setSecurity} />}
              {tab === 'integrations' && <IntegrationsPanel apiKey={integrations.biometricApiKey} onRegenerate={regenerateKey} regenerating={regenerating} />}
              {tab === 'help'         && <HelpSupportPanel />}
              {tab === 'about'        && <AboutPanel />}

              {!NO_SAVE_TABS.includes(tab) && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 26, paddingTop: 18, borderTop: `1px solid ${BORDER}` }}>
                  <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT, boxShadow: saving ? 'none' : `0 4px 14px ${AMBER}44` }}>
                    {saving ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={15} />} {saving ? 'Saving…' : 'Save Settings'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>
      )}
    </PageLayout>
  );
}
