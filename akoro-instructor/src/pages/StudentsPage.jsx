import { useState, useEffect } from 'react';
import { Search, Plus, X, User, Mail, Calendar, BookOpen, TrendingUp, Trash2, ChevronRight, Filter } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Sel, StatusPill, Toast, Skeleton } from '../components/Primitives.jsx';
import { useStudentsAPI } from '../hooks/useStudentsAPI.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, FONT } from '../constants.js';

/* ── Mock data ─────────────────────────────────────────────────────── */
const MOCK_STUDENTS = [
  { id: 1, enrollmentId: 'enr_1', fullName: 'Alice Johnson', email: 'alice@example.com', coursesEnrolled: 2, joinedAt: '2024-01-15', progress: 75, status: 'active', avatar: null },
  { id: 2, enrollmentId: 'enr_2', fullName: 'Bob Smith',    email: 'bob@example.com',   coursesEnrolled: 1, joinedAt: '2024-02-20', progress: 42, status: 'active', avatar: null },
  { id: 3, enrollmentId: 'enr_3', fullName: 'Carol White',  email: 'carol@example.com', coursesEnrolled: 3, joinedAt: '2023-11-05', progress: 91, status: 'active', avatar: null },
  { id: 4, enrollmentId: 'enr_4', fullName: 'Dan Brown',    email: 'dan@example.com',   coursesEnrolled: 1, joinedAt: '2024-03-01', progress: 15, status: 'paused', avatar: null },
  { id: 5, enrollmentId: 'enr_5', fullName: 'Eva Green',    email: 'eva@example.com',   coursesEnrolled: 2, joinedAt: '2024-01-28', progress: 60, status: 'active', avatar: null },
];

