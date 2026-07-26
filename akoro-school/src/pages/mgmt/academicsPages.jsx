/**
 * Academics module pages (mgmt schema).
 * Config pages via ResourcePage; Dashboard, Class Timetable and Promote
 * Students are custom.
 */
import { useState, useEffect, useCallback } from 'react';
import { CalendarRange, School, Rows3, BookOpen, Clock3, Grid3x3, Loader2, Save, X, ArrowRightLeft, Printer, CheckCircle2, Sparkles } from 'lucide-react';
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

// Academic Levels → Classes → Sections now live in ./academics/* as a rich
// drill-down hierarchy (level filter, counts, routing to sections/students).
export { AcademicLevelsPage, ClassesPage, SectionsPage, SectionTypesPage, SubjectsPage, AssignClassTeacherPage, AssignSubjectsPage, AssignTeacherSubjectsPage, ManagePeriodsPage } from './academics/index.js';

// SubjectsPage now lives in ./academics/SubjectsPage.jsx (rich toolbar).

/* ── Curriculum / Scheme of Work / Syllabus ──────────────────────── */
const TERM_OPTS = [
  { value: 'First Term', label: 'First Term' },
  { value: 'Second Term', label: 'Second Term' },
  { value: 'Third Term', label: 'Third Term' },
];
const ONOFF_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }];

// Curriculum — one or more frameworks per school (optionally scoped to a level/session).
export function CurriculumPage() {
  return <ResourcePage title="Curriculum" subtitle="Curriculum frameworks adopted by the school" resource="curriculum"
    columns={[
      { key: 'name', label: 'Curriculum' }, { key: 'framework', label: 'Framework' },
      { key: 'level_name', label: 'Level' }, { key: 'session_name', label: 'Session' }, { key: 'status', label: 'Status' },
    ]}
    fields={[
      { key: 'name', label: 'Curriculum Name', required: true, placeholder: 'Nigerian National Curriculum (9-Year Basic)' },
      { key: 'framework', label: 'Framework / Board', placeholder: 'NERDC · Cambridge · CBC · Montessori' },
      { key: 'level_id', label: 'Academic Level (optional)', type: 'select', optionsFrom: { resource: 'academic-levels' } },
      { key: 'session_id', label: 'Academic Session (optional)', type: 'select', optionsFrom: { resource: 'academic-sessions' } },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'document_url', label: 'Document URL (optional)', placeholder: 'https://…' },
      { key: 'status', label: 'Status', type: 'select', options: ONOFF_OPTS, default: 'active' },
    ]}
    listFilters={[
      { key: 'level_id', label: 'Level', optionsFrom: { resource: 'academic-levels' } },
      { key: 'status', label: 'Status', options: ONOFF_OPTS },
    ]} createLabel="New Curriculum" />;
}

// Scheme of Work — planned weekly coverage per class (optionally per subject).
export function SchemeOfWorkPage() {
  return <ResourcePage title="Scheme of Work" subtitle="Termly / weekly coverage plan per class" resource="scheme-of-work"
    columns={[
      { key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' },
      { key: 'term', label: 'Term' }, { key: 'week', label: 'Week' }, { key: 'topic', label: 'Topic' }, { key: 'status', label: 'Status' },
    ]}
    fields={[
      { key: 'class_id', label: 'Class', type: 'select', required: true, optionsFrom: { resource: 'classes' } },
      { key: 'subject_id', label: 'Subject (optional)', type: 'select', optionsFrom: { resource: 'subjects' } },
      { key: 'term', label: 'Term', type: 'select', options: TERM_OPTS },
      { key: 'week', label: 'Week', placeholder: 'Week 1' },
      { key: 'topic', label: 'Topic', required: true },
      { key: 'objectives', label: 'Objectives', type: 'textarea' },
      { key: 'activities', label: 'Activities', type: 'textarea' },
      { key: 'resources', label: 'Resources / Materials', type: 'textarea' },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'planned', label: 'Planned' }, { value: 'ongoing', label: 'Ongoing' }, { value: 'completed', label: 'Completed' }], default: 'planned' },
    ]}
    listFilters={[
      { key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } },
      { key: 'subject_id', label: 'Subject', optionsFrom: { resource: 'subjects' } },
      { key: 'term', label: 'Term', options: TERM_OPTS },
    ]} createLabel="New Scheme" />;
}

