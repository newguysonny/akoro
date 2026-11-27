/**
 * Student Information — daily attendance register.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ico } from '../../../theme/Ico.jsx';
import { PageLayout } from '../../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';
import { BASE, fullName, studentOpts, STATUS_PILL, STUDENT_FIELDS, STUDENT_COLUMNS, STUDENT_SEARCH, CLASS_FILTER, naira, STATUS_OPTS, InfoRow, GridInfo, InfoGrid, SectionCard, Ring, statPill, FEE_STATUS_COLOR, ModalShell } from './shared.jsx';

/* ── Student Attendance (register) ───────────────────────────────── */
const ATT_STATUSES = [
  { key: 'present', label: 'Present', c: GREEN },
  { key: 'absent', label: 'Absent', c: RED },
  { key: 'late', label: 'Late', c: C.brand },
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
        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 5 }}>Class</label>
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={{ ...inputStyle, width: 160, cursor: 'pointer' }}>
            <option value="">— select —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 5 }}>Section</label>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...inputStyle, width: 140, cursor: 'pointer' }}>
            <option value="">All</option>{sections.filter((s) => s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div><label style={{ fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, display: 'block', marginBottom: 5 }}>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: 160 }} /></div>
        <button onClick={loadRegister} style={{ padding: '10px 18px', borderRadius: 9, border: 'none', background: BLUE, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
          {loading ? 'Loading…' : 'Load Register'}
        </button>
      </div>

      {register && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
          {register.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: C.muted2, fontSize: 13, fontFamily: C.font }}>No active students in that class/section.</div>
          ) : (
            <>
              {register.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: C.font }}>{s.name}</span>
                    <span style={{ fontSize: 11, color: C.muted2, fontFamily: C.font, marginLeft: 8 }}>{s.admission_no}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {ATT_STATUSES.map((st) => (
                      <button key={st.key} onClick={() => setRegister((prev) => prev.map((r) => (r.id === s.id ? { ...r, status: st.key } : r)))}
                        style={{ padding: '6px 12px', borderRadius: 999, border: `1.5px solid ${s.status === st.key ? st.c : C.border}`, background: s.status === st.key ? tint(8, st.c) : C.surface, color: s.status === st.key ? st.c : C.muted2, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 16px', background: C.bg }}>
                <button onClick={saveMarks} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 10, border: 'none', background: saving ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: saving ? C.muted2 : '#fff', fontSize: 13, fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontFamily: C.font }}>
                  {saving ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-device-floppy" size={14} />} {saving ? 'Saving…' : 'Save Attendance'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {toast && <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: C.ink, color: '#fff', padding: '9px 20px', borderRadius: 20, fontSize: 12.5, fontWeight: 700, zIndex: 9999, boxShadow: '0 4px 14px rgba(0,0,0,.2)' }}>{toast}</div>}
    </PageLayout>
  );
}
