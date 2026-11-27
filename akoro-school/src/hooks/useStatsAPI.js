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
  // School-scoped sessions for the dashboard's "today's sessions". The
  // instructor endpoint (/api/instructor/sessions) is role-gated to
  // instructors and always 403s for a school admin.
  const getSchoolSessions = () => apiGet('/api/school/sessions');
  // The school's dedicated agent (chat + training operate on this).
  const getAgent    = () => apiGet('/api/school/agent');
  const updateAgent = (data) => apiPatch('/api/school/agent', data);
  return { getStats, getAgent, updateAgent, getSchoolSessions };
}
