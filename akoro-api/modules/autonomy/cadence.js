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
 *   AKORO_AUTONOMY_CYCLE_EVERY           THE LOOP — one variable, no
 *                                       overnight wait: while the agent is
 *                                       online the planner re-reviews on
 *                                       this pace, any time of day
 *                                       ("5m", "1h", "45s", raw ms…).
 *                                       Implies continuous mode; the tick
 *                                       derives automatically. Min 1m.
 *   AKORO_AUTONOMY_MODE                  "nightly" (default) | "continuous".
 *                                       continuous: the window is always
 *                                       open and every trigger paces by
 *                                       MIN_CYCLE below.
 *   AKORO_AUTONOMY_TICK_MS               scheduler wake-up (default 60s, min 5s)
 *   AKORO_AUTONOMY_BATCH_LIMIT           learners claimed per tick (default 40)
 *   AKORO_AUTONOMY_MIN_CYCLE_MS          per-learner pace in ms — the sub-hour
 *                                       knob for 5-minute test cycles (unset:
 *                                       pace derives from MIN_CYCLE_HOURS)
 *   AKORO_AUTONOMY_MIN_CYCLE_HOURS       per-learner pace in whole hours (default 20)
 *   AKORO_AUTONOMY_WINDOW_START_HOUR     nightly window start, Africa/Lagos (default 21)
 *   AKORO_AUTONOMY_WINDOW_END_HOUR       nightly window end (default 22)
 *   AKORO_AUTONOMY_TRIGGER_COOLDOWN_MS   event-trigger cooldown per user+kind
 *                                        (default 15min — triggers.js owns the literal)
 *
 * Test rig recipe — planner every 5 minutes:
 *   AKORO_AUTONOMY_MODE=continuous
 *   AKORO_AUTONOMY_TICK_MS=5000            (or 60000 — tick just paces claiming)
 *   AKORO_AUTONOMY_MIN_CYCLE_MS=300000
 *   AKORO_AUTONOMY_MAX_WEEKLY_RUNS=<raise> (cycle.js; 30/week ≈ 4 runs/hour max)
 * and the inbox cap (MAX_PENDING_PROPOSALS=5) still applies per learner.
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

/** Duration parser for CYCLE_EVERY: "45s", "5m", "1h", "2d" (or raw ms).
 *  Returns null for anything unparseable — callers keep their default. */
export function parseDuration(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const m = String(raw).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] || "ms"];
  return Math.round(n * mult);
}

/** 300000 → "5m", 3600000 → "1h" — for logs that humans read. */
export function fmtMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return String(ms);
  if (ms >= 86_400_000 && ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

/** "nightly" (default) or "continuous" — anything else falls back to nightly. */
export function autonomyMode() {
  return String(process.env.AKORO_AUTONOMY_MODE ?? "").trim().toLowerCase() === "continuous"
    ? "continuous" : "nightly";
}

/* The cadence knobs, read fresh per call (boot and every tick) so a seeded
   env is honoured without reload gymnastics. */
export function autonomyCadence() {
  // THE LOOP: AKORO_AUTONOMY_CYCLE_EVERY — while online, re-review on this
  // pace around the clock. Minute floor (job dedupe is minute-granular);
  // implies continuous mode; the scheduler tick derives from it.
  const loopRaw = parseDuration(process.env.AKORO_AUTONOMY_CYCLE_EVERY) ?? 0;
  const loopEveryMs = loopRaw > 0 ? Math.max(60_000, loopRaw) : 0;
  const derivedTick = loopEveryMs > 0
    ? Math.min(60_000, Math.max(5_000, Math.floor(loopEveryMs / 4)))
    : 60_000;
  return {
    mode:          loopEveryMs > 0 ? "continuous" : autonomyMode(),
    loopEveryMs,
    tickMs:        envInt("AKORO_AUTONOMY_TICK_MS", derivedTick, { min: 5_000 }),
    batchLimit:    envInt("AKORO_AUTONOMY_BATCH_LIMIT", 40, { min: 1, max: 500 }),
    minCycleHours: envInt("AKORO_AUTONOMY_MIN_CYCLE_HOURS", 20, { min: 1, max: 168 }),
    minCycleMs:    envInt("AKORO_AUTONOMY_MIN_CYCLE_MS", 0, { min: 0 }),   // 0 = derive from hours
    windowStart:   envInt("AKORO_AUTONOMY_WINDOW_START_HOUR", 21, { min: 0, max: 23 }),
    windowEnd:     envInt("AKORO_AUTONOMY_WINDOW_END_HOUR", 22, { min: 0, max: 23 }),
  };
}

/** Weekly planner budget per learner — the loop's fuel gauge. */
export function weeklyRunsCap() {
  return envInt("AKORO_AUTONOMY_MAX_WEEKLY_RUNS", 30, { min: 1, max: 1_000_000 });
}

/** The resolved per-learner pace: CYCLE_EVERY wins, then the explicit ms
 *  knob, then the whole-hours default. */
export function minCycleMs(cadence = autonomyCadence()) {
  if (cadence.loopEveryMs > 0) return cadence.loopEveryMs;
  return cadence.minCycleMs > 0 ? cadence.minCycleMs : cadence.minCycleHours * 3600 * 1000;
}

/** Per-learner dedupe cutoff: a cycle closer than the pace is skipped. */
export function minCycleCutoff(cadence = autonomyCadence(), now = new Date()) {
  return new Date(now.getTime() - minCycleMs(cadence)).toISOString();
}

/**
 * The nightly window, Africa/Lagos.
 *   start < end  → same-day window (21→22 = the whole 21:00 hour)
 *   start > end  → wraps midnight (22→2 = 22:00–02:00)
 *   start == end → no window at all — an explicit "planner stands down" switch
 */
export function inNightlyWindow(now = new Date(), cadence = autonomyCadence()) {
  // Test rig: continuous mode keeps the window permanently open — the
  // planner may run any time the per-learner pace allows.
  if (cadence.mode === "continuous") return true;
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
