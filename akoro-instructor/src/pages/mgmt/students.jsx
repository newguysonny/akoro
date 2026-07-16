/**
 * Teacher-scoped Student Information pages. Students the teacher added are
 * mirrored into the school SIS with created_by = the teacher, so the list is
 * scoped to created_by. Attendance / behavior use the shared mgmt resources.
 */
import ResourcePage from '../../components/mgmt/ResourcePage.jsx';

// NOTE: "My Students" (add/list/disable, with Manual Entry / Send Invite /
// Import CSV) is served by the full StudentsPage under /mgmt/students. These
// pages cover the SIS-side records that page doesn't: attendance + behavior.

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
