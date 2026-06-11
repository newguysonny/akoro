import { useState, useEffect } from 'react';
import { Plus, Video, BookOpen, Users, Clock, Calendar, Trash2, Edit2, ChevronRight } from 'lucide-react';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Txa, Sel, WizardSteps, StatusPill, PlatBadge, CoursTypeBadge, FileUploadZone, Toast, Skeleton } from '../components/Primitives.jsx';
import { useCoursesAPI } from '../hooks/useCoursesAPI.js';
import LiveClassWizard from '../components/LiveClassWizard.jsx';
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


/* ── On-Demand Builder ──────────────────────────────────────────────── */
function OnDemandBuilder({ open, onClose, onSubmit }) {
  const [form, setForm] = useState({ title: '', description: '', category: '', price: '' });
  const [loading, setLoading] = useState(false);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    setLoading(true);
    try { await onSubmit({ ...form, type: 'on-demand' }); onClose(); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="New On-Demand Course" width={500}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Inp label="Course Title" value={form.title} onChange={e => setField('title', e.target.value)} placeholder="e.g. Python for Beginners" />
        <Txa label="Description" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="What will students learn?" />
        <Inp label="Category" value={form.category} onChange={e => setField('category', e.target.value)} placeholder="e.g. Programming, Design…" />
        <Inp label="Price ($)" type="number" value={form.price} onChange={e => setField('price', e.target.value)} placeholder="0 for free" />
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: INK, display: 'block', marginBottom: 6 }}>Course Videos</label>
          <FileUploadZone label="Upload intro video or thumbnail" accept="video/*,image/*" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn onClick={handleSubmit} disabled={loading || !form.title.trim()}>
            {loading ? 'Creating…' : 'Create Course'}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

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

/* ── Course Card ────────────────────────────────────────────────────── */
function CourseCard({ course }) {
  return (
    <div style={{
      background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 16,
      overflow: 'hidden', transition: 'box-shadow .15s',
    }}
    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,.08)'}
    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      {/* Thumbnail */}
      <div style={{
        height: 100, background: course.thumbnail ? `url(${course.thumbnail})` : `linear-gradient(135deg, ${AMBER}22, ${PURPLE}22)`,
        backgroundSize: 'cover', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {!course.thumbnail && (
          course.type === 'live' ? <Video size={32} color={AMBER} /> : <BookOpen size={32} color={PURPLE} />
        )}
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
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: AMBER, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, fontFamily: FONT }}>
            Manage <ChevronRight size={12} />
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
  const { getCourses, createCourse, getSessions, createSession, deleteSession, commitSchedule } = useCoursesAPI();
  const [courses,  setCourses]  = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);

  const [liveWizard,     setLiveWizard]     = useState(false);
  const [onDemandModal,  setOnDemandModal]  = useState(false);
  const [scheduleModal,  setScheduleModal]  = useState(false);

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

  const handleCreateOnDemand = async (form) => {
    await createCourse({ ...form, type: 'on-demand' }).catch(console.warn);
    showToast('On-demand course created!');
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
            {courses.map(c => <CourseCard key={c.id} course={c} />)}
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

      <LiveClassWizard open={liveWizard} onClose={() => setLiveWizard(false)} onSubmit={handleCreateLive} />
      <OnDemandBuilder open={onDemandModal} onClose={() => setOnDemandModal(false)} onSubmit={handleCreateOnDemand} />
      <ScheduleSessionModal open={scheduleModal} onClose={() => setScheduleModal(false)} onSubmit={handleCreateSession} courses={courses} />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
