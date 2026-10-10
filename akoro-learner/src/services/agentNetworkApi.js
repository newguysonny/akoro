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
