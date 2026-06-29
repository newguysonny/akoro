import { useState, useEffect } from 'react';
import { Plus, Video, BookOpen, Users, Clock, Calendar, Trash2, Edit2, ChevronRight, Share2, Check } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Sel, StatusPill, PlatBadge, CoursTypeBadge, Toast } from '../components/Primitives.jsx';
import { useCoursesAPI } from '../hooks/useCoursesAPI.js';
import LiveClassWizard from '../components/LiveClassWizard.jsx';
import OnDemandWizard from '../components/OnDemandWizard.jsx';
import CourseCurriculum from '../components/CourseCurriculum.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, FONT } from '../constants.js';

/* ── Mock data ─────────────────────────────────────────────────────── */
const MOCK_COURSES = [
  { id: 1, title: 'React Mastery', type: 'live', description: 'Deep dive into modern React', studentsEnrolled: 14, status: 'active', thumbnail: null },
  { id: 2, title: 'Node.js Fundamentals', type: 'on-demand', description: 'Backend dev with Node', studentsEnrolled: 22, status: 'active', thumbnail: null },
  { id: 3, title: 'TypeScript Workshop', type: 'live', description: 'Type-safe JavaScript at scale', studentsEnrolled: 8, status: 'draft', thumbnail: null },
];

const MOCK_SESSIONS = [
  { id: 1, courseId: 1, title: 'State & Effects Deep Dive', startTime: new Date(Date.now() + 7200000).toISOString(), platform: 'zoom', status: 'scheduled', enrolledCount: 14 },
  { id: 2, courseId: 1, title: 'Context & Reducers', startTime: new Date(Date.now() + 86400000).toISOString(), platform: 'meet', status: 'scheduled', enrolledCount: 14 },
  { id: 3, courseId: 2, title: 'Express Routing', startTime: new Date(Date.now() - 3600000).toISOString(), platform: 'zoom', status: 'completed', enrolledCount: 22 },
];


