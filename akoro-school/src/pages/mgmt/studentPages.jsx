/**
 * Student Information module pages (mgmt schema).
 * Most pages are ResourcePage configs; Dashboard + Attendance are custom.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, UserCheck, UserX, Home, Tags, ShieldAlert, Loader2, Save, ClipboardCheck } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

const BASE = '/api/school/mgmt';
const fullName = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ');
const studentOpts = { resource: 'students', labelFn: (r) => `${fullName(r)} (${r.admission_no})` };

const STATUS_PILL = (v, map) => {
  const m = map[v] || { c: MUTED2 };
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${m.c}15`, color: m.c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v}</span>;
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

/* ── Student Dashboard ───────────────────────────────────────────── */
export function StudentDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/students`).then((r) => setStats(r.data)).catch(() => setStats({})); }, []);
  const cards = stats ? [
    { n: stats.total, label: 'Total Students', icon: Users, c: BLUE, to: '/mgmt/students' },
    { n: stats.active, label: 'Active Students', icon: UserCheck, c: GREEN, to: '/mgmt/students' },
    { n: stats.presentToday, label: 'Present Today', icon: ClipboardCheck, c: GREEN, to: '/mgmt/student-attendance' },
    { n: stats.absentToday, label: 'Absent Today', icon: UserX, c: RED, to: '/mgmt/student-attendance' },
    { n: stats.disabled, label: 'Disabled Students', icon: ShieldAlert, c: AMBER, to: '/mgmt/disabled-students' },
    { n: stats.behaviorIncidents, label: 'Behavior Records', icon: ShieldAlert, c: PURPLE, to: '/mgmt/behavior-records' },
    { n: stats.houses, label: 'Houses', icon: Home, c: BLUE, to: '/mgmt/student-houses' },
    { n: stats.categories, label: 'Categories', icon: Tags, c: AMBER, to: '/mgmt/student-categories' },
  ] : [];
  return (
    <PageLayout title="Student Dashboard" subtitle="Overview of your student body">
      {!stats ? (
        <div style={{ padding: '50px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {cards.map((c) => (
            <div key={c.label} onClick={() => navigate(c.to)} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: `${c.c}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <c.icon size={19} color={c.c} />
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: INK, fontFamily: FONT }}>{c.n ?? 0}</div>
                <div style={{ fontSize: 12, color: MUTED2, fontFamily: FONT }}>{c.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

/* ── Student Admission (create-first) + Student List ─────────────── */
export function StudentAdmissionPage() {
  return <ResourcePage title="Student Admission" subtitle="Admit a new student" resource="students"
    columns={STUDENT_COLUMNS} fields={STUDENT_FIELDS} searchKeys={STUDENT_SEARCH}
    createLabel="Admit Student" startOpen listFilters={[CLASS_FILTER]} />;
}

export function StudentListPage() {
  return <ResourcePage title="Student List" subtitle="All students in your school" resource="students"
    columns={STUDENT_COLUMNS} fields={STUDENT_FIELDS} searchKeys={STUDENT_SEARCH}
    createLabel="Admit Student" listFilters={[CLASS_FILTER, { key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'alumni', label: 'Alumni' }] }]} />;
}

export function DisabledStudentsPage() {
  return <ResourcePage title="Disabled Students" subtitle="Students flagged with a disability" resource="students"
    columns={[...STUDENT_COLUMNS.slice(0, 4), { key: 'disability_note', label: 'Note' }]}
    fields={STUDENT_FIELDS} searchKeys={STUDENT_SEARCH}
    fixedFilters={{ is_disabled: 'true' }} canCreate={false} listFilters={[CLASS_FILTER]} />;
}

/* ── Student Attendance (register) ───────────────────────────────── */
const ATT_STATUSES = [
  { key: 'present', label: 'Present', c: GREEN },
  { key: 'absent', label: 'Absent', c: RED },
  { key: 'late', label: 'Late', c: AMBER },
  { key: 'excused', label: 'Excused', c: BLUE },
];

