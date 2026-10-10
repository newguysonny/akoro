/*
 * activitySocket — one lazily-created socket for the learner's user room.
 *
 * Any authenticated socket.io connection is joined to `user:<id>` on the
 * server, so a single background connection receives everything addressed to
 * this learner — today the "ding, new assignment" event
 * (self_study_assigned), tomorrow battle invites and live-course reminders.
 *
 * Surfaces open their own session sockets (teaching, battles); this one is
 * ONLY for ambient announcements, so it stays connected quietly across tabs.
 */
import { io } from 'socket.io-client';
import { API } from './api.js';

let socket = null;
const listeners = new Set();        // self_study_assigned — a new activity
const gradedListeners = new Set();  // activity_graded — { assignmentId, grade }

const fire = (set, payload) => set.forEach((l) => { try { l(payload); } catch { /* one bad listener never kills the rest */ } });

function ensureSocket() {
  if (socket) return true;
  const connect = io || (typeof window !== 'undefined' ? window.io : null);
  if (!connect) return false;
  socket = connect(API, { transports: ['websocket', 'polling'], withCredentials: true });
  socket.on('self_study_assigned', (payload) => fire(listeners, payload));
  socket.on('activity_graded', (payload) => fire(gradedListeners, payload));
  return true;
}

export function onActivityEvent(cb) {
  if (!ensureSocket()) return () => {};
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** A teacher published a grade — the open activity page reloads it. */
export function onActivityGraded(cb) {
  if (!ensureSocket()) return () => {};
  gradedListeners.add(cb);
  return () => gradedListeners.delete(cb);
}

export default { onActivityEvent, onActivityGraded };
