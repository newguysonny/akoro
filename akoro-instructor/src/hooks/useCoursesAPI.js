import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';

export function useCoursesAPI() {
  const getCourses    = () => apiGet('/api/instructor/courses');
  const createCourse  = (data) => apiPost('/api/instructor/courses', data);
  const updateCourse  = (id, data) => apiPatch(`/api/instructor/courses/${id}`, data);
  const getSessions   = (courseId) => apiGet(`/api/instructor/sessions${courseId ? '?courseId=' + courseId : ''}`);
  const createSession = (data) => apiPost('/api/instructor/sessions', data);
  const updateSession = (id, data) => apiPatch(`/api/instructor/sessions/${id}`, data);
  const deleteSession = (id) => apiDelete(`/api/instructor/sessions/${id}`);
  return { getCourses, createCourse, updateCourse, getSessions, createSession, updateSession, deleteSession };
}
