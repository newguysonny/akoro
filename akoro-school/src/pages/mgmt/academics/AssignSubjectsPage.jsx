/**
 * Assign Subjects — dedicated page. Pick a class, select subjects from the
 * database (with an optional teacher and elective flag) and add them. Assigned
 * subjects for the class are listed with a remove action.
 */
import { useState, useEffect, useCallback } from 'react';
import { Ico } from '../../../theme/Ico.jsx';
import { PageLayout } from '../../../components/Layout.jsx';
import { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost, apiDelete } from '../../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';
import { BASE, iconBtn, toastEl } from './shared.jsx';
import { confirmDialog } from '../../../components/ConfirmHost.jsx';

const label = { display: 'block', fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, marginBottom: 5 };
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px' };
const teacherName = (t) => t?.full_name || t?.email || '';

export function AssignSubjectsPage() {
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classId, setClassId] = useState('');
  const [query, setQuery] = useState('');
  const [checked, setChecked] = useState({});          // subject id → bool
  const [teacherId, setTeacherId] = useState('');
  const [isElective, setIsElective] = useState(false);
  const [assigned, setAssigned] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/subjects`).then((r) => setSubjects(r.data || [])).catch(() => {});
    apiGet('/api/school/instructors').then((r) => setTeachers(r.data || [])).catch(() => {});
  }, []);

  const loadAssigned = useCallback(() => {
    if (!classId) { setAssigned([]); return; }
    setAssigned(null);
    apiGet(`${BASE}/class-subjects?class_id=${classId}`).then((r) => setAssigned(r.data || [])).catch(() => setAssigned([]));
  }, [classId]);
  useEffect(() => { loadAssigned(); setChecked({}); }, [loadAssigned]);

  const teacherById = Object.fromEntries(teachers.map((t) => [t.id, t]));
  const assignedSubjectIds = new Set((assigned || []).map((a) => a.subject_id));
  const q = query.trim().toLowerCase();
  const shown = subjects.filter((s) => !q || [s.name, s.code].some((v) => String(v || '').toLowerCase().includes(q)));
  const checkedIds = Object.keys(checked).filter((id) => checked[id] && !assignedSubjectIds.has(id));
  const activeClass = classes.find((c) => c.id === classId);

  const addSelected = async () => {
    if (!classId) return showToast('Select a class first');
    if (!checkedIds.length) return showToast('Select at least one subject');
    setBusy(true);
    try {
      await Promise.all(checkedIds.map((subject_id) => apiPost(`${BASE}/class-subjects`, {
        class_id: classId, subject_id, teacher_id: teacherId || null, is_elective: isElective,
      })));
      showToast(`Added ${checkedIds.length} subject(s) ✓`); setChecked({}); loadAssigned();
    } catch (e) { showToast(e.message || 'Could not add subjects'); } finally { setBusy(false); }
  };
  const remove = async (r) => {
    if (!await confirmDialog(`Remove "${r.subject_name}" from this class?`)) return;
    try { await apiDelete(`${BASE}/class-subjects/${r.id}`); loadAssigned(); }
    catch (e) { showToast(e.message || 'Could not remove'); }
  };

  return (
    <PageLayout title="Assign Subjects" subtitle="Choose a class, then add subjects from your database">
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
          <Ico ti="ti-school" size={26} style={{ opacity: .5, marginBottom: 8 }} /><div>Select a class above to assign subjects.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Subject picker */}
          <div style={{ ...card, flex: '1 1 360px', minWidth: 300 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ico ti="ti-book" size={16} color={BLUE} /><span style={{ fontSize: 14, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Available Subjects</span>
            </div>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Ico ti="ti-search" size={15} color={C.muted2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subjects by name or code…" style={{ ...inputStyle, paddingLeft: 34 }} />
            </div>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10 }}>
              {subjects.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: C.muted2, fontSize: 12.5, fontFamily: C.font }}>No subjects yet. Create them in Academics → Subjects.</div> : shown.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: C.muted2, fontSize: 12.5, fontFamily: C.font }}>No subjects match “{query}”.</div> : shown.map((s) => {
                const already = assignedSubjectIds.has(s.id);
                return (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: `1px solid ${C.border}`, cursor: already ? 'default' : 'pointer', fontFamily: C.font, opacity: already ? 0.55 : 1 }}>
                    <input type="checkbox" disabled={already} checked={already || !!checked[s.id]} onChange={(e) => setChecked((p) => ({ ...p, [s.id]: e.target.checked }))} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.ink }}>{s.name}{s.code ? <span style={{ color: C.muted2, fontWeight: 400 }}> · {s.code}</span> : ''}</span>
                    {already && <span style={{ fontSize: 10.5, fontWeight: 800, color: GREEN }}>Assigned</span>}
                  </label>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 160px' }}>
                <label style={label}>Teacher (optional)</label>
                <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">— none —</option>{teachers.map((t) => <option key={t.id} value={t.id}>{teacherName(t)}</option>)}
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: C.ink, fontFamily: C.font, cursor: 'pointer', paddingBottom: 9 }}>
                <input type="checkbox" checked={isElective} onChange={(e) => setIsElective(e.target.checked)} /> Elective
              </label>
            </div>
            <button onClick={addSelected} disabled={busy || !checkedIds.length} style={{ width: '100%', marginTop: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: (busy || !checkedIds.length) ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: (busy || !checkedIds.length) ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: (busy || !checkedIds.length) ? 'default' : 'pointer', fontFamily: C.font }}>
              {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-plus" size={14} />} Add {checkedIds.length ? `${checkedIds.length} ` : ''}Subject{checkedIds.length === 1 ? '' : 's'} to {activeClass?.name}
            </button>
          </div>

          {/* Assigned subjects */}
          <div style={{ ...card, flex: '1 1 300px', minWidth: 280 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, fontFamily: C.font, marginBottom: 12 }}>Assigned Subjects — {activeClass?.name}</div>
            {assigned === null ? <Ico ti="ti-loader-2" size={16} style={{ animation: 'spin .8s linear infinite' }} /> : assigned.length === 0 ? (
              <p style={{ fontSize: 12.5, color: C.muted2, fontFamily: C.font }}>No subjects assigned to this class yet.</p>
            ) : assigned.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
                <Ico ti="ti-book" size={15} color={a.is_elective ? PURPLE : BLUE} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: C.font }}>{a.subject_name}{a.is_elective ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: PURPLE }}>ELECTIVE</span> : ''}</div>
                  {a.teacher_id && teacherById[a.teacher_id] && <div style={{ fontSize: 11, color: C.muted2, fontFamily: C.font }}>{teacherName(teacherById[a.teacher_id])}</div>}
                </div>
                <button onClick={() => remove(a)} title="Remove" style={iconBtn(RED)}><Ico ti="ti-trash" size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      {toastEl(toast)}
    </PageLayout>
  );
}
