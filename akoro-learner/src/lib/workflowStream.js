/**
 * workflowStream.js — a workflow's live steps (Grand Plan §7.9.6, Phase 3).
 *
 *   openWorkflowStream({ workflowId, after, onEvent, onCaughtUp })
 *     Replays everything after `after`, calls onCaughtUp(replayed) once the
 *     gap is in, then delivers live events. A dropped connection reconnects
 *     from the last sequence it saw (backoff up to 30s), so nothing is missed
 *     and nothing arrives twice. Returns close().
 *   seenSequence(id) / rememberSeen(id, seq) — the last step this device
 *     showed, for "While you were away".
 */
import { streamGet } from '../services/api.js';

const KEY = (id) => `ak.wf.seen.${id}`;
/** Steps already received, per workflow, so a card that moves (pinned ↔ in the chat) picks up where it was. */
const received = new Map();
export const cachedEvents = (workflowId) => received.get(workflowId) || null;
export const cacheEvents = (workflowId, list) => { received.set(workflowId, list); };
export function seenSequence(workflowId) {
  try { const v = localStorage.getItem(KEY(workflowId)); return v == null ? null : Number(v); } catch { return null; }
}
export function rememberSeen(workflowId, sequence) {
  try { if (Number.isFinite(sequence)) localStorage.setItem(KEY(workflowId), String(sequence)); } catch { /* private mode */ }
}

export function openWorkflowStream({ workflowId, after = -1, onEvent, onCaughtUp, onError }) {
  let last = Number.isFinite(after) ? after : -1;
  let closed = false;
  let ctrl = null;
  let delay = 1000;
  let firstCatchUp = true;
  const run = async () => {
    while (!closed) {
      ctrl = new AbortController();
      const replayed = [];
      let caughtUp = false;
      try {
        await streamGet(`/api/workflows/${workflowId}/stream?after=${last}`, {
          signal: ctrl.signal,
          onEvent: (name, data) => {
            if (name === 'caught_up') {
              caughtUp = true; delay = 1000;
              if (firstCatchUp) { firstCatchUp = false; onCaughtUp?.(replayed); }
              return;
            }
            if (name !== 'workflow_event' || !Number.isFinite(data?.sequence) || data.sequence <= last) return;
            last = data.sequence;
            if (!caughtUp) replayed.push(data);
            // After the first catch-up everything is new, even what a reconnect replays.
            onEvent?.(data, { live: caughtUp || !firstCatchUp });
          },
        });
      } catch (err) {
        if (closed) return;
        // Not found / not allowed: stop; the card falls back to the session view.
        if (err?.status === 404 || err?.status === 403 || err?.status === 422) { onError?.(err); return; }
      }
      if (closed) return;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  };
  run();
  return () => { closed = true; ctrl?.abort(); };
}
