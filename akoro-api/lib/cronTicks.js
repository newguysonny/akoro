// lib/cronTicks.js
//
// The cron-tick registry — the seam Cloudflare's cron ticker (and any
// future scheduler) pokes. Each scheduled job in the API registers its
// callback here under a stable name; POST /api/internal/ticks/:name runs
// it. The callback is THE SAME function the local node-cron schedule
// calls, so local mode and Cloudflare mode execute identical work —
// only the clock differs (CRON_SOURCE picks which clock is armed).
//
// Every tick carries the same overlap guard the in-place cron callbacks
// had: if the previous run is still going, the poke is answered with a
// skipped=true rather than piling a second run on top.

const ticks = new Map();   // name → { fn, running }

/** Register (or replace) a named tick. Pure bookkeeping — never runs fn. */
export function registerTick(name, fn) {
  ticks.set(String(name), { fn, running: false });
}

export function listTicks() {
  return [...ticks.keys()].sort();
}

/** Run one tick. Returns a route-ready envelope; never throws. */
export async function runTick(name) {
  const t = ticks.get(String(name || ""));
  if (!t) return { ok: false, status: 404, error: `no such tick "${name}" — registered: ${listTicks().join(", ") || "none"}` };
  if (t.running) return { ok: true, data: { tick: name, skipped: true, reason: "previous run still in progress" } };
  t.running = true;
  try {
    const result = await t.fn();
    return { ok: true, data: { tick: name, skipped: false, result: result ?? null } };
  } catch (e) {
    return { ok: false, status: 500, error: String(e?.message || e).slice(0, 300) };
  } finally {
    t.running = false;
  }
}

/** Which clock owns the schedules: "local" (node-cron in-process) or
 *  "cloudflare" (the cf/cron-ticker Worker pokes /api/internal/ticks). */
export const cronSource = () => (process.env.CRON_SOURCE ?? "local").trim().toLowerCase();
export const cloudflareCronEnabled = () => cronSource() === "cloudflare";
