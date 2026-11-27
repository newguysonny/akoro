/**
 * Assign Teacher to Subjects — dedicated page. Pick a class, then set the
 * teacher for each subject already assigned to that class. Saves immediately
 * when a teacher is chosen (updates the class-subject's teacher_id).
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ico } from '../../../theme/Ico.jsx';
import { PageLayout } from '../../../components/Layout.jsx';
import { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPut } from '../../../services/api.js';
import { GREEN, BLUE, PURPLE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';
import { BASE, toastEl } from './shared.jsx';

const label = { display: 'block', fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, marginBottom: 5 };
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px' };
const teacherName = (t) => t?.full_name || t?.email || '';

export function AssignTeacherSubjectsPage() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classId, setClassId] = useState('');
  const [assigned, setAssigned] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet('/api/school/instructors').then((r) => setTeachers(r.data || [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    if (!classId) { setAssigned([]); return; }
    setAssigned(null);
    apiGet(`${BASE}/class-subjects?class_id=${classId}`).then((r) => setAssigned(r.data || [])).catch(() => setAssigned([]));
  }, [classId]);
  useEffect(() => { load(); }, [load]);

  const setTeacher = async (row, teacherId) => {
    setSavingId(row.id);
    setAssigned((prev) => prev.map((a) => (a.id === row.id ? { ...a, teacher_id: teacherId || null } : a)));
    try { await apiPut(`${BASE}/class-subjects/${row.id}`, { teacher_id: teacherId || null }); showToast('Teacher updated ✓'); }
    catch (e) { showToast(e.message || 'Could not save'); load(); }
    finally { setSavingId(null); }
  };

  const activeClass = classes.find((c) => c.id === classId);

  return (
    <PageLayout title="Assign Teacher to Subjects" subtitle="Choose a class, then set the teacher for each of its subjects">
      <div style={{ ...card, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px' }}>
          <label style={label}>Class</label>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">— select class —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {!classId ? (
        <div style={{ ...card, textAlign: 'center', color: C.muted2, padding: '40px 20px', fontFamily: C.font }}>
          <Ico ti="ti-school" size={26} style={{ opacity: .5, marginBottom: 8 }} /><div>Select a class above to assign teachers to its subjects.</div>
        </div>
      ) : assigned === null ? (
        <div style={{ ...card, textAlign: 'center', padding: '30px' }}><Ico ti="ti-loader-2" size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : assigned.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: C.muted2, padding: '34px 20px', fontFamily: C.font }}>
          <Ico ti="ti-book" size={24} style={{ opacity: .5, marginBottom: 8 }} />
          <div style={{ marginBottom: 12 }}>No subjects are assigned to {activeClass?.name} yet.</div>
          <button onClick={() => navigate('/mgmt/assign-subjects')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 9, border: 'none', background: `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: '#fff', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: C.font }}>
            Assign Subjects First
          </button>
        </div>
      ) : (
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, fontFamily: C.font, marginBottom: 6 }}>Subjects for {activeClass?.name}</div>
          <p style={{ fontSize: 11.5, color: C.muted2, fontFamily: C.font, margin: '0 0 12px' }}>Pick a teacher for each subject — changes save automatically.</p>
          {assigned.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: `${(a.is_elective ? PURPLE : BLUE)}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ico ti="ti-book" size={16} color={a.is_elective ? PURPLE : BLUE} />
              </div>
              <div style={{ flex: '1 1 160px', minWidth: 140 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: C.font }}>{a.subject_name}{a.is_elective ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: PURPLE }}>ELECTIVE</span> : ''}</div>
                <div style={{ fontSize: 11, color: C.muted2, fontFamily: C.font }}>{a.teacher_id ? 'Assigned' : 'No teacher yet'}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 1 260px' }}>
                <Ico ti="ti-user-cog" size={15} color={C.muted2} />
                <select value={a.teacher_id || ''} onChange={(e) => setTeacher(a, e.target.value)} disabled={savingId === a.id} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">— unassigned —</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{teacherName(t)}</option>)}
                </select>
                {savingId === a.id ? <Ico ti="ti-loader-2" size={15} style={{ animation: 'spin .8s linear infinite' }} /> : a.teacher_id ? <Ico ti="ti-check" size={15} color={GREEN} /> : <span style={{ width: 15 }} />}
              </div>
            </div>
          ))}
          {teachers.length === 0 && <p style={{ fontSize: 12, color: C.muted, fontFamily: C.font, marginTop: 12 }}>No teachers found — invite staff under Human Resource / Staff first.</p>}
        </div>
      )}
      {toastEl(toast)}
    </PageLayout>
  );
}
