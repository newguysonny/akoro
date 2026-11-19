import { intervalSeconds, MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS } from "../../../lib/scheduleInterval.js";
/**
 * Validation and normalisation shared by learner task creation paths.
 *
 * Keep this dependency-free except for the platform's timezone policy so it can
 * be exercised with the exact action payloads produced from diverse chat
 * prompts before any database write is attempted.
 */
import { isIanaTimeZone, PLATFORM_TIMEZONE } from "./learner-time-context.js";

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i;

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

function preciseDueAt(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !ISO_WITH_OFFSET.test(value.trim())) {
    throw new Error("dueAt must be an ISO 8601 timestamp with a timezone offset");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("dueAt is not a valid time");
  return date.toISOString();
}

/** Return only the normalized fields that are safe to persist on a learner task. */
export function validateLearnerTaskInput(input = {}, { defaultTimezone = PLATFORM_TIMEZONE } = {}) {
  const timezone = limitedText(input.timezone, "timezone", { max: 80 }) || defaultTimezone || PLATFORM_TIMEZONE;
  if (!isIanaTimeZone(timezone)) throw new Error("timezone must be a valid IANA timezone");

  // A repeating to-do regenerates its next occurrence when the learner completes
  // it (see tasks/routes.js toggle). daily = 1 day, weekly = 7 days, interval = N.
  const repeat = input.repeat == null || input.repeat === "" || input.repeat === "none" ? null : String(input.repeat);
  if (repeat && !["daily", "weekly", "interval"].includes(repeat)) throw new Error("repeat must be 'daily', 'weekly' or 'interval'");
  let recurrenceEverySeconds = null;
  if (repeat === "daily") recurrenceEverySeconds = 86_400;
  else if (repeat === "weekly") recurrenceEverySeconds = 604_800;
  else if (repeat === "interval") {
    // Any interval the learner names: every N seconds/minutes/hours/days/weeks/months/years.
    recurrenceEverySeconds = intervalSeconds(input.repeatEvery ?? input.every, input.repeatUnit ?? input.unit);
    if (!recurrenceEverySeconds) {
      const d = Number(input.repeatIntervalDays);
      if (!Number.isInteger(d) || d < 1 || d > 365) throw new Error("repeat needs repeatEvery + repeatUnit, or repeatIntervalDays from 1 to 365");
      recurrenceEverySeconds = d * 86_400;
    }
    if (recurrenceEverySeconds < MIN_INTERVAL_SECONDS) throw new Error(`an interval repeat must be at least ${MIN_INTERVAL_SECONDS} seconds apart`);
    if (recurrenceEverySeconds > MAX_INTERVAL_SECONDS) throw new Error("the interval is too long");
  }

  return {
    title: limitedText(input.title, "title", { required: true, max: 180 }),
    description: limitedText(input.description, "description", { max: 800 }),
    due: limitedText(input.due, "due", { max: 120 }),
    course: limitedText(input.course, "course", { max: 120 }),
    priority: ["high", "medium", "low"].includes(input.priority) ? input.priority : "medium",
    // "In 30 minutes" is precise: resolved here so the model needn't do clock maths.
    dueAt: preciseDueAt(input.dueAt) ?? (Number(input.dueInMinutes) > 0 && Number(input.dueInMinutes) <= 525_600
      ? new Date(Date.now() + Math.round(Number(input.dueInMinutes) * 60_000)).toISOString() : null),
    timezone,
    ...(recurrenceEverySeconds ? {
      recurrenceEverySeconds,
      recurrenceEveryDays: recurrenceEverySeconds % 86_400 === 0 ? recurrenceEverySeconds / 86_400 : null,
    } : {}),
  };
}
