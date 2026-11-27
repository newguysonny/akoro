import { useMemo } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../services/api.js';

export function useCoursesAPI() {
  const getCourses    = () => apiGet('/api/school/courses');   // school-scoped: all instructors' courses
  const createCourse  = (data) => apiPost('/api/school/courses', data);
  const updateCourse  = (id, data) => apiPatch(`/api/school/courses/${id}`, data);
  const deleteCourse  = (id) => apiDelete(`/api/school/courses/${id}`);
  const getSessions   = (courseId) => apiGet(`/api/school/sessions${courseId ? '?courseId=' + courseId : ''}`);
  const createSession = (data) => apiPost('/api/school/sessions', data);
  const updateSession = (id, data) => apiPatch(`/api/school/sessions/${id}`, data);
  const deleteSession = (id) => apiDelete(`/api/school/sessions/${id}`);

  // Modules + recurrence schedule
  const getModules      = (courseId) => apiGet(`/api/school/courses/${courseId}/modules`);
  const createModule    = (courseId, data) => apiPost(`/api/school/courses/${courseId}/modules`, data);
  const updateModule    = (id, data) => apiPatch(`/api/school/modules/${id}`, data);
  const deleteModule    = (id) => apiDelete(`/api/school/modules/${id}`);
  const previewSchedule = (courseId, spec) => apiPost(`/api/school/courses/${courseId}/schedule/preview`, spec);
  const commitSchedule  = (courseId, payload) => apiPost(`/api/school/courses/${courseId}/schedule/commit`, payload);
  const commitCurriculum = (courseId, payload) => apiPost(`/api/school/courses/${courseId}/curriculum`, payload);

  // Session materials
  const getMaterials    = (sessionId) => apiGet(`/api/school/sessions/${sessionId}/materials`);
  const addMaterial     = (sessionId, data) => apiPost(`/api/school/sessions/${sessionId}/materials`, data);
  const deleteMaterial  = (id) => apiDelete(`/api/school/materials/${id}`);

  return useMemo(() => ({
    getCourses, createCourse, updateCourse, deleteCourse,
    getSessions, createSession, updateSession, deleteSession,
    getModules, createModule, updateModule, deleteModule, previewSchedule, commitSchedule, commitCurriculum,
    getMaterials, addMaterial, deleteMaterial,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
}
