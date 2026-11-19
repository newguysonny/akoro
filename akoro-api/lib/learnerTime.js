/** Pure time-zone and presentation helpers for learner-owned tools. */

export const PLATFORM_TIMEZONE = "Africa/Lagos";

export function isIanaTimeZone(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * User settings are preferred over defaults. The platform has historically
 * used Africa/Lagos for learners without an explicit account time zone; expose
 * the source so a conversational agent can ask rather than pretend it knows.
 */
export function resolveLearnerTimeZone({ configuredTimeZone } = {}) {
  if (isIanaTimeZone(configuredTimeZone)) {
    return { timeZone: configuredTimeZone.trim(), source: "account_preference" };
  }
  return { timeZone: PLATFORM_TIMEZONE, source: "platform_default" };
}

export function localiseInstant(instant, timeZone) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime()) || !isIanaTimeZone(timeZone)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(parts
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  const numericDate = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return {
    dateTime: new Intl.DateTimeFormat("en-GB", {
      timeZone, weekday: "short", year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date),
    weekday: values.weekday,
    date: `${numericDate.year}-${numericDate.month}-${numericDate.day}`,
    time: `${values.hour}:${values.minute} ${values.dayPeriod || ""}`.trim(),
    timeZone: values.timeZoneName || timeZone,
  };
}
