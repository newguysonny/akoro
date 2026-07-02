/** Study Center module pages (mgmt schema). */
import { useState, useEffect } from 'react';
import { BookOpenCheck, ListChecks, NotebookText, FolderOpen, PencilLine, Video } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { apiGet } from '../../services/api.js';
import { AMBER, MUTED2, GREEN, RED, BLUE, PURPLE } from '../../constants.js';

const BASE = '/api/school/mgmt';
const pill = (v, map) => {
  const c = map[v] || MUTED2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: `${c}15`, color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v}</span>;
};
const classFilter = { key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } };
const classField = { key: 'class_id', label: 'Class', type: 'select', optionsFrom: { resource: 'classes' } };
const subjectField = { key: 'subject_id', label: 'Subject', type: 'select', optionsFrom: { resource: 'subjects' } };

export function StudyCenterDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/study-center`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const pct = s?.syllabusItems ? Math.round((s.syllabusCovered / s.syllabusItems) * 100) : 0;
  const cards = s ? [
    { n: s.syllabusItems, label: 'Syllabus Topics', icon: ListChecks, c: BLUE, to: '/mgmt/manage-syllabus' },
    { n: `${pct}%`, label: 'Syllabus Covered', icon: BookOpenCheck, c: pct >= 50 ? GREEN : AMBER, to: '/mgmt/manage-syllabus' },
    { n: s.classworkLogs, label: 'Classwork Logs', icon: NotebookText, c: PURPLE, to: '/mgmt/classwork-logbook' },
    { n: s.resources, label: 'Learning Resources', icon: FolderOpen, c: AMBER, to: '/mgmt/manage-resources' },
    { n: s.openHomework, label: 'Open Homework', icon: PencilLine, c: RED, to: '/mgmt/homework-assignments' },
    { n: s.liveClasses, label: 'Upcoming Live Classes', icon: Video, c: GREEN, to: '/mgmt/live-classes' },
  ] : [];
  return <PageLayout title="Study Center Dashboard" subtitle="Teaching & learning activity"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function ManageSyllabusPage() {
  return <ResourcePage title="Manage Syllabus" subtitle="Topics per class & subject" resource="syllabus-items"
    columns={[
      { key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' },
      { key: 'term', label: 'Term' }, { key: 'topic', label: 'Topic' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { pending: AMBER, covered: GREEN }) },
    ]}
    fields={[
      classField, subjectField,
      { key: 'term', label: 'Term', placeholder: 'First Term' },
      { key: 'status', label: 'Status', type: 'select', default: 'pending', options: [{ value: 'pending', label: 'Pending' }, { value: 'covered', label: 'Covered' }] },
      { key: 'topic', label: 'Topic', required: true, full: true },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
    ]} listFilters={[classFilter, { key: 'status', label: 'Status', options: [{ value: 'pending', label: 'Pending' }, { value: 'covered', label: 'Covered' }] }]}
    createLabel="New Topic" />;
}

export function ClassworkLogbookPage() {
  return <ResourcePage title="Classwork & Logbook" subtitle="Daily record of what was taught" resource="classwork-logs"
    columns={[
      { key: 'log_date', label: 'Date' }, { key: 'class_name', label: 'Class' },
      { key: 'subject_name', label: 'Subject' }, { key: 'teacher_name', label: 'Teacher' }, { key: 'topic', label: 'Topic' },
    ]}
    fields={[
      classField, subjectField,
      { key: 'teacher_id', label: 'Teacher', type: 'select', optionsFrom: { url: '/api/school/instructors', labelFn: (r) => r.full_name || r.email } },
      { key: 'log_date', label: 'Date', type: 'date' },
      { key: 'topic', label: 'Topic Taught', required: true, full: true },
      { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    ]} listFilters={[classFilter]} createLabel="New Log Entry" />;
}

export function ManageResourcesPage() {
  const TYPES = [{ value: 'document', label: 'Document' }, { value: 'video', label: 'Video' }, { value: 'link', label: 'Link' }];
  return <ResourcePage title="Manage Resources" subtitle="Teaching & study materials" resource="learning-resources"
    columns={[
      { key: 'title', label: 'Title' }, { key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' },
      { key: 'resource_type', label: 'Type', render: (r) => pill(r.resource_type, { document: BLUE, video: PURPLE, link: AMBER }) },
      { key: 'url', label: 'Link', render: (r) => r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: BLUE, fontWeight: 700 }}>Open</a> : '—' },
    ]}
    fields={[
      { key: 'title', label: 'Title', required: true },
      { key: 'resource_type', label: 'Type', type: 'select', default: 'document', options: TYPES },
      classField, subjectField,
      { key: 'url', label: 'URL', full: true, placeholder: 'https://…' },
      { key: 'note', label: 'Note', type: 'textarea', full: true },
    ]} listFilters={[classFilter, { key: 'resource_type', label: 'Type', options: TYPES }]} createLabel="New Resource" />;
}

export function HomeworkAssignmentsPage() {
  return <ResourcePage title="Homework & Assignments" subtitle="Set and track homework" resource="homework-assignments"
    columns={[
      { key: 'title', label: 'Homework' }, { key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' },
      { key: 'due_on', label: 'Due' }, { key: 'status', label: 'Status', render: (r) => pill(r.status, { open: AMBER, closed: GREEN }) },
    ]}
    fields={[
      { key: 'title', label: 'Title', required: true },
      classField, subjectField,
      { key: 'due_on', label: 'Due On', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', default: 'open', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
      { key: 'description', label: 'Instructions', type: 'textarea', full: true },
    ]} listFilters={[classFilter, { key: 'status', label: 'Status', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] }]}
    createLabel="New Homework" />;
}

export function LiveClassesPage() {
  const STATUSES = [{ value: 'scheduled', label: 'Scheduled' }, { value: 'live', label: 'Live' }, { value: 'ended', label: 'Ended' }];
  return <ResourcePage title="Live Classes" subtitle="Online sessions (Zoom/Meet)" resource="live-classes"
    columns={[
      { key: 'title', label: 'Class' }, { key: 'class_name', label: 'Class Level' }, { key: 'subject_name', label: 'Subject' },
      { key: 'platform', label: 'Platform' },
      { key: 'starts_at', label: 'Starts', render: (r) => r.starts_at ? new Date(r.starts_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—' },
      { key: 'meeting_url', label: 'Join', render: (r) => r.meeting_url ? <a href={r.meeting_url} target="_blank" rel="noreferrer" style={{ color: BLUE, fontWeight: 700 }}>Join</a> : '—' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { scheduled: AMBER, live: GREEN, ended: MUTED2 }) },
    ]}
    fields={[
      { key: 'title', label: 'Class Title', required: true },
      classField, subjectField,
      { key: 'platform', label: 'Platform', placeholder: 'Zoom / Google Meet' },
      { key: 'starts_at', label: 'Starts At', type: 'datetime-local' },
      { key: 'status', label: 'Status', type: 'select', default: 'scheduled', options: STATUSES },
      { key: 'meeting_url', label: 'Meeting URL', full: true, placeholder: 'https://…' },
    ]} listFilters={[{ key: 'status', label: 'Status', options: STATUSES }]} createLabel="Schedule Live Class" />;
}
