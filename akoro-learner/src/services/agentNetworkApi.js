/*
 * agentNetworkApi — learners' agents finding, messaging and challenging each
 * other (API: /api/agent-network). Most of this is used by the Agent Chat's
 * tools on the server; the app calls these for presence, privacy settings and
 * the agent cards' buttons.
 */
import { apiGet, apiPost, apiPut, apiDelete } from './api.js';

const data = (d) => d?.data ?? d ?? null;

/* "I'm here" — sent about once a minute while the app is open. */
export const sendHeartbeat = (surface = 'app') => apiPost('/api/agent-network/heartbeat', { surface }).catch(() => null);
export const fetchOnlineCount = () => apiGet('/api/agent-network/online-count', { cache: false }).then((d) => data(d)?.online ?? 0);

export const searchAgents = (filters = {}) => {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  return apiGet(`/api/agent-network/search?${q}`, { cache: false }).then(data);
};

export const fetchNetworkSettings = () => apiGet('/api/agent-network/settings', { cache: false }).then(data);
export const saveNetworkSettings = (patch) => apiPut('/api/agent-network/settings', patch).then(data);
export const fetchBlocked = () => apiGet('/api/agent-network/blocks', { cache: false }).then((d) => data(d)?.blocked ?? []);
export const blockAgent = (userId) => apiPost('/api/agent-network/blocks', { userId }).then(data);
export const unblockAgent = (userId) => apiDelete(`/api/agent-network/blocks/${userId}`).then(data);
export const reportAgent = (userId, reason, context = null) => apiPost('/api/agent-network/reports', { userId, reason, context }).then(data);
export const fetchPastQuestionSummary = () => apiGet('/api/agent-network/past-questions', { cache: false }).then((d) => data(d)?.summary ?? []);

/* Challenges and challenge requests. */
export const challengeAgents = (body) => apiPost('/api/agent-network/challenges', body).then(data);
export const fetchChallengeRequests = (filters = {}) => {
  const q = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  return apiGet(`/api/agent-network/challenge-requests?${q}`, { cache: false }).then(data);
};
export const postChallengeRequest = (body) => apiPost('/api/agent-network/challenge-requests', body).then((d) => data(d)?.request ?? null);
export const acceptChallengeRequest = (id) => apiPost(`/api/agent-network/challenge-requests/${id}/accept`, {}).then(data);
export const cancelChallengeRequest = (id) => apiDelete(`/api/agent-network/challenge-requests/${id}`).then(data);
export const rematchBattle = (battleId) => apiPost(`/api/agent-network/battles/${battleId}/rematch`, {}).then(data);

/* Agent-to-agent messages. */
export const messageAgent = (body) => apiPost('/api/agent-network/messages', body).then(data);
export const fetchAgentInbox = ({ peek = false } = {}) => apiGet(`/api/agent-network/inbox${peek ? '?peek=1' : ''}`, { cache: false }).then(data);
export const replyToAgentMessage = (id, reply) => apiPost(`/api/agent-network/messages/${id}/reply`, { reply }).then(data);

/* Daily battle, weekly league, study buddies, revision circles. */
export const joinDaily = (body = {}) => apiPost('/api/agent-network/daily/join', body).then(data);
export const skipDaily = () => apiPost('/api/agent-network/daily/skip', {}).then(data);
export const fetchDailyRanking = (subject) => apiGet(`/api/agent-network/daily/ranking?subject=${encodeURIComponent(subject || '')}`, { cache: false }).then(data);
export const fetchWeeklyLeague = (scope = 'everyone') => apiGet(`/api/agent-network/league?scope=${scope}`, { cache: false }).then(data);
export const fetchBuddies = () => apiGet('/api/agent-network/buddies', { cache: false }).then(data);
export const fetchCircles = (filters = {}) => apiGet(`/api/agent-network/circles?${new URLSearchParams(filters)}`, { cache: false }).then(data);
export const joinCircle = (id) => apiPost(`/api/agent-network/circles/${id}/join`, {}).then(data);
export const fetchDailyStatus = () => apiGet('/api/agent-network/daily/status', { cache: false }).then(data);
