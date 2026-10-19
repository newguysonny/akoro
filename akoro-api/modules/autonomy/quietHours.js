/**
 * modules/autonomy/quietHours.js — the learner's own quiet hours, in their
 * own time zone (Grand Plan §7.16.7). Pure: no db.
 *
 *   quietOf(row, fallbackTz)            → { timeZone, start, end } from the autonomy row
 *   inQuiet(date, quiet)                → is this instant inside their quiet hours?
 *   afterQuiet(date, quiet)             → the first instant outside them (ISO)
 *   localMinutes(date, timeZone)        → minutes since their midnight
 *
 * Default: Africa/Lagos 20:00–07:30 (the locked default, plan §9.2). A window
 * may cross midnight (20:00–07:30) or not (13:00–15:00); start = end = none.
 */
export const DEFAULT_QUIET = Object.freeze({ timeZone: "Africa/Lagos", start: "20:00", end: "07:30" });

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const validHHMM = (s) => HHMM.test(String(s || ""));
const minutesOf = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };

export function validTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }).format(new Date()); return true; } catch { return false; }
}

export function quietOf(row = {}, fallbackTz = null) {
  const timeZone = [row?.time_zone, fallbackTz, DEFAULT_QUIET.timeZone].find(validTimeZone);
  return {
    timeZone,
    start: validHHMM(row?.quiet_start) ? row.quiet_start : DEFAULT_QUIET.start,
    end: validHHMM(row?.quiet_end) ? row.quiet_end : DEFAULT_QUIET.end,
  };
}

export function localMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function inQuiet(date, quiet = DEFAULT_QUIET) {
  const s = minutesOf(quiet.start), e = minutesOf(quiet.end);
  if (s === e) return false;
  const now = localMinutes(date, quiet.timeZone || DEFAULT_QUIET.timeZone);
  return s < e ? now >= s && now < e : now >= s || now < e;
}

/** The first minute after quiet hours end (to the minute; a DST jump can shift it by an hour, never into quiet). */
export function afterQuiet(date, quiet = DEFAULT_QUIET) {
  if (!inQuiet(date, quiet)) return date.toISOString();
  const now = localMinutes(date, quiet.timeZone || DEFAULT_QUIET.timeZone);
  const wait = (minutesOf(quiet.end) - now + 1440) % 1440;
  const at = new Date(date.getTime() + wait * 60_000);
  at.setUTCSeconds(0, 0);
  return inQuiet(at, quiet) ? new Date(at.getTime() + 3_600_000).toISOString() : at.toISOString();
}
