import { useState, useEffect, useCallback } from 'react';

import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Sel, Toast } from '../components/Primitives.jsx';
import { apiGet, apiPost } from '../services/api.js';
import { GREEN } from '../constants.js';
import { C, tint } from '../theme/colors.js';
import { Ico } from '../theme/Ico.jsx';

/* ── Create class modal ──────────────────────────────────────────── */
function CreateModal({ open, onClose, onDone, instructors }) {
  const [form, setForm] = useState({ name: '', description: '', teacher_id: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setForm({ name: '', description: '', teacher_id: '' }); setError(''); } }, [open]);
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Class name is required'); return; }
    setLoading(true); setError('');
    try {
      const res = await apiPost('/api/school/classrooms', { name: form.name.trim(), description: form.description.trim(), teacher_id: form.teacher_id || undefined });
      onDone?.(res.data); onClose();
    } catch (err) { setError(err.message || 'Could not create class'); }
    finally { setLoading(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Create a class">
      <form onSubmit={submit}>
        <Inp label="Class name" placeholder="e.g. SS2 Further Maths" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Inp label="Description (optional)" placeholder="What is this class about?" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <Sel label="Assign a teacher (optional)" value={form.teacher_id} onChange={(e) => setForm((f) => ({ ...f, teacher_id: e.target.value }))}>
          <option value="">— No teacher yet —</option>
          {instructors.map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}</option>)}
        </Sel>
        {error && <p style={{ fontSize: 12.5, color: '#DC2626', fontWeight: 600, margin: '6px 0 0' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Btn variant="secondary" style={{ flex: 1 }} type="button" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" style={{ flex: 1 }} type="submit" disabled={loading}><Ico ti="ti-plus" size={14} />{loading ? 'Creating…' : 'Create class'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ── Manage class modal (assign teacher + add student) ───────────── */
function ManageModal({ room, onClose, onChanged, instructors, students }) {
  const [teacher, setTeacher] = useState(room?.teacher_id || '');
  const [stu, setStu] = useState({ email: '', full_name: '', user_id: '' });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const assignTeacher = async () => {
    if (!teacher) return;
    setBusy('teacher'); setErr(''); setMsg('');
    try { await apiPost(`/api/school/classrooms/${room.id}/teacher`, { teacher_id: teacher }); setMsg('Teacher assigned ✓'); onChanged?.(); }
    catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const addStudent = async () => {
    if (!stu.user_id && !stu.email.trim()) { setErr('Pick a student or enter an email'); return; }
    setBusy('student'); setErr(''); setMsg('');
    try {
      await apiPost(`/api/school/classrooms/${room.id}/students`, stu.user_id ? { user_id: stu.user_id } : { email: stu.email.trim(), full_name: stu.full_name.trim() });
      setMsg('Student added ✓'); setStu({ email: '', full_name: '', user_id: '' }); onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };

  return (
    <Modal open={!!room} onClose={onClose} title={`Manage · ${room?.name || ''}`}>
      <div style={{ fontSize: 11, fontWeight: 900, color: C.brand, letterSpacing: 1, textTransform: 'uppercase', margin: '0 0 8px' }}>Teacher</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Sel value={teacher} onChange={(e) => setTeacher(e.target.value)} style={{ flex: 1 }}>
          <option value="">— Select teacher —</option>
          {instructors.map((t) => <option key={t.id} value={t.id}>{t.full_name || t.email}</option>)}
        </Sel>
        <Btn variant="secondary" onClick={assignTeacher} disabled={busy === 'teacher' || !teacher}>Assign</Btn>
      </div>

      <div style={{ fontSize: 11, fontWeight: 900, color: C.brand, letterSpacing: 1, textTransform: 'uppercase', margin: '18px 0 8px' }}>Add student</div>
      <Sel label="Existing student" value={stu.user_id} onChange={(e) => setStu((s) => ({ ...s, user_id: e.target.value }))}>
        <option value="">— New student by email —</option>
        {students.map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
      </Sel>
      {!stu.user_id && (
        <>
          <Inp label="Student email" type="email" placeholder="student@school.edu" value={stu.email} onChange={(e) => setStu((s) => ({ ...s, email: e.target.value }))} />
          <Inp label="Full name (optional)" placeholder="e.g. Chidi Okeke" value={stu.full_name} onChange={(e) => setStu((s) => ({ ...s, full_name: e.target.value }))} />
        </>
      )}
      <Btn variant="primary" style={{ width: '100%', marginTop: 4 }} onClick={addStudent} disabled={busy === 'student'}><Ico ti="ti-user-plus" size={14} />Add to class</Btn>

      {msg && <p style={{ fontSize: 12.5, color: GREEN, fontWeight: 700, margin: '12px 0 0' }}>{msg}</p>}
      {err && <p style={{ fontSize: 12.5, color: '#DC2626', fontWeight: 600, margin: '12px 0 0' }}>{err}</p>}
    </Modal>
  );
}

/* ── Page ────────────────────────────────────────────────────────── */
export default function ClassroomsPage() {
  const [rooms, setRooms] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [manage, setManage] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet('/api/school/classrooms').then((r) => r?.data || []).catch(() => []),
      apiGet('/api/school/instructors').then((r) => r?.data || []).catch(() => []),
      apiGet('/api/school/students').then((r) => r?.data || []).catch(() => []),
    ]).then(([rms, ins, stu]) => { setRooms(rms); setInstructors(ins); setStudents(stu); }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <PageLayout title="Classes" subtitle="Create classes and manage their students & teachers"
      action={<Btn variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Ico ti="ti-plus" size={14} />Create class</Btn>}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map((i) => <div key={i} style={{ height: 76, borderRadius: 16, background: C.tagBg, animation: 'pulse-dot 1.5s ease-in-out infinite' }} />)}
          </div>
        ) : rooms.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '56px 24px', color: C.muted2 }}>
            <Ico ti="ti-stack-2" size={40} color="#D1D5DB" style={{ marginBottom: 14 }} />
            <p style={{ fontSize: 15, fontWeight: 700, color: C.muted, margin: '0 0 4px' }}>No classes yet</p>
            <p style={{ fontSize: 13, margin: '0 0 16px' }}>Create your first class, then add students and assign a teacher.</p>
            <Btn variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Ico ti="ti-plus" size={14} />Create a class</Btn>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rooms.map((c) => (
              <div key={c.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, fontFamily: C.font }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: tint(9), color: C.brand, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico ti="ti-stack-2" size={20} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: C.ink }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: C.muted2, display: 'flex', gap: 12, marginTop: 3 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Ico ti="ti-users" size={11} />{c.student_count} students</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Ico ti="ti-school" size={11} />{c.teacher_name || 'No teacher'}</span>
                  </div>
                </div>
                <Btn variant="secondary" size="sm" onClick={() => setManage(c)}>Manage</Btn>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} instructors={instructors}
        onDone={() => { setToast({ message: 'Class created ✓', type: 'success' }); load(); }} />
      {manage && <ManageModal room={manage} instructors={instructors} students={students}
        onClose={() => setManage(null)} onChanged={() => load()} />}
    </PageLayout>
  );
}
