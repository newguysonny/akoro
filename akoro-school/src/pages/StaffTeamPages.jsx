/**
 * Staff & Team — Academic / Non-Academic staff, grouped.
 *
 *   /staff/academic         → AcademicStaffPage      (grid of group cards)
 *   /staff/non-academic     → NonAcademicStaffPage   (grid of group cards)
 *   /staff/academic/:group  → StaffGroupPage         (staff table for one group)
 *   /staff/non-academic/:group → StaffGroupPage
 *
 * Mirrors the School Settings "external channels" pattern: a card opens a
 * dedicated page with a Back button, and each dedicated page is a staff table
 * (add / edit / delete / log out) scoped to that group.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Crown,
  GraduationCap,
  ClipboardList,
  HeartHandshake,
  Users,
  Briefcase,
  Calculator,
  Headphones,
  Shield,
  Sparkles,
  Bus,
  UtensilsCrossed,
  Wrench,
  Stethoscope,
  Monitor,
  Library,
  Megaphone,
  BedDouble,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import ResourcePage from '../components/mgmt/ResourcePage.jsx';
import BackButton from '../components/BackButton.jsx';
import { apiPost } from '../services/api.js';
import { GREEN, RED, BLUE } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';
import { confirmDialog } from '../components/ConfirmHost.jsx';

const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const ACADEMIC = {
  key: 'academic', path: '/staff/academic', label: 'Academic Staff',
  subtitle: 'Teaching and academic team, grouped by role',
  groups: [
    { name: 'Leadership', icon: Crown, ti: 'ti-crown', desc: 'Principal, VPs, Heads of School' },
    { name: 'Class Teacher', icon: GraduationCap, ti: 'ti-school', desc: 'Form and subject teachers' },
    { name: 'Academic Coordinators', icon: ClipboardList, ti: 'ti-clipboard-list', desc: 'Curriculum & exam coordinators' },
    { name: 'Special Needs Teacher', icon: HeartHandshake, ti: 'ti-heart-handshake', desc: 'SEN & inclusion specialists' },
    { name: 'Teaching Assistants', icon: Users, ti: 'ti-users', desc: 'Classroom support staff' },
  ],
};
const NON_ACADEMIC = {
  key: 'non-academic', path: '/staff/non-academic', label: 'Non-Academic Staff',
  subtitle: 'Administrative and support team, grouped by role',
  groups: [
    { name: 'Administration', icon: Briefcase, ti: 'ti-briefcase', desc: 'Office & admin staff' },
    { name: 'Bursary & Accounts', icon: Calculator, ti: 'ti-calculator', desc: 'Finance and fees team' },
    { name: 'Front Desk & Reception', icon: Headphones, ti: 'ti-headphones', desc: 'Reception and enquiries' },
    { name: 'Security', icon: Shield, ti: 'ti-shield', desc: 'Gate and campus security' },
    { name: 'Custodial & Cleaning', icon: Sparkles, ti: 'ti-sparkles', desc: 'Cleaners and janitorial' },
    { name: 'Drivers & Transport', icon: Bus, ti: 'ti-bus', desc: 'Bus drivers and transport' },
    { name: 'Kitchen & Catering', icon: UtensilsCrossed, ti: 'ti-tools-kitchen-2', desc: 'Kitchen and catering staff' },
    { name: 'Maintenance', icon: Wrench, ti: 'ti-tool', desc: 'Facilities and repairs' },
    { name: 'Medical & Nursing', icon: Stethoscope, ti: 'ti-stethoscope', desc: 'School nurse and clinic' },
    { name: 'ICT Support', icon: Monitor, ti: 'ti-device-desktop', desc: 'IT and technical support' },
    { name: 'Library', icon: Library, ti: 'ti-library', desc: 'Librarians and library assistants' },
    { name: 'Marketing & Communications', icon: Megaphone, ti: 'ti-speakerphone', desc: 'Marketing, PR and comms' },
    { name: 'Boarding & Welfare', icon: BedDouble, ti: 'ti-bed', desc: 'Matrons and house parents' },
  ],
};
const SECTIONS = { academic: ACADEMIC, 'non-academic': NON_ACADEMIC };

/* ── Quick / Setup guide (matches Settings & Domain pages) ───────────────── */
function Guide({ title = 'Quick Guide', items }) {
  return (
    <div style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}22`, borderRadius: 14, padding: '14px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Ico ti="ti-book" size={15} color={BLUE} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: BLUE, fontFamily: C.font }}>{title}</span>
      </div>
      {items.map((it, i) => (
        <p key={it.t} style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.6, margin: i === 0 ? 0 : '10px 0 0', fontFamily: C.font, ...(i > 0 ? { paddingTop: 10, borderTop: `1px solid ${BLUE}18` } : {}) }}>
          <b style={{ color: C.ink }}>{it.t}:</b> {it.d}
        </p>
      ))}
    </div>
  );
}

const GRID_GUIDE = (label) => [
  { t: 'Step 1', d: `Pick a role card below to open that group's staff list.` },
  { t: 'Step 2', d: 'Inside a group, click “Add Staff” to register a team member — they’re filed under that group automatically.' },
  { t: 'Step 3', d: 'Add each staff member’s email so their app login is linked (needed for “Log out”).' },
  { t: 'Step 4', d: `Edit or delete staff anytime; set status to Inactive to keep records without counting them as active ${label.toLowerCase()}.` },
];
const TABLE_GUIDE = [
  { t: 'Add staff', d: 'New staff you add here are automatically tagged to this group.' },
  { t: 'Email', d: 'Set the staff’s email to link their app account — required for “Log out” to end their sessions.' },
  { t: 'Log out', d: 'Instantly revokes all of that staff member’s active app sessions (they’ll need to sign in again).' },
  { t: 'Status', d: 'Mark a staff Inactive to keep their record without them showing as active staff.' },
];

