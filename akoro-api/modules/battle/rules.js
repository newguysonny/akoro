/**
 * battle/rules.js — the pure rules behind the battle routes: deadlines,
 * scheduling windows and what a set of seats means. No db, no Express, no
 * socket: everything here is a function of its arguments, so a route's timing
 * can be reasoned about (and tested) without a database.
 */

/** How long AFTER a scheduled battle's start time the expiry job runs. */
export const EXPIRE_AFTER_START_MS = 10_000;

/**
 * How long an unscheduled invitation stays open (BATTLE_IDLE_HOURS, default 48h).
 * Read once at module load, as the routes always did.
 */
export const IDLE_HOURS = Math.max(1, Number(process.env.BATTLE_IDLE_HOURS ?? 48) || 48);

export const idleDeadline = (at = Date.now()) =>
  new Date(at + IDLE_HOURS * 3600_000).toISOString();

/**
 * When does an invitation stop being acceptable?
 *
 * A SCHEDULED battle: the moment it starts. There is nothing to accept after
 * that, and the start time is a deadline the teacher actually chose.
 *
 * An UNSCHEDULED battle: after BATTLE_IDLE_HOURS (idleDeadline), when it runs
 * with whoever accepted or expires. An invitation with no fixed start has no
 * natural deadline, so it waits until it is answered.
 *
 * NULL means no deadline. Every reader must be null-safe: `new Date(null)` is
 * the epoch, so a naive `< new Date()` marks an open invitation expired.
 */
export const acceptDeadline = (scheduledFor) => {
  if (!scheduledFor) return null;
  const at = new Date(scheduledFor);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

/** Has an invitation with a deadline passed? No deadline never has. */
export const deadlinePassed = (expiresAt, at = Date.now()) =>
  !!expiresAt && new Date(expiresAt) < new Date(at);

/** A start time in the future — what makes a battle "scheduled". */
export const isFuture = (value, at = Date.now()) => !!value && new Date(value) > new Date(at);

/** Milliseconds until a battle's accept window closes, plus the ordering gap. */
export const expiryDelay = (expiresAt, at = Date.now()) =>
  Math.max(0, new Date(expiresAt).getTime() - at + EXPIRE_AFTER_START_MS);

/** Milliseconds until a scheduled start (never negative). */
export const startDelay = (scheduledFor, at = Date.now()) =>
  Math.max(0, new Date(scheduledFor).getTime() - at);

/** Seconds left on an invitation, or null when it has no deadline. */
export const expiresInSeconds = (expiresAt, at = Date.now()) =>
  expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - at) / 1000)) : null;

export const fmtDuration = (secs) =>
  `${String(Math.floor((secs ?? 0) / 60)).padStart(2, "0")}:${String((secs ?? 0) % 60).padStart(2, "0")}`;

/**
 * What a battle's seats say: invitations still unanswered, players who will
 * actually compete (accepted, not declined, teacher excluded) and everyone who
 * was invited as a participant. The worker counts the same way.
 */
export function seatSummary(seats) {
  const all = seats ?? [];
  const invited = all.filter((s) => s.role === "participant");
  return {
    invited,
    answered: invited.every((s) => s.joined_at || s.declined_at),
    players: all.filter((s) => s.role !== "teacher" && s.joined_at && !s.declined_at).length,
  };
}

/** The fields a battle may be edited with (PUT /battles/:id). */
export const EDITABLE_BATTLE_FIELDS = Object.freeze([
  "title", "description", "topic", "subject", "difficulty", "xp_prize", "xp_pool",
  "time_limit_seconds", "total_questions", "max_participants", "scheduled_start",
  "hp_per_miss", "min_xp",
]);
