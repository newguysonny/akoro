/**
 * battle/seriesCore.js — the rules of a recurring battle series, PURE (no db,
 * no queue), so they are testable (reference/Akoro Battles — Model.md).
 *
 * A series repeats on days of the week at one time, in the creator's time
 * zone, until an end date and time. Each occurrence is its own battle, made
 * SERIES.LEAD_MS before it starts (questions are built then, and it appears in
 * the Battles tab of everyone in it). Everyone invited to the series is in
 * every occurrence unless they opt out of the series or skip that one.
 */

export const SERIES = Object.freeze({
  LEAD_MS: 60 * 60_000,          // an occurrence is made an hour before it starts
  POST_LEAD_MS: 12 * 3600_000,   // an open challenge post goes up 12 hours before (people need time to find it)
  MAX_DAYS: 366,                 // a series ends within a year
  DEFAULT_TZ: "Africa/Lagos",
});

const fail = (message) => Object.assign(new Error(message), { status: 400 });

const validTz = (tz) => {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; }
};

/** PURE: a client's { days, time, tz, until } → the stored rule, or throws a 400 saying what is wrong. */
export function cleanRepeat(repeat, now = Date.now()) {
  if (!repeat || typeof repeat !== "object") throw fail("Say when it repeats: days of the week, a time and an end date.");
  const days = [...new Set((Array.isArray(repeat.days) ? repeat.days : []).map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (!days.length) throw fail("Pick at least one day of the week for it to repeat on.");
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(repeat.time || "").trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw fail("Give the time it starts, like 16:00.");
  const time = `${m[1].padStart(2, "0")}:${m[2]}`;
  const tz = repeat.tz && validTz(repeat.tz) ? repeat.tz : SERIES.DEFAULT_TZ;
  const until = new Date(repeat.until || "");
  if (Number.isNaN(until.getTime())) throw fail("Give the date and time the series ends.");
  if (until.getTime() <= now) throw fail("The end date has already passed.");
  if (until.getTime() > now + SERIES.MAX_DAYS * 86400_000) throw fail("A series can run for up to a year.");
  return { days, time, tz, until: until.toISOString() };
}

/** The wall-clock parts of an instant in a time zone. */
function partsIn(ms, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd };
}

/** PURE: the instant a wall-clock time in a time zone falls on (two passes settle a DST edge). */
export function zonedToUtc(y, mo, d, h, mi, tz) {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let ms = want;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(ms, tz);
    ms += want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  }
  return ms;
}

/** PURE: the first start strictly after `afterMs` that the rule allows, or null when the series is over. */
export function nextOccurrence(rule, afterMs) {
  const until = new Date(rule.until).getTime();
  const [h, mi] = String(rule.time).split(":").map(Number);
  const today = partsIn(afterMs, rule.tz);
  for (let i = 0; i <= 8; i++) {
    // Calendar arithmetic on the local date; the weekday comes from that date.
    const day = new Date(Date.UTC(today.y, today.mo - 1, today.d + i));
    if (!rule.days.includes(day.getUTCDay())) continue;
    const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, mi, rule.tz);
    if (at <= afterMs) continue;
    return at <= until ? at : null;
  }
  return null;
}

/** PURE: when the occurrence starting at startMs is made (never in the past). */
export const makeAt = (startMs, now = Date.now(), lead = SERIES.LEAD_MS) => Math.max(now, startMs - lead);

/** PURE: how far ahead a series makes its occurrences: a post needs finding; an invite only needs its questions. */
export const leadOf = (s) => (s?.scope === "network" && s?.template?.post ? SERIES.POST_LEAD_MS : SERIES.LEAD_MS);

/** PURE: the queue job id of one occurrence (one per start, so a repeat release is a no-op). */
export const occurrenceJobId = (seriesId, startMs) => `series-${seriesId}-${startMs}`;

/** PURE: who plays the occurrence at startMs: in the series, not opted out, not skipping it. */
export function playersFor(members, startMs) {
  const at = new Date(startMs).getTime();
  return (members || []).filter((m) => !m.opted_out_at
    && !(m.skips || []).some((s) => new Date(s).getTime() === at)).map((m) => m.user_id);
}

/** PURE: the parts of a battle's settings a series repeats (not who, not when). */
export function seriesTemplate(body = {}, extra = []) {
  const keep = ["title", "description", "subject", "topic", "difficulty", "total_questions",
    "time_limit_seconds", "xp_prize", "question_source", "hp_per_miss", "min_xp", "expires_in_minutes", ...extra];
  return Object.fromEntries(keep.filter((k) => body[k] !== undefined && body[k] !== null).map((k) => [k, body[k]]));
}

const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The extra settings a network invite or post repeats (battle/networkBattle.js, agent-network/challenges.js). */
export const NETWORK_KEYS = ["kind", "exam", "seconds_per_question", "max_players", "scope", "scope_id", "max_xp", "note", "teams", "post"];

/** PURE: the battle_type a series' card shows. */
export function seriesCardType(s, players, creatorIsTeacher) {
  const t = s.template || {};
  if (s.scope === "network") return t.post ? "open" : t.kind === "team" ? "team" : t.kind === "group" ? "classroom" : "1v1";
  return players <= 2 && !creatorIsTeacher ? "1v1" : "classroom";
}

/** PURE: "Mon, Thu at 16:00 until 12 Dec" for notifications. */
export function ruleText(rule) {
  const until = new Date(rule.until).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: rule.tz });
  return `${rule.days.map((d) => DAY_NAME[d]).join(", ")} at ${rule.time} until ${until}`;
}
