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
  };
}
