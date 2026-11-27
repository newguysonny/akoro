/** CBC Academics + PTM Meetings module pages (mgmt schema). */
import { useState, useEffect } from 'react';
import { Layers, ListChecks, Trophy, Route, CalendarClock, Users, CheckCircle2, ListTodo } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { GuidePage } from '../../components/mgmt/extras.jsx';
import { apiGet } from '../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';

const BASE = '/api/school/mgmt';
const studentOpts = { resource: 'students', labelFn: (r) => `${r.first_name} ${r.last_name} (${r.admission_no})` };
const pill = (v, map) => {
  const c = map[v] || C.muted2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: tint(8, c), color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{String(v).replace('_', ' ')}</span>;
};
const LEVELS = [
  { value: 'exceeding', label: 'Exceeding Expectations' }, { value: 'meeting', label: 'Meeting Expectations' },
  { value: 'approaching', label: 'Approaching Expectations' }, { value: 'below', label: 'Below Expectations' },
];
const LEVEL_COLORS = { exceeding: GREEN, meeting: BLUE, approaching: C.brand, below: RED };

/* ═══ CBC ═══ */
export function CBCDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/cbc`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.strands, label: 'Strands & Outcomes', icon: Layers, ti: 'ti-stack-2', c: BLUE, to: '/mgmt/cbc-strands' },
    { n: s.assessments, label: 'Assessments', icon: ListChecks, ti: 'ti-list-check', c: PURPLE, to: '/mgmt/cbc-assessments' },
    { n: s.competencies, label: 'Core Competencies', icon: Trophy, ti: 'ti-trophy', c: C.brand, to: '/mgmt/core-competencies' },
    { n: s.pathways, label: 'Pathways & Tracks', icon: Route, ti: 'ti-route', c: GREEN, to: '/mgmt/cbc-pathways' },
    { n: s.exceeding, label: 'Exceeding', icon: Trophy, ti: 'ti-trophy', c: GREEN },
    { n: s.below, label: 'Below Expectations', icon: ListChecks, ti: 'ti-list-check', c: RED },
  ] : [];
  return <PageLayout title="CBC Dashboard" subtitle="Competency-based curriculum overview"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function CBCStrandsPage() {
  return <ResourcePage title="Strands & Outcomes" subtitle="Curriculum strands and learning outcomes" resource="cbc-strands"
    columns={[
      { key: 'subject_name', label: 'Subject' }, { key: 'strand', label: 'Strand' },
      { key: 'sub_strand', label: 'Sub-strand' }, { key: 'outcome', label: 'Outcome' },
    ]}
    fields={[
      { key: 'subject_id', label: 'Subject', type: 'select', optionsFrom: { resource: 'subjects' } },
      { key: 'strand', label: 'Strand', required: true },
      { key: 'sub_strand', label: 'Sub-strand' },
      { key: 'outcome', label: 'Learning Outcome', type: 'textarea', full: true },
    ]} listFilters={[{ key: 'subject_id', label: 'Subject', optionsFrom: { resource: 'subjects' } }]} createLabel="New Strand" />;
}

export function CBCAssessmentsPage() {
  return <ResourcePage title="CBC Assessments" subtitle="Competency ratings per student" resource="cbc-assessments"
    columns={[
      { key: 'student_name', label: 'Student' }, { key: 'strand_name', label: 'Strand' },
      { key: 'level', label: 'Level', render: (r) => pill(r.level, LEVEL_COLORS) },
      { key: 'assessed_on', label: 'Date' },
    ]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: studentOpts },
      { key: 'strand_id', label: 'Strand', type: 'select', optionsFrom: { resource: 'cbc-strands', labelKey: 'strand' } },
      { key: 'level', label: 'Level', type: 'select', required: true, default: 'meeting', options: LEVELS },
      { key: 'assessed_on', label: 'Date', type: 'date' },
      { key: 'note', label: 'Note', type: 'textarea', full: true },
    ]} listFilters={[{ key: 'level', label: 'Level', options: LEVELS }]} createLabel="New Assessment" />;
}

export function CoreCompetenciesPage() {
  return <ResourcePage title="Core Competencies" subtitle="Cross-cutting skills" resource="core-competencies"
    columns={[{ key: 'name', label: 'Competency' }, { key: 'description', label: 'Description' }]}
    fields={[{ key: 'name', label: 'Name', required: true }, { key: 'description', label: 'Description', type: 'textarea', full: true }]}
    createLabel="New Competency" />;
}

export function CBCPathwaysPage() {
  return <ResourcePage title="Pathways & Tracks" subtitle="Senior-school pathways" resource="cbc-pathways"
    columns={[{ key: 'name', label: 'Pathway' }, { key: 'track', label: 'Track' }, { key: 'description', label: 'Description' }]}
    fields={[
      { key: 'name', label: 'Pathway Name', required: true },
      { key: 'track', label: 'Track', placeholder: 'STEM / Arts / Social Sciences' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
    ]} createLabel="New Pathway" />;
}

export function CBCReportsPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/cbc`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.exceeding, label: 'Exceeding Expectations', icon: Trophy, ti: 'ti-trophy', c: GREEN },
    { n: s.meeting, label: 'Meeting Expectations', icon: CheckCircle2, ti: 'ti-circle-check', c: BLUE },
    { n: s.approaching, label: 'Approaching Expectations', icon: ListChecks, ti: 'ti-list-check', c: C.brand },
    { n: s.below, label: 'Below Expectations', icon: ListChecks, ti: 'ti-list-check', c: RED },
    { n: s.assessments, label: 'Total Assessments', icon: Layers, ti: 'ti-stack-2', c: PURPLE, to: '/mgmt/cbc-assessments' },
  ] : [];
  return <PageLayout title="CBC Reports" subtitle="Competency-level distribution"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

