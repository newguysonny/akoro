/**
 * Student Information — shared foundation.
 * Constants, list/field config, and small presentational primitives reused
 * across the student pages. Page/feature files import from here.
 */
import { Ico } from '../../../theme/Ico.jsx';
import ResourcePage, { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { GREEN, RED, BLUE, PURPLE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';

const BASE = '/api/school/mgmt';
const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ');
const studentOpts = { resource: 'students', labelFn: (r) => `${fullName(r)} (${r.admission_no})` };

const STATUS_PILL = (v, map) => {
  const m = map[v] || { c: C.muted2 };
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: tint(8, m.c), color: m.c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v}</span>;
};

const STUDENT_FIELDS = [
  { key: 'admission_no', label: 'Admission No', required: true },
  { key: 'roll_no', label: 'Roll No' },
  { key: 'first_name', label: 'First Name', required: true },
  { key: 'last_name', label: 'Last Name', required: true },
  { key: 'gender', label: 'Gender', type: 'select', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }] },
  { key: 'dob', label: 'Date of Birth', type: 'date' },
  { key: 'class_id', label: 'Class', type: 'select', optionsFrom: { resource: 'classes' } },
  { key: 'section_id', label: 'Section', type: 'select', optionsFrom: { resource: 'sections', labelFn: (r) => `${r.class_name || ''} — ${r.name}` } },
  { key: 'category_id', label: 'Category', type: 'select', optionsFrom: { resource: 'student-categories' } },
  { key: 'house_id', label: 'House', type: 'select', optionsFrom: { resource: 'student-houses' } },
  { key: 'guardian_name', label: 'Guardian Name' },
  { key: 'guardian_phone', label: 'Guardian Phone' },
  { key: 'guardian_email', label: 'Guardian Email' },
  { key: 'blood_group', label: 'Blood Group' },
  { key: 'address', label: 'Address', type: 'textarea', full: true },
  { key: 'is_disabled', label: 'Has Disability', type: 'toggle' },
  { key: 'disability_note', label: 'Disability Note', full: true },
  { key: 'status', label: 'Status', type: 'select', default: 'active', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'alumni', label: 'Alumni' }] },
  { key: 'admitted_on', label: 'Admitted On', type: 'date' },
];

const STUDENT_COLUMNS = [
  { key: 'admission_no', label: 'Admission No' },
  { key: 'name', label: 'Name', render: (r) => <b>{fullName(r)}</b> },
  { key: 'class_name', label: 'Class' },
  { key: 'section_name', label: 'Section' },
  { key: 'guardian_phone', label: 'Guardian Phone' },
  { key: 'status', label: 'Status', render: (r) => STATUS_PILL(r.status, { active: { c: GREEN }, inactive: { c: RED }, alumni: { c: BLUE } }) },
];
const STUDENT_SEARCH = ['admission_no', 'first_name', 'last_name', 'guardian_phone'];
const CLASS_FILTER = { key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } };

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'alumni', label: 'Alumni' }];

/* ── Modal shell ──────────────────────────────────────────────────────────── */
function ModalShell({ title, onClose, width = 460, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, maxHeight: '86vh', overflowY: 'auto', background: C.surface, borderRadius: 16, padding: '20px 22px', fontFamily: C.font }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: C.ink }}>{title}</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: C.muted2 }}><Ico ti="ti-x" size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Profile info primitives (rows, grid cells, section card) ─────────────── */
function InfoRow({ icon: Icon, ti, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0' }}>
      {Icon && <Ico lucide={Icon} ti={ti} size={14} color={C.muted2} style={{ marginTop: 2, flexShrink: 0 }} />}
      <div style={{ minWidth: 130, fontSize: 11.5, fontWeight: 700, color: C.muted, fontFamily: C.font }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, color: C.ink, fontFamily: C.font }}>{value ?? <span style={{ color: C.muted2 }}>—</span>}</div>
    </div>
  );
}
// Grid cell: small uppercase label above the value — used for the Profile
// tab's read-only sections, which lay out as a 2-column grid (not a stacked
// list), matching the reference design.
function GridInfo({ icon: Icon, ti, label, value }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 800, color: C.muted2, textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4, fontFamily: C.font }}>
        {Icon && <Ico lucide={Icon} ti={ti} size={11} />} {label}
      </div>
      <div style={{ fontSize: 13, color: C.ink, fontFamily: C.font, fontWeight: 600 }}>{value ?? <span style={{ color: C.muted2, fontWeight: 400 }}>N/A</span>}</div>
    </div>
  );
}
function InfoGrid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '14px 18px' }}>{children}</div>;
}
function SectionCard({ title, color = BLUE, action, children }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink, fontFamily: C.font, textTransform: 'uppercase', letterSpacing: .4 }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

/* ── Ring / stat primitives (used across the profile tabs) ────────────────── */
function Ring({ percent, label, color = GREEN, size = 96 }) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `conic-gradient(${color} ${p * 3.6}deg, ${C.border} 0deg)`,
      }}>
        <div style={{ width: size - 18, height: size - 18, borderRadius: '50%', background: C.surface, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{p}%</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: C.muted2, fontFamily: C.font, textTransform: 'uppercase' }}>{label}</span>
        </div>
      </div>
    </div>
  );
}
const statPill = (label, value, color) => (
  <div style={{ flex: '1 1 110px', background: tint(7, color), border: `1px solid ${color}33`, borderRadius: 10, padding: '10px 12px' }}>
    <div style={{ fontSize: 15, fontWeight: 800, color, fontFamily: C.font }}>{value}</div>
    <div style={{ fontSize: 10, color: C.muted, fontFamily: C.font, textTransform: 'uppercase', letterSpacing: .3, marginTop: 2 }}>{label}</div>
  </div>
);
const FEE_STATUS_COLOR = { paid: GREEN, partial: C.brand, unpaid: RED };

export { BASE, fullName, studentOpts, STATUS_PILL, STUDENT_FIELDS, STUDENT_COLUMNS, STUDENT_SEARCH, CLASS_FILTER, naira, STATUS_OPTS, InfoRow, GridInfo, InfoGrid, SectionCard, Ring, statPill, FEE_STATUS_COLOR, ModalShell };
