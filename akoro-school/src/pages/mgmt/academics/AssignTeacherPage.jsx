/**
 * Assign Class Teacher — dedicated page. Pick a class (and optional section),
 * search the school's teachers, choose one and assign. Existing assignments
 * for the class are listed with a remove action.
 */
import { useState, useEffect, useCallback } from 'react';
import { Ico } from '../../../theme/Ico.jsx';
import { PageLayout } from '../../../components/Layout.jsx';
import { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { apiGet, apiPost, apiDelete } from '../../../services/api.js';
import { GREEN, RED, BLUE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';
import { BASE, iconBtn, toolBtn, toastEl } from './shared.jsx';
import { confirmDialog } from '../../../components/ConfirmHost.jsx';

const label = { display: 'block', fontSize: 12, fontWeight: 700, color: C.ink, fontFamily: C.font, marginBottom: 5 };
const card = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px' };
const teacherName = (t) => t?.full_name || t?.email || 'Unknown';

export function AssignClassTeacherPage() {
  const [classes, setClasses] = useState([]);
  const [sections, setSections] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [classId, setClassId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);       // teacher id
  const [assignments, setAssignments] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    apiGet(`${BASE}/classes`).then((r) => setClasses(r.data || [])).catch(() => {});
    apiGet(`${BASE}/sections`).then((r) => setSections(r.data || [])).catch(() => {});
    apiGet('/api/school/instructors').then((r) => setTeachers(r.data || [])).catch(() => {});
  }, []);

  const loadAssignments = useCallback(() => {
    if (!classId) { setAssignments([]); return; }
    setAssignments(null);
    apiGet(`${BASE}/class-teachers?class_id=${classId}`).then((r) => setAssignments(r.data || [])).catch(() => setAssignments([]));
  }, [classId]);
  useEffect(() => { loadAssignments(); }, [loadAssignments]);

  const teacherById = Object.fromEntries(teachers.map((t) => [t.id, t]));
  const q = query.trim().toLowerCase();
  const shown = teachers.filter((t) => !q || [t.full_name, t.email].some((v) => String(v || '').toLowerCase().includes(q)));

  const assign = async () => {
    if (!classId) return showToast('Select a class first');
    if (!picked) return showToast('Choose a teacher');
    setBusy(true);
    try {
      await apiPost(`${BASE}/class-teachers`, { class_id: classId, section_id: sectionId || null, teacher_id: picked });
      showToast('Teacher assigned ✓'); setPicked(null); loadAssignments();
    } catch (e) { showToast(e.message || 'Could not assign'); } finally { setBusy(false); }
  };
  const remove = async (r) => {
    if (!await confirmDialog('Remove this teacher assignment?')) return;
    try { await apiDelete(`${BASE}/class-teachers/${r.id}`); loadAssignments(); }
    catch (e) { showToast(e.message || 'Could not remove'); }
  };

  const activeClass = classes.find((c) => c.id === classId);

  return (
    <PageLayout title="Assign Class Teacher" subtitle="Choose a class, then pick a form teacher from your staff">
      <div style={{ ...card, marginBottom: 16, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={label}>Class</label>
          <select value={classId} onChange={(e) => { setClassId(e.target.value); setSectionId(''); }} style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">— select class —</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={label}>Section (optional)</label>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} disabled={!classId}>
            <option value="">Whole class</option>{sections.filter((s) => s.class_id === classId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {!classId ? (
        <div style={{ ...card, textAlign: 'center', color: C.muted2, padding: '40px 20px', fontFamily: C.font }}>
          <Ico ti="ti-school" size={26} style={{ opacity: .5, marginBottom: 8 }} /><div>Select a class above to assign a teacher.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Teacher picker */}
          <div style={{ ...card, flex: '1 1 340px', minWidth: 300 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ico ti="ti-user-cog" size={16} color={BLUE} /><span style={{ fontSize: 14, fontWeight: 800, color: C.ink, fontFamily: C.font }}>Choose a Teacher</span>
            </div>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Ico ti="ti-search" size={15} color={C.muted2} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search teachers by name or email…" style={{ ...inputStyle, paddingLeft: 34 }} />
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto', border: `1px solid ${C.border}`, borderRadius: 10 }}>
              {teachers.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: C.muted2, fontSize: 12.5, fontFamily: C.font }}>No teachers found. Invite staff in Human Resource / Staff.</div> : shown.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: C.muted2, fontSize: 12.5, fontFamily: C.font }}>No teachers match “{query}”.</div> : shown.map((t) => (
                <button key={t.id} onClick={() => setPicked(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderTop: `1px solid ${C.border}`, background: picked === t.id ? `${BLUE}0E` : C.surface, cursor: 'pointer', fontFamily: C.font }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: C.bg, overflow: 'hidden', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {t.avatar_url ? <img src={t.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Ico ti="ti-user-cog" size={16} color={C.muted2} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{teacherName(t)}</div>
                    <div style={{ fontSize: 11, color: C.muted2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.email}</div>
                  </div>
                  {picked === t.id && <Ico ti="ti-check" size={16} color={BLUE} />}
                </button>
              ))}
            </div>
            <button onClick={assign} disabled={busy || !picked} style={{ width: '100%', marginTop: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, border: 'none', background: (busy || !picked) ? C.borderSoft : `linear-gradient(135deg, ${C.brand}, ${C.brandDeep})`, color: (busy || !picked) ? C.muted2 : '#fff', fontSize: 13.5, fontWeight: 800, cursor: (busy || !picked) ? 'default' : 'pointer', fontFamily: C.font }}>
              {busy ? <Ico ti="ti-loader-2" size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Ico ti="ti-check" size={14} />} Assign to {activeClass?.name}{sectionId ? ` ${sections.find((s) => s.id === sectionId)?.name || ''}` : ''}
            </button>
          </div>

          {/* Current assignments */}
          <div style={{ ...card, flex: '1 1 300px', minWidth: 280 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, fontFamily: C.font, marginBottom: 12 }}>Assigned Teachers — {activeClass?.name}</div>
            {assignments === null ? <Ico ti="ti-loader-2" size={16} style={{ animation: 'spin .8s linear infinite' }} /> : assignments.length === 0 ? (
              <p style={{ fontSize: 12.5, color: C.muted2, fontFamily: C.font }}>No teacher assigned to this class yet.</p>
            ) : assignments.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: `1px solid ${C.border}` }}>
                <Ico ti="ti-user-cog" size={15} color={GREEN} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: C.font }}>{teacherName(teacherById[a.teacher_id])}</div>
                  <div style={{ fontSize: 11, color: C.muted2, fontFamily: C.font }}>{a.section_name ? `Section ${a.section_name}` : 'Whole class'}</div>
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
