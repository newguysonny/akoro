import { apiGet, apiPost, apiPatch } from '../services/api.js';

export function useBattlesAPI() {
  const getBattles   = (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiGet(`/api/instructor/battles${q ? '?' + q : ''}`);
  };
  const createBattle = (data) => apiPost('/api/instructor/battles', data);
  const updateBattle = (id, data) => apiPatch(`/api/instructor/battles/${id}`, data);
  return { getBattles, createBattle, updateBattle };
}
