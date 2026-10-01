/**
 * studyPrepApi.js — learner study-prep session data seam.
 *
 * Every call maps to one harness-owned REST endpoint under
 * /api/adaptive/study-prep. The page never constructs session state itself:
 * the harness is the sole writer, the envelope carries stable `code`s, and
 * answer keys never reach the client.
 */
import { apiGet, apiPost } from './api.js';

const BASE = '/api/adaptive/study-prep';

export async function startStudyPrepSession({ goal, subject, classLevel, examBoard }) {
  return apiPost(`${BASE}/sessions`, { goal, subject, classLevel, examBoard });
}

export async function fetchActiveStudyPrepSession() {
  return apiGet(`${BASE}/sessions`);
}

export async function fetchStudyPrepSession(sessionId) {
  return apiGet(`${BASE}/sessions/${sessionId}`);
}

export async function confirmStudyPrepPlan(sessionId) {
  return apiPost(`${BASE}/sessions/${sessionId}/confirm`, {});
}

export async function adjustStudyPrepPlan(sessionId, drop) {
  return apiPost(`${BASE}/sessions/${sessionId}/adjust`, { drop });
}

export async function generateStudyPrepPractice(sessionId, topicId, mode) {
  return apiPost(`${BASE}/sessions/${sessionId}/topics/${topicId}/practice`, { mode });
}

export async function submitStudyPrepPractice(sessionId, topicId, answers) {
  return apiPost(`${BASE}/sessions/${sessionId}/topics/${topicId}/submit`, { answers });
}

export async function confirmStudyPrepTeachBack(sessionId, topicId) {
  return apiPost(`${BASE}/sessions/${sessionId}/topics/${topicId}/teach-back-done`, {});
}

export async function studyPrepNext(sessionId) {
  return apiPost(`${BASE}/sessions/${sessionId}/next`, {});
}

export async function advanceStudyPrepTopic(sessionId) {
  return apiPost(`${BASE}/sessions/${sessionId}/advance`, {});
}

export async function deferStudyPrepTopic(sessionId, topicId, reasonCode) {
  return apiPost(`${BASE}/sessions/${sessionId}/defer`, { topicId, reasonCode });
}

export async function retryStudyPrepDeferred(sessionId, topicId) {
  return apiPost(`${BASE}/sessions/${sessionId}/retry-deferred`, { topicId });
}

export async function concludeStudyPrepSession(sessionId) {
  return apiPost(`${BASE}/sessions/${sessionId}/conclude`, {});
}

export async function pauseStudyPrepSession(sessionId) {
  return apiPost(`${BASE}/sessions/${sessionId}/pause`, {});
}

export async function resumeStudyPrepSession(sessionId) {
  return apiPost(`${BASE}/sessions/${sessionId}/resume`, {});
}

export async function cancelStudyPrepSession(sessionId) {
  return apiPost(`${BASE}/sessions/${sessionId}/cancel`, {});
}
