/**
 * workers/sessionReminders.js — the pure rules of live-session reminders
 * (workers/sessionNotifier.js runs them).
 */

export const REMINDERS = [
  { type: "reminder_24h",   offsetMs: 24 * 60 * 60 * 1000 },
  { type: "reminder_1h",    offsetMs: 60 * 60 * 1000 },
  { type: "reminder_10min", offsetMs: 10 * 60 * 1000 },
];

/**
 * PURE: the reminders still ahead for a session starting at `start`.
 * The job id carries the start time, so a rescheduled session gets fresh
 * reminders (and the old ones are recognisably stale). → [{ type, delayMs, jobId }]
 */
export function reminderPlan(sessionId, start, now = Date.now()) {
  const startMs = new Date(start).getTime();
  if (!sessionId || !Number.isFinite(startMs)) return [];
  return REMINDERS
    .map(({ type, offsetMs }) => ({ type, delayMs: startMs - offsetMs - now, jobId: `${type}-${sessionId}-${startMs}` }))
    .filter((r) => r.delayMs > 0);
}

/** PURE: a reminder still applies only to a scheduled session that has not moved. → reason string | null */
export function staleReason(session, jobStart) {
  if (!session) return "session_deleted";
  if (session.status && session.status !== "scheduled") return `session_${session.status}`;
  if (jobStart && new Date(session.scheduled_start).getTime() !== new Date(jobStart).getTime()) return "session_rescheduled";
  return null;
}
