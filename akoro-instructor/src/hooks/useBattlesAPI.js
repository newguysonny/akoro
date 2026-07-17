import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from '../services/api.js';

export function useBattlesAPI() {
  const getBattles   = (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiGet(`/api/instructor/battles${q ? '?' + q : ''}`);
  };
  const createBattle = (data) => apiPost('/api/instructor/battles', data);
  const updateBattle = (id, data) => apiPatch(`/api/instructor/battles/${id}`, data);

  // ── Question bank (per course) ──────────────────────────────────────────
  const getQuestionBank    = (courseId) => apiGet(`/api/battle/courses/${courseId}/questions-bank`);
  const addBankQuestion    = (courseId, data) => apiPost(`/api/battle/courses/${courseId}/questions-bank`, data);
  const updateBankQuestion = (id, data) => apiPut(`/api/battle/questions-bank/${id}`, data);
  const deleteBankQuestion = (id) => apiDelete(`/api/battle/questions-bank/${id}`);
  const generateBank       = (courseId, data) => apiPost(`/api/battle/courses/${courseId}/questions-bank/generate`, data);

  return {
    getBattles, createBattle, updateBattle,
    getQuestionBank, addBankQuestion, updateBankQuestion, deleteBankQuestion, generateBank,
  };
}
