/**
 * schedule.js — client-side recurrence generator (mirrors the backend
 * modules/instructor/schedule.js). Lets the wizard scaffold a Module(=Week)→
 * topics tree instantly, before the course row exists. Final commit re-validates
 * server-side.
 */

const WEEK_STEP = { weekly: 1, biweekly: 2, '3x_weekly': 1, custom: 1 };

// Frequency → suggested default weekday set (0=Sun…6=Sat).
export const FREQ_DEFAULT_DAYS = {
  weekly:    [1],          // Monday
  biweekly:  [1],
  '3x_weekly': [1, 3, 5],  // Mon / Wed / Fri
  custom:    [1, 3, 5],
};

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (n) => String(n).padStart(2, '0');

/**
 * @param spec { frequency, daysOfWeek[], time "HH:MM", durationMin, startDate "YYYY-MM-DD", weeks, platform }
 * @returns { modules: [{ title, orderIndex, sessions: [{ title, date, time, scheduled_start, scheduled_end, duration_min, platform, order_index, materials:[] }] }] }
 */
export function generateSchedule(spec) {
  const {
    frequency = 'weekly',
    daysOfWeek = [],
    time = '16:00',
    durationMin = 60,
    startDate,
    weeks = 1,
    platform = 'zoom',
  } = spec || {};

  if (!startDate || !daysOfWeek.length) return { modules: [] };

  const step = WEEK_STEP[frequency] ?? 1;
  const days = [...new Set(daysOfWeek)].sort((a, b) => a - b);

  const startDay = Date.UTC(+startDate.slice(0, 4), +startDate.slice(5, 7) - 1, +startDate.slice(8, 10));
  const startMs = new Date(`${startDate}T${time}:00+01:00`).getTime();
  const weekStart = startDay - new Date(startDay).getUTCDay() * 86400000;

  const modules = [];
  for (let w = 0; w < weeks; w++) {
    const sessions = [];
    days.forEach((d, i) => {
      const day = new Date(weekStart + (w * step * 7 + d) * 86400000);
      const dateStr = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
      const startAt = new Date(`${dateStr}T${time}:00+01:00`);
      if (startAt.getTime() < startMs) return;
      sessions.push({
        title: '',
        date: dateStr,
        time,
        scheduled_start: startAt.toISOString(),
        scheduled_end: new Date(startAt.getTime() + durationMin * 60000).toISOString(),
        duration_min: durationMin,
        platform,
        order_index: i,
        materials: [],
      });
    });
    modules.push({ title: `Week ${w + 1}`, orderIndex: w, sessions });
  }

  return { modules };
}

/** Recompute a session's ISO start/end from its date + time + duration. */
export function recomputeSession(s) {
  if (!s.date || !s.time) return s;
  const start = new Date(`${s.date}T${s.time}:00+01:00`);
  const dur = Number(s.duration_min || 60);
  return {
    ...s,
    scheduled_start: start.toISOString(),
    scheduled_end: new Date(start.getTime() + dur * 60000).toISOString(),
  };
}
