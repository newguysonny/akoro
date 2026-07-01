import { useState } from 'react';
import {
  Building2, SlidersHorizontal, Clock, ShieldCheck, Plug, Facebook, Send,
  Bell, BookOpen, Info, Sparkles, Save, ExternalLink, Upload,
  Settings2, Warehouse, Hash, MapPin, Fingerprint, UserCog,
  AlertTriangle, Eye, EyeOff, RefreshCw, Check,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, RED, FONT } from '../constants.js';

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

/* ── System & Formats panel ──────────────────────────────────────── */
const THEMES = [
  'Classic Dashboard (Legacy)', 'Action V2 (Clean)', 'Action V2 (Colorful)', 'Action V3 (Smart Auto-Arrange) ✨',
  'Mac OS Style (Informative & Active) 🍎', 'Futuristic Command Center (Extreme Data) 🚀',
  'Analytics Pro (Light & Colorful) 📊', 'Executive Pro (All-in-One Premium) ♦',
];
const CURRENCIES = ['Nigerian Naira (₦)', 'Indian Rupee (₹)', 'US Dollar ($)', 'Kenyan Shilling (KSh)', 'Ghanaian Cedi (₵)'];

function SystemFormatsPanel() {
  const [udise, setUdise] = useState('AKS');
  const [affiliated, setAffiliated] = useState('W.A.E.C');
  const [theme, setTheme] = useState(THEMES[1]);
  const [currency, setCurrency] = useState(CURRENCIES[0]);
  const [taxLabel, setTaxLabel] = useState('VAT');
  const [taxId, setTaxId] = useState('TIN');
  const [prefix, setPrefix] = useState('SCH');

  return (
    <div>
      <SectionHeader color={BLUE} icon={Settings2} title="System & Academic Settings" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="School Code / UDISE"><input style={inputStyle} value={udise} onChange={(e) => setUdise(e.target.value)} /></Field>
        <Field label="Affiliated By"><input style={inputStyle} value={affiliated} onChange={(e) => setAffiliated(e.target.value)} /></Field>
      </div>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 4px', fontFamily: FONT }}>Dashboard Design Theme</p>
      <p style={{ fontSize: 12, color: MUTED, margin: '0 0 14px', fontFamily: FONT }}>Choose the visual layout of your administration dashboard.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 26 }}>
        {THEMES.map((t) => {
          const on = theme === t;
          return (
            <button key={t} onClick={() => setTheme(t)} style={{
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
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Default Fee Receipt Template">
          <select style={{ ...inputStyle, cursor: 'pointer' }} defaultValue="auto">
            <option value="auto">Default Fee Receipt (Auto-Generated)</option>
            <option value="minimal">Minimal Receipt</option>
            <option value="detailed">Detailed Receipt</option>
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="Mobile App Receipt Template">
            <select style={{ ...inputStyle, cursor: 'pointer' }} defaultValue="">
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
          <Field label="Tax Label (e.g. GST, VAT, Tax)"><input style={inputStyle} value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} /></Field>
          <p style={{ fontSize: 11.5, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>Used as the column header for taxes in the inventory module.</p>
        </div>
        <div>
          <Field label="Tax ID Label (e.g. GSTIN, VAT No.)"><input style={inputStyle} value={taxId} onChange={(e) => setTaxId(e.target.value)} /></Field>
          <p style={{ fontSize: 11.5, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>Used on supplier forms and invoices.</p>
        </div>
      </div>

      <SectionHeader color={BLUE} icon={Hash} title="Fee Receipt Numbering" />
      <div style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}22`, borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12.5, fontFamily: FONT }}>
        Live Preview: <b style={{ color: BLUE }}>{prefix || 'SCH'}-2027-2028-JUL26-0005</b>
      </div>
      <Field label="Receipt Prefix"><input style={{ ...inputStyle, maxWidth: 260 }} value={prefix} onChange={(e) => setPrefix(e.target.value)} /></Field>
    </div>
  );
}

/* ── Attendance panel ─────────────────────────────────────────────── */
function AttendancePanel() {
  const [geo, setGeo] = useState(false);
  const [lat, setLat] = useState('6.5244');
  const [lng, setLng] = useState('3.3792');
  const [radius, setRadius] = useState('1000');
  const [inStart, setInStart] = useState('07:00'), [inEnd, setInEnd] = useState('08:00');
  const [outStart, setOutStart] = useState('14:00'), [outEnd, setOutEnd] = useState('15:00');
  const [bioInStart, setBioInStart] = useState('06:30'), [bioInEnd, setBioInEnd] = useState('09:00');
  const [bioOutStart, setBioOutStart] = useState('13:00'), [bioOutEnd, setBioOutEnd] = useState('18:00');
  const [schoolStart, setSchoolStart] = useState('08:00');
  const [grace, setGrace] = useState('15');

  return (
    <div>
      <SectionHeader color={BLUE} icon={MapPin} title="Staff Geolocation & Time Settings" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>Enable Geolocation Restrictions for Staff App Punch In/Out</span>
        <Toggle on={geo} onChange={setGeo} />
      </div>
      <p style={{ fontSize: 11.5, color: MUTED2, margin: '0 0 20px', fontFamily: FONT }}>Toggle whether mobile app attendance relies on physical GPS distance to the school.</p>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 12px', fontFamily: FONT }}>Global Campus Coordinates</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="Latitude"><input style={inputStyle} value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
        <Field label="Longitude"><input style={inputStyle} value={lng} onChange={(e) => setLng(e.target.value)} /></Field>
        <Field label="Radius (Meters)"><input style={inputStyle} value={radius} onChange={(e) => setRadius(e.target.value)} /></Field>
      </div>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 12px', fontFamily: FONT }}>Allowed Punch Time Windows</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 26 }}>
        <Field label="Punch In Start"><input type="time" style={inputStyle} value={inStart} onChange={(e) => setInStart(e.target.value)} /></Field>
        <Field label="Punch In End"><input type="time" style={inputStyle} value={inEnd} onChange={(e) => setInEnd(e.target.value)} /></Field>
        <Field label="Punch Out Start"><input type="time" style={inputStyle} value={outStart} onChange={(e) => setOutStart(e.target.value)} /></Field>
        <Field label="Punch Out End"><input type="time" style={inputStyle} value={outEnd} onChange={(e) => setOutEnd(e.target.value)} /></Field>
      </div>

      <SectionHeader color={AMBER} icon={Fingerprint} title="Biometric Attendance Settings" />
      <p style={{ fontSize: 12, color: MUTED, margin: '0 0 16px', fontFamily: FONT, lineHeight: 1.55 }}>
        Configure how biometric device punches are mapped to Clock-In / Clock-Out. If left empty, the system uses smart fallback (first punch = in, last punch = out).
      </p>
      <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 12px', fontFamily: FONT }}>Biometric Punch Time Windows</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 22 }}>
        <Field label="Punch In Start"><input type="time" style={inputStyle} value={bioInStart} onChange={(e) => setBioInStart(e.target.value)} /></Field>
        <Field label="Punch In End"><input type="time" style={inputStyle} value={bioInEnd} onChange={(e) => setBioInEnd(e.target.value)} /></Field>
        <Field label="Punch Out Start"><input type="time" style={inputStyle} value={bioOutStart} onChange={(e) => setBioOutStart(e.target.value)} /></Field>
        <Field label="Punch Out End"><input type="time" style={inputStyle} value={bioOutEnd} onChange={(e) => setBioOutEnd(e.target.value)} /></Field>
      </div>

      <p style={{ fontSize: 12.5, fontWeight: 700, color: INK, margin: '0 0 12px', fontFamily: FONT }}>Late Detection</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <div>
          <Field label="School Start Time"><input type="time" style={inputStyle} value={schoolStart} onChange={(e) => setSchoolStart(e.target.value)} /></Field>
          <p style={{ fontSize: 11, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>Used to auto-detect “Late” status for biometric attendance.</p>
        </div>
        <div>
          <Field label="Grace Period (Minutes)"><input style={inputStyle} value={grace} onChange={(e) => setGrace(e.target.value)} /></Field>
          <p style={{ fontSize: 11, color: MUTED2, margin: '6px 0 0', fontFamily: FONT }}>Minutes after school start time before marking as Late.</p>
        </div>
      </div>
    </div>
  );
}

/* ── Security panel ───────────────────────────────────────────────── */
function SecurityPanel() {
  const [maintenance, setMaintenance] = useState(false);
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
        <Toggle on={maintenance} onChange={setMaintenance} />
      </div>
      <p style={{ fontSize: 12, color: MUTED, margin: 0, fontFamily: FONT, lineHeight: 1.6 }}>
        When active, <b style={{ color: INK }}>Students and Parents</b> will be blocked from accessing the portal and mobile app. Staff and Admins still have access to the panel.
      </p>
    </div>
  );
}

/* ── Integrations panel ───────────────────────────────────────────── */
function IntegrationsPanel() {
  const [reveal, setReveal] = useState(false);
  const key = 'sk_live_8f2a1c9e4b7d6f30a1c8e5b2d947f61a';
  const masked = '•'.repeat(32);
  return (
    <div>
      <SectionHeader color={BLUE} icon={Fingerprint} title="Biometric API Access" />
      <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 18px', fontFamily: FONT, lineHeight: 1.6 }}>
        This API Key is used by the Windows Biometric Sync Agent to communicate with the server. Keep it secret.
      </p>
      <Field label="Current API Key">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ ...inputStyle, flex: 1, minWidth: 220, fontFamily: 'ui-monospace, Menlo, monospace', color: MUTED, background: LIGHT, display: 'flex', alignItems: 'center' }}>
            {reveal ? key : masked}
          </div>
          <button onClick={() => setReveal((r) => !r)} style={{ padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}>
            <RefreshCw size={13} /> Generate New Key
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
          <QuickGuide tab={tab} />
        </aside>

        {/* Right content card */}
        <section style={{ flex: 1, minWidth: 300, background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: '22px 24px' }}>
          {tab === 'profile'      && <SchoolProfilePanel />}
          {tab === 'formats'      && <SystemFormatsPanel />}
          {tab === 'attendance'   && <AttendancePanel />}
          {tab === 'security'     && <SecurityPanel />}
          {tab === 'integrations' && <IntegrationsPanel />}

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
