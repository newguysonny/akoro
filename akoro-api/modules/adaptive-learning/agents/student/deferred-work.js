/**
 * deferred-work.js — tracks a session's deferred per-turn work (the coach
 * and the knowledge record, moved off the turn's critical path for latency)
 * so the session's end can settle it before flushing what it recorded.
 */
export function createDeferredWorkTracker() {
  const pending = new Set();
  return {
    track(promise) {
      const tracked = Promise.resolve(promise).catch(() => null);
      pending.add(tracked);
      tracked.finally(() => pending.delete(tracked));
    },
    async settle() {
      if (pending.size) await Promise.allSettled([...pending]);
    },
  };
}
