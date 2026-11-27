/** Lesson Planner + OSM (Digital Evaluation) module pages (mgmt schema). */
import { useState, useEffect } from 'react';
import { NotebookPen, CheckCircle2, XCircle, Send, FileText, Eye, ClipboardCheck, Gauge } from 'lucide-react';
import { PageLayout } from '../../components/Layout.jsx';
import ResourcePage from '../../components/mgmt/ResourcePage.jsx';
import StatCards from '../../components/mgmt/StatCards.jsx';
import { GuidePage, ModuleSettingsForm } from '../../components/mgmt/extras.jsx';
import { apiGet } from '../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../constants.js';
import { C, tint } from '../../theme/colors.js';

const BASE = '/api/school/mgmt';
const TEACHER_OPTS = { url: '/api/school/instructors', labelFn: (r) => r.full_name || r.email };
const pill = (v, map) => {
  const c = map[v] || C.muted2;
  return <span style={{ padding: '3px 10px', borderRadius: 999, background: tint(8, c), color: c, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }}>{v}</span>;
};
const LP_STATUS_COLORS = { draft: C.muted2, submitted: C.brand, approved: GREEN, rejected: RED };
const LP_STATUSES = ['draft', 'submitted', 'approved', 'rejected'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }));

const LP_COLUMNS = [
  { key: 'topic', label: 'Topic' }, { key: 'teacher_name', label: 'Teacher' },
  { key: 'class_name', label: 'Class' }, { key: 'subject_name', label: 'Subject' },
  { key: 'week_label', label: 'Week' },
  { key: 'status', label: 'Status', render: (r) => pill(r.status, LP_STATUS_COLORS) },
];
const LP_FIELDS = [
  { key: 'topic', label: 'Topic', required: true },
  { key: 'teacher_id', label: 'Teacher', type: 'select', optionsFrom: TEACHER_OPTS },
  { key: 'class_id', label: 'Class', type: 'select', optionsFrom: { resource: 'classes' } },
  { key: 'subject_id', label: 'Subject', type: 'select', optionsFrom: { resource: 'subjects' } },
  { key: 'week_label', label: 'Week', placeholder: 'Week 3 — Term 1' },
  { key: 'status', label: 'Status', type: 'select', default: 'draft', options: LP_STATUSES },
  { key: 'objectives', label: 'Objectives', type: 'textarea', full: true },
  { key: 'activities', label: 'Activities', type: 'textarea', full: true },
  { key: 'resources', label: 'Resources', type: 'textarea', full: true },
  { key: 'feedback', label: 'Reviewer Feedback', type: 'textarea', full: true },
];

