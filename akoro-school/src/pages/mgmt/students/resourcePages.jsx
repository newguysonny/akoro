/**
 * Student Information — dashboard + simple ResourcePage-config pages.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Users, UserCheck, UserX, Home, Tags, ShieldAlert, Loader2, Save, ClipboardCheck,
  Eye, Pencil, Trash2, UserPlus, Search, ArrowLeft, Phone, Mail, MapPin, Droplet,
  Cake, CreditCard, ShieldCheck, CircleDot, X, Copy, Printer, Columns, Image,
  FileUp, Upload, Sheet, Download, CheckSquare, FileText,
  FolderOpen, Key, HeartPulse, Bus, Bed, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, RefreshCw,
  ClipboardList, ThumbsUp, ThumbsDown, Plus,
} from 'lucide-react';
import { PageLayout } from '../../../components/Layout.jsx';
import ResourcePage, { inputStyle } from '../../../components/mgmt/ResourcePage.jsx';
import { API, apiGet, apiPost, apiPut, apiDelete } from '../../../services/api.js';
import { AMBER, INK, MUTED, MUTED2, BORDER, LIGHT, WHITE, GREEN, RED, BLUE, PURPLE, FONT } from '../../../constants.js';
import { BASE, fullName, studentOpts, STATUS_PILL, STUDENT_FIELDS, STUDENT_COLUMNS, STUDENT_SEARCH, CLASS_FILTER, naira, STATUS_OPTS, InfoRow, GridInfo, InfoGrid, SectionCard, Ring, statPill, FEE_STATUS_COLOR, ModalShell } from './shared.jsx';

/* ── Student Dashboard ───────────────────────────────────────────── */
export function StudentDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  useEffect(() => { apiGet(`${BASE}/dashboard/students`).then((r) => setStats(r.data)).catch(() => setStats({})); }, []);
  const cards = stats ? [
    { n: stats.total, label: 'Total Students', icon: Users, c: BLUE, to: '/mgmt/students' },
    { n: stats.active, label: 'Active Students', icon: UserCheck, c: GREEN, to: '/mgmt/students' },
    { n: stats.presentToday, label: 'Present Today', icon: ClipboardCheck, c: GREEN, to: '/mgmt/student-attendance' },
    { n: stats.absentToday, label: 'Absent Today', icon: UserX, c: RED, to: '/mgmt/student-attendance' },
    { n: stats.disabled, label: 'Disabled Students', icon: ShieldAlert, c: AMBER, to: '/mgmt/disabled-students' },
    { n: stats.behaviorIncidents, label: 'Behavior Records', icon: ShieldAlert, c: PURPLE, to: '/mgmt/behavior-records' },
    { n: stats.houses, label: 'Houses', icon: Home, c: BLUE, to: '/mgmt/student-houses' },
    { n: stats.categories, label: 'Categories', icon: Tags, c: AMBER, to: '/mgmt/student-categories' },
  ] : [];
  return (
    <PageLayout title="Student Dashboard" subtitle="Overview of your student body">
      {!stats ? (
        <div style={{ padding: '50px 0', textAlign: 'center', color: MUTED2 }}><Loader2 size={20} style={{ animation: 'spin .8s linear infinite' }} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
          {cards.map((c) => (
            <div key={c.label} onClick={() => navigate(c.to)} style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '18px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: `${c.c}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <c.icon size={19} color={c.c} />
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: INK, fontFamily: FONT }}>{c.n ?? 0}</div>
                <div style={{ fontSize: 12, color: MUTED2, fontFamily: FONT }}>{c.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}

/* ── Student Admission (create-first) ─────────────────────────────── */
export function StudentAdmissionPage() {
  return <ResourcePage title="Student Admission" subtitle="Admit a new student" resource="students"
    columns={STUDENT_COLUMNS} fields={STUDENT_FIELDS} searchKeys={STUDENT_SEARCH}
    createLabel="Admit Student" startOpen listFilters={[CLASS_FILTER]} />;
}

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
      { key: 'severity', label: 'Severity', render: (r) => STATUS_PILL(r.severity, { low: { c: GREEN }, medium: { c: AMBER }, high: { c: RED } }) },
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
      { key: 'record_type', label: 'Type', render: (r) => STATUS_PILL(r.record_type, { allergy: { c: RED }, condition: { c: AMBER }, vaccination: { c: GREEN }, checkup: { c: BLUE } }) },
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
