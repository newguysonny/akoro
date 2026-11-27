/**
 * Student Information — dashboard + simple ResourcePage-config pages.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Users, UserCheck, UserX, Home, Tags, ShieldAlert, ClipboardCheck } from 'lucide-react';
import { Ico } from '../../../theme/Ico.jsx';
import { PageLayout } from '../../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { GREEN, RED, BLUE, PURPLE } from '../../../constants.js';
import { C, tint } from '../../../theme/colors.js';
import { BASE, fullName, studentOpts, STATUS_PILL, STUDENT_FIELDS, STUDENT_COLUMNS, STUDENT_SEARCH, CLASS_FILTER, naira, STATUS_OPTS, InfoRow, GridInfo, InfoGrid, SectionCard, Ring, statPill, FEE_STATUS_COLOR, ModalShell } from './shared.jsx';

/* ── Student Dashboard ───────────────────────────────────────────── */
export function StudentDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/students`).then((r) => setStats(r.data)).catch(() => setStats({})); }, []);
  const cards = stats ? [
    { n: stats.total, label: 'Total Students', icon: Users, ti: 'ti-users', c: BLUE, to: '/mgmt/students' },
    { n: stats.active, label: 'Active Students', icon: UserCheck, ti: 'ti-user-check', c: GREEN, to: '/mgmt/students' },
    { n: stats.presentToday, label: 'Present Today', icon: ClipboardCheck, ti: 'ti-clipboard-check', c: GREEN, to: '/mgmt/student-attendance' },
    { n: stats.absentToday, label: 'Absent Today', icon: UserX, ti: 'ti-user-x', c: RED, to: '/mgmt/student-attendance' },
    { n: stats.disabled, label: 'Disabled Students', icon: ShieldAlert, ti: 'ti-shield-exclamation', c: C.brand, to: '/mgmt/disabled-students' },
    { n: stats.behaviorIncidents, label: 'Behavior Records', icon: ShieldAlert, ti: 'ti-shield-exclamation', c: PURPLE, to: '/mgmt/behavior-records' },
    { n: stats.houses, label: 'Houses', icon: Home, ti: 'ti-home', c: BLUE, to: '/mgmt/student-houses' },
    { n: stats.categories, label: 'Categories', icon: Tags, ti: 'ti-tags', c: C.brand, to: '/mgmt/student-categories' },
  ] : [];
  return (
    <PageLayout title="Student Dashboard" subtitle="Overview of your student body">
      {!stats ? (
        <div style={{ padding: '50px 0', textAlign: 'center', color: C.muted2 }}><Ico ti="ti-loader-2" size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {cards.map((c) => (
            <div key={c.label} onClick={() => navigate(c.to)} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: '18px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: tint(8, c.c), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Ico lucide={c.icon} ti={c.ti} size={19} color={c.c} />
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: C.ink, fontFamily: C.font }}>{c.n ?? 0}</div>
                <div style={{ fontSize: 12, color: C.muted2, fontFamily: C.font }}>{c.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

/* Student Admission now lives in ./admissionPage.jsx (multi-step wizard). */

/* ── Disabled Students ────────────────────────────────────────────── */
export function DisabledStudentsPage() {
  return <ResourcePage title="Disabled Students" subtitle="Students flagged with a disability" resource="students"
    columns={[...STUDENT_COLUMNS.slice(0, 4), { key: 'disability_note', label: 'Note' }]}
    fields={STUDENT_FIELDS} searchKeys={STUDENT_SEARCH}
    fixedFilters={{ is_disabled: 'true' }} canCreate={false} listFilters={[CLASS_FILTER]} />;
}

/* ── Simple config pages ─────────────────────────────────────────── */
export function BehaviorRecordsPage() {
  return <ResourcePage title="Behavior Records" subtitle="Student behavior incidents" resource="behavior-records"
    columns={[
      { key: 'student_name', label: 'Student' }, { key: 'incident_type', label: 'Incident' },
      { key: 'severity', label: 'Severity', render: (r) => STATUS_PILL(r.severity, { low: { c: GREEN }, medium: { c: C.brand }, high: { c: RED } }) },
      { key: 'action_taken', label: 'Action Taken' }, { key: 'recorded_on', label: 'Date' },
    ]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: studentOpts },
      { key: 'incident_type', label: 'Incident Type', required: true, placeholder: 'e.g. Lateness' },
      { key: 'severity', label: 'Severity', type: 'select', default: 'low', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] },
      { key: 'recorded_on', label: 'Date', type: 'date' },
      { key: 'description', label: 'Description', type: 'textarea', full: true },
      { key: 'action_taken', label: 'Action Taken', type: 'textarea', full: true },
    ]} createLabel="New Incident" />;
}

export function StudentHousesPage() {
  return <ResourcePage title="Student Houses" subtitle="Sports/pastoral houses" resource="student-houses"
    columns={[
      { key: 'name', label: 'House' },
      { key: 'color', label: 'Color', render: (r) => r.color ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><span style={{ width: 14, height: 14, borderRadius: '50%', background: r.color, display: 'inline-block' }} />{r.color}</span> : '—' },
    ]}
    fields={[{ key: 'name', label: 'House Name', required: true }, { key: 'color', label: 'Color (hex)', placeholder: '#EF4444' }]}
    createLabel="New House" />;
}

export function StudentCategoriesPage() {
  return <ResourcePage title="Student Categories" subtitle="e.g. Day / Boarding" resource="student-categories"
    columns={[{ key: 'name', label: 'Category' }]}
    fields={[{ key: 'name', label: 'Category Name', required: true }]} createLabel="New Category" />;
}

export function HealthRecordsPage() {
  return <ResourcePage title="Health Records" subtitle="Allergies, conditions, vaccinations & checkups" resource="health-records"
    columns={[
      { key: 'student_name', label: 'Student' },
      { key: 'record_type', label: 'Type', render: (r) => STATUS_PILL(r.record_type, { allergy: { c: RED }, condition: { c: C.brand }, vaccination: { c: GREEN }, checkup: { c: BLUE } }) },
      { key: 'title', label: 'Title' }, { key: 'recorded_on', label: 'Date' },
    ]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: studentOpts },
      { key: 'record_type', label: 'Type', type: 'select', default: 'condition', options: [{ value: 'allergy', label: 'Allergy' }, { value: 'condition', label: 'Condition' }, { value: 'vaccination', label: 'Vaccination' }, { value: 'checkup', label: 'Checkup' }] },
      { key: 'title', label: 'Title', required: true },
      { key: 'recorded_on', label: 'Date', type: 'date' },
      { key: 'details', label: 'Details', type: 'textarea', full: true },
    ]} createLabel="New Record" />;
}
