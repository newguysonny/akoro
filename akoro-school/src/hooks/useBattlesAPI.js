import { apiGet, apiPost, apiPut, apiDelete } from '../services/api.js';

export function useBattlesAPI() {
  // "Everything I run or take part in" — course-independent, so the page can
  // load before a course has been picked.
  const getBattles = () => apiGet('/api/battle/my-battles');

  // Roster for the "who do you want to challenge?" picker.
  const getRoster  = (courseId) => apiGet(`/api/battle/courses/${courseId}/roster`);

  // One creation path for a duel, a handful of learners, or the whole class:
  // the backend picks 1v1 vs classroom from how many targets resolve.
  // One creator for both kinds; the scope travels in the path. A course battle
  // takes its questions from that course's bank, a class battle from the
  // past-questions bank for the subject — the API decides, not the caller.
  // 'review' is class-scoped like 'class' — it draws its questions from a
  // class subject. The server tells them apart by `mode` in the body.
  const createBattle = ({ kind, courseId, classId, ...data }) =>
    kind === 'course'
      ? apiPost(`/api/battle/courses/${courseId}/battles/invite`, data)
      : apiPost(`/api/battle/classes/${classId}/battles/invite`, data);

  const getClasses = () => apiGet('/api/battle/my-classes');
  const getClassRoster = (classId) => apiGet(`/api/battle/classes/${classId}/roster`);

  const updateBattle = (id, data) => apiPut(`/api/battle/battles/${id}`, data);
  // Starting is its own endpoint — it queues the worker, it isn't a status write.
  const startBattle  = (id) => apiPost(`/api/battle/battles/${id}/start`, {});
  // Real delete (participants/questions cascade). ?cancel=1 keeps the record.
  const deleteBattle = (id) => apiDelete(`/api/battle/battles/${id}`);
  const cancelBattle = (id) => apiDelete(`/api/battle/battles/${id}?cancel=1`);

  return { getBattles, getRoster, getClasses, getClassRoster, createBattle, updateBattle, startBattle, deleteBattle, cancelBattle };
}
