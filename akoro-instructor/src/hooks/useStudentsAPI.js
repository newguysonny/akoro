import { apiGet, apiPost, apiDelete } from '../services/api.js';
import { API } from '../constants.js';

export function useStudentsAPI() {
  const getStudents = (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiGet(`/api/instructor/students${q ? '?' + q : ''}`);
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
      headers: { 'X-Akoro-Portal': 'instructor' },
      body: form,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || json.message || 'Import failed');
    return json;
  };

  return { getStudents, addStudent, removeStudent, generateInvite, importCSV };
}
