/**
 * lib/redisTrace.js — local, opt-in stack-trace logging for every Redis call.
 *
 * Wrap an ioredis instance and, when AKORO_REDIS_TRACE=true, every command is
 * logged with the application call-site that issued it, plus aggregated into
 * a per-call-site/per-command tally printed every minute. This answers "what
 * is burning the Redis quota" from inside the app.
 *
 * NO server changes: the flag defaults off — with it unset the wrapper is
 * inert (a pass-through), nothing is logged, nothing is counted. Run it
 * locally or on any service by setting the env var:
 *
 *   AKORO_REDIS_TRACE=true npm run dev
 *
 * BullMQ note: every BullMQ command also passes through the shared client's
 * sendCommand, so queue/worker internals are attributed too — call-sites in
 * node_modules/bullmq are expected; the interesting lines are YOUR frames.
 */

const traceOn = () => String(process.env.AKORO_REDIS_TRACE ?? "").trim().toLowerCase() === "true";

// Flood guard for the immediate per-command lines — the tally keeps counting
// past this, only the console spam stops (AKORO_REDIS_TRACE_MAX to raise).
const MAX_IMMEDIATE_LOGS = Number(process.env.AKORO_REDIS_TRACE_MAX) || 300;

const state = {
  wrapped: new Set(),       // clients already patched (idempotent double-wraps)
  total: 0,
  byCommand: new Map(),     // "xadd" → n
  bySite: new Map(),        // "routes/battles.js:123" → n
  byLabel: new Map(),       // "battle-worker" → Map("evalsha" → n) — the label IS the consumer
  immediateLogs: 0,
  reporter: null,
};

/** First meaningful application frame from a V8 stack (skips node internals,
 *  node_modules, and this tracer itself). */
function callSite(stack) {
  const frames = String(stack).split("\n").map((l) => l.trim())
    .filter((l) => l.startsWith("at "))
    .filter((l) => !l.includes("node:") && !l.includes("node_modules") && !l.includes("lib/redisTrace.js"));
  return (frames[0] || "(native)").replace(/^at\s+/, "");
}

/** Patch one ioredis-like client in place. Returns the same client. */
export function traceRedis(client, label = "redis") {
  if (!client || typeof client.sendCommand !== "function" || state.wrapped.has(client)) return client;
  state.wrapped.add(client);
  const original = client.sendCommand.bind(client);
  client.sendCommand = (command, ...rest) => {
    if (traceOn()) {
      try {
        const name = command?.name || "unknown";
        const site = callSite(new Error().stack);
        state.total += 1;
        state.byCommand.set(name, (state.byCommand.get(name) || 0) + 1);
        state.bySite.set(site, (state.bySite.get(site) || 0) + 1);
        const perLabel = state.byLabel.get(label) || new Map();
        perLabel.set(name, (perLabel.get(name) || 0) + 1);
        state.byLabel.set(label, perLabel);
        if (state.immediateLogs < MAX_IMMEDIATE_LOGS) {
          state.immediateLogs += 1;
          console.log(`[redis-trace] ${label} ${name} ← ${site}`);
        } else if (state.immediateLogs === MAX_IMMEDIATE_LOGS) {
          state.immediateLogs += 1;
          console.log(`[redis-trace] per-command log cap reached — the per-minute tally below keeps counting (AKORO_REDIS_TRACE_MAX to raise)`);
        }
      } catch { /* tracing must never break a command */ }
    }
    return original(command, ...rest);
  };
  return client;
}

/** Cumulative tally since boot: { total, byCommand, bySite, byLabel }. byLabel
 *  is the attribution that matters for BullMQ — its internals all show as
 *  "(native)" call-sites, but each client's label names the consumer. */
export function redisTraceSnapshot({ top = 10 } = {}) {
  const topOf = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  const byLabel = [...state.byLabel.entries()]
    .map(([label, cmds]) => {
      let n = 0;
      for (const v of cmds.values()) n += v;
      return [label, n, topOf(cmds, 4)];
    })
    .sort((a, b) => b[1] - a[1]);
  return { total: state.total, byCommand: topOf(state.byCommand), bySite: topOf(state.bySite), byLabel };
}

/** One-minute console tally (self-gates on the flag; no-op if already running). */
export function startRedisTraceReporting(intervalMs = 60_000) {
  if (!traceOn() || state.reporter) return;
  state.reporter = setInterval(() => {
    if (!state.total) return;
    const snap = redisTraceSnapshot();
    console.log(`\n[redis-trace] ${snap.total} commands since boot — by consumer:`);
    for (const [label, n, cmds] of snap.byLabel) {
      const detail = cmds.map(([c, k]) => `${c}×${k}`).join(" ");
      console.log(`   ${String(n).padStart(8)}  ${label}  (${detail})`);
    }
    console.log(`[redis-trace] top call-sites:`);
    for (const [site, n] of snap.bySite) console.log(`   ${String(n).padStart(8)}  ${site}`);
  }, intervalMs);
  state.reporter.unref?.();
}
