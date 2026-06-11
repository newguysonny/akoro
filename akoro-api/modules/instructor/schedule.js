/**
 * instructor/schedule.js
 * Pure recurrence generator for live-class schedules.
 *
 * A "module" maps to a week; each chosen weekday in that week becomes a dated
 * session (topic). Used by the /schedule/preview endpoint and unit-testable.
 */

// frequency → how many weeks to step between occurrences of the same weekday.
const WEEK_STEP = { weekly: 1, biweekly: 2, "3x_weekly": 1, custom: 1 };

/**
 * Expand a recurrence spec into a module(week) → sessions tree.
 *
 * @param {object} spec
 *   frequency   'weekly' | 'biweekly' | '3x_weekly' | 'custom'
 *   daysOfWeek  number[] 0=Sun … 6=Sat
 *   time        "HH:MM" (24h, local WAT)
 *   durationMin number
 *   startDate   "YYYY-MM-DD"
 *   weeks       number (how many module-weeks to generate)
 *   platform    'zoom' | 'meet' | 'teams'
 *   modules     optional [{ title, topics:[{ title }] }] to pre-fill names
 * @returns {{ modules: Array }}
 */
export function generateSchedule(spec) {
  const {
    frequency = "weekly",
    daysOfWeek = [],
    time = "16:00",
    durationMin = 60,
    startDate,
    weeks = 1,
    platform = "zoom",
    modules: names = [],
  } = spec || {};

  if (!startDate) throw new Error("startDate is required");
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) throw new Error("daysOfWeek is required");

  const step = WEEK_STEP[frequency] ?? 1;
  const days = [...new Set(daysOfWeek)].sort((a, b) => a - b);
  const pad = (n) => String(n).padStart(2, "0");

  // Anchor on UTC midnight of the start date, then offset by weekday + week index.
  // We do calendar math in UTC and stamp the wall-clock time as WAT (+01:00) so
  // results are identical regardless of the server's local timezone.
  const start = new Date(`${startDate}T00:00:00+01:00`);
  const startDay = Date.UTC(
    Number(startDate.slice(0, 4)),
    Number(startDate.slice(5, 7)) - 1,
    Number(startDate.slice(8, 10)),
  );
  const startMs = start.getTime();
  // Sunday of the start week (UTC).
  const startWeekday = new Date(startDay).getUTCDay();
  const weekStart = startDay - startWeekday * 86400000;

  const out = [];
  for (let w = 0; w < weeks; w++) {
    const moduleSpec = names[w] || {};
    const sessions = [];

    days.forEach((d, i) => {
      const dayMs = weekStart + (w * step * 7 + d) * 86400000;
      const day = new Date(dayMs);
      const dateStr = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
      const startAt = new Date(`${dateStr}T${time}:00+01:00`);
      if (startAt.getTime() < startMs) return; // don't backfill before the start date

      const startIso = startAt.toISOString();
      const endIso = new Date(startAt.getTime() + durationMin * 60000).toISOString();
      const topic = moduleSpec.topics?.[i] || {};
      sessions.push({
        title:          topic.title || "",
        scheduled_start: startIso,
        scheduled_end:   endIso,
        duration_min:    durationMin,
        platform,
        order_index:     i,
      });
    });

    out.push({
      title:       moduleSpec.title || `Week ${w + 1}`,
      order_index: w,
      sessions,
    });
  }

  return { modules: out };
}