/* ═══ PTM ═══ */
const PTM_STATUSES = [{ value: 'scheduled', label: 'Scheduled' }, { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }];

export function PTMDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/ptm`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.meetings, label: 'Meetings', icon: CalendarClock, ti: 'ti-calendar-clock', c: BLUE, to: '/mgmt/ptm-meetings' },
    { n: s.scheduled, label: 'Scheduled', icon: CalendarClock, ti: 'ti-calendar-clock', c: C.brand, to: '/mgmt/ptm-meetings' },
    { n: s.attendanceRecords, label: 'Attendance Records', icon: Users, ti: 'ti-users', c: PURPLE, to: '/mgmt/ptm-attendance' },
    { n: s.attended, label: 'Guardians Attended', icon: CheckCircle2, ti: 'ti-circle-check', c: GREEN, to: '/mgmt/ptm-attendance' },
    { n: s.openFollowups, label: 'Open Follow-ups', icon: ListTodo, ti: 'ti-checklist', c: RED, to: '/mgmt/ptm-followups' },
  ] : [];
  return <PageLayout title="PTM Dashboard" subtitle="Parent–teacher meeting overview"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function PTMScheduleMeetingsPage() {
  return <ResourcePage title="PTM Schedule Meetings" subtitle="Plan parent–teacher meetings" resource="ptm-meetings"
    columns={[
      { key: 'title', label: 'Meeting' }, { key: 'meeting_date', label: 'Date' }, { key: 'class_name', label: 'Class' },
      { key: 'venue', label: 'Venue' }, { key: 'status', label: 'Status', render: (r) => pill(r.status, { scheduled: C.brand, completed: GREEN, cancelled: RED }) },
    ]}
    fields={[
      { key: 'title', label: 'Meeting Title', required: true },
      { key: 'meeting_date', label: 'Date', type: 'date' },
      { key: 'class_id', label: 'Class (optional)', type: 'select', optionsFrom: { resource: 'classes' } },
      { key: 'venue', label: 'Venue' },
      { key: 'status', label: 'Status', type: 'select', default: 'scheduled', options: PTM_STATUSES },
      { key: 'agenda', label: 'Agenda', type: 'textarea', full: true },
    ]} listFilters={[{ key: 'status', label: 'Status', options: PTM_STATUSES }]} createLabel="Schedule Meeting" />;
}

export function PTMGuidePage() {
  return <GuidePage title="PTM Guide" subtitle="How to run effective parent–teacher meetings"
    sections={[
      { h: '1. Schedule early', p: 'Create the meeting under PTM Schedule Meetings at least two weeks ahead, attach a class if it is class-specific, and share the agenda so parents come prepared.' },
      { h: '2. Record attendance & remarks', p: 'During the meeting, log each guardian under PTM Attendance & Remarks — note who attended and capture the key points discussed per student.' },
      { h: '3. Create follow-ups', p: 'Anything that needs action (extra lessons, fee discussions, behavioral support) becomes a PTM Follow-up with a due date, so nothing agreed in the room is forgotten.' },
      { h: '4. Review reports', p: 'PTM Reports shows attendance rates and open follow-ups so you can measure engagement term over term.' },
    ]} />;
}

export function PTMAttendancePage() {
  return <ResourcePage title="PTM Attendance & Remarks" subtitle="Who attended and what was discussed" resource="ptm-attendance"
    columns={[
      { key: 'meeting_name', label: 'Meeting' }, { key: 'student_name', label: 'Student' },
      { key: 'guardian_name', label: 'Guardian' }, { key: 'attended', label: 'Attended' }, { key: 'remarks', label: 'Remarks' },
    ]}
    fields={[
      { key: 'meeting_id', label: 'Meeting', type: 'select', required: true, optionsFrom: { resource: 'ptm-meetings', labelKey: 'title' } },
      { key: 'student_id', label: 'Student', type: 'select', optionsFrom: studentOpts },
      { key: 'guardian_name', label: 'Guardian Name' },
      { key: 'attended', label: 'Attended', type: 'toggle', default: true },
      { key: 'remarks', label: 'Remarks', type: 'textarea', full: true },
    ]} listFilters={[{ key: 'meeting_id', label: 'Meeting', optionsFrom: { resource: 'ptm-meetings', labelKey: 'title' } }]} createLabel="Record Attendance" />;
}

export function PTMFollowupsPage() {
  const STATUSES = [{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }];
  return <ResourcePage title="PTM Follow-ups" subtitle="Actions agreed with parents" resource="ptm-followups"
    columns={[
      { key: 'note', label: 'Follow-up' }, { key: 'meeting_name', label: 'Meeting' }, { key: 'student_name', label: 'Student' },
      { key: 'due_on', label: 'Due' }, { key: 'status', label: 'Status', render: (r) => pill(r.status, { open: C.brand, done: GREEN }) },
    ]}
    fields={[
      { key: 'note', label: 'Follow-up', type: 'textarea', required: true, full: true },
      { key: 'meeting_id', label: 'Meeting', type: 'select', optionsFrom: { resource: 'ptm-meetings', labelKey: 'title' } },
      { key: 'student_id', label: 'Student', type: 'select', optionsFrom: studentOpts },
      { key: 'due_on', label: 'Due On', type: 'date' },
      { key: 'status', label: 'Status', type: 'select', default: 'open', options: STATUSES },
    ]} listFilters={[{ key: 'status', label: 'Status', options: STATUSES }]} createLabel="New Follow-up" />;
}

export function PTMReportsPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/ptm`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const rate = s?.attendanceRecords ? Math.round((s.attended / s.attendanceRecords) * 100) : 0;
  const cards = s ? [
    { n: s.meetings, label: 'Total Meetings', icon: CalendarClock, ti: 'ti-calendar-clock', c: BLUE },
    { n: `${rate}%`, label: 'Attendance Rate', icon: Users, ti: 'ti-users', c: rate >= 60 ? GREEN : C.brand },
    { n: s.attended, label: 'Guardians Attended', icon: CheckCircle2, ti: 'ti-circle-check', c: GREEN },
    { n: s.openFollowups, label: 'Open Follow-ups', icon: ListTodo, ti: 'ti-checklist', c: RED, to: '/mgmt/ptm-followups' },
  ] : [];
  return <PageLayout title="PTM Reports" subtitle="Engagement metrics"><StatCards cards={cards} loading={!s} /></PageLayout>;
}