/* ── Add Student Modal ──────────────────────────────────────────────── */
function AddStudentModal({ open, onClose, onSubmit }) {
  const [form, setForm] = useState({ email: '', fullName: '', courseId: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.email) { setError('Email is required'); return; }
    setLoading(true); setError('');
    try { await onSubmit(form); onClose(); setForm({ email: '', fullName: '', courseId: '' }); }
    catch (err) { setError(err.message || 'Failed to add student'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Student">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#EF4444' }}>
            {error}
          </div>
        )}
        <Inp label="Student Email *" type="email" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="student@example.com" />
        <Inp label="Full Name (optional)" value={form.fullName} onChange={e => setField('fullName', e.target.value)} placeholder="Jane Doe" />
        <Inp label="Course ID (optional)" value={form.courseId} onChange={e => setField('courseId', e.target.value)} placeholder="Enroll in a specific course" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn variant="secondary" type="button" onClick={onClose}>Cancel</Btn>
          <Btn type="submit" disabled={loading}>{loading ? 'Adding…' : 'Add Student'}</Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ── Student detail sheet ───────────────────────────────────────────── */
function StudentSheet({ student, onClose, onRemove }) {
  if (!student) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,26,46,.3)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 360, height: '100vh', background: WHITE, boxShadow: '-8px 0 40px rgba(0,0,0,.12)',
          padding: '24px', overflowY: 'auto', animation: 'sheet-up .25s ease both',
          display: 'flex', flexDirection: 'column', gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: INK, margin: 0, fontFamily: FONT }}>Student Profile</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED }}>
            <X size={18} />
          </button>
        </div>

        {/* Avatar + name */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '20px', background: LIGHT, borderRadius: 16 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: `linear-gradient(135deg, ${AMBER}, ${PURPLE})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, color: WHITE, fontWeight: 700,
          }}>
            {(student.fullName || student.email || '?')[0].toUpperCase()}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK, fontFamily: FONT }}>{student.fullName || 'Unknown'}</div>
            <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>{student.email}</div>
          </div>
          <StatusPill status={student.status} />
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { label: 'Courses', value: student.coursesEnrolled || 0, icon: BookOpen, color: BLUE },
            { label: 'Progress', value: `${student.progress || 0}%`, icon: TrendingUp, color: GREEN },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} style={{ background: LIGHT, borderRadius: 12, padding: '14px', textAlign: 'center' }}>
              <Icon size={18} color={color} style={{ marginBottom: 6 }} />
              <div style={{ fontSize: 20, fontWeight: 800, color: INK, fontFamily: FONT }}>{value}</div>
              <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Mail size={14} color={MUTED} />
            <span style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>{student.email}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Calendar size={14} color={MUTED} />
            <span style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>
              Joined {student.joinedAt ? new Date(student.joinedAt).toLocaleDateString() : 'Unknown'}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: INK, fontFamily: FONT }}>Overall Progress</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: AMBER }}>{student.progress || 0}%</span>
          </div>
          <div style={{ height: 8, background: BORDER, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${student.progress || 0}%`, background: `linear-gradient(90deg, ${AMBER}, ${GREEN})`, borderRadius: 4 }} />
          </div>
        </div>

        {/* Actions */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Btn variant="danger" onClick={() => { onRemove(student.enrollmentId); onClose(); }}>
            <Trash2 size={14} /> Remove from courses
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ── Student row ────────────────────────────────────────────────────── */
function StudentRow({ student, onClick }) {
  return (
    <div
      onClick={() => onClick(student)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 16px', background: WHITE, borderRadius: 12,
        border: `1px solid ${BORDER}`, cursor: 'pointer', transition: 'all .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = AMBER; e.currentTarget.style.boxShadow = `0 2px 12px ${AMBER}18`; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, ${AMBER}88, ${PURPLE}88)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, color: WHITE,
      }}>
        {(student.fullName || student.email || '?')[0].toUpperCase()}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT }}>{student.fullName || 'Unknown'}</div>
        <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>{student.email}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK, fontFamily: FONT }}>{student.progress || 0}%</div>
          <div style={{ fontSize: 10, color: MUTED, fontFamily: FONT }}>progress</div>
        </div>
        <StatusPill status={student.status} />
        <ChevronRight size={14} color={MUTED} />
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────── */
export default function StudentsPage() {
  const { getStudents, addStudent, removeStudent } = useStudentsAPI();
  const [searchParams] = useSearchParams();

  const [students,   setStudents]   = useState([]);
  const [filtered,   setFiltered]   = useState([]);
  const [search,     setSearch]     = useState('');
  const [loading,    setLoading]    = useState(true);
  const [addModal,   setAddModal]   = useState(searchParams.get('add') === '1');
  const [selected,   setSelected]   = useState(null);
  const [toast,      setToast]      = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    try {
      const res = await getStudents();
      const data = res?.data || MOCK_STUDENTS;
      setStudents(data);
      setFiltered(data);
    } catch (err) {
      console.warn('Students API error, using mock:', err);
      setStudents(MOCK_STUDENTS);
      setFiltered(MOCK_STUDENTS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Client-side search
  useEffect(() => {
    if (!search.trim()) { setFiltered(students); return; }
    const q = search.toLowerCase();
    setFiltered(students.filter(s =>
      (s.fullName || '').toLowerCase().includes(q) ||
      (s.email || '').toLowerCase().includes(q)
    ));
  }, [search, students]);

  const handleAdd = async (form) => {
    await addStudent(form).catch(console.warn);
    showToast('Student added successfully!');
    load();
  };

  const handleRemove = async (enrollmentId) => {
    await removeStudent(enrollmentId).catch(console.warn);
    setStudents(s => s.filter(x => x.enrollmentId !== enrollmentId));
    showToast('Student removed.', 'info');
  };

  return (
    <PageLayout
      title="Students"
      subtitle={`${loading ? '…' : students.length} enrolled learners`}
      action={
        <Btn size="sm" onClick={() => setAddModal(true)}>
          <Plus size={14} /> Add Student
        </Btn>
      }
    >
      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 20, maxWidth: 420 }}>
        <Search size={16} color={MUTED} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          style={{
            width: '100%', padding: '10px 14px 10px 40px', borderRadius: 12,
            border: `1.5px solid ${BORDER}`, outline: 'none', fontSize: 14,
            fontFamily: FONT, color: INK, background: WHITE,
          }}
        />
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 66, borderRadius: 12 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: WHITE, border: `1px dashed ${BORDER}`, borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <User size={32} color={MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 16px' }}>
            {search ? 'No students match your search' : 'No students enrolled yet'}
          </p>
          {!search && <Btn onClick={() => setAddModal(true)}><Plus size={14} /> Add your first student</Btn>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(s => (
            <StudentRow key={s.id || s.enrollmentId} student={s} onClick={setSelected} />
          ))}
        </div>
      )}

      <AddStudentModal open={addModal} onClose={() => setAddModal(false)} onSubmit={handleAdd} />
      <StudentSheet student={selected} onClose={() => setSelected(null)} onRemove={handleRemove} />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
