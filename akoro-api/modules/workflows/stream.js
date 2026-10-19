/**
 * workflows/stream.js — replay then live (Grand Plan §7.9.6, Phase 3).
 *
 *   streamWorkflowEvents({ list, subscribe, after, send, pollMs })
 *     list(after)        → the stored events with sequence > after, in order
 *     subscribe(onEvent) → unsubscribe — live events from this instance
 *     send(event, data)  → write one SSE event
 *   Replays the gap after `after`, says `caught_up`, then streams. A poll of
 *   the table covers events written by another instance. Every event goes out
 *   once, in sequence order. Returns stop().
 */
export function streamWorkflowEvents({ list, subscribe, after = -1, send, pollMs = 3000, filter = (e) => e }) {
  let last = Number.isInteger(after) ? after : -1;
  let stopped = false;
  let busy = Promise.resolve();
  const out = (env) => {
    if (stopped || !env || env.sequence <= last) return;
    last = env.sequence;
    const shown = filter(env);
    if (shown) send("workflow_event", shown);
  };
  // One read at a time, so a live event and a poll never interleave out of order.
  const pull = () => (busy = busy.then(async () => {
    if (stopped) return;
    const rows = await list(last).catch(() => []);
    for (const env of rows) out(env);
  }));

  const ready = pull().then(() => { if (!stopped) send("caught_up", { last }); });
  const unsubscribe = subscribe((env) => {
    // A live-only event (developer notes) has no sequence: straight out, if the filter lets it.
    if (env.live) { if (!stopped) { const shown = filter(env); if (shown) send("workflow_live", shown); } return; }
    // A gap means something was written that this instance didn't see: read it.
    if (env.sequence === last + 1) busy = busy.then(() => out(env)); else pull();
  });
  const timer = pollMs ? setInterval(pull, pollMs) : null;
  timer?.unref?.();
  const stop = () => { stopped = true; if (timer) clearInterval(timer); unsubscribe?.(); };
  stop.ready = ready;
  return stop;
}
