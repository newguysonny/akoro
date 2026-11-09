/**
 * lib/scheduleInterval.js — one unit model for every repeat: second, minute,
 * hour, day, week, month, year. Both repeating reminders (scheduled chat
 * messages) and repeating tasks use this, so "every 15 minutes", "every 2
 * hours", "every 3 days", "weekly", "yearly" all speak the same language and
 * are stored canonically as SECONDS.
 *
 * PURE: no db, no clock.
 */
export const UNIT_SECONDS = Object.freeze({
  second: 1,
  minute: 60,
  hour: 3_600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000,   // 30 days
  year: 31_536_000,   // 365 days
});

/** "minutes"/"MINUTE" → "minute"; unknown → null. */
export function normalizeUnit(unit) {
  const s = String(unit ?? "").trim().toLowerCase().replace(/s$/, "");
  return UNIT_SECONDS[s] ? s : null;
}

/** every N units → seconds, or null if invalid. */
export function intervalSeconds(every, unit) {
  const n = Number(every);
  const u = normalizeUnit(unit ?? "day");
  if (!u || !Number.isFinite(n) || n < 1) return null;
  return Math.round(n * UNIT_SECONDS[u]);
}

/** One auto-send/spawn cannot be more frequent than this — a 1-second chat ping is spam. */
export const MIN_INTERVAL_SECONDS = 60;
export const MAX_INTERVAL_SECONDS = UNIT_SECONDS.year;
/** Cap the number of occurrences a single series may queue/regenerate. */
export const MAX_OCCURRENCES = 1_000;

/** Clamp a series: at most `days` and at most MAX_OCCURRENCES sends. → spanMs */
export function seriesSpanMs({ everySeconds, days, dayMs = 86_400_000 }) {
  const byDays = Math.max(1, Number(days) || 1) * dayMs;
  const byCount = Math.max(1, everySeconds || MIN_INTERVAL_SECONDS) * 1_000 * MAX_OCCURRENCES;
  return Math.min(byDays, byCount);
}