/* ── Card grid (one per staff class) ─────────────────────────────────────── */
function StaffGroupsPage({ section }) {
  const navigate = useNavigate();
  return (
    <PageLayout title={section.label} subtitle={section.subtitle}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 460px', minWidth: 300, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {section.groups.map((g) => (
            <button key={g.name} onClick={() => navigate(`${section.path}/${slug(g.name)}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', padding: '16px 16px', borderRadius: 14, border: `1px solid ${C.border}`, background: C.surface, cursor: 'pointer', fontFamily: C.font, transition: 'all .12s' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.background = C.bg; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.surface; }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: tint(9), color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ico lucide={g.icon} ti={g.ti} size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{g.name}</div>
                <div style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>{g.desc}</div>
              </div>
              <Ico ti="ti-chevron-right" size={17} color={C.muted2} style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>
        <aside style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 340 }}>
          <Guide title="Setup Guide" items={GRID_GUIDE(section.label)} />
        </aside>
      </div>
    </PageLayout>
  );
}

export function AcademicStaffPage() { return <StaffGroupsPage section={ACADEMIC} />; }
export function NonAcademicStaffPage() { return <StaffGroupsPage section={NON_ACADEMIC} />; }

/* ── One group's staff table ─────────────────────────────────────────────── */
const EMPLOYMENT = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'contract', label: 'Contract' },
];
const STATUSES = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }];

const statusPill = (v) => {
  const c = v === 'active' ? GREEN : C.muted2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: tint(8, c), color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v || '—'}</span>;
};

// Name cell: photo (or initials) + "First LASTNAME" with qualification beneath,
// mirroring the staff-directory display (e.g. "Opeyemi BELLO / (BSc. Accounting 2012)").
function StaffName({ row }) {
  const first = row.first_name || '';
  const last = row.last_name || '';
  const initials = `${first[0] || ''}${last[0] || ''}`.toUpperCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: tint(9), color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
        {row.photo_url ? <img src={row.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>{first} {last.toUpperCase()}</div>
        {row.qualification && <div style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>({row.qualification})</div>}
      </div>
    </div>
  );
}

export function StaffGroupPage() {
  const navigate = useNavigate();
  const params = useParams();
  // Declared before the early return below — hooks must run in the same order
  // on every render.
  const [notice, setNotice] = useState(null);
  const sectionKey = params.staffClass;                    // 'academic' | 'non-academic'
  const section = SECTIONS[sectionKey];
  const group = section?.groups.find((g) => slug(g.name) === params.group);

  if (!section || !group) {
    return (
      <PageLayout title="Not found" subtitle="">
        <BackButton onClick={() => navigate('/staff/academic')} label="Back" />
        <p style={{ marginTop: 16, color: C.muted, fontFamily: C.font }}>That staff group doesn’t exist.</p>
      </PageLayout>
    );
  }

  // staff_class stored as 'academic' | 'non_academic'
  const staffClassValue = section.key === 'academic' ? 'academic' : 'non_academic';

  // A result banner beats two alert() boxes: the outcome stays on screen next
  // to the row it refers to instead of having to be dismissed to be read.
  const logout = async (row) => {
    if (!await confirmDialog({ title: 'Log this staff member out?', message: `${row.first_name} ${row.last_name} will be signed out of every device immediately and will need to sign in again.`, confirmLabel: 'Log out', danger: false })) return;
    try {
      const res = await apiPost(`/api/school/mgmt/staff/${row.id}/logout`, {});
      setNotice({
        type: res.loggedOut ? 'success' : 'info',
        text: res.loggedOut
          ? `${row.first_name} was logged out — every session revoked.`
          : (res.message || 'That staff member has no login account to sign out.'),
      });
    } catch (e) { setNotice({ type: 'error', text: e.message || 'Could not log this staff member out.' }); }
  };

  return (
    <PageLayout title={group.name} subtitle={`${section.label} · manage staff in this group`}>
      {notice && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '11px 14px', borderRadius: 12,
          background: notice.type === 'error' ? '#FEE2E2' : notice.type === 'success' ? '#DCFCE7' : '#FEF3C7',
          border: `1px solid ${notice.type === 'error' ? '#FECACA' : notice.type === 'success' ? '#BBF7D0' : '#FDE68A'}`,
        }}>
          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: notice.type === 'error' ? '#991B1B' : notice.type === 'success' ? '#166534' : '#92400E' }}>
            {notice.text}
          </span>
          <button onClick={() => setNotice(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, fontWeight: 900, color: 'inherit', opacity: .6 }}>×</button>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <BackButton onClick={() => navigate(section.path)} label={`Back to ${section.label}`} />
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 460px', minWidth: 300 }}>
          <ResourcePage
            embedded
            resource="staff"
            fixedFilters={{ staff_class: staffClassValue, staff_group: group.name }}
            createLabel="Add Staff"
            searchKeys={['staff_no', 'first_name', 'last_name', 'phone', 'email', 'duty', 'qualification']}
            columns={[
              { key: 'first_name', label: 'Name', render: (r) => <StaffName row={r} /> },
              { key: 'duty', label: 'Duty' },
              { key: 'qualification', label: 'Qualification', render: (r) => r.qualification || '—' },
              { key: 'experience_years', label: 'Exp.', render: (r) => (r.experience_years != null && r.experience_years !== '' ? `${r.experience_years} yrs` : '—') },
              { key: 'year_of_graduation', label: 'Grad.', render: (r) => r.year_of_graduation || '—' },
              { key: 'phone', label: 'Phone' },
              { key: 'status', label: 'Status', render: (r) => statusPill(r.status) },
            ]}
            fields={[
              { key: 'staff_no', label: 'Staff No', required: true },
              { key: 'first_name', label: 'First Name', required: true },
              { key: 'last_name', label: 'Last Name', required: true },
              { key: 'duty', label: 'Duty / Subject', placeholder: 'e.g. Geography/SOS' },
              { key: 'qualification', label: 'Qualification / Degree', placeholder: 'e.g. NCE 1993, B.Ed 1998, M.A. Ed 2015' },
              { key: 'experience_years', label: 'Experience (years)', type: 'number' },
              { key: 'year_of_graduation', label: 'Year of Graduation', type: 'number', placeholder: 'e.g. 2012' },
              { key: 'photo_url', label: 'Photo URL', placeholder: 'https://…' },
              { key: 'gender', label: 'Gender', type: 'select', options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }] },
              { key: 'phone', label: 'Phone' },
              { key: 'email', label: 'Email', placeholder: 'Used for their app login & logout' },
              { key: 'employment_type', label: 'Employment Type', type: 'select', default: 'full_time', options: EMPLOYMENT },
              { key: 'monthly_salary', label: 'Monthly Salary', type: 'number' },
              { key: 'joined_on', label: 'Joined On', type: 'date' },
              { key: 'status', label: 'Status', type: 'select', default: 'active', options: STATUSES },
            ]}
            rowActions={[
              { icon: <Ico ti="ti-logout" size={13} />, label: 'Log out', title: 'Force-log-out this staff', color: RED, onClick: logout },
            ]}
          />
        </div>
        <aside style={{ flex: '1 1 260px', minWidth: 240, maxWidth: 340 }}>
          <Guide title="Quick Guide" items={TABLE_GUIDE} />
        </aside>
      </div>
    </PageLayout>
  );
}

const backBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9,
  border: `1.5px solid ${C.border}`, background: C.surface, color: C.muted, fontSize: 12.5, fontWeight: 700,
  cursor: 'pointer', fontFamily: C.font,
};
