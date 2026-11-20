/**
 * modules/autonomy/cycleTime.js — the cycle's clock arithmetic, extracted from
 * cycle.js: quiet hours in Africa/Lagos, the streak count and title
 * normalisation. Pure; no db.
 */

export const LAGOS = "Africa/Lagos";

const minutesInLagos = (date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
};

/** Is this instant inside quiet hours (Africa/Lagos)? */
export function inQuietHoursAt(date, startMin, endMin) {
  const mins = minutesInLagos(date);
  return mins >= startMin || mins < endMin;
}

/** Next instant outside quiet hours (Lagos is fixed UTC+1, no DST). */
export function outsideQuietHoursAt(date, startMin, endMin) {
  if (!inQuietHoursAt(date, startMin, endMin)) return date.toISOString();
  // evening (≥20:00) shifts to tomorrow 07:30; early morning shifts to today 07:30
  const evening = minutesInLagos(date) >= startMin;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: LAGOS, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(evening ? new Date(date.getTime() + 24 * 3600 * 1000) : date);
  return `${day}T07:30:00+01:00`;
}

export const normalizeTitle = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Consecutive-day streak ending today (or yesterday, grace), computed from
 * completion timestamps — the same honest algorithm as /api/self-study/streak
 * (it can never show a number the learner did not earn).
 */
export function streakOf(completedAtDays, today = new Date()) {
  const days = new Set(completedAtDays);
  const key = (d) => d.toISOString().slice(0, 10);
  const cursor = new Date(today);
  if (!days.has(key(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1); // grace
  let streak = 0;
  while (days.has(key(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
