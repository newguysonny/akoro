/**
 * Teacher-scoped Student Information pages. Students the teacher added are
 * mirrored into the school SIS with created_by = the teacher, so the list is
 * scoped to created_by. Attendance / behavior use the shared mgmt resources.
 */
import ResourcePage from '../../components/mgmt/ResourcePage.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';

const GENDER_OPTS = [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }];
const STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'alumni', label: 'Alumni' }];

// Student list — only students this teacher added (created_by = me).
export function StudentListPage() {
  const { user } = useAuth();
  if (!user?.id) return null;
  return <ResourcePage title="My Students" subtitle="Students you've added" resource="students"
    fixedFilters={{ created_by: user.id }}
    columns={[
      { key: 'admission_no', label: 'Adm. No' },
      { key: 'first_name', label: 'First' }, { key: 'last_name', label: 'Last' },
      { key: 'class_name', label: 'Class' }, { key: 'status', label: 'Status' }, { key: 'is_disabled', label: 'Disabled' },
    ]}
    fields={[
      { key: 'admission_no', label: 'Admission No', required: true, placeholder: 'e.g. 2026-001' },
      { key: 'first_name', label: 'First Name', required: true },
      { key: 'last_name', label: 'Last Name', required: true },
      { key: 'gender', label: 'Gender', type: 'select', options: GENDER_OPTS },
      { key: 'dob', label: 'Date of Birth', type: 'date' },
      { key: 'class_id', label: 'Class', type: 'select', optionsFrom: { resource: 'classes' } },
      { key: 'section_id', label: 'Section', type: 'select', optionsFrom: { resource: 'sections' } },
      { key: 'guardian_name', label: 'Guardian Name' },
      { key: 'guardian_phone', label: 'Guardian Phone' },
      { key: 'student_email', label: 'Student Email' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTS, default: 'active' },
      { key: 'is_disabled', label: 'Disabled (no access)', type: 'toggle' },
      { key: 'disability_note', label: 'Reason (if disabled)', type: 'textarea' },
    ]}
    listFilters={[
      { key: 'class_id', label: 'Class', optionsFrom: { resource: 'classes' } },
      { key: 'status', label: 'Status', options: STATUS_OPTS },
      { key: 'is_disabled', label: 'Disabled', options: [{ value: 'true', label: 'Disabled' }, { value: 'false', label: 'Active' }] },
    ]}
    createLabel="Add Student" />;
}

export function StudentAttendancePage() {
  return <ResourcePage title="Student Attendance" subtitle="Mark and review attendance" resource="student-attendance"
    columns={[{ key: 'student_name', label: 'Student' }, { key: 'date', label: 'Date' }, { key: 'status', label: 'Status' }, { key: 'note', label: 'Note' }]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: { resource: 'students', labelKey: 'first_name' } },
      { key: 'date', label: 'Date', type: 'date', required: true },
      { key: 'status', label: 'Status', type: 'select', options: [{ value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' }, { value: 'late', label: 'Late' }, { value: 'excused', label: 'Excused' }], default: 'present' },
      { key: 'note', label: 'Note', type: 'textarea' },
    ]}
    listFilters={[
      { key: 'student_id', label: 'Student', optionsFrom: { resource: 'students', labelKey: 'first_name' } },
      { key: 'status', label: 'Status', options: [{ value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' }, { value: 'late', label: 'Late' }] },
    ]}
    createLabel="Mark Attendance" />;
}

export function BehaviorRecordsPage() {
  return <ResourcePage title="Behavior Records" subtitle="Log positive and negative behavior" resource="behavior-records"
    columns={[{ key: 'student_name', label: 'Student' }, { key: 'incident_type', label: 'Incident' }, { key: 'polarity', label: 'Type' }, { key: 'severity', label: 'Severity' }, { key: 'recorded_on', label: 'Date' }]}
    fields={[
      { key: 'student_id', label: 'Student', type: 'select', required: true, optionsFrom: { resource: 'students', labelKey: 'first_name' } },
      { key: 'incident_type', label: 'Incident', required: true, placeholder: 'e.g. Helped a classmate' },
      { key: 'polarity', label: 'Type', type: 'select', options: [{ value: 'positive', label: 'Positive' }, { value: 'negative', label: 'Negative' }], default: 'positive' },
      { key: 'severity', label: 'Severity', type: 'select', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }] },
      { key: 'points', label: 'Points', placeholder: '±5' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'action_taken', label: 'Action Taken', type: 'textarea' },
      { key: 'recorded_on', label: 'Date', type: 'date' },
    ]}
    listFilters={[
      { key: 'student_id', label: 'Student', optionsFrom: { resource: 'students', labelKey: 'first_name' } },
      { key: 'polarity', label: 'Type', options: [{ value: 'positive', label: 'Positive' }, { value: 'negative', label: 'Negative' }] },
    ]}
    createLabel="New Record" />;
}
