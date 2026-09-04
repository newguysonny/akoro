import { apiGet, apiPost, apiDelete } from '../services/api.js';
import { API } from '../constants.js';

export function useStudentsAPI() {
  // School-scoped: all students across the school's classrooms.
  const getStudents = async () => {
    const res = await apiGet('/api/school/students');
    const rows = (res?.data || []).map((r) => ({
      ...r,
      fullName:        r.full_name,
      coursesEnrolled: r.course_count || 0,
      enrollmentId:    r.id,
    }));
    return { data: rows };
  };

  const addStudent = (data) =>
    apiPost('/api/instructor/students', data);

  const removeStudent = (id) =>
    apiDelete(`/api/instructor/students/${id}`);

  const generateInvite = ({ courseIds = [], expiresInDays = 7, emails = [] }) =>
    apiPost('/api/profiles/teacher/invite', {
      course_ids: courseIds,
      expires_in_days: Number(expiresInDays),
      send_to_emails: emails,
    });

  const importCSV = async (file, courseId, classroomId) => {
    const form = new FormData();
    form.append('csv', file);           // backend expects field name "csv"
    if (courseId)    form.append('course_id', courseId);
    if (classroomId) form.append('classroom_id', classroomId);
    const res = await fetch(`${API}/api/profiles/teacher/students/import`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Akoro-Portal': 'school' },
      body: form,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || json.message || 'Import failed');
    return json;
  };

  return { getStudents, addStudent, removeStudent, generateInvite, importCSV };
}
