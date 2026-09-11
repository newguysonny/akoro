/**
 * lib/usageMeter.js — in-process meter for platform "command" burn.
 *
 * The DB platform bills every PostgREST call as a "command" (450k+ in days
 * with no real users). This module makes that burn VISIBLE from inside the
 * app: every db.from/rpc/schema call is counted, attributed to the API route
 * that caused it (AsyncLocalStorage set by the /api middleware in app.js) or
 * to "(background)" when no request is in flight.
 *
 * One platform command ≈ one query execution; we count query-BUILDER
 * creation, which matches 1:1 in this codebase (builders execute once).
 * Auth/platform-service calls are not visible here — treat the numbers as a
 * conservative floor. All state is process-local and resets on restart.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const routeContext = new AsyncLocalStorage();

/** Run `fn` with DB commands attributed to `routeKey`. */
export const runWithRouteUsage = (routeKey, fn) => routeContext.run({ routeKey }, fn);

export const currentRouteKey = () => routeContext.getStore()?.routeKey || "(background)";

const WINDOW_HOURS = 25;
const buckets = [];          // [{ hour: "YYYY-MM-DDTHH", total, byRoute: Map }]
const lifetime = new Map();  // routeKey → commands since boot
let lifetimeTotal = 0;
const BOOTED_AT = new Date();

function bucketNow() {
  const hour = new Date().toISOString().slice(0, 13);
  let b = buckets[buckets.length - 1];
  if (!b || b.hour !== hour) {
    b = { hour, total: 0, byRoute: new Map() };
    buckets.push(b);
    if (buckets.length > WINDOW_HOURS) buckets.shift();
  }
  return b;
}

/** Record n DB commands against the current route context. */
export function countQuery(n = 1) {
  const route = currentRouteKey();
  const b = bucketNow();
  b.total += n;
  b.byRoute.set(route, (b.byRoute.get(route) || 0) + n);
  lifetime.set(route, (lifetime.get(route) || 0) + n);
  lifetimeTotal += n;
}

const topOf = (map, topN) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
  .map(([route, commands]) => ({ route, commands }));

/** Everything the admin usage page needs, in one plain object. */
export function usageSnapshot({ topN = 12 } = {}) {
  const uptimeHours = Math.max((Date.now() - BOOTED_AT.getTime()) / 3_600_000, 1 / 3600);
  const cur = buckets[buckets.length - 1] || null;
  return {
    bootedAt: BOOTED_AT.toISOString(),
    uptimeHours: +uptimeHours.toFixed(2),
    lifetimeTotal,
    burnPerHour: +(lifetimeTotal / uptimeHours).toFixed(1),
    currentHour: cur ? { hour: cur.hour, total: cur.total, byRoute: topOf(cur.byRoute, topN) } : null,
    hourly: buckets.map(({ hour, total }) => ({ hour, total })),
    topRoutes: topOf(lifetime, topN),
    note: "Counts PostgREST queries issued by this process (db.from/rpc/schema). One platform command ≈ one query; auth and other platform services are NOT included, so real billing is somewhat higher. Resets on restart.",
  };
}
