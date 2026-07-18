/**
 * StudentsPage — composes the components from ./parts.jsx.
 */
import { useState, useEffect, useRef } from 'react';
import {
  Search, Plus, X, User, Mail, Calendar, BookOpen, TrendingUp,
  Trash2, ChevronRight, Copy, Check, Upload, Link2, UserPlus, Eye,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, Modal, Inp, StatusPill, Toast } from '../../components/Primitives.jsx';
import { useStudentsAPI } from '../../hooks/useStudentsAPI.js';
import { useCoursesAPI }  from '../../hooks/useCoursesAPI.js';
import {
  AMBER, INK, MUTED, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, RED, FONT,
} from '../../constants.js';

/* ── Enrol Modal — tabs: Manual | Invite Link | Bulk CSV ─────────────── */
import { EnrolModal, StudentSheet } from './parts.jsx';
import JoinRequests from './JoinRequests.jsx';

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

  // School-dashboard table styling.
  const th = { textAlign: 'left', padding: '10px 14px', fontSize: 10.5, fontWeight: 800, color: MUTED, letterSpacing: .4, whiteSpace: 'nowrap' };
  const td = { padding: '11px 14px', fontSize: 13, color: INK, borderTop: `1px solid ${BORDER}`, whiteSpace: 'nowrap' };
  const iconBtn = (color) => ({ width: 30, height: 30, borderRadius: 7, border: 'none', background: `${color}15`, color, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });

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
      subtitle={`${loading ? '…' : students.length} enrolled learners`}
      action={
        <Btn size="sm" onClick={() => setModal(true)}>
          <Plus size={14} /> Add Student
        </Btn>
      }
    >
      {/* Pending learner join requests */}
      <JoinRequests onChanged={load} />

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
          {[1,2,3,4].map(i => (
            <div key={i} style={{ height: 66, borderRadius: 12, background: BORDER, opacity: .4, animation: 'shimmer 1.4s infinite linear', backgroundSize: '200% 100%', backgroundImage: `linear-gradient(90deg, ${BORDER} 0%, ${WHITE} 50%, ${BORDER} 100%)` }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ background: WHITE, border: `1px dashed ${BORDER}`, borderRadius: 16, padding: '48px', textAlign: 'center' }}>
          <User size={32} color={MUTED} style={{ marginBottom: 12 }} />
          <p style={{ fontSize: 14, color: MUTED, fontFamily: FONT, margin: '0 0 16px' }}>
            {search ? 'No students match your search' : 'No students enrolled yet'}
          </p>
          {!search && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Btn onClick={() => setModal(true)}><UserPlus size={14} /> Manual Entry</Btn>
              <Btn variant="secondary" onClick={() => setModal(true)}><Mail size={14} /> Send Invite</Btn>
              <Btn variant="secondary" onClick={() => setModal(true)}><Upload size={14} /> Import CSV</Btn>
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT }}>
            <thead><tr>
              <th style={th}>STUDENT</th>
              <th style={th}>EMAIL</th>
              <th style={th}>PROGRESS</th>
              <th style={th}>STATUS</th>
              <th style={{ ...th, textAlign: 'right' }}>ACTIONS</th>
            </tr></thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id || s.enrollmentId}>
                  <td style={{ ...td, whiteSpace: 'normal' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: `linear-gradient(135deg, ${AMBER}88, ${PURPLE}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: WHITE }}>
                        {(s.fullName || s.email || '?')[0].toUpperCase()}
                      </div>
                      <button onClick={() => setSelected(s)} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontWeight: 700, color: BLUE, textAlign: 'left', fontSize: 13 }}>
                        {s.fullName || 'Unknown'}
                      </button>
                    </div>
                  </td>
                  <td style={{ ...td, color: MUTED }}>{s.email || '—'}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 99, background: LIGHT, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${s.progress || 0}%`, background: AMBER, borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{s.progress || 0}%</span>
                    </div>
                  </td>
                  <td style={td}><StatusPill status={s.status} /></td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button onClick={() => setSelected(s)} title="View profile" style={iconBtn(GREEN)}><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

