/**
 * CoursesPage — composes the components from ./parts.jsx.
 */
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Video, BookOpen, Users, Clock, Calendar, Trash2, Edit2, ChevronRight, Share2, Check , AlertTriangle } from 'lucide-react';
import { PageLayout, useIsMobile } from '../../components/Layout.jsx';
import { Btn, Modal, Inp, Sel, StatusPill, PlatBadge, CoursTypeBadge, Toast } from '../../components/Primitives.jsx';
import { useCoursesAPI } from '../../hooks/useCoursesAPI.js';
import LiveClassWizard from '../../components/LiveClassWizard.jsx';
import OnDemandWizard from '../../components/OnDemandWizard.jsx';
import CourseCurriculum from '../../components/CourseCurriculum.jsx';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, PURPLE, BLUE, FONT } from '../../constants.js';

/* ── Mock data ─────────────────────────────────────────────────────── */
import { ScheduleSessionModal, EditCourseModal, LEARNER_URL, CourseCard, SessionRow } from './parts.jsx';
import { confirmDialog } from '../../components/ConfirmHost.jsx';

/* URL shell — the creation/scheduling/manage pages are their own COMPONENTS,
   so navigating list ↔ flow never changes one component's hook count (the
   branches previously returned before the hooks were declared, and read
   state that did not exist yet on those renders). */
export default function CoursesPage() {
  const [sp] = useSearchParams();
  const flow = sp.get('flow');
  const flowId = sp.get('id');
  if (flow === 'new-live' || flow === 'new-ondemand') return <CourseFlow kind={flow === 'new-live' ? 'live' : 'ondemand'} />;
  if (flow === 'schedule') return <ScheduleFlow />;
  if (flow === 'manage') return <ManageFlow flowId={flowId} />;
  return <CoursesHome />;
}

const flowToast = (setToast) => (message, type = 'success') => {
  setToast({ message, type });
  setTimeout(() => setToast(null), 3500);
};

