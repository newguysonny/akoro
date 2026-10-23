/**
 * ScheduleSessionsPage — Course Creator's "Schedule sessions": put a live
 * session on one of the instructor's courses. The picker lists every course
 * (Course Creator's included: each has its courses row, see
 * akoro-api/modules/course-builder/link.js).
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/Layout.jsx';
import { Btn, Modal, Inp, Sel, Toast } from '../components/Primitives.jsx';
import { useCoursesAPI } from '../hooks/useCoursesAPI.js';

function ScheduleSessionModal({ open, onClose, onSubmit, courses, asPage = false }) {
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
    <Modal open={open} onClose={onClose} title="Schedule Session" width={480} asPage={asPage}>
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

export default function ScheduleSessionsPage() {
  const navigate = useNavigate();
  const { getCourses, createSession } = useCoursesAPI();
  const [courses, setCourses] = useState([]);
  const [toast, setToast] = useState(null);

  useEffect(() => { getCourses().then((r) => setCourses(r?.data ?? [])).catch(() => {}); }, []);

  const handleCreateSession = async (form) => {
    await createSession(form).catch(console.warn);
    setToast({ message: 'Session scheduled!', type: 'success' });
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <PageLayout title="Schedule Session" subtitle="Put a live class on the calendar">
      <ScheduleSessionModal open asPage courses={courses} onSubmit={handleCreateSession} onClose={() => navigate('/course-creator')} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageLayout>
  );
}
