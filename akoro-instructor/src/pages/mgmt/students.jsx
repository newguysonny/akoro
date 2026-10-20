/**
 * Teacher-scoped Student Information pages.
 * - Attendance: a whole-class register (mark everyone in one screen).
 * - Behavior: SIS behavior log.
 * "My Students" (add/list/disable + Manual/Invite/CSV) is the StudentsPage
 * mounted at /mgmt/students.
 */
import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Loader2, Save, Check } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { GREEN, RED, BLUE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';
import { Ico } from '../../theme/Ico.jsx';

const BASE = '/api/school/mgmt';
const STATUSES = [
  { v: 'present', label: 'P', full: 'Present', c: GREEN },
  { v: 'absent',  label: 'A', full: 'Absent',  c: RED },
  { v: 'late',    label: 'L', full: 'Late',    c: '#E8884A' },
  { v: 'excused', label: 'E', full: 'Excused', c: BLUE },
];

// Whole-class attendance register.
export function StudentAttendancePage() {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [roster, setRoster] = useState(null);   // [{student_id,name,admission_no,status}]
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2600); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!classId || !date) { setRoster(null); return; }
    const p = new URLSearchParams({ class_id: classId, date });
    if (sectionId) p.set('section_id', sectionId);
    setRoster(null);
    apiGet(`${BASE}/attendance/roster?${p}`).then((r) => setRoster(r.data || [])).catch((e) => { showToast(e.message || 'Could not load'); setRoster([]); });
  }, [classId, sectionId, date]);
  useEffect(() => { load(); }, [load]);

  const setStatus = (id, v) => setRoster((rs) => rs.map((s) => s.student_id === id ? { ...s, status: v } : s));
  const allPresent = () => setRoster((rs) => rs.map((s) => ({ ...s, status: 'present' })));

  const save = async () => {
    if (!roster?.length) return;
    setBusy(true);
    try {
      const records = roster.map((s) => ({ student_id: s.student_id, status: s.status || 'present' }));
      const r = await apiPost(`${BASE}/attendance/mark`, { date, records });
      showToast(`Saved attendance for ${r.saved} student${r.saved === 1 ? '' : 's'} ✓`);
      load();
    } catch (e) { showToast(e.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  const counts = (roster || []).reduce((a, s) => { if (s.status) a[s.status] = (a[s.status] || 0) + 1; return a; }, {});

  return (
    <PageLayout title="Attendance Register" subtitle="Mark a whole class in one screen">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={{ ...inputStyle, width: 160, cursor: 'pointer' }}>
          <option value="">— class —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...inputStyle, width: 140, cursor: 'pointer' }}>
          <option value="">All sections</option>{sections.filter((s) => s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Ico lucide={CalendarDays} ti="ti-calendar" size={15} color={C.muted2} /><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 160 }} /></div>
        {roster?.length > 0 && <button onClick={allPresent} style={{ ...pillBtn(GREEN) }}><Ico lucide={Check} ti="ti-check" size={13} /> All present</button>}
        {roster?.length > 0 && <button onClick={save} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>{busy ? <Ico lucide={Loader2} ti="ti-loader-2" size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico lucide={Save} ti="ti-device-floppy" size={13} />} Save</button>}
      </div>

      {roster?.length > 0 && (
        <div style={{ display: 'flex', gap: 14, marginBottom: 12, fontSize: 12, fontWeight: 700, color: C.muted }}>
          {STATUSES.map((s) => <span key={s.v} style={{ color: s.c }}>{s.full}: {counts[s.v] || 0}</span>)}
          <span>Total: {roster.length}</span>
        </div>
      )}

      {!classId ? (
        <div style={emptyBox}>Pick a class and date to take attendance.</div>
      ) : roster === null ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.muted2 }}><Ico lucide={Loader2} ti="ti-loader-2" size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : roster.length === 0 ? (
        <div style={emptyBox}>No active students in this class.</div>
      ) : (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
          {roster.map((s, i) => (
            <div key={s.student_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
              <span style={{ width: 22, fontSize: 11, color: C.muted2, fontWeight: 700 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{s.name || 'Student'}</div>
                <div style={{ fontSize: 11, color: C.muted2 }}>{s.admission_no}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {STATUSES.map((st) => (
                  <button key={st.v} onClick={() => setStatus(s.student_id, st.v)} title={st.full}
                    style={{ width: 34, height: 34, borderRadius: 8, border: `1.5px solid ${s.status === st.v ? st.c : C.border}`, background: s.status === st.v ? st.c : C.surface, color: s.status === st.v ? '#fff' : C.muted, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                    {st.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {toast && <div style={toastStyle}>{toast}</div>}
    </PageLayout>
  );
}

const pillBtn = (c) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 9, border: `1px solid ${c}55`, background: tint(7, c), color: c, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: C.font });
const emptyBox = { padding: 44, textAlign: 'center', color: C.muted2, fontSize: 13.5, fontFamily: C.font, background: C.surface, border: `1.5px dashed ${C.border}`, borderRadius: 14 };
const toastStyle = { position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.hero, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999 };

export function BehaviorRecordsPage() {
  return <ResourcePage title="Behavior Records" subtitle="Log positive and negative behavior" resource="behavior-records"
    columns={[{ key: 'student_name', label: 'Student' }, { key: 'incident_type', label: 'Incident' }, { key: 'polarity', label: 'Type' }, { key: 'severity', label: 'Severity' }, { key: 'recorded_on', label: 'Date' }]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: { resource: 'students', labelKey: 'first_name' } },
      { key: 'incident_type', label: 'Incident', required: true, placeholder: 'e.g. Helped a classmate' },
      { key: 'polarity', label: 'Type', type: 'select', options: [{ value: 'positive', label: 'Positive' }, { value: 'negative', label: 'Negative' }], default: 'positive' },
      { key: 'severity', label: 'Severity', type: 'select', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] },
      { key: 'points', label: 'Points', placeholder: '±5' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'action_taken', label: 'Action Taken', type: 'textarea' },
      { key: 'recorded_on', label: 'Date', type: 'date' },
    ]}
    listFilters={[
      { key: 'student_id', label: 'Student', optionsFrom: { resource: 'students', labelKey: 'first_name' } },
      { key: 'polarity', label: 'Type', options: [{ value: 'positive', label: 'Positive' }, { value: 'negative', label: 'Negative' }] },
    ]}
    createLabel="New Record" />;
}