/* ═══ Lesson Planner ═══ */
export function LessonPlannerDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/lesson-planner`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.plans, label: 'Lesson Plans', icon: NotebookPen, ti: 'ti-notebook', c: BLUE, to: '/mgmt/lesson-plans' },
    { n: s.submitted, label: 'Awaiting Review', icon: Send, ti: 'ti-send', c: C.brand, to: '/mgmt/lesson-plan-review' },
    { n: s.approved, label: 'Approved', icon: CheckCircle2, ti: 'ti-circle-check', c: GREEN, to: '/mgmt/lesson-plan-approvals' },
    { n: s.rejected, label: 'Rejected', icon: XCircle, ti: 'ti-circle-x', c: RED, to: '/mgmt/lesson-plan-review' },
    { n: s.draft, label: 'Drafts', icon: FileText, ti: 'ti-file-text', c: C.muted2, to: '/mgmt/lesson-plans' },
  ] : [];
  return <PageLayout title="Lesson Planner Dashboard" subtitle="Plan submission & approval pipeline"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function LessonPlansPage() {
  return <ResourcePage title="Lesson Plans" subtitle="All lesson plans" resource="lesson-plans"
    columns={LP_COLUMNS} fields={LP_FIELDS}
    listFilters={[{ key: 'status', label: 'Status', options: LP_STATUSES }, { key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } }]}
    createLabel="New Plan" searchKeys={['topic', 'teacher_name', 'week_label']} />;
}

export function LessonPlannerGuidePage() {
  return <GuidePage title="Lesson Planner Guide" subtitle="How the planning workflow runs"
    sections={[
      { h: '1. Draft', p: 'Teachers create a plan per topic/week with objectives, activities and resources. Plans start as drafts only the author works on.' },
      { h: '2. Submit', p: 'Setting the status to Submitted sends the plan to the review queue (Lesson Plan Review).' },
      { h: '3. Review & feedback', p: 'A reviewer approves or rejects each plan and can leave feedback. Rejected plans go back to the teacher with the notes attached.' },
      { h: '4. Track coverage', p: 'Lesson Plan Coverage and Reports show how many plans exist per status so heads of department can spot gaps before the week starts.' },
    ]} />;
}

export function LessonPlanReviewPage() {
  return <ResourcePage title="Lesson Plan Review" subtitle="Plans awaiting a decision" resource="lesson-plans"
    columns={LP_COLUMNS} fields={LP_FIELDS} fixedFilters={{ status: 'submitted' }} canCreate={false} />;
}

export function LessonPlanApprovalsPage() {
  return <ResourcePage title="Lesson Plan Approvals" subtitle="Approved plans" resource="lesson-plans"
    columns={LP_COLUMNS} fields={LP_FIELDS} fixedFilters={{ status: 'approved' }} canCreate={false} />;
}

export function LessonPlanCoveragePage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/lesson-planner`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const total = s?.plans || 0;
  const pct = (n) => total ? `${Math.round(((n || 0) / total) * 100)}%` : '0%';
  const cards = s ? [
    { n: total, label: 'Total Plans', icon: NotebookPen, ti: 'ti-notebook', c: BLUE, to: '/mgmt/lesson-plans' },
    { n: pct(s.approved), label: 'Approved Coverage', icon: CheckCircle2, ti: 'ti-circle-check', c: GREEN },
    { n: pct(s.submitted), label: 'In Review', icon: Send, ti: 'ti-send', c: C.brand },
    { n: pct(s.draft), label: 'Still Draft', icon: FileText, ti: 'ti-file-text', c: C.muted2 },
  ] : [];
  return <PageLayout title="Lesson Plan Coverage" subtitle="How much of the curriculum is planned & approved"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function LessonPlanReportsPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/lesson-planner`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.approved, label: 'Approved', icon: CheckCircle2, ti: 'ti-circle-check', c: GREEN },
    { n: s.rejected, label: 'Rejected', icon: XCircle, ti: 'ti-circle-x', c: RED },
    { n: s.submitted, label: 'Pending Review', icon: Send, ti: 'ti-send', c: C.brand, to: '/mgmt/lesson-plan-review' },
    { n: s.draft, label: 'Drafts', icon: FileText, ti: 'ti-file-text', c: C.muted2 },
  ] : [];
  return <PageLayout title="Lesson Plan Reports" subtitle="Status breakdown"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function LessonPlannerSettingsPage() {
  return <ModuleSettingsForm module="lesson-planner" title="Lesson Planner Settings" subtitle="Workflow preferences"
    fields={[
      { key: 'require_approval', label: 'Require Approval Before Teaching', type: 'toggle' },
      { key: 'submission_day', label: 'Weekly Submission Day', type: 'select', options: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => ({ value: d, label: d })) },
      { key: 'weeks_ahead', label: 'Plan Weeks Ahead', type: 'number', hint: 'How many weeks in advance teachers must plan.' },
    ]} />;
}

/* ═══ OSM (Digital Evaluation) ═══ */
const OSM_STATUSES = [{ value: 'scheduled', label: 'Scheduled' }, { value: 'completed', label: 'Completed' }];

export function OSMDashboardPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/osm`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: s.sessions, label: 'Observation Sessions', icon: Eye, ti: 'ti-eye', c: BLUE, to: '/mgmt/osm-sessions' },
    { n: s.completed, label: 'Completed', icon: CheckCircle2, ti: 'ti-circle-check', c: GREEN, to: '/mgmt/osm-sessions' },
    { n: s.evaluations, label: 'Evaluations', icon: ClipboardCheck, ti: 'ti-clipboard-check', c: PURPLE, to: '/mgmt/osm-evaluate' },
    { n: s.pendingModeration, label: 'Pending Moderation', icon: ClipboardCheck, ti: 'ti-clipboard-check', c: C.brand, to: '/mgmt/osm-moderation' },
    { n: `${s.averageScore}%`, label: 'Average Score', icon: Gauge, ti: 'ti-gauge', c: s.averageScore >= 60 ? GREEN : C.brand },
  ] : [];
  return <PageLayout title="OSM Dashboard" subtitle="Observation & supervision overview"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function OSMSessionsPage() {
  return <ResourcePage title="OSM Sessions" subtitle="Classroom observation sessions" resource="osm-sessions"
    columns={[
      { key: 'teacher_name', label: 'Teacher' }, { key: 'observer_name', label: 'Observer' },
      { key: 'session_date', label: 'Date' }, { key: 'focus_area', label: 'Focus' },
      { key: 'status', label: 'Status', render: (r) => pill(r.status, { scheduled: C.brand, completed: GREEN }) },
    ]}
    fields={[
      { key: 'teacher_id', label: 'Teacher', type: 'select', optionsFrom: TEACHER_OPTS },
      { key: 'observer_name', label: 'Observer' },
      { key: 'session_date', label: 'Date', type: 'date' },
      { key: 'focus_area', label: 'Focus Area', placeholder: 'e.g. Classroom management' },
      { key: 'status', label: 'Status', type: 'select', default: 'scheduled', options: OSM_STATUSES },
    ]} listFilters={[{ key: 'status', label: 'Status', options: OSM_STATUSES }]} createLabel="New Session" />;
}

