import { apiGet, apiPatch } from '../services/api.js';

export function useStatsAPI() {
  const getStats    = () => apiGet('/api/instructor/stats');
  const getProfile  = () => apiGet('/api/instructor/profile');
  const updateAgent = (data) => apiPatch('/api/instructor/profile/agent', data);
  return { getStats, getProfile, updateAgent };
}
