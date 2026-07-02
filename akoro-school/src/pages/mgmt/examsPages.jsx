/** Offline + Online Examinations module pages (mgmt schema). */
import { useState, useEffect, useCallback } from 'react';
import { ClipboardList, CalendarDays, FileCheck, Layers, Upload, Loader2, Save, Printer } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../constants.js';

const BASE = '/api/school/mgmt';
const studentOpts = { resource: 'students', labelFn: (r) => `${r.first_name} ${r.last_name} (${r.admission_no})` };
const pill = (v, map) => {
  const c = map[v] || MUTED2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${c}15`, color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v}</span>;
};

export function ExamDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/exams`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.exams, label: 'Exams', icon: ClipboardList, c: BLUE, to: '/mgmt/offline-exams' },
    { n: s.upcoming, label: 'Upcoming', icon: CalendarDays, c: AMBER, to: '/mgmt/offline-exams' },
    { n: s.schedules, label: 'Scheduled Papers', icon: Layers, c: PURPLE, to: '/mgmt/exam-schedules' },
    { n: s.marksEntered, label: 'Marks Entered', icon: FileCheck, c: GREEN, to: '/mgmt/enter-marks' },
    { n: s.examTypes, label: 'Exam Types', icon: Layers, c: BLUE, to: '/mgmt/exam-types' },
    { n: s.uploads, label: 'Marksheet Uploads', icon: Upload, c: AMBER, to: '/mgmt/manage-uploads' },
  ] : [];
  return <PageLayout title="Exam Dashboard" subtitle="Offline examination overview"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function ManageOfflineExamsPage() {
  const STATUSES = [{ value: 'upcoming', label: 'Upcoming' }, { value: 'ongoing', label: 'Ongoing' }, { value: 'completed', label: 'Completed' }];
  return <ResourcePage title="Manage Offline Exams" subtitle="Exam events" resource="exams"
    columns={[
      { key: 'name', label: 'Exam' }, { key: 'exam_type_name', label: 'Type' }, { key: 'session_name', label: 'Session' },
      { key: 'starts_on', label: 'Starts' }, { key: 'status', label: 'Status', render: (r) => pill(r.status, { upcoming: AMBER, ongoing: BLUE, completed: GREEN }) },
    ]}
    fields={[
      { key: 'name', label: 'Exam Name', required: true },
      { key: 'exam_type_id', label: 'Exam Type', type: 'select', optionsFrom: { resource: 'exam-types' } },
      { key: 'session_id', label: 'Session', type: 'select', optionsFrom: { resource: 'academic-sessions' } },
      { key: 'status', label: 'Status', type: 'select', default: 'upcoming', options: STATUSES },
      { key: 'starts_on', label: 'Starts On', type: 'date' },
      { key: 'ends_on', label: 'Ends On', type: 'date' },
    ]} listFilters={[{ key: 'status', label: 'Status', options: STATUSES }]} createLabel="New Exam" />;
}

export function ExamTypesPage() {
  return <ResourcePage title="Exam Types" subtitle="e.g. Mid-Term, End of Term" resource="exam-types"
    columns={[{ key: 'name', label: 'Type' }]} fields={[{ key: 'name', label: 'Type Name', required: true }]} createLabel="New Type" />;
}

export function ScheduleMarksSetupPage() {
  return <ResourcePage title="Schedule & Marks Setup" subtitle="Papers per exam/class/subject" resource="exam-schedules"
    columns={[
      { key: 'exam_name', label: 'Exam' }, { key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' },
      { key: 'exam_date', label: 'Date' }, { key: 'max_marks', label: 'Max' }, { key: 'pass_marks', label: 'Pass' },
    ]}
    fields={[
      { key: 'exam_id', label: 'Exam', type: 'select', required: true, optionsFrom: { resource: 'exams' } },
      { key: 'class_id', label: 'Class', type: 'select', required: true, optionsFrom: { resource: 'classes' } },
      { key: 'subject_id', label: 'Subject', type: 'select', required: true, optionsFrom: { resource: 'subjects' } },
      { key: 'exam_date', label: 'Exam Date', type: 'date' },
      { key: 'max_marks', label: 'Max Marks', type: 'number', default: 100 },
      { key: 'pass_marks', label: 'Pass Marks', type: 'number', default: 40 },
    ]} listFilters={[{ key: 'exam_id', label: 'Exam', optionsFrom: { resource: 'exams' } }, { key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } }]}
    createLabel="New Schedule" />;
}