const OSM_EVAL_COLUMNS = [
  { key: 'session_name', label: 'Session Focus' },
  { key: 'score', label: 'Score', render: (r) => r.score != null ? <b>{r.score}%</b> : '—' },
  { key: 'strengths', label: 'Strengths' },
  { key: 'status', label: 'Status', render: (r) => pill(r.status, { pending: C.brand, moderated: GREEN }) },
];
const OSM_EVAL_FIELDS = [
  { key: 'session_id', label: 'Session', type: 'select', required: true, optionsFrom: { resource: 'osm-sessions', labelFn: (r) => `${r.focus_area || 'Session'} — ${r.session_date || ''}` } },
  { key: 'score', label: 'Score (%)', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', default: 'pending', options: [{ value: 'pending', label: 'Pending' }, { value: 'moderated', label: 'Moderated' }] },
  { key: 'strengths', label: 'Strengths', type: 'textarea', full: true },
  { key: 'improvements', label: 'Areas for Improvement', type: 'textarea', full: true },
];

export function OSMEvaluatePage() {
  return <ResourcePage title="OSM Evaluate" subtitle="Score observed sessions" resource="osm-evaluations"
    columns={OSM_EVAL_COLUMNS} fields={OSM_EVAL_FIELDS} createLabel="New Evaluation" />;
}

export function OSMModerationPage() {
  return <ResourcePage title="OSM Moderation" subtitle="Evaluations awaiting moderation" resource="osm-evaluations"
    columns={OSM_EVAL_COLUMNS} fields={OSM_EVAL_FIELDS} fixedFilters={{ status: 'pending' }} canCreate={false} />;
}

export function OSMReportsPage() {
  const [s, setS] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/osm`).then((r) => setS(r.data)).catch(() => setS({})); }, []);
  const cards = s ? [
    { n: `${s.averageScore}%`, label: 'Average Score', icon: Gauge, ti: 'ti-gauge', c: s.averageScore >= 60 ? GREEN : C.brand },
    { n: s.evaluations, label: 'Total Evaluations', icon: ClipboardCheck, ti: 'ti-clipboard-check', c: BLUE },
    { n: s.pendingModeration, label: 'Pending Moderation', icon: ClipboardCheck, ti: 'ti-clipboard-check', c: C.brand, to: '/mgmt/osm-moderation' },
    { n: s.completed, label: 'Sessions Completed', icon: CheckCircle2, ti: 'ti-circle-check', c: GREEN },
  ] : [];
  return <PageLayout title="OSM Reports" subtitle="Observation outcomes"><StatCards cards={cards} loading={!s} /></PageLayout>;
}

export function OSMGuidePage() {
  return <GuidePage title="OSM Guide" subtitle="Observation & supervision workflow"
    sections={[
      { h: '1. Schedule the observation', p: 'Create an OSM Session with the teacher, observer, date and a focus area so the teacher knows what the visit will look at.' },
      { h: '2. Evaluate', p: 'After the visit, record an evaluation under OSM Evaluate — a score plus written strengths and areas for improvement.' },
      { h: '3. Moderate', p: 'A second reviewer checks pending evaluations under OSM Moderation for fairness and consistency before they become final.' },
      { h: '4. Review trends', p: 'OSM Reports aggregates average scores so leadership can track teaching quality across terms.' },
    ]} />;
}
