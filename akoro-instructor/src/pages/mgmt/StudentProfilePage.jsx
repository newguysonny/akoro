/**
 * StudentProfilePage — full-page student profile (school-dashboard layout).
 * Mounted at /mgmt/students/:id. The student object is passed via router
 * state from the list; on a direct load it's recovered from the list fetch.
 */
import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, TrendingUp, Calendar, Mail, Trash2, User, Loader2, GraduationCap } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import { Btn, StatusPill, Toast } from '../../components/Primitives.jsx';
import { useStudentsAPI } from '../../hooks/useStudentsAPI.js';
import { useCoursesAPI }  from '../../hooks/useCoursesAPI.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, BLUE, PURPLE, RED, FONT } from '../../constants.js';

const TABS = [
  { key: 'overview',   label: 'Overview',   icon: User },
  { key: 'enrollment', label: 'Enrollment', icon: GraduationCap },
];

export default function StudentProfilePage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { getStudents, addStudent, removeStudent } = useStudentsAPI();
  const { getCourses } = useCoursesAPI();

  const [student, setStudent] = useState(location.state?.student || null);
  const [loading, setLoading] = useState(!location.state?.student);
  const [courses, setCourses] = useState([]);
  const [sel, setSel]         = useState([]);
  const [tab, setTab]         = useState('overview');
  const [busy, setBusy]       = useState(false);
  const [toast, setToast]     = useState(null);
  const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    if (!student) {
      getStudents()
        .then((r) => setStudent((r?.data || []).find((s) => (s.id || s.enrollmentId) === id) || null))
        .catch(() => {})
        .finally(() => setLoading(false));
    }
    getCourses().then((r) => setCourses(r?.data || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const toggleCourse = (cid) => setSel((s) => (s.includes(cid) ? s.filter((x) => x !== cid) : [...s, cid]));

  const enrol = async () => {
    if (!sel.length || !student) return;
    setBusy(true);
    try {
      for (const cid of sel) await addStudent({ email: student.email, courseId: cid });
      showToast(`Enrolled in ${sel.length} course${sel.length === 1 ? '' : 's'}`);
      setSel([]);
    } catch (e) { showToast(e.message || 'Could not enrol', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!student || !window.confirm('Remove this student from your courses? This cannot be undone.')) return;
    try { await removeStudent(student.enrollmentId); showToast('Student removed', 'info'); setTimeout(() => navigate('/mgmt/students'), 700); }
    catch (e) { showToast(e.message || 'Could not remove', 'error'); }
  };

  if (loading) return <PageLayout title="Student Profile" subtitle=""><div style={{ padding: '60px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={22} style={{ animation: 'spin .8s linear infinite' }} /></div></PageLayout>;
  if (!student) return (
    <PageLayout title="Student Profile" subtitle="">
      <div style={{ padding: 40, textAlign: 'center', color: MUTED2, fontFamily: FONT }}>
        Student not found.{' '}
        <button onClick={() => navigate('/mgmt/students')} style={{ background: 'none', border: 'none', color: AMBER, fontWeight: 700, cursor: 'pointer' }}>Back to Students</button>
      </div>
    </PageLayout>
  );

  const statCard = (label, value, color) => (
    <div style={{ flex: '1 1 140px', background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: FONT }}>{value}</div>
      <div style={{ fontSize: 11, color: MUTED2, fontFamily: FONT, marginTop: 2 }}>{label}</div>
    </div>
  );
  const infoRow = (Icon, label, value) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 0', fontSize: 12.5, fontFamily: FONT }}>
      <Icon size={14} color={MUTED2} style={{ flexShrink: 0 }} />
      <span style={{ color: MUTED2, minWidth: 66 }}>{label}</span>
      <span style={{ color: INK, fontWeight: 600, marginLeft: 'auto', textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
  const initial = (student.fullName || student.email || '?')[0].toUpperCase();
  const joined = student.joinedAt ? new Date(student.joinedAt).toLocaleDateString() : '—';

  return (
    <PageLayout title={student.fullName || 'Student'} subtitle={student.email}>
      <div style={{ marginBottom: 16 }}>
        <button onClick={() => navigate('/mgmt/students')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, border: `1.5px solid ${BORDER}`, background: WHITE, color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
          <ArrowLeft size={14} /> Back to Students
        </button>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        {statCard('Courses Enrolled', student.coursesEnrolled || 0, BLUE)}
        {statCard('Progress', `${student.progress || 0}%`, GREEN)}
        {statCard('Joined', joined, INK)}
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: avatar + quick facts */}
        <div style={{ flex: '1 1 240px', maxWidth: 280 }}>
          <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '22px 18px', textAlign: 'center' }}>
            <div style={{ width: 84, height: 84, borderRadius: '50%', margin: '0 auto 12px', background: `linear-gradient(135deg, ${AMBER}88, ${PURPLE}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800, color: WHITE }}>{initial}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: INK, fontFamily: FONT }}>{student.fullName || 'Unknown'}</div>
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}><StatusPill status={student.status} /></div>
            <div style={{ marginTop: 14, textAlign: 'left', borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
              {infoRow(Mail, 'Email', student.email || '—')}
              {infoRow(BookOpen, 'Courses', student.coursesEnrolled || 0)}
              {infoRow(Calendar, 'Joined', joined)}
            </div>
          </div>
        </div>

        {/* Right: tabs + content */}
        <div style={{ flex: '2 1 420px', minWidth: 320 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: `1px solid ${BORDER}`, marginBottom: 16 }}>
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 13px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 700, color: tab === t.key ? AMBER : MUTED2, borderBottom: `2px solid ${tab === t.key ? AMBER : 'transparent'}`, marginBottom: -1 }}>
                <t.icon size={13} /> {t.label}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: MUTED2, letterSpacing: .4, marginBottom: 10 }}>COURSE PROGRESS</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                <div style={{ flex: 1, height: 8, borderRadius: 99, background: LIGHT, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${student.progress || 0}%`, background: `linear-gradient(90deg, ${AMBER}, ${GREEN})`, borderRadius: 99 }} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>{student.progress || 0}%</span>
              </div>
              {infoRow(Mail, 'Email', student.email || '—')}
              {infoRow(BookOpen, 'Courses enrolled', student.coursesEnrolled || 0)}
              {infoRow(TrendingUp, 'Status', <StatusPill status={student.status} />)}
              {infoRow(Calendar, 'Joined', joined)}
            </div>
          )}

          {tab === 'enrollment' && (
            <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {courses.length > 0 ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: INK, fontFamily: FONT }}>Enrol in course(s)</div>
                    <button onClick={() => setSel(sel.length === courses.length ? [] : courses.map((c) => c.id))} style={{ fontSize: 11, color: AMBER, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, fontWeight: 700 }}>
                      {sel.length === courses.length ? 'Deselect all' : 'All courses'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
                    {courses.map((c) => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, color: INK, fontFamily: FONT }}>
                        <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggleCourse(c.id)} style={{ accentColor: AMBER, width: 14, height: 14 }} />
                        {c.title}
                      </label>
                    ))}
                  </div>
                  <Btn size="sm" disabled={!sel.length || busy} onClick={enrol} style={{ width: '100%' }}>
                    {busy ? '…' : `Enrol in ${sel.length || ''} course${sel.length === 1 ? '' : 's'}`}
                  </Btn>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: MUTED, fontFamily: FONT }}>No courses available to enrol.</div>
              )}
              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 14 }}>
                <Btn variant="danger" onClick={remove} style={{ width: '100%' }}><Trash2 size={14} /> Remove from courses</Btn>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
