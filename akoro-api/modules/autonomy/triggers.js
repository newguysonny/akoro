/**
 * modules/autonomy/triggers.js — the event-trigger seam (Full Autonomy §6).
 *
 * Hot paths (task toggles, submissions, battle ends) call emitAutonomyEvent
 * and move on: one cheap in-process debounce, then a single Redis enqueue.
 * Every real gate (enabled, level 2, pace, caps, quiet hours) is checked
 * later by the cycle itself — a trigger PROPOSES a run, it never starts one.
 */
import { enqueueAutonomyCycle } from "./scheduler.js";

// Per-process cooldown so a rapid-fire path (bulk completes, replays) does
// not chatter Redis: one enqueue per user+kind per cooldown window, in-memory.
const EMIT_COOLDOWN_MS = 15 * 60 * 1000;
// Env override (AKORO_AUTONOMY_TRIGGER_COOLDOWN_MS, milliseconds) — same
// convention as the scheduler's cadence knobs (./cadence.js). Read per emit;
// an absent or unusable value keeps the default above.
const emitCooldownMs = () => {
  const n = Math.floor(Number(process.env.AKORO_AUTONOMY_TRIGGER_COOLDOWN_MS ?? ""));
  return Number.isFinite(n) && n >= 1000 ? n : EMIT_COOLDOWN_MS;
};
const lastEmit = new Map();

export async function emitAutonomyEvent(userId, kind) {
  if (!userId || !kind) return false;
  const key = `${userId}:${kind}`;
  const nowMs = Date.now();
  const last = lastEmit.get(key) ?? 0;
  if (nowMs - last < emitCooldownMs()) return false;
  lastEmit.set(key, nowMs);
  try {
    await enqueueAutonomyCycle(userId, `event:${kind}`);
    return true;
  } catch (error) {
    // A trigger is an optimisation, never a dependency of the write path.
    lastEmit.delete(key);
    console.warn(`[autonomy/triggers] enqueue failed (${kind}):`, error.message);
    return false;
  }
}

/** Test hook. */
export function resetAutonomyTriggers() {
  lastEmit.clear();
}