/* ── Schedule Session Modal ─────────────────────────────────────────── */
function ScheduleSessionModal({ open, onClose, onSubmit, courses }) {
  const [form, setForm] = useState({ courseId: '', title: '', date: '', time: '', platform: 'zoom', duration: '60', meetingLink: '' });
  const [loading, setLoading] = useState(false);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.courseId || !form.title || !form.date || !form.time) return;
    setLoading(true);
    try {
      const startTime = new Date(`${form.date}T${form.time}`).toISOString();
      await onSubmit({ ...form, startTime });
      onClose();
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Schedule Session" width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Sel label="Course" value={form.courseId} onChange={e => setField('courseId', e.target.value)}>
          <option value="">Select a course…</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </Sel>
        <Inp label="Session Title" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="e.g. Live Q&A Session" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Inp type="date" label="Date" value={form.date} onChange={e => setField('date', e.target.value)} />
          <Inp type="time" label="Time" value={form.time} onChange={e => setField('time', e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Sel label="Platform" value={form.platform} onChange={e => setField('platform', e.target.value)}>
            <option value="zoom">Zoom</option>
            <option value="meet">Google Meet</option>
            <option value="teams">Teams</option>
            <option value="youtube">YouTube Live</option>
            <option value="akoro">Akoro Live</option>
          </Sel>
          <Inp label="Duration (min)" type="number" value={form.duration} onChange={e => setField('duration', e.target.value)} />
        </div>
        <Inp label="Meeting Link (optional)" value={form.meetingLink} onChange={e => setField('meetingLink', e.target.value)} placeholder="https://zoom.us/j/…" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSubmit} disabled={loading || !form.courseId || !form.title || !form.date || !form.time}>
            {loading ? 'Scheduling…' : 'Schedule Session'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ── Edit Course Modal ──────────────────────────────────────────────── */
function EditCourseModal({ open, course, onClose, onSave }) {
  const [form, setForm] = useState({ title: '', description: '', level: 'all', status: 'active' });
  const [loading, setLoading] = useState(false);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (course) setForm({
      title:       course.title || '',
      description: course.description || '',
      level:       course.level || 'all',
      status:      course.status || 'active',
    });
  }, [course]);

  const handleSave = async () => {
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSave(course.id, form); onClose(); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Edit Course" width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Inp label="Course Title" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="Course title" />
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: INK, marginBottom: 6, fontFamily: FONT }}>Description</label>
          <textarea
            value={form.description}
            onChange={e => setField('description', e.target.value)}
            rows={3}
            placeholder="What is this course about?"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10,
              border: `1.5px solid ${BORDER}`, fontFamily: FONT, fontSize: 13,
              color: INK, background: WHITE, outline: 'none', resize: 'vertical',
            }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Sel label="Level" value={form.level} onChange={e => setField('level', e.target.value)}>
            <option value="all">All levels</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </Sel>
          <Sel label="Status" value={form.status} onChange={e => setField('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
          </Sel>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSave} disabled={loading || !form.title.trim()}>
            {loading ? 'Saving…' : 'Save Changes'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ── Course Card ────────────────────────────────────────────────────── */
const LEARNER_URL = import.meta.env.VITE_LEARNER_URL || 'https://akoro.app';

function CourseCard({ course, onManage, onEdit, onDelete }) {
  const [copied, setCopied] = useState(false);
  const shareLink = async (e) => {
    e.stopPropagation();
    const url = `${LEARNER_URL}/course/${course.id}`;
    try {
      if (navigator.share) { await navigator.share({ title: course.title, url }); return; }
      await navigator.clipboard.writeText(url);
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* user cancelled / no clipboard */ }
  };
  return (
    <div style={{
      background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16,
      overflow: 'hidden', transition: 'box-shadow .15s', position: 'relative',
    }}
    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,.08)'}
    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      {/* Thumbnail */}
      <div style={{
        height: 100, background: course.thumbnail ? `url(${course.thumbnail})` : `linear-gradient(135deg, ${AMBER}22, ${PURPLE}22)`,
        backgroundSize: 'cover', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
      }}>
        {!course.thumbnail && (
          course.type === 'live' ? <Video size={32} color={AMBER} /> : <BookOpen size={32} color={PURPLE} />
        )}
        {/* Edit/Delete actions */}
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
          <button
            onClick={shareLink}
            title="Copy course link"
            style={{ background: copied ? GREEN : 'rgba(255,255,255,.92)', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: copied ? '#fff' : INK, display: 'flex', boxShadow: '0 1px 4px rgba(0,0,0,.1)' }}
          >
            {copied ? <Check size={13} /> : <Share2 size={13} />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit?.(course); }}
            title="Edit course"
            style={{ background: 'rgba(255,255,255,.92)', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: INK, display: 'flex', boxShadow: '0 1px 4px rgba(0,0,0,.1)' }}
          >
            <Edit2 size={13} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(course); }}
            title="Delete course"
            style={{ background: 'rgba(255,255,255,.92)', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: '#DC2626', display: 'flex', boxShadow: '0 1px 4px rgba(0,0,0,.1)' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div style={{ padding: '14px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <CoursTypeBadge type={course.type} />
          <StatusPill status={course.status} />
        </div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: INK, margin: '8px 0 4px', fontFamily: FONT }}>{course.title}</h3>
        <p style={{ fontSize: 12, color: MUTED, margin: '0 0 12px', fontFamily: FONT, lineHeight: 1.4 }}>
          {course.description}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Users size={12} /> {course.studentsEnrolled || 0} students
          </span>
          <button onClick={() => onManage?.(course)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: AMBER, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
            {course.type === 'live' ? 'Curriculum' : 'Manage'} <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Session Row ────────────────────────────────────────────────────── */
function SessionRow({ session, onDelete }) {
  const time = new Date(session.startTime);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 16px', background: WHITE, borderRadius: 12,
      border: `1px solid ${BORDER}`,
    }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `${AMBER}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Video size={18} color={AMBER} />
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK, fontFamily: FONT }}>{session.title}</div>
        <div style={{ fontSize: 11, color: MUTED, fontFamily: FONT }}>
          {time.toLocaleDateString()} at {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
      <PlatBadge platform={session.platform} />
      <StatusPill status={session.status} />
      {onDelete && (
        <button onClick={() => onDelete(session.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 4, borderRadius: 6 }}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────────────── */
export default function CoursesPage() {
  const { getCourses, createCourse, updateCourse, deleteCourse, getSessions, createSession, deleteSession, commitSchedule, commitCurriculum } = useCoursesAPI();
  const [courses,  setCourses]  = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);

  const [liveWizard,     setLiveWizard]     = useState(false);
  const [onDemandModal,  setOnDemandModal]  = useState(false);
  const [scheduleModal,  setScheduleModal]  = useState(false);
  const [curriculumFor,  setCurriculumFor]  = useState(null);
  const [editCourse,     setEditCourse]     = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    try {
      const [cr, sr] = await Promise.allSettled([getCourses(), getSessions()]);
      setCourses(cr.status === 'fulfilled' ? (cr.value?.data || MOCK_COURSES) : MOCK_COURSES);
      setSessions(sr.status === 'fulfilled' ? (sr.value?.data || MOCK_SESSIONS) : MOCK_SESSIONS);
      if (cr.status === 'rejected') console.warn('Courses API error, using mock:', cr.reason);
    } catch (err) {
      console.warn('CoursesPage load error:', err);
      setCourses(MOCK_COURSES);
      setSessions(MOCK_SESSIONS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreateLive = async ({ info, spec, modules }) => {
    // 1. Create the live course.
    const course = await createCourse({
      title: info.title, description: info.description, type: 'live',
      maxStudents: parseInt(info.maxStudents), thumbnail: info.thumbnail,
    }).catch((e) => { console.warn('createCourse failed:', e); return null; });
    const courseId = course?.data?.id;
    if (!courseId) { showToast('Could not create course.', 'error'); return; }

    // 2. Commit the whole module → topics tree (+ materials) + schedule config.
    try {
      await commitSchedule(courseId, {
        scheduleConfig: spec,
        modules: modules.map((m, mi) => ({
          title: m.title, orderIndex: mi,
          sessions: m.sessions.map((s, si) => ({
            title: s.title, scheduled_start: s.scheduled_start, scheduled_end: s.scheduled_end,
            duration_min: Number(s.duration_min) || 60, platform: s.platform, order_index: si,
            materials: (s.materials || []).filter((x) => x.title || x.url || x.body),
          })),
        })),
      });
      showToast('Course & schedule created!');
    } catch (e) {
      console.warn('commitSchedule failed:', e);
      showToast('Course created, but schedule failed to save.', 'error');
    }
    load();
  };

  const handleCreateOnDemand = async ({ info, sections, pricing, published }) => {
    // 1. Create the on-demand course shell.
    const course = await createCourse({
      title: info.title, description: info.description, type: 'on-demand',
      subject: info.category, level: info.level, thumbnail: info.thumbnail,
      price: pricing.isFree ? 0 : Number(pricing.price) || 0,
      discountPrice: pricing.isFree ? null : (pricing.discountPrice ? Number(pricing.discountPrice) : null),
      isFree: pricing.isFree,
      status: published ? 'active' : 'draft',
    }).catch((e) => { console.warn('createCourse failed:', e); return null; });
    const courseId = course?.data?.id;
    if (!courseId) { showToast('Could not create course.', 'error'); return; }

    // 2. Commit the sections → video lessons tree.
    try {
      await commitCurriculum(courseId, {
        sections: sections.map((s, si) => ({
          title: s.title, orderIndex: si,
          lessons: s.lessons.map((l, li) => ({
            title: l.title, orderIndex: li,
            videoUrl: l.videoUrl,
            duration: Number(l.duration) || 0,   // minutes; backend converts to seconds
            preview: !!l.preview,
          })),
        })),
      });
      showToast(published ? 'On-demand course published!' : 'Draft saved!');
    } catch (e) {
      console.warn('commitCurriculum failed:', e);
      showToast('Course created, but curriculum failed to save.', 'error');
    }
    load();
  };

  const handleCreateSession = async (form) => {
    await createSession(form).catch(console.warn);
    showToast('Session scheduled!');
    load();
  };

  const handleDeleteSession = async (id) => {
    await deleteSession(id).catch(console.warn);
    setSessions(s => s.filter(x => x.id !== id));
    showToast('Session removed.', 'info');
  };

  const handleSaveCourse = async (id, data) => {
    await updateCourse(id, data);
    showToast('Course updated!');
    load();
  };

  const handleDeleteCourse = async (course) => {
    if (!window.confirm(`Delete "${course.title}"? This removes its sessions and enrollments and cannot be undone.`)) return;
    try {
      await deleteCourse(course.id);
      setCourses(cs => cs.filter(c => c.id !== course.id));
      showToast('Course deleted.', 'info');
    } catch (err) {
      showToast(err.message || 'Failed to delete course', 'error');
    }
  };

  return (
    <PageLayout
      title="Courses"
      subtitle="Manage your live and on-demand courses"
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn size="sm" variant="secondary" onClick={() => setScheduleModal(true)}>
            <Calendar size={14} /> Schedule Session
          </Btn>
          <Btn size="sm" variant="secondary" onClick={() => setOnDemandModal(true)}>
            <BookOpen size={14} /> New On-Demand
          </Btn>
          <Btn size="sm" onClick={() => setLiveWizard(true)}>
            <Plus size={14} /> New Live Class
          </Btn>
        </div>
      }
    >
      {/* Courses grid */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: INK, margin: '0 0 16px', fontFamily: FONT }}>
          Your Courses ({loading ? '…' : courses.length})
        </h2>
        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 240, borderRadius: 16 }} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
            {courses.map(c => <CourseCard key={c.id} course={c} onManage={setCurriculumFor} onEdit={setEditCourse} onDelete={handleDeleteCourse} />)}
            {courses.length === 0 && (
              <div style={{
                gridColumn: '1 / -1', background: WHITE, border: `1px dashed ${BORDER}`,
                borderRadius: 16, padding: '40px', textAlign: 'center',
              }}>
                <BookOpen size={32} color={MUTED} style={{ marginBottom: 12 }} />
                <p style={{ fontSize: 14, color: MUTED, margin: '0 0 16px', fontFamily: FONT }}>No courses yet</p>
                <Btn onClick={() => setLiveWizard(true)}><Plus size={14} /> Create your first course</Btn>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Upcoming sessions */}
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: INK, margin: '0 0 16px', fontFamily: FONT }}>
          Live Sessions
        </h2>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 66, borderRadius: 12 }} />)}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sessions.map(s => <SessionRow key={s.id} session={s} onDelete={handleDeleteSession} />)}
            {sessions.length === 0 && (
              <div style={{ background: WHITE, border: `1px dashed ${BORDER}`, borderRadius: 12, padding: '32px', textAlign: 'center' }}>
                <p style={{ fontSize: 14, color: MUTED, margin: '0 0 12px', fontFamily: FONT }}>No sessions scheduled</p>
                <Btn size="sm" variant="secondary" onClick={() => setScheduleModal(true)}>
                  <Calendar size={14} /> Schedule one
                </Btn>
              </div>
            )}
          </div>
        )}
      </div>

      <EditCourseModal open={!!editCourse} course={editCourse} onClose={() => setEditCourse(null)} onSave={handleSaveCourse} />
      <CourseCurriculum open={!!curriculumFor} course={curriculumFor} onClose={() => { setCurriculumFor(null); load(); }} onToast={showToast} />
      <LiveClassWizard open={liveWizard} onClose={() => setLiveWizard(false)} onSubmit={handleCreateLive} />
      <OnDemandWizard open={onDemandModal} onClose={() => setOnDemandModal(false)} onSubmit={handleCreateOnDemand} />
      <ScheduleSessionModal open={scheduleModal} onClose={() => setScheduleModal(false)} onSubmit={handleCreateSession} courses={courses} />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
