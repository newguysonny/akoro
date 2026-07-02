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
import { useNavigate, useParams } from 'react-router-dom';
import {
  Crown, GraduationCap, ClipboardList, HeartHandshake, Users, ArrowLeft,
  LogOut, ChevronRight, Briefcase, Calculator, Headphones, Shield, Sparkles,
  Bus, UtensilsCrossed, Wrench, Stethoscope, Monitor, BookOpen,
} from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import ResourcePage from '../components/mgmt/ResourcePage.jsx';
import { apiPost } from '../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, FONT } from '../constants.js';

const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const ACADEMIC = {
  key: 'academic', path: '/staff/academic', label: 'Academic Staff',
  subtitle: 'Teaching and academic team, grouped by role',
  groups: [
    { name: 'Leadership', icon: Crown, desc: 'Principal, VPs, Heads of School' },
    { name: 'Class Teacher', icon: GraduationCap, desc: 'Form and subject teachers' },
    { name: 'Academic Coordinators', icon: ClipboardList, desc: 'Curriculum & exam coordinators' },
    { name: 'Special Needs Teacher', icon: HeartHandshake, desc: 'SEN & inclusion specialists' },
    { name: 'Teaching Assistants', icon: Users, desc: 'Classroom support staff' },
  ],
};
const NON_ACADEMIC = {
  key: 'non-academic', path: '/staff/non-academic', label: 'Non-Academic Staff',
  subtitle: 'Administrative and support team, grouped by role',
  groups: [
    { name: 'Administration', icon: Briefcase, desc: 'Office & admin staff' },
    { name: 'Bursary & Accounts', icon: Calculator, desc: 'Finance and fees team' },
    { name: 'Front Desk & Reception', icon: Headphones, desc: 'Reception and enquiries' },
    { name: 'Security', icon: Shield, desc: 'Gate and campus security' },
    { name: 'Custodial & Cleaning', icon: Sparkles, desc: 'Cleaners and janitorial' },
    { name: 'Drivers & Transport', icon: Bus, desc: 'Bus drivers and transport' },
    { name: 'Kitchen & Catering', icon: UtensilsCrossed, desc: 'Kitchen and catering staff' },
    { name: 'Maintenance', icon: Wrench, desc: 'Facilities and repairs' },
    { name: 'Medical & Nursing', icon: Stethoscope, desc: 'School nurse and clinic' },
    { name: 'ICT Support', icon: Monitor, desc: 'IT and technical support' },
  ],
};
const SECTIONS = { academic: ACADEMIC, 'non-academic': NON_ACADEMIC };

/* ── Quick / Setup guide (matches Settings & Domain pages) ───────────────── */
function Guide({ title = 'Quick Guide', items }) {
  return (
    <div style={{ background: `${BLUE}08`, border: `1px solid ${BLUE}22`, borderRadius: 14, padding: '14px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <BookOpen size={15} color={BLUE} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: BLUE, fontFamily: FONT }}>{title}</span>
      </div>
      {items.map((it, i) => (
        <p key={it.t} style={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6, margin: i === 0 ? 0 : '10px 0 0', fontFamily: FONT, ...(i > 0 ? { paddingTop: 10, borderTop: `1px solid ${BLUE}18` } : {}) }}>
          <b style={{ color: INK }}>{it.t}:</b> {it.d}
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
              style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', padding: '16px 16px', borderRadius: 14, border: `1px solid ${BORDER}`, background: WHITE, cursor: 'pointer', fontFamily: FONT, transition: 'all .12s' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = AMBER; e.currentTarget.style.background = LIGHT; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.background = WHITE; }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: `${AMBER}18`, color: AMBER, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <g.icon size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{g.name}</div>
                <div style={{ fontSize: 11.5, color: MUTED2, marginTop: 2 }}>{g.desc}</div>
              </div>
              <ChevronRight size={17} color={MUTED2} style={{ flexShrink: 0 }} />
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
  const c = v === 'active' ? GREEN : MUTED2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${c}15`, color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v || '—'}</span>;
};

// Name cell: photo (or initials) + "First LASTNAME" with qualification beneath,
// mirroring the staff-directory display (e.g. "Opeyemi BELLO / (BSc. Accounting 2012)").
function StaffName({ row }) {
  const first = row.first_name || '';
  const last = row.last_name || '';
  const initials = `${first[0] || ''}${last[0] || ''}`.toUpperCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: `${AMBER}18`, color: AMBER, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
        {row.photo_url ? <img src={row.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>{first} {last.toUpperCase()}</div>
        {row.qualification && <div style={{ fontSize: 11, color: MUTED2, marginTop: 1 }}>({row.qualification})</div>}
      </div>
    </div>
  );
}

export function StaffGroupPage() {
  const navigate = useNavigate();
  const params = useParams();
  const sectionKey = params.staffClass;                    // 'academic' | 'non-academic'
  const section = SECTIONS[sectionKey];
  const group = section?.groups.find((g) => slug(g.name) === params.group);

  if (!section || !group) {
    return (
      <PageLayout title="Not found" subtitle="">
        <button onClick={() => navigate('/staff/academic')} style={backBtn}><ArrowLeft size={14} /> Back</button>
        <p style={{ marginTop: 16, color: MUTED, fontFamily: FONT }}>That staff group doesn’t exist.</p>
      </PageLayout>
    );
  }

  // staff_class stored as 'academic' | 'non_academic'
  const staffClassValue = section.key === 'academic' ? 'academic' : 'non_academic';

  const logout = async (row) => {
    if (!window.confirm(`Log out ${row.first_name} ${row.last_name}? Their app sessions will end immediately.`)) return;
    try {
      const res = await apiPost(`/api/school/mgmt/staff/${row.id}/logout`, {});
      window.alert(res.loggedOut ? 'Staff logged out — all their sessions were revoked.' : (res.message || 'No active login account for this staff.'));
    } catch (e) { window.alert(e.message || 'Could not log out this staff.'); }
  };

  return (
    <PageLayout title={group.name} subtitle={`${section.label} · manage staff in this group`}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button onClick={() => navigate(section.path)} style={backBtn}>
          <ArrowLeft size={14} /> Back to {section.label}
        </button>
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
              { icon: <LogOut size={13} />, label: 'Log out', title: 'Force-log-out this staff', color: RED, onClick: logout },
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
  border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700,
  cursor: 'pointer', fontFamily: FONT,
};