// Syllabus — outline per subject (optionally scoped to a class).
export function SyllabusPage() {
  return <ResourcePage title="Syllabus" subtitle="Syllabus outline per subject" resource="subject-syllabus"
    columns={[
      { key: 'subject_name', label: 'Subject' }, { key: 'class_name', label: 'Class' },
      { key: 'title', label: 'Title' }, { key: 'term', label: 'Term' }, { key: 'status', label: 'Status' },
    ]}
    fields={[
      { key: 'subject_id', label: 'Subject', type: 'select', required: true, optionsFrom: { resource: 'subjects' } },
      { key: 'class_id', label: 'Class (optional)', type: 'select', optionsFrom: { resource: 'classes' } },
      { key: 'title', label: 'Syllabus Title', required: true, placeholder: 'JSS1 Mathematics Syllabus' },
      { key: 'term', label: 'Term', type: 'select', options: TERM_OPTS },
      { key: 'description', label: 'Description / Topics', type: 'textarea' },
      { key: 'document_url', label: 'Document URL (optional)', placeholder: 'https://…' },
      { key: 'status', label: 'Status', type: 'select', options: ONOFF_OPTS, default: 'active' },
    ]}
    listFilters={[
      { key: 'subject_id', label: 'Subject', optionsFrom: { resource: 'subjects' } },
      { key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } },
      { key: 'status', label: 'Status', options: ONOFF_OPTS },
    ]} createLabel="New Syllabus" />;
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

// AssignSubjectsPage now lives in ./academics/AssignSubjectsPage.jsx (dedicated page).

export function AssignElectivesPage() {
  return <ResourcePage title="Assign Electives" subtitle="Elective subjects offered per class" resource="class-subjects"
    columns={ASSIGN_SUBJECT_COLUMNS} fields={ASSIGN_SUBJECT_FIELDS(true)}
    fixedFilters={{ is_elective: 'true' }}
    listFilters={[{ key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } }]} createLabel="Assign Elective" />;
}

// AssignClassTeacherPage now lives in ./academics/AssignTeacherPage.jsx (dedicated page).

// ManagePeriodsPage now lives in ./academics/PeriodsPage.jsx (class-first + type).

/* ── Class Timetable (printed-style grid) ─────────────────────────── */
const SPECIAL_TYPES = { assembly: 1, break: 1, lunch: 1, activity: 1 };
const SPECIAL_LABEL = {
  assembly: 'ASSEMBLY · CLASS MEETING · PPI',
  break: 'BREAK',
  lunch: 'LUNCH',
  activity: 'GAMES · CLUBS & SOCIETIES · CAREER GUIDANCE',
};
const specialStyle = (type) => type === 'break' || type === 'lunch'
  ? { bg: `${AMBER}14`, fg: '#B45309' }
  : { bg: `${INK}0A`, fg: INK };
const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