/* New Live Class / New On-Demand — the wizards at their own URLs. */
function CourseFlow({ kind }) {
  const navigate = useNavigate();
  const { createCourse, commitSchedule, commitCurriculum } = useCoursesAPI();
  const [toast, setToast] = useState(null);
  const showToast = flowToast(setToast);
  const live = kind === 'live';

  const handleCreateLive = async ({ info, spec, modules }) => {
    const course = await createCourse({
      title: info.title, description: info.description, type: 'live',
      maxStudents: parseInt(info.maxStudents), thumbnail: info.thumbnail,
    }).catch((e) => { console.warn('createCourse failed:', e); return null; });
    const courseId = course?.data?.id;
    if (!courseId) { showToast('Could not create course.', 'error'); return; }
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
  };

  const handleCreateOnDemand = async ({ info, sections, pricing, published }) => {
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
      showToast('Course saved, but the curriculum failed to commit.', 'error');
    }
  };

  return (
    <PageLayout title={live ? 'New Live Class' : 'New On-Demand Course'} subtitle={live ? 'Create a live, scheduled course' : 'Create a self-paced course'}>
      {live
        ? <LiveClassWizard open asPage onClose={() => navigate('/courses')} onSubmit={handleCreateLive} />
        : <OnDemandWizard open asPage onClose={() => navigate('/courses')} onSubmit={handleCreateOnDemand} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

/* Schedule Session — needs the course list for its picker. */
function ScheduleFlow() {
  const navigate = useNavigate();
  const { getCourses, createSession } = useCoursesAPI();
  const [courses, setCourses] = useState([]);
  const [toast, setToast] = useState(null);
  const showToast = flowToast(setToast);

  useEffect(() => { getCourses().then((r) => setCourses(r?.data ?? [])).catch(() => {}); }, []);

  const handleCreateSession = async (form) => {
    await createSession(form).catch(console.warn);
    showToast('Session scheduled!');
  };

  return (
    <PageLayout title="Schedule Session" subtitle="Put a live class on the calendar">
      <ScheduleSessionModal open asPage courses={courses} onSubmit={handleCreateSession} onClose={() => navigate('/courses')} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

/* Manage course / Curriculum — the card's Manage affordance lands here. */
function ManageFlow({ flowId }) {
  const navigate = useNavigate();
  const { getCourses } = useCoursesAPI();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const showToast = flowToast(setToast);

  useEffect(() => {
    getCourses().then((r) => setCourses(r?.data ?? [])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const course = courses.find((c) => String(c.id) === String(flowId)) || null;

  return (
    <PageLayout title="Manage course" subtitle={course?.title || 'Curriculum, pricing and publishing'}>
      {loading ? (
        <div style={{ fontFamily: FONT, color: MUTED, padding: '20px 0' }}>Loading…</div>
      ) : course ? (
        <CourseCurriculum open asPage course={course} onClose={() => navigate('/courses')} onToast={showToast} />
      ) : (
        <div style={{ fontFamily: FONT, color: MUTED }}>
          That course is no longer available.
          <div style={{ marginTop: 14 }}><Btn onClick={() => navigate('/courses')}>Back to courses</Btn></div>
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

function CoursesHome() {
  const navigate = useNavigate();
  const mobile = useIsMobile();
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
  const [loadError,      setLoadError]      = useState('');

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    try {
      const [cr, sr] = await Promise.allSettled([getCourses(), getSessions()]);
      // Sample courses shown on failure look exactly like real ones — a teacher
      // could open, edit or delete something that does not exist. Show what
      // loaded and name what didn't.
      const failed = [];
      setCourses(cr.status === 'fulfilled' ? (cr.value?.data ?? []) : []);
      setSessions(sr.status === 'fulfilled' ? (sr.value?.data ?? []) : []);
      if (cr.status === 'rejected') { failed.push('your courses'); console.warn('[courses]', cr.reason?.detail || cr.reason); }
      if (sr.status === 'rejected') { failed.push('your sessions'); console.warn('[sessions]', sr.reason?.detail || sr.reason); }
      setLoadError(failed.length ? `We couldn't load ${failed.join(' or ')}.` : '');
    } catch (err) {
      console.warn('[courses] load:', err?.detail || err);
      setCourses([]); setSessions([]);
      setLoadError(err?.message || "We couldn't load this page.");
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
    if (!await confirmDialog(`Delete "${course.title}"? This removes its sessions and enrollments and cannot be undone.`)) return;
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
    >
      {loadError && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
          padding: '11px 14px', borderRadius: 12,
          background: '#FEF3C7', border: '1px solid #FDE68A', fontFamily: FONT,
        }}>
          <span style={{ display: 'flex' }}><AlertTriangle size={16} color="#B45309" /></span>
          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: '#92400E' }}>{loadError}</span>
          <button onClick={() => { setLoading(true); load(); }} style={{
            padding: '6px 13px', borderRadius: 9, border: '1px solid #FDE68A',
            background: WHITE, color: '#92400E', fontSize: 12, fontWeight: 800,
            cursor: 'pointer', fontFamily: FONT,
          }}>Retry</button>
        </div>
      )}
      {/* Quick actions — live in the body so they breathe on mobile */}
      <div style={{
        display: 'flex',
        flexDirection: mobile ? 'column' : 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 28,
      }}>
        <Btn variant="secondary" onClick={() => navigate('/courses/schedule')} style={mobile ? { width: '100%' } : undefined}>
          <Calendar size={15} /> Schedule Session
        </Btn>
        <Btn variant="secondary" onClick={() => navigate('/courses/new-ondemand')} style={mobile ? { width: '100%' } : undefined}>
          <BookOpen size={15} /> New On-Demand
        </Btn>
        <Btn onClick={() => navigate('/courses/new-live')} style={mobile ? { width: '100%' } : undefined}>
          <Plus size={15} /> New Live Class
        </Btn>
      </div>

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
            {courses.map(c => <CourseCard key={c.id} course={c} onManage={(c) => navigate(`/courses/manage?id=${c.id}`)} onEdit={setEditCourse} onDelete={handleDeleteCourse} />)}
            {courses.length === 0 && (
              <div style={{
                gridColumn: '1 / -1', background: WHITE, border: `1px dashed ${BORDER}`,
                borderRadius: 16, padding: '40px', textAlign: 'center',
              }}>
                <BookOpen size={32} color={MUTED} style={{ marginBottom: 12 }} />
                <p style={{ fontSize: 14, color: MUTED, margin: '0 0 16px', fontFamily: FONT }}>No courses yet</p>
                <Btn onClick={() => navigate('/courses/new-live')}><Plus size={14} /> Create your first course</Btn>
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
                <Btn size="sm" variant="secondary" onClick={() => navigate('/courses/schedule')}>
                  <Calendar size={14} /> Schedule one
                </Btn>
              </div>
            )}
          </div>
        )}
      </div>

      <EditCourseModal open={!!editCourse} course={editCourse} onClose={() => setEditCourse(null)} onSave={handleSaveCourse} />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}