export function StudentAttendancePage() {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [register, setRegister] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
  }, []);

  const loadRegister = async () => {
    if (!classId || !date) return showToast('Pick a class and date first');
    setLoading(true);
    try {
      const params = new URLSearchParams({ class_id: classId, date });
      if (sectionId) params.set('section_id', sectionId);
      const res = await apiGet(`${BASE}/attendance/register?${params}`);
      setRegister((res.data || []).map((s) => ({ ...s, status: s.status || 'present' })));
    } catch (e) { showToast(e.message || 'Could not load register'); }
    finally { setLoading(false); }
  };

  const saveMarks = async () => {
    setSaving(true);
    try {
      await apiPost(`${BASE}/attendance/mark`, { date, entries: register.map((s) => ({ student_id: s.id, status: s.status })) });
      showToast('Attendance saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <PageLayout title="Student Attendance" subtitle="Mark the daily register">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, alignItems: 'flex-end' }}>
        <div><label style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 5 }}>Class</label>
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={{ ...inputStyle, width: 160, cursor: 'pointer' }}>
            <option value="">— select —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div><label style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 5 }}>Section</label>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...inputStyle, width: 140, cursor: 'pointer' }}>
            <option value="">All</option>{sections.filter((s) => s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div><label style={{ fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, display: 'block', marginBottom: 5 }}>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 160 }} /></div>
        <button onClick={loadRegister} style={{ padding: '10px 18px', borderRadius: 9, border: 'none', background: BLUE, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          {loading ? 'Loading…' : 'Load Register'}
        </button>
      </div>

      {register && (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          {register.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>No active students in that class/section.</div>
          ) : (
            <>
              {register.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontFamily: FONT }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, marginLeft: 8 }}>{s.admission_no}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {ATT_STATUSES.map((st) => (
                      <button key={st.key} onClick={() => setRegister((prev) => prev.map((r) => (r.id === s.id ? { ...r, status: st.key } : r)))}
                        style={{ padding: '6px 12px', borderRadius: 999, border: `1.5px solid ${s.status === st.key ? st.c : BORDER}`, background: s.status === st.key ? `${st.c}15` : WHITE, color: s.status === st.key ? st.c : MUTED2, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 16px', background: LIGHT }}>
                <button onClick={saveMarks} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
                  {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} {saving ? 'Saving…' : 'Save Attendance'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Simple config pages ─────────────────────────────────────────── */
export function BehaviorRecordsPage() {
  return <ResourcePage title="Behavior Records" subtitle="Student behavior incidents" resource="behavior-records"
    columns={[
      { key: 'student_name', label: 'Student' }, { key: 'incident_type', label: 'Incident' },
      { key: 'severity', label: 'Severity', render: (r) => STATUS_PILL(r.severity, { low: { c: GREEN }, medium: { c: AMBER }, high: { c: RED } }) },
      { key: 'action_taken', label: 'Action Taken' }, { key: 'recorded_on', label: 'Date' },
    ]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: studentOpts },
      { key: 'incident_type', label: 'Incident Type', required: true, placeholder: 'e.g. Lateness' },
      { key: 'severity', label: 'Severity', type: 'select', default: 'low', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] },
      { key: 'recorded_on', label: 'Date', type: 'date' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
      { key: 'action_taken', label: 'Action Taken', type: 'textarea', full: true },
    ]} createLabel="New Incident" />;
}

export function StudentHousesPage() {
  return <ResourcePage title="Student Houses" subtitle="Sports/pastoral houses" resource="student-houses"
    columns={[
      { key: 'name', label: 'House' },
      { key: 'color', label: 'Color', render: (r) => r.color ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 14, height: 14, borderRadius: '50%', background: r.color, display: 'inline-block' }} />{r.color}</span> : '—' },
    ]}
    fields={[{ key: 'name', label: 'House Name', required: true }, { key: 'color', label: 'Color (hex)', placeholder: '#EF4444' }]}
    createLabel="New House" />;
}

export function StudentCategoriesPage() {
  return <ResourcePage title="Student Categories" subtitle="e.g. Day / Boarding" resource="student-categories"
    columns={[{ key: 'name', label: 'Category' }]}
    fields={[{ key: 'name', label: 'Category Name', required: true }]} createLabel="New Category" />;
}

export function HealthRecordsPage() {
  return <ResourcePage title="Health Records" subtitle="Allergies, conditions, vaccinations & checkups" resource="health-records"
    columns={[
      { key: 'student_name', label: 'Student' },
      { key: 'record_type', label: 'Type', render: (r) => STATUS_PILL(r.record_type, { allergy: { c: RED }, condition: { c: AMBER }, vaccination: { c: GREEN }, checkup: { c: BLUE } }) },
      { key: 'title', label: 'Title' }, { key: 'recorded_on', label: 'Date' },
    ]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: studentOpts },
      { key: 'record_type', label: 'Type', type: 'select', default: 'condition', options: [{ value: 'allergy', label: 'Allergy' }, { value: 'condition', label: 'Condition' }, { value: 'vaccination', label: 'Vaccination' }, { value: 'checkup', label: 'Checkup' }] },
      { key: 'title', label: 'Title', required: true },
      { key: 'recorded_on', label: 'Date', type: 'date' },
      { key: 'details', label: 'Details', type: 'textarea', full: true },
    ]} createLabel="New Record" />;
}