export function ClassTimetablePage() {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [slots, setSlots] = useState([]);
  const [meta, setMeta] = useState(null);         // timetable_meta row (or null)
  const [cell, setCell] = useState(null);         // { day, period, slot? }
  const [cellSubject, setCellSubject] = useState('');
  const [cellAlt, setCellAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  // Periods + subjects can be created server-side by "Load starter template",
  // so keep them in a reloadable callback (not a one-shot mount effect).
  const loadRefData = useCallback(() => {
    apiGet(`${BASE}/periods`).then((r) => setPeriods(r.data || [])).catch(() => {});
    apiGet(`${BASE}/subjects`).then((r) => setSubjects(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
    loadRefData();
  }, [loadRefData]);

  const loadSlots = useCallback(() => {
    if (!classId) { setSlots([]); setMeta(null); return; }
    const p = new URLSearchParams({ class_id: classId });
    if (sectionId) p.set('section_id', sectionId);
    apiGet(`${BASE}/timetable-slots?${p}`).then((r) => setSlots(r.data || [])).catch(() => {});
    apiGet(`${BASE}/timetable-meta?class_id=${classId}`).then((r) => {
      const rows = r.data || [];
      setMeta(rows.find((m) => (sectionId ? m.section_id === sectionId : !m.section_id)) || rows[0] || null);
    }).catch(() => setMeta(null));
  }, [classId, sectionId]);
  useEffect(() => { loadSlots(); }, [loadSlots]);

  const subjById = Object.fromEntries(subjects.map((s) => [s.id, s]));
  const codeOf = (id) => id ? (subjById[id]?.code || subjById[id]?.name || '') : '';
  const className = classes.find((c) => c.id === classId)?.name || '';

  const classPeriods = periods.filter((p) => p.class_id === classId);
  const cols = (classPeriods.length ? classPeriods : periods.filter((p) => !p.class_id))
    .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const slotAt = (day, periodId) => slots.find((s) => s.day_of_week === day && s.period_id === periodId);

  // Subjects that appear → Key legend.
  const usedIds = [...new Set(slots.flatMap((s) => [s.subject_id, s.alt_subject_id]).filter(Boolean))];
  const legend = usedIds.map((id) => subjById[id]).filter(Boolean)
    .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));

  const openCell = (day, period) => {
    const slot = slotAt(day, period.id);
    setCellSubject(slot?.subject_id || '');
    setCellAlt(slot?.alt_subject_id || '');
    setCell({ day, period, slot });
  };
  const saveCell = async () => {
    setBusy(true);
    try {
      const body = { subject_id: cellSubject || '', alt_subject_id: cellAlt || '' };
      if (cell.slot) await apiPut(`${BASE}/timetable-slots/${cell.slot.id}`, body);
      else await apiPost(`${BASE}/timetable-slots`, { class_id: classId, section_id: sectionId || '', day_of_week: cell.day, period_id: cell.period.id, ...body });
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

  const loadTemplate = async (replace = false) => {
    if (!classId) return;
    setBusy(true);
    try {
      const res = await apiPost(`${BASE}/timetable/load-template`, { class_id: classId, section_id: sectionId || '', replace });
      // The template can create school-wide periods + subjects, so refresh those
      // (otherwise the new grid columns don't render) before reloading the slots.
      loadRefData();
      loadSlots();
      showToast(res.created ? `Loaded ${res.variant} template — ${res.created} lessons placed ✓` : 'No lessons were placed — add class periods first, then try again.');
    } catch (e) {
      // Class already has a timetable → confirm replace.
      if ((e.message || '').toLowerCase().includes('already has')) {
        if (window.confirm('This class already has a timetable. Replace it with the starter template?')) return loadTemplate(true);
      } else showToast(e.message || 'Could not load template');
    } finally { setBusy(false); }
  };

  // ── Meta (footer) ──
  const [metaForm, setMetaForm] = useState({});
  useEffect(() => {
    setMetaForm(meta || { title: className ? `${className.toUpperCase()} TIMETABLE` : '', prepared_by: '', approved_by: '', head_of_curriculum: '', approved: false, approved_on: '' });
  }, [meta, className]);
  const saveMeta = async () => {
    setBusy(true);
    try {
      const body = { class_id: classId, section_id: sectionId || '', title: metaForm.title || '', prepared_by: metaForm.prepared_by || '', approved_by: metaForm.approved_by || '', head_of_curriculum: metaForm.head_of_curriculum || '', approved: !!metaForm.approved, approved_on: metaForm.approved_on || '' };
      if (meta?.id) await apiPut(`${BASE}/timetable-meta/${meta.id}`, body);
      else await apiPost(`${BASE}/timetable-meta`, body);
      showToast('Timetable details saved ✓'); loadSlots();
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  const approved = !!metaForm.approved;
  const badge = (
    <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 6, background: GREEN, color: WHITE, fontSize: 11, fontWeight: 900, letterSpacing: .5, transform: 'rotate(-4deg)' }}>APPROVED</span>
  );

  return (
    <PageLayout title="Class Timetable" subtitle="Printed weekly timetable per class">
      <style>{`@media print {
        @page { size: landscape; margin: 8mm; }
        body * { visibility: hidden !important; }
        #tt-print, #tt-print * { visibility: visible !important; }
        #tt-print { position: absolute; left: 0; top: 0; width: 100%; border: none !important; }
        /* Fit the grid to the landscape page instead of overflowing the right edge. */
        #tt-print table { min-width: 0 !important; width: 100% !important; }
        .tt-controls, .tt-noprint { display: none !important; }
      }`}</style>
      <div className="tt-controls" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={{ ...inputStyle, width: 170, cursor: 'pointer' }}>
          <option value="">— select class —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...inputStyle, width: 150, cursor: 'pointer' }}>
          <option value="">All sections</option>{sections.filter((s) => s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {classId && <button onClick={loadTemplate} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 9, border: `1px solid ${AMBER}66`, background: `${AMBER}0C`, color: '#B45309', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}><Sparkles size={14} /> Load starter template</button>}
        {classId && <button onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}><Printer size={14} /> Print</button>}
      </div>

      {!classId ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT, background: WHITE, border: `1.5px dashed ${BORDER}`, borderRadius: 14 }}>
          Pick a class to view and edit its timetable.
        </div>
      ) : (
        <div id="tt-print" style={{ background: WHITE, border: `2px solid ${INK}`, borderRadius: 6, padding: 14, fontFamily: FONT }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
            {approved ? badge : <span />}
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: INK, letterSpacing: .3 }}>{className.toUpperCase()} — {metaForm.title || 'TIMETABLE'}</div>
            </div>
            {approved ? badge : <span />}
          </div>

          {/* Grid */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1180, tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={ttTh}>TIME<br />DAY</th>
                  {cols.map((p) => (
                    <th key={p.id} style={{ ...ttTh, color: RED }}>
                      {hhmm(p.starts_at)}<br />{hhmm(p.ends_at)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((d, di) => (
                  <tr key={d.n}>
                    <td style={{ ...ttDay }}>{d.label.toUpperCase()}</td>
                    {cols.map((p) => {
                      const sp = SPECIAL_TYPES[p.type];
                      if (sp) {
                        if (di !== 0) return null;   // merged across all day rows
                        const { bg, fg } = specialStyle(p.type);
                        return (
                          <td key={p.id} rowSpan={DAYS.length} style={{ border: `1px solid ${INK}`, background: bg, padding: 2, textAlign: 'center', verticalAlign: 'middle' }}>
                            <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', margin: '0 auto', fontSize: 11, fontWeight: 900, color: fg, letterSpacing: .5, whiteSpace: 'nowrap' }}>
                              {SPECIAL_LABEL[p.type] || p.name}
                            </div>
                          </td>
                        );
                      }
                      const slot = slotAt(d.n, p.id);
                      const code = codeOf(slot?.subject_id);
                      const alt = codeOf(slot?.alt_subject_id);
                      return (
                        <td key={p.id} onClick={() => openCell(d.n, p)} style={{ border: `1px solid ${INK}`, padding: '8px 7px', textAlign: 'center', cursor: 'pointer', height: 54, background: code ? WHITE : `${LIGHT}` }}>
                          {code ? (
                            <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, lineHeight: 1.3 }}>
                              {code}
                              {alt && <><div style={{ fontSize: 9.5, fontWeight: 600, color: MUTED2, fontStyle: 'italic' }}>or</div><div>{alt}</div></>}
                            </div>
                          ) : <span style={{ color: MUTED2, fontSize: 13 }}>+</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Key + footer */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <div style={{ flex: '1 1 240px', border: `1px solid ${INK}`, borderRadius: 6, padding: '10px 12px', background: `${AMBER}0A` }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: INK, marginBottom: 6, letterSpacing: .5 }}>KEY</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                {legend.length ? legend.map((s) => (
                  <div key={s.id} style={{ fontSize: 10.5, color: INK }}><b>{s.code || s.name}</b>{s.code ? ` – ${s.name}` : ''}</div>
                )) : <span style={{ fontSize: 11, color: MUTED2 }}>No subjects placed yet.</span>}
              </div>
            </div>
            <div className="tt-footer" style={{ flex: '1 1 300px', border: `1px solid ${INK}`, borderRadius: 6, padding: '10px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
              <FooterField label="Time table Prepared by" value={metaForm.prepared_by} onChange={(v) => setMetaForm((f) => ({ ...f, prepared_by: v }))} />
              <FooterField label="Time table Approved by" value={metaForm.approved_by} onChange={(v) => setMetaForm((f) => ({ ...f, approved_by: v }))} />
              <FooterField label="Head of Curriculum" value={metaForm.head_of_curriculum} onChange={(v) => setMetaForm((f) => ({ ...f, head_of_curriculum: v }))} />
              <FooterField label="Date" type="date" value={metaForm.approved_on || ''} onChange={(v) => setMetaForm((f) => ({ ...f, approved_on: v }))} />
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: INK, cursor: 'pointer' }}>
                <input type="checkbox" checked={approved} onChange={(e) => setMetaForm((f) => ({ ...f, approved: e.target.checked }))} style={{ width: 15, height: 15, accentColor: GREEN }} />
                <CheckCircle2 size={14} color={approved ? GREEN : MUTED2} /> Approved
              </label>
              <button className="tt-noprint" onClick={saveMeta} disabled={busy} style={{ justifySelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 15px', borderRadius: 8, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                {busy ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={13} />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cell editor */}
      {cell && (
        <div onClick={() => setCell(null)} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: WHITE, borderRadius: 16, padding: '20px 20px 22px', fontFamily: FONT }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <p style={{ fontSize: 14.5, fontWeight: 800, color: INK, margin: 0 }}>{DAYS.find((d) => d.n === cell.day)?.label} · {hhmm(cell.period.starts_at)}–{hhmm(cell.period.ends_at)}</p>
              <button onClick={() => setCell(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED2 }}><X size={17} /></button>
            </div>
            <label style={{ fontSize: 12, fontWeight: 700, color: INK, display: 'block', marginBottom: 5 }}>Subject</label>
            <select value={cellSubject} onChange={(e) => setCellSubject(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 12 }}>
              <option value="">— none —</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.code ? `${s.code} — ${s.name}` : s.name}</option>)}
            </select>
            <label style={{ fontSize: 12, fontWeight: 700, color: INK, display: 'block', marginBottom: 5 }}>Optional alternative (shown as “or”)</label>
            <select value={cellAlt} onChange={(e) => setCellAlt(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 16 }}>
              <option value="">— none —</option>{subjects.filter((s) => s.id !== cellSubject).map((s) => <option key={s.id} value={s.id}>{s.code ? `${s.code} — ${s.name}` : s.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              {cell.slot && <button onClick={clearCell} disabled={busy} style={{ padding: '9px 15px', borderRadius: 9, border: `1.5px solid ${RED}44`, background: `${RED}0C`, color: RED, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>Clear</button>}
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

const ttTh = { border: `1px solid ${INK}`, padding: '7px 5px', fontSize: 10.5, fontWeight: 800, color: INK, textAlign: 'center', background: LIGHT, lineHeight: 1.35 };
const ttDay = { border: `1px solid ${INK}`, padding: '6px 8px', fontSize: 11.5, fontWeight: 900, color: INK, textAlign: 'center', background: LIGHT, whiteSpace: 'nowrap' };

function FooterField({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: MUTED2, marginBottom: 2 }}>{label}</div>
      <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', border: 'none', borderBottom: `1px solid ${BORDER}`, fontSize: 12, fontWeight: 700, color: INK, fontFamily: FONT, outline: 'none', padding: '2px 0', background: 'transparent' }} />
    </div>
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

/* ── Weekly Forecast & Daily Schedule (timetable-driven) ─────────────── */
// Shared helpers: snap a date to the Monday of its week, add days, format.
function mondayOf(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const dow = (d.getDay() + 6) % 7;                 // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const prettyDate = (iso) => { try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return iso; } };
const DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Load class + timetable context shared by both pages.
function useTimetableContext(classId, sectionId) {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [slots, setSlots] = useState([]);
  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
    apiGet(`${BASE}/periods`).then((r) => setPeriods(r.data || [])).catch(() => {});
    apiGet(`${BASE}/subjects`).then((r) => setSubjects(r.data || [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!classId) { setSlots([]); return; }
    const p = new URLSearchParams({ class_id: classId });
    if (sectionId) p.set('section_id', sectionId);
    apiGet(`${BASE}/timetable-slots?${p}`).then((r) => setSlots(r.data || [])).catch(() => {});
  }, [classId, sectionId]);
  const subjById = Object.fromEntries(subjects.map((s) => [s.id, s]));
  const classPeriods = periods.filter((p) => p.class_id === classId);
  const cols = (classPeriods.length ? classPeriods : periods.filter((p) => !p.class_id))
    .slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const codeOf = (id) => id ? (subjById[id]?.code || subjById[id]?.name || '') : '';
  const slotAt = (day, pid) => slots.find((s) => s.day_of_week === day && s.period_id === pid);
  const subjectLabel = (day, pid) => {
    const s = slotAt(day, pid);
    if (!s) return '';
    const c = codeOf(s.subject_id); const a = codeOf(s.alt_subject_id);
    return a ? `${c} / ${a}` : c;
  };
  return { classes, sections, periods, subjects, cols, subjById, slotAt, subjectLabel };
}

export function WeeklyForecastPage() {
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [weekStart, setWeekStart] = useState(mondayOf());
  const ctx = useTimetableContext(classId, sectionId);
  const [theme, setTheme] = useState('');
  const [preparedBy, setPreparedBy] = useState('');
  const [cellMap, setCellMap] = useState({});   // `${day}_${pid}` → activity
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const className = ctx.classes.find((c) => c.id === classId)?.name || '';

  const loadForecast = useCallback(() => {
    if (!classId || !weekStart) { setCellMap({}); setTheme(''); setPreparedBy(''); return; }
    const p = new URLSearchParams({ class_id: classId, week_start: weekStart });
    if (sectionId) p.set('section_id', sectionId);
    apiGet(`${BASE}/forecast?${p}`).then((r) => {
      const { week, cells } = r.data || {};
      setTheme(week?.theme || ''); setPreparedBy(week?.prepared_by || '');
      setCellMap(Object.fromEntries((cells || []).map((c) => [`${c.day_of_week}_${c.period_id}`, c.activity || ''])));
    }).catch(() => {});
  }, [classId, sectionId, weekStart]);
  useEffect(() => { loadForecast(); }, [loadForecast]);

  const setCell = (day, pid, v) => setCellMap((m) => ({ ...m, [`${day}_${pid}`]: v }));

  const save = async () => {
    setBusy(true);
    try {
      const cells = [];
      for (const d of DAYS) for (const p of ctx.cols) {
        if (p.type && p.type !== 'teaching') continue;
        const v = cellMap[`${d.n}_${p.id}`];
        if (v !== undefined) cells.push({ day_of_week: d.n, period_id: p.id, activity: v });
      }
      await apiPost(`${BASE}/forecast/save`, { class_id: classId, section_id: sectionId || '', week_start: weekStart, week_end: addDays(weekStart, 4), theme, prepared_by: preparedBy, cells });
      showToast('Forecast saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Weekly Forecast" subtitle="What will be taught each day — follows the class timetable">
      <style>{`@media print { body * { visibility: hidden !important; } #wf-print, #wf-print * { visibility: visible !important; } #wf-print { position: absolute; left:0; top:0; width:100%; } .wf-noprint { display:none !important; } }`}</style>
      <div className="wf-noprint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={{ ...inputStyle, width: 160, cursor: 'pointer' }}>
          <option value="">— class —</option>{ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...inputStyle, width: 140, cursor: 'pointer' }}>
          <option value="">All sections</option>{ctx.sections.filter((s) => s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={weekStart} onChange={(e) => setWeekStart(mondayOf(e.target.value))} style={{ ...inputStyle, width: 160 }} title="Any day — snaps to that week's Monday" />
        {classId && <button onClick={save} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>{busy ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={13} />} Save</button>}
        {classId && <button onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}><Printer size={14} /> Print</button>}
      </div>

      {!classId ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT, background: WHITE, border: `1.5px dashed ${BORDER}`, borderRadius: 14 }}>Pick a class and week to plan.</div>
      ) : (
        <div id="wf-print" style={{ background: WHITE, border: `2px solid ${INK}`, borderRadius: 8, padding: 14, fontFamily: FONT }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: INK }}>WEEKLY FORECAST — {className.toUpperCase()}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ padding: '6px 12px', borderRadius: 8, background: LIGHT, fontSize: 12.5, fontWeight: 700, color: INK }}>Week: {prettyDate(weekStart)} – {prettyDate(addDays(weekStart, 4))}</span>
              <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Theme…" style={{ ...inputStyle, width: 200, padding: '6px 10px' }} />
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 860, tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  <th style={ttTh}>DAY \ TIME</th>
                  {ctx.cols.map((p) => <th key={p.id} style={{ ...ttTh, color: RED }}>{hhmm(p.starts_at)}<br />{hhmm(p.ends_at)}</th>)}
                </tr>
              </thead>
              <tbody>
                {DAYS.map((d, di) => (
                  <tr key={d.n}>
                    <td style={ttDay}>{d.label.toUpperCase()}</td>
                    {ctx.cols.map((p) => {
                      if (p.type && p.type !== 'teaching') {
                        if (di !== 0) return null;
                        const { bg, fg } = specialStyle(p.type);
                        return <td key={p.id} rowSpan={DAYS.length} style={{ border: `1px solid ${INK}`, background: bg, padding: 2, textAlign: 'center', verticalAlign: 'middle' }}><div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', margin: '0 auto', fontSize: 11, fontWeight: 900, color: fg, whiteSpace: 'nowrap' }}>{SPECIAL_LABEL[p.type] || p.name}</div></td>;
                      }
                      const subj = ctx.subjectLabel(d.n, p.id);
                      return (
                        <td key={p.id} style={{ border: `1px solid ${INK}`, padding: 4, verticalAlign: 'top' }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: subj ? BLUE : MUTED2, marginBottom: 2 }}>{subj || '—'}</div>
                          <textarea value={cellMap[`${d.n}_${p.id}`] || ''} onChange={(e) => setCell(d.n, p.id, e.target.value)} placeholder="…" rows={2}
                            style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontSize: 11, color: INK, fontFamily: FONT, background: 'transparent', lineHeight: 1.3 }} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="wf-noprint" style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: MUTED2 }}>Prepared by</span>
            <input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} style={{ ...inputStyle, width: 220, padding: '6px 10px' }} />
          </div>
        </div>
      )}
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

export function DailySchedulePage() {
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const ctx = useTimetableContext(classId, sectionId);
  const [cellMap, setCellMap] = useState({});   // periodId → activity
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };
  const className = ctx.classes.find((c) => c.id === classId)?.name || '';
  const weekStart = mondayOf(date);
  const dow = ((new Date(date + 'T00:00:00').getDay()) + 6) % 7 + 1;   // 1=Mon

  const loadDay = useCallback(() => {
    if (!classId) { setCellMap({}); return; }
    const p = new URLSearchParams({ class_id: classId, week_start: weekStart });
    if (sectionId) p.set('section_id', sectionId);
    apiGet(`${BASE}/forecast?${p}`).then((r) => {
      const cells = (r.data?.cells || []).filter((c) => c.day_of_week === dow);
      setCellMap(Object.fromEntries(cells.map((c) => [c.period_id, c.activity || ''])));
    }).catch(() => {});
  }, [classId, sectionId, weekStart, dow]);
  useEffect(() => { loadDay(); }, [loadDay]);

  const save = async () => {
    setBusy(true);
    try {
      const cells = ctx.cols.filter((p) => !p.type || p.type === 'teaching').map((p) => ({ day_of_week: dow, period_id: p.id, activity: cellMap[p.id] ?? '' }));
      await apiPost(`${BASE}/forecast/save`, { class_id: classId, section_id: sectionId || '', week_start: weekStart, week_end: addDays(weekStart, 4), cells });
      showToast('Daily schedule saved ✓');
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <PageLayout title="Daily Schedule" subtitle="A single day's plan, period by period — follows the class timetable">
      <style>{`@media print { body * { visibility: hidden !important; } #ds-print, #ds-print * { visibility: visible !important; } #ds-print { position:absolute; left:0; top:0; width:100%; } .ds-noprint { display:none !important; } }`}</style>
      <div className="ds-noprint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={{ ...inputStyle, width: 160, cursor: 'pointer' }}>
          <option value="">— class —</option>{ctx.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...inputStyle, width: 140, cursor: 'pointer' }}>
          <option value="">All sections</option>{ctx.sections.filter((s) => s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 160 }} />
        {classId && <button onClick={save} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>{busy ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={13} />} Save</button>}
        {classId && <button onClick={() => window.print()} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 9, border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}><Printer size={14} /> Print</button>}
      </div>

      {!classId ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT, background: WHITE, border: `1.5px dashed ${BORDER}`, borderRadius: 14 }}>Pick a class and date.</div>
      ) : dow > 5 ? (
        <div style={{ padding: 40, textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT, background: WHITE, border: `1.5px dashed ${BORDER}`, borderRadius: 14 }}>{DOW_NAMES[dow - 1]} is a weekend — no scheduled periods.</div>
      ) : (
        <div id="ds-print" style={{ background: WHITE, border: `2px solid ${INK}`, borderRadius: 8, padding: 14, fontFamily: FONT, maxWidth: 720 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: INK, marginBottom: 10 }}>{className.toUpperCase()} — {DOW_NAMES[dow - 1].toUpperCase()}, {prettyDate(date)}</div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...ttTh, width: 90 }}>TIME</th>
                <th style={{ ...ttTh, width: 120 }}>SUBJECT</th>
                <th style={ttTh}>WHAT WILL BE DONE</th>
              </tr>
            </thead>
            <tbody>
              {ctx.cols.map((p) => {
                const special = p.type && p.type !== 'teaching';
                const { bg, fg } = special ? specialStyle(p.type) : { bg: WHITE, fg: INK };
                const subj = special ? '' : ctx.subjectLabel(dow, p.id);
                return (
                  <tr key={p.id}>
                    <td style={{ border: `1px solid ${INK}`, padding: '6px 8px', fontSize: 11.5, fontWeight: 700, color: INK, whiteSpace: 'nowrap', background: special ? bg : LIGHT }}>{hhmm(p.starts_at)}–{hhmm(p.ends_at)}</td>
                    {special ? (
                      <td colSpan={2} style={{ border: `1px solid ${INK}`, padding: '6px 10px', background: bg, color: fg, fontWeight: 900, fontSize: 12, letterSpacing: .5 }}>{SPECIAL_LABEL[p.type] || p.name}</td>
                    ) : (
                      <>
                        <td style={{ border: `1px solid ${INK}`, padding: '6px 8px', fontSize: 12, fontWeight: 800, color: subj ? BLUE : MUTED2 }}>{subj || '—'}</td>
                        <td style={{ border: `1px solid ${INK}`, padding: 4 }}>
                          <textarea value={cellMap[p.id] || ''} onChange={(e) => setCellMap((m) => ({ ...m, [p.id]: e.target.value }))} placeholder="…" rows={1}
                            style={{ width: '100%', border: 'none', outline: 'none', resize: 'vertical', fontSize: 12, color: INK, fontFamily: FONT, background: 'transparent', lineHeight: 1.35 }} />
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}