/* ── Enter Marks ─────────────────────────────────────────────────── */
export function EnterMarksPage() {
  const [schedules, setSchedules] = useState([]);
  const [scheduleId, setScheduleId] = useState('');
  const [register, setRegister] = useState(null);
  const [maxMarks, setMaxMarks] = useState(100);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => { apiGet(`${BASE}/exam-schedules`).then((r) => setSchedules(r.data || [])).catch(() => {}); }, []);

  const load = useCallback(() => {
    if (!scheduleId) return setRegister(null);
    apiGet(`${BASE}/exams/marks/register?schedule_id=${scheduleId}`)
      .then((r) => { setRegister(r.data || []); setMaxMarks(r.maxMarks || 100); })
      .catch((e) => showToast(e.message || 'Could not load'));
  }, [scheduleId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiPost(`${BASE}/exams/marks`, { schedule_id: scheduleId, entries: register.map((s) => ({ student_id: s.id, marks: s.marks })) });
      showToast(`Saved ${res.saved} mark${res.saved === 1 ? '' : 's'} ✓`);
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setSaving(false); }
  };

  return (
    <PageLayout title="Enter Marks" subtitle="Record scores per exam paper">
      <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} style={{ ...inputStyle, width: 420, maxWidth: '100%', cursor: 'pointer', marginBottom: 16 }}>
        <option value="">— select exam paper —</option>
        {schedules.map((s) => <option key={s.id} value={s.id}>{s.exam_name} · {s.class_name} · {s.subject_name}</option>)}
      </select>

      {register && (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
          {register.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>No active students in that class.</div>
          ) : (
            <>
              {register.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${BORDER}`, fontFamily: FONT }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: MUTED2, marginLeft: 8 }}>{s.admission_no}</span>
                  </div>
                  <input type="number" min="0" max={maxMarks} value={s.marks ?? ''} placeholder={`/ ${maxMarks}`}
                    onChange={(e) => setRegister((prev) => prev.map((r) => (r.id === s.id ? { ...r, marks: e.target.value } : r)))}
                    style={{ ...inputStyle, width: 110 }} />
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 16px', background: LIGHT }}>
                <button onClick={save} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? '#E5E7EB' : `linear-gradient(135deg, ${AMBER}, #D4651E)`, color: saving ? '#9CA3AF' : WHITE, fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: FONT }}>
                  {saving ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={14} />} Save Marks
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: INK, color: WHITE, padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 }}>{toast}</div>}
    </PageLayout>
  );
}

export function CocurricularAreasPage() {
  return <ResourcePage title="Cocurricular Areas" subtitle="Sports, clubs & activities" resource="cocurricular-areas"
    columns={[{ key: 'name', label: 'Area' }]} fields={[{ key: 'name', label: 'Area Name', required: true }]} createLabel="New Area" />;
}

export function CocurricularGradesPage() {
  return <ResourcePage title="Cocurricular Grades" subtitle="Grading scale for activities" resource="cocurricular-grades"
    columns={[{ key: 'grade', label: 'Grade' }, { key: 'min_score', label: 'Min' }, { key: 'max_score', label: 'Max' }, { key: 'remark', label: 'Remark' }]}
    fields={[
      { key: 'grade', label: 'Grade', required: true, placeholder: 'A' },
      { key: 'remark', label: 'Remark' },
      { key: 'min_score', label: 'Min Score', type: 'number' },
      { key: 'max_score', label: 'Max Score', type: 'number' },
    ]} createLabel="New Grade" />;
}

