/**
 * modules/autonomy/cadence.js — the heartbeat's tunable rhythm.
 *
 * The agent backend has no always-on per-minute heartbeat by design (the
 * Redis-quota lesson): ONE scheduler tick considers a small batch, and only
 * inside the nightly window. Every "how often" knob of that rhythm lives
 * here as an env var so ops can retune any environment without code
 * changes — set the var, restart the process, done. Names follow the
 * AKORO_AUTONOMY_* convention (cycle.js's AKORO_AUTONOMY_MAX_WEEKLY_RUNS
 * is the precedent).
 *
 *   AKORO_AUTONOMY_TICK_MS               scheduler wake-up (default 60s, min 5s)
 *   AKORO_AUTONOMY_BATCH_LIMIT           learners claimed per tick (default 40)
 *   AKORO_AUTONOMY_MIN_CYCLE_HOURS       per-learner dedupe (default 20h)
 *   AKORO_AUTONOMY_WINDOW_START_HOUR     nightly window start, Africa/Lagos (default 21)
 *   AKORO_AUTONOMY_WINDOW_END_HOUR       nightly window end (default 22)
 *   AKORO_AUTONOMY_TRIGGER_COOLDOWN_MS   event-trigger cooldown per user+kind
 *                                        (default 15min — triggers.js owns the literal)
 *
 * Pure module on purpose: no db, no redis, no imports — index.js, triggers.js
 * and tests all resolve the same knobs through it.
 */

const LAGOS = "Africa/Lagos";

/** Integer env var with a safe fallback: absent or unusable keeps the default. */
export function envInt(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/* The scheduler's five knobs, read fresh per call (boot and every tick) so a
   seeded env is honoured without reload gymnastics. */
export function autonomyCadence() {
  return {
    tickMs:        envInt("AKORO_AUTONOMY_TICK_MS", 60_000, { min: 5_000 }),
    batchLimit:    envInt("AKORO_AUTONOMY_BATCH_LIMIT", 40, { min: 1, max: 500 }),
    minCycleHours: envInt("AKORO_AUTONOMY_MIN_CYCLE_HOURS", 20, { min: 1, max: 168 }),
    windowStart:   envInt("AKORO_AUTONOMY_WINDOW_START_HOUR", 21, { min: 0, max: 23 }),
    windowEnd:     envInt("AKORO_AUTONOMY_WINDOW_END_HOUR", 22, { min: 0, max: 23 }),
  };
}

/** Per-learner dedupe cutoff: a cycle closer than minCycleHours is skipped. */
export function minCycleCutoff(cadence = autonomyCadence(), now = new Date()) {
  return new Date(now.getTime() - cadence.minCycleHours * 3600 * 1000).toISOString();
}

/**
 * The nightly window, Africa/Lagos.
 *   start < end  → same-day window (21→22 = the whole 21:00 hour)
 *   start > end  → wraps midnight (22→2 = 22:00–02:00)
 *   start == end → no window at all — an explicit "planner stands down" switch
 */
export function inNightlyWindow(now = new Date(), cadence = autonomyCadence()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LAGOS, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const { windowStart, windowEnd } = cadence;
  if (windowStart === windowEnd) return false;
  return windowStart < windowEnd
    ? h >= windowStart && h < windowEnd
    : h >= windowStart || h < windowEnd;
}
