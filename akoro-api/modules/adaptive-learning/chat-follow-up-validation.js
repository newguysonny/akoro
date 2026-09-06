/** Input validation kept dependency-free so timing/timezone policy is testable. */

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

export function validateFollowUpInput(input = {}) {
  const message = limitedText(input.message, "message", { required: true, max: 800 });
  const title = limitedText(input.title, "title", { max: 80 }) || "Scheduled check-in";
  const timezone = limitedText(input.timezone, "timezone", { max: 80 }) || TIME_ZONE_FALLBACK;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
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
  return { message, title, timezone, scheduledAt: time.toISOString(), delayMs };
}

export function validateFollowUpId(value) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error("followUpId is invalid");
  }
  return value;
}
