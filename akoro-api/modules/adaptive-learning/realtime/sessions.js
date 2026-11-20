// Live teaching sessions and the reap grace window that bounds them.

import { SESSION_REAP_GRACE_MS } from "./rules.js";

export const activeSessions = new Map();

const sessionReapTimers = new Map();   // sessionId → timeout

export function cancelSessionReap(sessionId) {
  const t = sessionReapTimers.get(sessionId);
  if (t) { clearTimeout(t); sessionReapTimers.delete(sessionId); }
}

export function scheduleSessionReap(sessionId) {
  cancelSessionReap(sessionId);
  const t = setTimeout(() => {
    sessionReapTimers.delete(sessionId);
    if (activeSessions.has(sessionId)) {
      activeSessions.delete(sessionId);
      console.log(`[session reap] ${sessionId} removed after ${SESSION_REAP_GRACE_MS / 1000}s grace`);
    }
  }, SESSION_REAP_GRACE_MS);
  if (t.unref) t.unref();   // don't keep the process alive for a reap timer
  sessionReapTimers.set(sessionId, t);
}
