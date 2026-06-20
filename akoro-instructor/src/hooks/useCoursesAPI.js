import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';

export function useCoursesAPI() {
  const getCourses    = () => apiGet('/api/instructor/courses');
  const createCourse  = (data) => apiPost('/api/instructor/courses', data);
  const updateCourse  = (id, data) => apiPatch(`/api/instructor/courses/${id}`, data);
  const deleteCourse  = (id) => apiDelete(`/api/instructor/courses/${id}`);
  const getSessions   = (courseId) => apiGet(`/api/instructor/sessions${courseId ? '?courseId=' + courseId : ''}`);
  const createSession = (data) => apiPost('/api/instructor/sessions', data);
  const updateSession = (id, data) => apiPatch(`/api/instructor/sessions/${id}`, data);
  const deleteSession = (id) => apiDelete(`/api/instructor/sessions/${id}`);

  // Modules + recurrence schedule
  const getModules      = (courseId) => apiGet(`/api/instructor/courses/${courseId}/modules`);
  const createModule    = (courseId, data) => apiPost(`/api/instructor/courses/${courseId}/modules`, data);
  const updateModule    = (id, data) => apiPatch(`/api/instructor/modules/${id}`, data);
  const deleteModule    = (id) => apiDelete(`/api/instructor/modules/${id}`);
  const previewSchedule = (courseId, spec) => apiPost(`/api/instructor/courses/${courseId}/schedule/preview`, spec);
  const commitSchedule  = (courseId, payload) => apiPost(`/api/instructor/courses/${courseId}/schedule/commit`, payload);
  const commitCurriculum = (courseId, payload) => apiPost(`/api/instructor/courses/${courseId}/curriculum`, payload);

  // Session materials
  const getMaterials    = (sessionId) => apiGet(`/api/instructor/sessions/${sessionId}/materials`);
  const addMaterial     = (sessionId, data) => apiPost(`/api/instructor/sessions/${sessionId}/materials`, data);
  const deleteMaterial  = (id) => apiDelete(`/api/instructor/materials/${id}`);

  return {
    getCourses, createCourse, updateCourse, deleteCourse,
    getSessions, createSession, updateSession, deleteSession,
    getModules, createModule, updateModule, deleteModule, previewSchedule, commitSchedule, commitCurriculum,
    getMaterials, addMaterial, deleteMaterial,
  };
}
