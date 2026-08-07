import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.js';

export function useBattlesAPI() {
  // "Everything I run or take part in" — course-independent, so the page can
  // load before a course has been picked.
  const getBattles = () => apiGet('/api/battle/my-battles');

  // Roster for the "who do you want to challenge?" picker.
  const getRoster  = (courseId) => apiGet(`/api/battle/courses/${courseId}/roster`);

  // One creation path for a duel, a handful of learners, or the whole class:
  // the backend picks 1v1 vs classroom from how many targets resolve.
  const createBattle = (courseId, data) =>
    apiPost(`/api/battle/courses/${courseId}/battles/invite`, data);

  const updateBattle = (id, data) => apiPut(`/api/battle/battles/${id}`, data);
  // Starting is its own endpoint — it queues the worker, it isn't a status write.
  const startBattle  = (id) => apiPost(`/api/battle/battles/${id}/start`, {});
  // Real delete (participants/questions cascade). ?cancel=1 keeps the record.
  const deleteBattle = (id) => apiDelete(`/api/battle/battles/${id}`);
  const cancelBattle = (id) => apiDelete(`/api/battle/battles/${id}?cancel=1`);

  return { getBattles, getRoster, createBattle, updateBattle, startBattle, deleteBattle, cancelBattle };
}
