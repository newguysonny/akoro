/**
 * activityLock — a tiny ref-counted "busy" signal for flows that must not be
 * interrupted by an auto-reload (live/teaching sessions, proctored assessments).
 *
 * A component in a critical flow calls acquireActivityLock() on mount and calls
 * the returned release on unmount. While any lock is held, UpdatePrompt pauses
 * its reload countdown.
 */
let locks = 0;
const subscribers = new Set();

function notify() {
  const busy = locks > 0;
  subscribers.forEach((cb) => { try { cb(busy); } catch { /* ignore */ } });
}

export function acquireActivityLock() {
  locks += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    notify();
  };
}

export function isBusy() { return locks > 0; }

export function subscribeActivity(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
