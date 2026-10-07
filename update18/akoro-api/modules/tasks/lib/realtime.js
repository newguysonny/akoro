/**
 * modules/tasks/lib/realtime.js
 * Real-time event delivery adapted for akoro-api.
 * Uses Socket.io (global.io) instead of Pusher — no extra dependency.
 * Teachers subscribe to user:<teacherId> room on login.
 */

export function teacherChannel(teacherId) { return `user:${teacherId}`; }

export async function pushToTeacher(teacherId, event, payload) {
  try {
    global.io?.to(teacherChannel(teacherId)).emit(event, payload);
  } catch (err) {
    console.error(`[realtime] Failed to push "${event}" to teacher ${teacherId}:`, err.message);
  }
}
