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

// conversationId (optional): the chat the card is in — the agent's wake posts its message there.
const inChat = (conversationId) => (conversationId ? { conversationId } : {});

export async function confirmStudyPrepPlan(sessionId, conversationId = null) {
  return apiPost(`${BASE}/sessions/${sessionId}/confirm`, inChat(conversationId));
}

export async function adjustStudyPrepPlan(sessionId, drop, { order = null, conversationId = null } = {}) {
  return apiPost(`${BASE}/sessions/${sessionId}/adjust`, { drop, ...(order ? { order } : {}), ...inChat(conversationId) });
}

/** The learner lets the plan go past its approved coins by a fixed amount (the card says how much). */
export async function approveMoreStudyPrepCoins(sessionId, conversationId = null) {
  return apiPost(`${BASE}/sessions/${sessionId}/approve-more`, inChat(conversationId));
}

export async function generateStudyPrepPractice(sessionId, topicId, mode) {
  return apiPost(`${BASE}/sessions/${sessionId}/topics/${topicId}/practice`, { mode });
}

export async function submitStudyPrepPractice(sessionId, topicId, answers) {
  return apiPost(`${BASE}/sessions/${sessionId}/topics/${topicId}/submit`, { answers });
}

export async function confirmStudyPrepTeachBack(sessionId, topicId, conversationId = null) {
  return apiPost(`${BASE}/sessions/${sessionId}/topics/${topicId}/teach-back-done`, inChat(conversationId));
}

/** Phase 6: confirm the teaching session offered after a missed Agent Check (it waits on the dashboard). */
export async function approveStudyPrepTeaching(sessionId, topicId, conversationId = null) {
  return apiPost(`${BASE}/sessions/${sessionId}/topics/${topicId}/teaching/approve`, inChat(conversationId));
}

export async function studyPrepNext(sessionId) {
  return apiPost(`${BASE}/sessions/${sessionId}/next`, {});
}

export async function advanceStudyPrepTopic(sessionId, conversationId = null) {
  return apiPost(`${BASE}/sessions/${sessionId}/advance`, inChat(conversationId));
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

/** The learner's answer to a strategy the agent offered: accepted runs it; false records a Reject. */
export async function answerStudyPrepStrategy(sessionId, topicId, strategy, accepted) {
  return apiPost(`${BASE}/sessions/${sessionId}/topics/${topicId}/strategy`, { strategy, accepted });
}

export async function cancelStudyPrepSession(sessionId) {
  return apiPost(`${BASE}/sessions/${sessionId}/cancel`, {});
}
