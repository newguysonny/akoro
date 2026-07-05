/**
 * Student Information module pages (mgmt schema).
 * Most pages are ResourcePage configs; Dashboard + Attendance are custom.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Users, UserCheck, UserX, Home, Tags, ShieldAlert, Loader2, Save, ClipboardCheck,
  Eye, Pencil, Trash2, UserPlus, Search, ArrowLeft, Phone, Mail, MapPin, Droplet,
  Cake, CreditCard, ShieldCheck, CircleDot, X,
} from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost, apiPut, apiDelete } from '../../services/api.js';
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

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
const STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'alumni', label: 'Alumni' }];

/* ── Student List — table with fee dues, view/edit/delete actions ───────── */
export function StudentListPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [status, setStatus] = useState('active');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    setRows(null);
    const params = new URLSearchParams();
    if (classId) params.set('class_id', classId);
    if (sectionId) params.set('section_id', sectionId);
    if (status) params.set('status', status);
    apiGet(`${BASE}/students/list?${params}`)
      .then((r) => setRows(r.data || []))
      .catch((e) => { showToast(e.message || 'Could not load students'); setRows([]); });
  }, [classId, sectionId, status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
  }, []);

  const q = query.trim().toLowerCase();
  const visible = (rows || []).filter((r) => !q ||
    [r.admission_no, r.first_name, r.last_name, r.guardian_phone].some((v) => String(v || '').toLowerCase().includes(q)));

  const remove = async (r) => {
    if (!window.confirm(`Remove ${fullName(r)} (${r.admission_no})? This cannot be undone.`)) return;
    setBusyId(r.id);
    try { await apiDelete(`${BASE}/students/${r.id}`); setRows((p) => p.filter((x) => x.id !== r.id)); showToast('Removed'); }
    catch (e) { showToast(e.message || 'Could not remove'); }
    finally { setBusyId(null); }
  };

  const th = { textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2, letterSpacing: .4, whiteSpace: 'nowrap' };
  const td = { padding: '11px 14px', fontSize: 13, color: INK, borderTop: `1px solid ${BORDER}`, whiteSpace: 'nowrap' };
  const iconBtn = (color) => ({ width: 30, height: 30, borderRadius: 7, border: 'none', background: `${color}15`, color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
  const selStyle = { ...inputStyle, width: 'auto', minWidth: 150, cursor: 'pointer' };

  return (
    <PageLayout title="Student List" subtitle="All students in your school">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180, maxWidth: 280 }}>
          <Search size={15} color={MUTED2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, adm no, phone…" style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
        <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={selStyle}>
          <option value="">All Classes</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={selStyle}>
          <option value="">All Sections</option>{sections.filter((s) => !classId || s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selStyle}>
          <option value="">All Statuses</option>{STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button onClick={() => navigate('/mgmt/student-admission')} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <UserPlus size={15} /> Admit Student
        </button>
      </div>

      <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
          <thead><tr>
            <th style={th}>ADM NO.</th><th style={th}>ROLL NO.</th><th style={th}>NAME</th>
            <th style={th}>CLASS</th><th style={th}>SECTION</th>
            <th style={th}>TOTAL ASSIGNED</th><th style={th}>TOTAL DUE</th>
            <th style={th}>STATUS</th><th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
          </tr></thead>
          <tbody>
            {rows === null && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={9}><Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} /></td></tr>}
            {rows && visible.length === 0 && <tr><td style={{ ...td, textAlign: 'center', color: MUTED2 }} colSpan={9}>No students found.</td></tr>}
            {visible.map((r) => (
              <tr key={r.id}>
                <td style={{ ...td, fontWeight: 700 }}>{r.admission_no}</td>
                <td style={td}>{r.roll_no || '—'}</td>
                <td style={{ ...td, whiteSpace: 'normal' }}>
                  <button onClick={() => navigate(`/mgmt/students/${r.id}`)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontWeight: 700, color: BLUE, textAlign: 'left' }}>{fullName(r)}</button>
                </td>
                <td style={td}>{r.class_name || '—'}</td>
                <td style={td}>{r.section_name || '—'}</td>
                <td style={td}>{naira(r.fee_assigned)}</td>
                <td style={td}>{r.fee_due > 0 ? <span style={{ padding: '3px 10px', borderRadius: 999, background: `${RED}15`, color: RED, fontSize: 11.5, fontWeight: 800 }}>{naira(r.fee_due)}</span> : <span style={{ padding: '3px 10px', borderRadius: 999, background: `${GREEN}15`, color: GREEN, fontSize: 11.5, fontWeight: 800 }}>Paid</span>}</td>
                <td style={td}>{STATUS_PILL(r.status, { active: { c: GREEN }, inactive: { c: RED }, alumni: { c: BLUE } })}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {busyId === r.id ? <Loader2 size={15} style={{ animation: 'spin .8s linear infinite' }} /> : (
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <button onClick={() => navigate(`/mgmt/students/${r.id}`)} title="View Profile" style={iconBtn(GREEN)}><Eye size={14} /></button>
                      <button onClick={() => navigate(`/mgmt/students/${r.id}?edit=1`)} title="Edit" style={iconBtn(BLUE)}><Pencil size={14} /></button>
                      <button onClick={() => remove(r)} title="Delete" style={iconBtn(RED)}><Trash2 size={14} /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
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

/* ── Assign to Class (bulk — includes students with no class yet) ──── */
export function AssignClassPage() {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [filterClass, setFilterClass] = useState('__null__'); // default: unassigned
  const [toClass, setToClass] = useState('');
  const [toSection, setToSection] = useState('');
  const [students, setStudents] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
  }, []);

  const load = () => {
    const cls = filterClass ? `&class_id=${filterClass}` : '';
    apiGet(`${BASE}/students?status=active${cls}`).then((r) => {
      setStudents(r.data || []);
      setSelected({});
    }).catch(() => setStudents([]));
  };
  useEffect(load, [filterClass]);

  const chosen = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const allChecked = students?.length && chosen.length === students.length;

  const assign = async () => {
    if (!toClass) return showToast('Pick a target class');
    if (!chosen.length) return showToast('Select at least one student');
    setBusy(true);
    try {
      const res = await apiPost(`${BASE}/students/assign-class`, { to_class_id: toClass, section_id: toSection || undefined, student_ids: chosen });
      showToast(`Assigned ${res.assigned} student${res.assigned === 1 ? '' : 's'} ✓`);
      load();
    } catch (e) { showToast(e.message || 'Assignment failed'); }
    finally { setBusy(false); }
  };

  const disabled = busy || !chosen.length || !toClass;
  return (
    <PageLayout title="Assign to Class" subtitle="Bulk-place students into a class — including students without one">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
        <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)} style={{ ...inputStyle, width: 190, cursor: 'pointer' }}>
          <option value="__null__">Unassigned students</option>
          <option value="">All students</option>
          {classes.map((c) => <option key={c.id} value={c.id}>In {c.name}</option>)}
        </select>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: MUTED2, fontFamily: FONT }}>→ assign to</span>
        <select value={toClass} onChange={(e) => { setToClass(e.target.value); setToSection(''); }} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">Target class…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={toSection} onChange={(e) => setToSection(e.target.value)} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">Section (optional)</option>
          {sections.filter((s) => s.class_id === toClass).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={assign} disabled={disabled} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 9, border: 'none', background: disabled ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: disabled ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : null} Assign {chosen.length ? `(${chosen.length})` : ''}
        </button>
      </div>

      {students && (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          {students.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>
              {filterClass === '__null__' ? 'No unassigned students — everyone has a class. 🎉' : 'No active students matched.'}
            </div>
          ) : (<>
            <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', fontFamily: FONT, background: LIGHT }}>
              <input type="checkbox" checked={!!allChecked} onChange={(e) => setSelected(e.target.checked ? Object.fromEntries(students.map((s) => [s.id, true])) : {})} style={{ width: 15, height: 15, accentColor: AMBER }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: MUTED }}>Select all ({students.length})</span>
            </label>
            {students.map((s) => (
              <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', fontFamily: FONT }}>
                <input type="checkbox" checked={!!selected[s.id]} onChange={(e) => setSelected((p) => ({ ...p, [s.id]: e.target.checked }))} style={{ width: 15, height: 15, accentColor: AMBER }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{fullName(s)}</span>
                <span style={{ fontSize: 11, color: MUTED2 }}>{s.admission_no}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: s.class_name ? BLUE : MUTED2 }}>{s.class_name || 'No class'}</span>
              </label>
            ))}
          </>)}
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Student Profile — dedicated page (view + inline edit) ──────────────── */
function InfoRow({ icon: Icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0' }}>
      {Icon && <Icon size={14} color={MUTED2} style={{ marginTop: 2, flexShrink: 0 }} />}
      <div style={{ minWidth: 130, fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13, color: INK, fontFamily: FONT }}>{value ?? <span style={{ color: MUTED2 }}>—</span>}</div>
    </div>
  );
}
function SectionCard({ title, color = BLUE, children }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${color}`, borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, fontFamily: FONT, marginBottom: 6, textTransform: 'uppercase', letterSpacing: .4 }}>{title}</div>
      {children}
    </div>
  );
}

export function StudentProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = [new URLSearchParams(window.location.search)];
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(params.get('edit') === '1');
  const [form, setForm] = useState({});
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [categories, setCategories] = useState([]);
  const [houses, setHouses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  const load = useCallback(() => {
    apiGet(`${BASE}/students/${id}/profile`)
      .then((r) => { setData(r.data); setForm(r.data); })
      .catch((e) => showToast(e.message || 'Could not load student'))
      .finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
    apiGet(`${BASE}/student-categories`).then((r) => setCategories(r.data || [])).catch(() => {});
    apiGet(`${BASE}/student-houses`).then((r) => setHouses(r.data || [])).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    try {
      const patch = {};
      for (const f of STUDENT_FIELDS) if (form[f.key] !== undefined) patch[f.key] = form[f.key] === '' ? null : form[f.key];
      await apiPut(`${BASE}/students/${id}`, patch);
      showToast('Saved ✓'); setEditing(false); load();
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  if (loading) return <PageLayout title="Student Profile" subtitle=""><div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /></div></PageLayout>;
  if (!data) return <PageLayout title="Student Profile" subtitle=""><div style={{ padding: '40px', textAlign: 'center', color: MUTED2, fontFamily: FONT }}>Student not found.</div></PageLayout>;

  const statCard = (label, value, color) => (
    <div style={{ flex: '1 1 140px', background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: FONT }}>{value}</div>
      <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, marginTop: 2 }}>{label}</div>
    </div>
  );

  const editSel = (key, options, labelKey = 'name') => (
    <select value={form[key] || ''} onChange={set(key)} style={{ ...inputStyle, marginBottom: 8 }}>
      <option value="">— none —</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o[labelKey]}</option>)}
    </select>
  );

  return (
    <PageLayout title={fullName(data)} subtitle={`Admission No: ${data.admission_no}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate('/mgmt/students')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Student List
        </button>
        {editing ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setEditing(false); setForm(data); }} style={{ padding: '9px 16px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} Save Changes
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
            <Pencil size={14} /> Edit Profile
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        {statCard('Total Fees', naira(data.fees?.assigned), INK)}
        {statCard('Amount Paid', naira(data.fees?.paid), GREEN)}
        {statCard('Balance Due', naira(data.fees?.due), data.fees?.due > 0 ? RED : GREEN)}
        {statCard('Attendance (Present)', data.attendance?.total ? `${Math.round((data.attendance.present / data.attendance.total) * 100)}%` : '—', BLUE)}
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: photo + quick facts */}
        <div style={{ flex: '1 1 240px', maxWidth: 280 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '22px 18px', textAlign: 'center' }}>
            <div style={{ width: 88, height: 88, borderRadius: '50%', margin: '0 auto 12px', overflow: 'hidden', background: LIGHT, border: `3px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {data.photo_url ? <img src={data.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Users size={34} color={MUTED2} />}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: INK, fontFamily: FONT }}>{fullName(data)}</div>
            <div style={{ display: 'inline-block', marginTop: 6, padding: '3px 12px', borderRadius: 999, background: `${AMBER}15`, color: AMBER, fontSize: 11.5, fontWeight: 800, fontFamily: FONT }}>{data.class_name || 'No class'}{data.section_name ? ` — ${data.section_name}` : ''}</div>
            <div style={{ marginTop: 14, textAlign: 'left' }}>
              <InfoRow icon={CreditCard} label="Admission No" value={data.admission_no} />
              <InfoRow icon={CircleDot} label="Roll No" value={data.roll_no} />
              <InfoRow icon={Droplet} label="Blood Group" value={data.blood_group} />
              <InfoRow icon={ShieldCheck} label="Status" value={STATUS_PILL(data.status, { active: { c: GREEN }, inactive: { c: RED }, alumni: { c: BLUE } })} />
            </div>
          </div>
        </div>

        {/* Right: details */}
        <div style={{ flex: '2 1 420px', minWidth: 320 }}>
          {!editing ? (
            <>
              <SectionCard title="Academic Information" color={BLUE}>
                <InfoRow label="Class" value={data.class_name} />
                <InfoRow label="Section" value={data.section_name} />
                <InfoRow label="Category" value={data.category_name} />
                <InfoRow label="House" value={data.house_name} />
                <InfoRow label="Admitted On" value={data.admitted_on} />
              </SectionCard>
              <SectionCard title="Personal Details" color={PURPLE}>
                <InfoRow icon={Cake} label="Date of Birth" value={data.dob} />
                <InfoRow label="Gender" value={data.gender} />
                <InfoRow label="Blood Group" value={data.blood_group} />
                <InfoRow icon={ShieldAlert} label="Disability" value={data.is_disabled ? (data.disability_note || 'Yes') : 'None'} />
              </SectionCard>
              <SectionCard title="Guardian & Contact" color={GREEN}>
                <InfoRow label="Guardian Name" value={data.guardian_name} />
                <InfoRow icon={Phone} label="Guardian Phone" value={data.guardian_phone} />
                <InfoRow icon={Mail} label="Guardian Email" value={data.guardian_email} />
              </SectionCard>
              <SectionCard title="Address" color={AMBER}>
                <InfoRow icon={MapPin} label="Address" value={data.address} />
              </SectionCard>
            </>
          ) : (
            <>
              <SectionCard title="Academic Information" color={BLUE}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Class</label>
                {editSel('class_id', classes)}
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Section</label>
                {editSel('section_id', sections.filter((s) => !form.class_id || s.class_id === form.class_id))}
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Category</label>
                {editSel('category_id', categories)}
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>House</label>
                {editSel('house_id', houses)}
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Admitted On</label>
                <input type="date" value={form.admitted_on || ''} onChange={set('admitted_on')} style={inputStyle} />
              </SectionCard>
              <SectionCard title="Personal Details" color={PURPLE}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>First Name</label>
                <input value={form.first_name || ''} onChange={set('first_name')} style={{ ...inputStyle, marginBottom: 8 }} />
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Last Name</label>
                <input value={form.last_name || ''} onChange={set('last_name')} style={{ ...inputStyle, marginBottom: 8 }} />
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Date of Birth</label>
                <input type="date" value={form.dob || ''} onChange={set('dob')} style={{ ...inputStyle, marginBottom: 8 }} />
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Gender</label>
                <select value={form.gender || ''} onChange={set('gender')} style={{ ...inputStyle, marginBottom: 8 }}>
                  <option value="">— select —</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                </select>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Blood Group</label>
                <input value={form.blood_group || ''} onChange={set('blood_group')} style={inputStyle} />
              </SectionCard>
              <SectionCard title="Guardian & Contact" color={GREEN}>
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Guardian Name</label>
                <input value={form.guardian_name || ''} onChange={set('guardian_name')} style={{ ...inputStyle, marginBottom: 8 }} />
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Guardian Phone</label>
                <input value={form.guardian_phone || ''} onChange={set('guardian_phone')} style={{ ...inputStyle, marginBottom: 8 }} />
                <label style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, fontFamily: FONT }}>Guardian Email</label>
                <input value={form.guardian_email || ''} onChange={set('guardian_email')} style={inputStyle} />
              </SectionCard>
              <SectionCard title="Address" color={AMBER}>
                <textarea value={form.address || ''} onChange={set('address')} style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} />
              </SectionCard>
            </>
          )}
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}
