/** Input validation kept dependency-free so timing/timezone policy is testable. */
import { intervalSeconds, MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS, seriesSpanMs } from "../../lib/scheduleInterval.js";

const MIN_DELAY_MS = 60_000;
const MAX_DELAY_MS = 180 * 24 * 60 * 60 * 1000;
const ISO_WITH_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/i;
const TIME_ZONE_FALLBACK = "Africa/Lagos";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function limitedText(value, label, { required = false, max = 800 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

export function validateFollowUpInput(input = {}, { defaultTimezone = TIME_ZONE_FALLBACK } = {}) {
  const message = limitedText(input.message, "message", { required: true, max: 800 });
  const title = limitedText(input.title, "title", { max: 80 }) || "Scheduled check-in";
  // The caller supplies the authenticated learner's saved time zone. The
  // fallback preserves the platform's established Africa/Lagos default.
  // An older internal caller can omit defaultTimezone; never let Intl silently
  // fall back to the server's own zone in that case.
  const timezone = limitedText(input.timezone, "timezone", { max: 80 }) || defaultTimezone || TIME_ZONE_FALLBACK;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
  }

  // "In 10 minutes": a relative delay is resolved here, so the agent never has
  // to work out a clock time (that is where "message me in 10 minutes" broke).
  const inMinutes = Number(input.inMinutes);
  if (!input.scheduledAt && Number.isFinite(inMinutes) && inMinutes > 0) {
    input = { ...input, scheduledAt: new Date(Date.now() + Math.round(inMinutes * 60_000)).toISOString() };
  }
  const scheduledAt = limitedText(input.scheduledAt, "scheduledAt", { required: true, max: 64 });
  if (!ISO_WITH_OFFSET.test(scheduledAt)) {
    throw new Error("scheduledAt must be an ISO 8601 timestamp with a timezone offset");
  }
  const time = new Date(scheduledAt);
  if (!Number.isFinite(time.getTime())) throw new Error("scheduledAt is invalid");
  const delayMs = time.getTime() - Date.now();
  if (delayMs < MIN_DELAY_MS) throw new Error("scheduledAt must be at least one minute in the future");
  if (delayMs > MAX_DELAY_MS) throw new Error("scheduledAt must be within 180 days");
  // Repeating check-ins ("every day at 4:30pm"): the series ends after
  // repeatDays (default 30, max 90); cancelling the pending one ends it sooner.
  const repeat = input.repeat == null || input.repeat === "" || input.repeat === "none" ? null : String(input.repeat);
  if (repeat && !REPEATS.has(repeat)) throw new Error("repeat must be 'daily', 'weekdays', 'hourly' or 'interval'");
  let repeatUntil = null;
  let everySeconds = null;
  if (repeat === "interval") {
    // Any interval the learner names: every N seconds/minutes/hours/days/weeks/months/years.
    everySeconds = intervalSeconds(input.repeatEvery ?? input.every, input.repeatUnit ?? input.unit);
    if (!everySeconds) throw new Error("repeatEvery and repeatUnit are required for an interval repeat");
    if (everySeconds < MIN_INTERVAL_SECONDS) throw new Error(`an interval repeat must be at least ${MIN_INTERVAL_SECONDS} seconds apart`);
    if (everySeconds > MAX_INTERVAL_SECONDS) throw new Error("the interval is too long");
    const days = input.repeatDays == null ? 7 : Number(input.repeatDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error("repeatDays must be a whole number from 1 to 90");
    repeatUntil = new Date(time.getTime() + seriesSpanMs({ everySeconds, days })).toISOString();
  } else if (repeat) {
    // Hourly is bounded tighter (1–7 days ⇒ 24–168 sends, one pending at a time).
    const defaultDays = repeat === "hourly" ? 1 : 30;
    const maxDays = repeat === "hourly" ? 7 : 90;
    const days = input.repeatDays == null ? defaultDays : Number(input.repeatDays);
    if (!Number.isInteger(days) || days < 1 || days > maxDays) {
      throw new Error(repeat === "hourly"
        ? "repeatDays must be a whole number from 1 to 7 for an hourly repeat"
        : "repeatDays must be a whole number from 1 to 90");
    }
    repeatUntil = new Date(time.getTime() + days * DAY_MS).toISOString();
  }
  // One of the learner's own read tools, run fresh at each send (its answer is added to the message).
  const runTool = input.runTool == null || input.runTool === "" ? null : String(input.runTool);
  if (runTool && !TOOL_NAME.test(runTool)) throw new Error("runTool must be the name of one of your tools");
  return { message, title, timezone, scheduledAt: time.toISOString(), delayMs, repeat, repeatUntil, everySeconds, runTool };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const REPEATS = new Set(["daily", "weekdays", "hourly", "interval"]);
const TOOL_NAME = /^[a-z][a-z0-9_]{2,47}$/;

/** Day of week (0 = Sunday) of an instant in a time zone. */
function weekdayIn(date, timeZone) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/**
 * PURE: the next send time of a repeating check-in, or null when the series
 * is over. Same clock time the next day (weekdays: skips Saturday and Sunday
 * in the learner's time zone); hourly: one hour later. Never earlier than
 * `now` + 1 minute, so a late delivery doesn't fire a backlog of past sends.
 */
export function nextOccurrence({ scheduledAt, repeat, repeatUntil, everySeconds = null, timezone = TIME_ZONE_FALLBACK, now = Date.now() }) {
  if (!REPEATS.has(repeat)) return null;
  if (repeat === "interval" && !(Number(everySeconds) >= MIN_INTERVAL_SECONDS)) return null;
  const step = repeat === "interval" ? Number(everySeconds) * 1000 : repeat === "hourly" ? HOUR_MS : DAY_MS;
  let t = new Date(scheduledAt).getTime();
  if (!Number.isFinite(t)) return null;
  const guardMax = repeat === "interval" ? 5000 : repeat === "hourly" ? 24 * 130 : 400;
  for (let guard = 0; guard < guardMax; guard++) {
    t += step;
    if (repeat === "weekdays" && [0, 6].includes(weekdayIn(new Date(t), timezone))) continue;
    if (t > now + MIN_DELAY_MS) break;
  }
  if (repeatUntil && t > new Date(repeatUntil).getTime()) return null;
  return new Date(t).toISOString();
}

export function validateFollowUpId(value) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error("followUpId is invalid");
  }
  return value;
}
