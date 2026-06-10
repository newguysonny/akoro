import { apiGet, apiPost, apiDelete } from '../services/api.js';

export function useStudentsAPI() {
  const getStudents = (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiGet(`/api/instructor/students${q ? '?' + q : ''}`);
  };
  const addStudent    = (data) => apiPost('/api/instructor/students', data);
  const removeStudent = (id) => apiDelete(`/api/instructor/students/${id}`);
  return { getStudents, addStudent, removeStudent };
}
