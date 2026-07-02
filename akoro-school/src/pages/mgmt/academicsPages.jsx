/**
 * Academics module pages (mgmt schema).
 * Config pages via ResourcePage; Dashboard, Class Timetable and Promote
 * Students are custom.
 */
import { useState, useEffect, useCallback } from 'react';
import { CalendarRange, School, Rows3, BookOpen, Clock3, Grid3x3, Loader2, Save, X, ArrowRightLeft } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { apiGet, apiPost, apiPut, apiDelete } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

const BASE = '/api/school/mgmt';
const TEACHER_OPTS = { url: '/api/school/instructors', labelFn: (r) => r.full_name || r.email };
const DAYS = [{ n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' }, { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }];

/* ── Academic Dashboard ──────────────────────────────────────────── */
export function AcademicDashboardPage() {
  const [stats, setStats] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/academics`).then((r) => setStats(r.data)).catch(() => setStats({})); }, []);
  const cards = stats ? [
    { n: stats.sessions, label: 'Academic Sessions', icon: CalendarRange, c: BLUE, to: '/mgmt/academic-sessions' },
    { n: stats.classes, label: 'Classes', icon: School, c: GREEN, to: '/mgmt/classes' },
    { n: stats.sections, label: 'Sections', icon: Rows3, c: AMBER, to: '/mgmt/sections' },
    { n: stats.subjects, label: 'Subjects', icon: BookOpen, c: PURPLE, to: '/mgmt/subjects' },
    { n: stats.periods, label: 'Periods', icon: Clock3, c: BLUE, to: '/mgmt/periods' },
    { n: stats.timetableSlots, label: 'Timetable Slots', icon: Grid3x3, c: GREEN, to: '/mgmt/class-timetable' },
  ] : [];
  return (
    <PageLayout title="Academic Dashboard" subtitle="Sessions, classes, subjects and timetable at a glance">
      <StatCards cards={cards} loading={!stats} />
    </PageLayout>
  );
}

/* ── Config pages ────────────────────────────────────────────────── */
export function AcademicSessionsPage() {
  return <ResourcePage title="Academic Sessions" subtitle="School years / terms" resource="academic-sessions"
    columns={[{ key: 'name', label: 'Session' }, { key: 'starts_on', label: 'Starts' }, { key: 'ends_on', label: 'Ends' }, { key: 'is_active', label: 'Active' }]}
    fields={[
      { key: 'name', label: 'Session Name', required: true, placeholder: '2026/2027' },
      { key: 'is_active', label: 'Active Session', type: 'toggle' },
      { key: 'starts_on', label: 'Starts On', type: 'date' },
      { key: 'ends_on', label: 'Ends On', type: 'date' },
    ]} createLabel="New Session" />;
}

export function ClassesPage() {
  return <ResourcePage title="Classes" subtitle="Class levels (e.g. JSS1–SS3)" resource="classes"
    columns={[{ key: 'name', label: 'Class' }, { key: 'sort_order', label: 'Order' }]}
    fields={[{ key: 'name', label: 'Class Name', required: true, placeholder: 'JSS1' }, { key: 'sort_order', label: 'Sort Order', type: 'number' }]}
    createLabel="New Class" />;
}

export function SectionsPage() {
  return <ResourcePage title="Sections" subtitle="Arms within each class (A, B, …)" resource="sections"
    columns={[{ key: 'class_name', label: 'Class' }, { key: 'name', label: 'Section' }]}
    fields={[
      { key: 'class_id', label: 'Class', type: 'select', required: true, optionsFrom: { resource: 'classes' } },
      { key: 'name', label: 'Section Name', required: true, placeholder: 'A' },
    ]} listFilters={[{ key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } }]} createLabel="New Section" />;
}

export function SubjectsPage() {
  return <ResourcePage title="Subjects" subtitle="Core and elective subjects" resource="subjects"
    columns={[{ key: 'name', label: 'Subject' }, { key: 'code', label: 'Code' }, { key: 'subject_type', label: 'Type' }]}
    fields={[
      { key: 'name', label: 'Subject Name', required: true },
      { key: 'code', label: 'Code', placeholder: 'MTH' },
      { key: 'subject_type', label: 'Type', type: 'select', default: 'core', options: [{ value: 'core', label: 'Core' }, { value: 'elective', label: 'Elective' }] },
    ]} createLabel="New Subject" />;
}

const ASSIGN_SUBJECT_FIELDS = (elective) => [
  { key: 'class_id', label: 'Class', type: 'select', required: true, optionsFrom: { resource: 'classes' } },
  { key: 'subject_id', label: 'Subject', type: 'select', required: true, optionsFrom: { resource: 'subjects' } },
  { key: 'teacher_id', label: 'Teacher', type: 'select', optionsFrom: TEACHER_OPTS },
  { key: 'is_elective', label: 'Elective', type: 'toggle', default: elective },
];
const ASSIGN_SUBJECT_COLUMNS = [
  { key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' }, { key: 'is_elective', label: 'Elective' },
];

export function AssignSubjectsPage() {
  return <ResourcePage title="Assign Subjects" subtitle="Map subjects (and teachers) to classes" resource="class-subjects"
    columns={ASSIGN_SUBJECT_COLUMNS} fields={ASSIGN_SUBJECT_FIELDS(false)}
    listFilters={[{ key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } }]} createLabel="Assign Subject" />;
}

export function AssignElectivesPage() {
  return <ResourcePage title="Assign Electives" subtitle="Elective subjects offered per class" resource="class-subjects"
    columns={ASSIGN_SUBJECT_COLUMNS} fields={ASSIGN_SUBJECT_FIELDS(true)}
    fixedFilters={{ is_elective: 'true' }}
    listFilters={[{ key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } }]} createLabel="Assign Elective" />;
}

export function AssignClassTeacherPage() {
  return <ResourcePage title="Assign Class Teacher" subtitle="Form teacher per class/section" resource="class-teachers"
    columns={[{ key: 'class_name', label: 'Class' }, { key: 'section_name', label: 'Section' }]}
    fields={[
      { key: 'class_id', label: 'Class', type: 'select', required: true, optionsFrom: { resource: 'classes' } },
      { key: 'section_id', label: 'Section', type: 'select', optionsFrom: { resource: 'sections', labelFn: (r) => `${r.class_name || ''} — ${r.name}` } },
      { key: 'teacher_id', label: 'Teacher', type: 'select', required: true, optionsFrom: TEACHER_OPTS },
    ]} createLabel="Assign Teacher" />;
}

export function ManagePeriodsPage() {
  return <ResourcePage title="Manage Periods" subtitle="Daily lesson periods" resource="periods"
    columns={[{ key: 'name', label: 'Period' }, { key: 'starts_at', label: 'Starts' }, { key: 'ends_at', label: 'Ends' }, { key: 'sort_order', label: 'Order' }]}
    fields={[
      { key: 'name', label: 'Period Name', required: true, placeholder: '1st Period' },
      { key: 'sort_order', label: 'Sort Order', type: 'number' },
      { key: 'starts_at', label: 'Starts At', type: 'time' },
      { key: 'ends_at', label: 'Ends At', type: 'time' },
    ]} createLabel="New Period" />;
}

/* ── Class Timetable (grid) ──────────────────────────────────────── */
export function ClassTimetablePage() {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [slots, setSlots] = useState([]);
  const [cell, setCell] = useState(null);      // { day, period, slot? }
  const [cellSubject, setCellSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
    apiGet(`${BASE}/periods`).then((r) => setPeriods(r.data || [])).catch(() => {});
    apiGet(`${BASE}/subjects`).then((r) => setSubjects(r.data || [])).catch(() => {});
  }, []);

  const loadSlots = useCallback(() => {
    if (!classId) return setSlots([]);
    const params = new URLSearchParams({ class_id: classId });
    if (sectionId) params.set('section_id', sectionId);
    apiGet(`${BASE}/timetable-slots?${params}`).then((r) => setSlots(r.data || [])).catch(() => {});
  }, [classId, sectionId]);
  useEffect(() => { loadSlots(); }, [loadSlots]);

  const slotAt = (day, periodId) => slots.find((s) => s.day_of_week === day && s.period_id === periodId);

  const openCell = (day, period) => {
    const slot = slotAt(day, period.id);
    setCellSubject(slot?.subject_id || '');
    setCell({ day, period, slot });
  };

  const saveCell = async () => {
    setBusy(true);
    try {
      if (cell.slot) await apiPut(`${BASE}/timetable-slots/${cell.slot.id}`, { subject_id: cellSubject || '' });
      else await apiPost(`${BASE}/timetable-slots`, { class_id: classId, section_id: sectionId || '', day_of_week: cell.day, period_id: cell.period.id, subject_id: cellSubject || '' });
      setCell(null); loadSlots();
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  const clearCell = async () => {
    if (!cell.slot) return setCell(null);
    setBusy(true);
    try { await apiDelete(`${BASE}/timetable-slots/${cell.slot.id}`); setCell(null); loadSlots(); }
    catch (e) { showToast(e.message || 'Could not clear'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Class Timetable" subtitle="Weekly lesson grid per class">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">— select class —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...inputStyle, width: 150, cursor: 'pointer' }}>
          <option value="">All sections</option>{sections.filter((s) => s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {!classId ? (
        <div style={{ padding: '40px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT, background: WHITE, border: `1.5px dashed ${BORDER}`, borderRadius: 14 }}>
          Pick a class to view and edit its timetable.
        </div>
      ) : (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, minWidth: 680 }}>
            <thead>
              <tr style={{ background: LIGHT }}>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>PERIOD</th>
                {DAYS.map((d) => <th key={d.n} style={{ textAlign: 'center', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>{d.label.toUpperCase()}</th>)}
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '10px 14px', fontSize: 12.5, fontWeight: 700, color: INK, whiteSpace: 'nowrap' }}>
                    {p.name}{p.starts_at && <span style={{ display: 'block', fontSize: 10.5, fontWeight: 500, color: MUTED2 }}>{String(p.starts_at).slice(0, 5)}–{String(p.ends_at || '').slice(0, 5)}</span>}
                  </td>
                  {DAYS.map((d) => {
                    const slot = slotAt(d.n, p.id);
                    return (
                      <td key={d.n} onClick={() => openCell(d.n, p)} style={{ padding: 6, textAlign: 'center', cursor: 'pointer' }}>
                        <div style={{ padding: '9px 6px', borderRadius: 8, background: slot?.subject_name ? `${BLUE}10` : LIGHT, border: `1px ${slot?.subject_name ? 'solid' : 'dashed'} ${slot?.subject_name ? `${BLUE}44` : BORDER}`, fontSize: 12, fontWeight: 700, color: slot?.subject_name ? BLUE : MUTED2 }}>
                          {slot?.subject_name || '+'}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cell && (
        <div onClick={() => setCell(null)} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: WHITE, borderRadius: 16, padding: '20px 20px 22px', fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <p style={{ fontSize: 14.5, fontWeight: 800, color: INK, margin: 0 }}>{DAYS.find((d) => d.n === cell.day)?.label} — {cell.period.name}</p>
              <button onClick={() => setCell(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED2 }}><X size={17} /></button>
            </div>
            <label style={{ fontSize: 12, fontWeight: 700, color: INK, display: 'block', marginBottom: 5 }}>Subject</label>
            <select value={cellSubject} onChange={(e) => setCellSubject(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 16 }}>
              <option value="">— none —</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {cell.slot && <button onClick={clearCell} disabled={busy} style={{ padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${RED}44`, background: `${RED}0C`, color: RED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Clear Slot</button>}
              <button onClick={saveCell} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                {busy ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={13} />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

/* ── Promote Students ────────────────────────────────────────────── */
export function PromoteStudentsPage() {
  const [classes, setClasses] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [fromClass, setFromClass] = useState('');
  const [toClass, setToClass] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [students, setStudents] = useState(null);
  const [selected, setSelected] = useState({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/academic-sessions`).then((r) => setSessions(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!fromClass) return setStudents(null);
    apiGet(`${BASE}/students?class_id=${fromClass}&status=active`).then((r) => {
      setStudents(r.data || []);
      setSelected(Object.fromEntries((r.data || []).map((s) => [s.id, true])));
    }).catch(() => {});
  }, [fromClass]);

  const chosen = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);

  const promote = async () => {
    if (!fromClass || !toClass) return showToast('Pick both classes');
    if (!chosen.length) return showToast('Select at least one student');
    setBusy(true);
    try {
      const res = await apiPost(`${BASE}/students/promote`, { from_class_id: fromClass, to_class_id: toClass, session_id: sessionId || undefined, student_ids: chosen });
      showToast(`Promoted ${res.promoted} student${res.promoted === 1 ? '' : 's'} ✓`);
      setStudents(null); setFromClass('');
    } catch (e) { showToast(e.message || 'Promotion failed'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Promote Students" subtitle="Move students to the next class">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18, alignItems: 'center' }}>
        <select value={fromClass} onChange={(e) => setFromClass(e.target.value)} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">From class…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <ArrowRightLeft size={16} color={MUTED2} />
        <select value={toClass} onChange={(e) => setToClass(e.target.value)} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">To class…</option>{classes.filter((c) => c.id !== fromClass).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">Session (optional)</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={promote} disabled={busy || !chosen.length || !toClass} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 9, border: 'none', background: busy || !chosen.length || !toClass ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: busy || !chosen.length || !toClass ? '#9CA3AF' : WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : null} Promote {chosen.length ? `(${chosen.length})` : ''}
        </button>
      </div>

      {students && (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          {students.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>No active students in that class.</div>
          ) : students.map((s) => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${BORDER}`, cursor: 'pointer', fontFamily: FONT }}>
              <input type="checkbox" checked={!!selected[s.id]} onChange={(e) => setSelected((p) => ({ ...p, [s.id]: e.target.checked }))} style={{ width: 15, height: 15, accentColor: AMBER }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{s.first_name} {s.last_name}</span>
              <span style={{ fontSize: 11, color: MUTED2 }}>{s.admission_no}</span>
            </label>
          ))}
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}
