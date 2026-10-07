import { apiGet, apiPatch } from '../services/api.js';

export function useStatsAPI() {
  // School-scoped stats, normalised to the dashboard's field names.
  const getStats = async () => {
    const res = await apiGet('/api/school/stats');
    const d = res?.data || {};
    return { data: {
      total_students:    d.students     || 0,
      total_courses:     d.courses      || 0,
      active_courses:    d.courses      || 0,
      total_instructors: d.instructors  || 0,
      total_classrooms:  d.classrooms   || 0,
    } };
  };
  const getProfile  = () => apiGet('/api/instructor/profile');
  // The school's dedicated agent (chat + training operate on this).
  const getAgent    = () => apiGet('/api/school/agent');
  const updateAgent = (data) => apiPatch('/api/school/agent', data);
  return { getStats, getProfile, getAgent, updateAgent };
}
