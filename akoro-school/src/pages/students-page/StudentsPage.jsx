/**
 * StudentsPage — composes the components from ./parts.jsx.
 */
import { useState, useEffect, useRef } from 'react';
import { Ico } from '../../theme/Ico.jsx';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Modal, Inp, StatusPill, Toast } from '../../components/Primitives.jsx';
import { useStudentsAPI } from '../../hooks/useStudentsAPI.js';
import { useCoursesAPI }  from '../../hooks/useCoursesAPI.js';
import { GREEN, PURPLE, BLUE, RED } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';

/* ── Enrol Modal — tabs: Manual | Invite Link | Bulk CSV ─────────────── */
import { EnrolModal, StudentSheet, StudentRow } from './parts.jsx';

export default function StudentsPage() {
  const { getStudents, removeStudent } = useStudentsAPI();
  const { getCourses } = useCoursesAPI();
  const [searchParams] = useSearchParams();

  const [students, setStudents] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [courses,  setCourses]  = useState([]);
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(searchParams.get('add') === '1');
  const [selected, setSelected] = useState(null);
  const [toast,    setToast]    = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    try {
      const [studRes, courseRes] = await Promise.allSettled([getStudents(), getCourses()]);
      const data = studRes.status === 'fulfilled' ? (studRes.value?.data || []) : [];
      setStudents(data);
      setFiltered(data);
      if (courseRes.status === 'fulfilled') setCourses(courseRes.value?.data || []);
    } catch {
      setStudents([]); setFiltered([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!search.trim()) { setFiltered(students); return; }
    const q = search.toLowerCase();
    setFiltered(students.filter(s =>
      (s.fullName || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q)
    ));
  }, [search, students]);

  const handleDone = () => {
    showToast('Students updated!');
    window.dispatchEvent(new Event('akoro:notifications-changed'));
    load();
  };

  const handleRemove = async (enrollmentId) => {
    await removeStudent(enrollmentId).catch(console.warn);
    setStudents(s => s.filter(x => x.enrollmentId !== enrollmentId));
    window.dispatchEvent(new Event('akoro:notifications-changed'));
    showToast('Student removed.', 'info');
  };

  return (
    <PageLayout
      title="Students"
      subtitle={`${loading ? '…' : students.length} learner${students.length === 1 ? '' : 's'}`}
      action={
        <Btn size="sm" onClick={() => setModal(true)}>
          <Ico ti="ti-plus" size={14} /> Add Student
        </Btn>
      }
    >
      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 20, maxWidth: 420 }}>
        <Ico ti="ti-search" size={16} color={C.muted} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          style={{
            width: '100%', padding: '10px 14px 10px 40px', borderRadius: 12,
            border: `1.5px solid ${C.border}`, outline: 'none', fontSize: 14,
            fontFamily: C.font, color: C.ink, background: C.surface,
          }}
        />
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3,4].map(i => (
            <div key={i} style={{ height: 66, borderRadius: 12, background: C.border, opacity: .4, animation: 'shimmer 1.4s infinite linear', backgroundSize: '200% 100%', backgroundImage: `linear-gradient(90deg, ${C.border} 0%, ${C.surface} 50%, ${C.border} 100%)` }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <Ico ti="ti-user" size={32} color={C.muted} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: C.muted, fontFamily: C.font, margin: '0 0 16px' }}>
            {search ? 'No students match your search' : 'No students enrolled yet'}
          </p>
          {!search && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Btn onClick={() => setModal(true)}><Ico ti="ti-user-plus" size={14} /> Manual Entry</Btn>
              <Btn variant="secondary" onClick={() => setModal(true)}><Ico ti="ti-mail" size={14} /> Send Invite</Btn>
              <Btn variant="secondary" onClick={() => setModal(true)}><Ico ti="ti-upload" size={14} /> Import CSV</Btn>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(s => (
            <StudentRow key={s.id || s.enrollmentId} student={s} onClick={setSelected} />
          ))}
        </div>
      )}

      <EnrolModal
        open={modal}
        onClose={() => setModal(false)}
        onDone={handleDone}
        courses={courses}
      />
      <StudentSheet
        student={selected}
        courses={courses}
        onClose={() => setSelected(null)}
        onRemove={handleRemove}
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

