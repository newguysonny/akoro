/**
 * middleware/loadShedder.js — shed low-priority traffic before the server
 * falls over, instead of after.
 *
 * Monitors event-loop lag (the number that actually predicts collapse — CPU
 * and memory graphs are already too late) and RSS. Past either bar, every
 * non-exempt request gets an immediate 503 + Retry-After. Never silently
 * drop: the client deserves to know it should retry.
 *
 * Priority order (plan §3.5): auth flows and health are never shed — a user
 * mid-session must be able to refresh a token even while the server is on its
 * knees, and the platform/monitors must see the truth.
 *
 * Env (all optional):
 *   SHED_LAG_MS        event-loop lag bar   (default 500)
 *   SHED_MEM_MB        RSS bar in MB        (default 450 — Render Hobby ~512MB)
 *   SHED_RETRY_AFTER_S Retry-After seconds  (default 5)
 */
import { monitorEventLoopDelay } from "node:perf_hooks";

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const LAG_BAR_MS   = num("SHED_LAG_MS", 500);
const MEM_BAR_MB   = num("SHED_MEM_MB", 450);
const RETRY_AFTER  = num("SHED_RETRY_AFTER_S", 5);

// Auth + health are exempt under ALL load. Registration too: a signup in
// flight should not 503 because a scrape ran hot.
const EXEMPT_PREFIXES = [
  "/health",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/auth/logout",
];

/**
 * Pure decision function (exported for contract tests): given overload state
 * and a path, should the request be shed? Robust to a query string being
 * included (Express's req.path never has one, but no caller should be able to
 * accidentally exempt itself by appending "?x").
 */
export function decideShed({ overloaded, path }) {
  if (!overloaded) return false;
  const p = String(path ?? "").split("?")[0];
  return !EXEMPT_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** Build the middleware. One histogram per process; the interval is unref'd so
 *  it never holds shutdown open. */
export function createLoadShedder() {
  const hist = monitorEventLoopDelay({ resolution: 20 });
  hist.enable();
  let lagEmaMs = 0;
  const tick = setInterval(() => {
    const sampleMs = hist.mean / 1e6;   // histogram is nanoseconds
    hist.reset();
    // Exponential moving average: one slow tick (GC pause) must not trip the
    // bar alone, but a sustained slowdown must not be averaged away either.
    lagEmaMs = lagEmaMs ? 0.7 * lagEmaMs + 0.3 * sampleMs : sampleMs;
  }, 1000);
  tick.unref?.();

  let shedding = false;
  return function loadShedder(req, res, next) {
    const rssMb = process.memoryUsage().rss / (1024 * 1024);
    const overloaded = lagEmaMs > LAG_BAR_MS || rssMb > MEM_BAR_MB;
    // Log the TRANSITION, not every request — a line per shed request is the
    // log-flood version of the overload we are trying to survive.
    if (overloaded !== shedding) {
      shedding = overloaded;
      console.warn(
        `[shed] ${overloaded ? "ON" : "OFF"} — lag ${Math.round(lagEmaMs)}ms (bar ${LAG_BAR_MS}), ` +
        `rss ${Math.round(rssMb)}MB (bar ${MEM_BAR_MB})`,
      );
    }
    if (!decideShed({ overloaded, path: req.path })) return next();
    res.setHeader("Retry-After", String(RETRY_AFTER));
    return res.status(503).json({
      success: false,
      message: "Server busy — please retry shortly.",
      code: "overloaded",
    });
  };
}