export function ManageGradesPage() {
  return <ResourcePage title="Manage Grades" subtitle="Academic grading scale" resource="grade-scales"
    columns={[{ key: 'grade', label: 'Grade' }, { key: 'min_percent', label: 'Min %' }, { key: 'max_percent', label: 'Max %' }, { key: 'remark', label: 'Remark' }]}
    fields={[
      { key: 'grade', label: 'Grade', required: true, placeholder: 'A' },
      { key: 'remark', label: 'Remark' },
      { key: 'min_percent', label: 'Min %', type: 'number' },
      { key: 'max_percent', label: 'Max %', type: 'number' },
    ]} createLabel="New Grade" />;
}

export function ReportCardSetupsPage() {
  return <ResourcePage title="Report Card Setups" subtitle="Report card layouts" resource="report-card-setups"
    columns={[{ key: 'name', label: 'Setup' }, { key: 'description', label: 'Description' }]}
    fields={[{ key: 'name', label: 'Setup Name', required: true }, { key: 'description', label: 'Description', type: 'textarea', full: true }]}
    createLabel="New Setup" />;
}

/* ── Generate Marksheet (matrix) ─────────────────────────────────── */
export function GenerateMarksheetPage() {
  const [exams, setExams] = useState([]);
  const [classes, setClasses] = useState([]);
  const [examId, setExamId] = useState('');
  const [classId, setClassId] = useState('');
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet(`${BASE}/exams`).then((r) => setExams(r.data || [])).catch(() => {});
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
  }, []);

  const generate = async () => {
    if (!examId || !classId) return;
    setLoading(true);
    try { setSheet(await apiGet(`${BASE}/exams/marksheet?exam_id=${examId}&class_id=${classId}`)); }
    catch { setSheet(null); }
    finally { setLoading(false); }
  };

  return (
    <PageLayout title="Generate Marksheet" subtitle="Class result matrix per exam">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <select value={examId} onChange={(e) => setExamId(e.target.value)} style={{ ...inputStyle, width: 220, cursor: 'pointer' }}>
          <option value="">— exam —</option>{exams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} style={{ ...inputStyle, width: 160, cursor: 'pointer' }}>
          <option value="">— class —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={generate} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: BLUE, color: WHITE, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          <Printer size={13} /> {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {sheet && (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
          {!sheet.subjects?.length ? (
            <div style={{ padding: '30px', textAlign: 'center', color: MUTED2, fontSize: 13, fontFamily: FONT }}>No scheduled papers for that exam/class yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, minWidth: 640 }}>
              <thead><tr style={{ background: LIGHT }}>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>STUDENT</th>
                {sheet.subjects.map((s) => <th key={s.id} style={{ textAlign: 'center', padding: '10px 10px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>{s.name.toUpperCase()}</th>)}
                <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>TOTAL</th>
                <th style={{ textAlign: 'center', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED2 }}>%</th>
              </tr></thead>
              <tbody>
                {sheet.data.map((r) => (
                  <tr key={r.student_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                    <td style={{ padding: '10px 14px', fontSize: 12.5, fontWeight: 700, color: INK }}>{r.name}<span style={{ fontSize: 10.5, color: MUTED2, marginLeft: 6 }}>{r.admission_no}</span></td>
                    {r.scores.map((v, i) => <td key={i} style={{ padding: '10px', textAlign: 'center', fontSize: 12.5, color: v === null ? MUTED2 : INK }}>{v === null ? '—' : v}</td>)}
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: INK }}>{r.total}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 12.5, fontWeight: 800, color: r.percent >= 40 ? GREEN : RED }}>{r.percent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </PageLayout>
  );
}

const UPLOAD_COLUMNS = [
  { key: 'title', label: 'Title' }, { key: 'exam_name', label: 'Exam' }, { key: 'class_name', label: 'Class' },
  { key: 'file_url', label: 'File', render: (r) => r.file_url ? <a href={r.file_url} target="_blank" rel="noreferrer" style={{ color: BLUE, fontWeight: 700 }}>Open</a> : '—' },
];
const UPLOAD_FIELDS = [
  { key: 'title', label: 'Title', required: true },
  { key: 'exam_id', label: 'Exam', type: 'select', optionsFrom: { resource: 'exams' } },
  { key: 'class_id', label: 'Class', type: 'select', optionsFrom: { resource: 'classes' } },
  { key: 'file_url', label: 'File URL', full: true, placeholder: 'https://…' },
  { key: 'note', label: 'Note', type: 'textarea', full: true },
];

export function UploadMarksheetPage() {
  return <ResourcePage title="Upload Marksheet" subtitle="Attach an externally prepared marksheet" resource="marksheet-uploads"
    columns={UPLOAD_COLUMNS} fields={UPLOAD_FIELDS} createLabel="Upload Marksheet" startOpen />;
}

export function ManageUploadsPage() {
  return <ResourcePage title="Manage Uploads" subtitle="All uploaded marksheets" resource="marksheet-uploads"
    columns={UPLOAD_COLUMNS} fields={UPLOAD_FIELDS} createLabel="Upload Marksheet" />;
}

export function TeacherRemarksPage() {
  return <ResourcePage title="Teacher Remarks" subtitle="Per-student report card remarks" resource="teacher-remarks"
    columns={[{ key: 'student_name', label: 'Student' }, { key: 'exam_name', label: 'Exam' }, { key: 'remark', label: 'Remark' }]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: studentOpts },
      { key: 'exam_id', label: 'Exam', type: 'select', optionsFrom: { resource: 'exams' } },
      { key: 'remark', label: 'Remark', type: 'textarea', required: true, full: true },
    ]} listFilters={[{ key: 'exam_id', label: 'Exam', optionsFrom: { resource: 'exams' } }]} createLabel="New Remark" />;
}

/* ── Online Examinations ─────────────────────────────────────────── */
export function ManageOnlineExamsPage() {
  const STATUSES = [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'closed', label: 'Closed' }];
  return <ResourcePage title="Manage Online Exams" subtitle="Computer-based tests" resource="online-exams"
    columns={[
      { key: 'title', label: 'Exam' }, { key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' },
      { key: 'exam_date', label: 'Date' }, { key: 'duration_minutes', label: 'Duration (min)' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { draft: AMBER, published: GREEN, closed: MUTED2 }) },
    ]}
    fields={[
      { key: 'title', label: 'Exam Title', required: true },
      { key: 'class_id', label: 'Class', type: 'select', optionsFrom: { resource: 'classes' } },
      { key: 'subject_id', label: 'Subject', type: 'select', optionsFrom: { resource: 'subjects' } },
      { key: 'exam_date', label: 'Date', type: 'date' },
      { key: 'duration_minutes', label: 'Duration (minutes)', type: 'number', default: 60 },
      { key: 'status', label: 'Status', type: 'select', default: 'draft', options: STATUSES },
    ]} listFilters={[{ key: 'status', label: 'Status', options: STATUSES }]} createLabel="New Online Exam" />;
}

export function QuestionBankPage() {
  return <ResourcePage title="Question Bank" subtitle="Reusable multiple-choice questions" resource="question-bank"
    columns={[
      { key: 'question', label: 'Question' }, { key: 'subject_name', label: 'Subject' },
      { key: 'correct_option', label: 'Answer', render: (r) => r.correct_option ? <b style={{ textTransform: 'uppercase', color: GREEN }}>{r.correct_option}</b> : '—' },
      { key: 'marks', label: 'Marks' },
    ]}
    fields={[
      { key: 'subject_id', label: 'Subject', type: 'select', optionsFrom: { resource: 'subjects' } },
      { key: 'marks', label: 'Marks', type: 'number', default: 1 },
      { key: 'question', label: 'Question', type: 'textarea', required: true, full: true },
      { key: 'option_a', label: 'Option A' }, { key: 'option_b', label: 'Option B' },
      { key: 'option_c', label: 'Option C' }, { key: 'option_d', label: 'Option D' },
      { key: 'correct_option', label: 'Correct Option', type: 'select', options: ['a', 'b', 'c', 'd'].map((o) => ({ value: o, label: o.toUpperCase() })) },
    ]} listFilters={[{ key: 'subject_id', label: 'Subject', optionsFrom: { resource: 'subjects' } }]} createLabel="New Question" />;
}
