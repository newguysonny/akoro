/**
 * lib/outboxCore.js — store first, send after (Grand Plan Phase 18 item 5).
 * The rules, pure: no db, no network. lib/outbox.js does the reads/writes.
 *
 *   backoffMs(attempt)                5 s, doubling, capped at 300 s
 *   afterAttempt(row, outcome, now)   the row's next state: sent · retry (due later) · failed after N · dropped
 *   staleSending(row, now)            a claim older than STALE_MS: the process died mid-send
 *   headOf(rows)                      the next row of one order key (created order; nothing jumps the queue)
 *   idemKey(parts)                    a stable idempotency key from its parts
 *   decideAction(row, now)            an outside action's journal row → act | reuse | check | busy
 *
 * Outcomes a sender reports (lib/outbox.js turns throws into these):
 *   { ok: true, result? }                         sent
 *   { ok: false, error, retry: true, progress? }  try again later (progress = what is already done)
 *   { ok: false, drop: "why" }                    never try again (e.g. no device subscribed)
 */
import { createHash } from "node:crypto";

export const OUTBOX = Object.freeze({
  BASE_MS: 5_000,
  MAX_BACKOFF_MS: 300_000,
  MAX_ATTEMPTS: 8,          // 5 + 10 + 20 + 40 + 80 + 160 + 300 s ≈ 10 min of trying
  STALE_MS: 120_000,        // a "sending" claim this old: its process is gone
  KEEP_DAYS: 14,            // finished rows kept this long, then swept
});
export const FINAL = Object.freeze(["sent", "failed", "dropped"]);
export const OPEN = Object.freeze(["pending", "sending"]);

/** Wait before attempt n+1, after n failed attempts (n ≥ 1): 5 s, 10 s, 20 s … ≤ 300 s. */
export function backoffMs(attempt, { base = OUTBOX.BASE_MS, cap = OUTBOX.MAX_BACKOFF_MS } = {}) {
  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(cap, base * 2 ** (n - 1));
}

/** The patch after one attempt. row: { attempts, max_attempts }. → patch for edu.outbox */
export function afterAttempt(row, outcome = {}, now = Date.now()) {
  const attempts = (Number(row?.attempts) || 0) + 1;
  const iso = new Date(now).toISOString();
  if (outcome.ok) return { status: "sent", attempts, finished_at: iso, claimed_at: null, last_error: null, ...(outcome.result !== undefined ? { result: outcome.result } : {}) };
  if (outcome.drop) return { status: "dropped", attempts, finished_at: iso, claimed_at: null, drop_reason: String(outcome.drop).slice(0, 300) };
  const max = Number(row?.max_attempts) || OUTBOX.MAX_ATTEMPTS;
  const error = String(outcome.error || "failed").slice(0, 500);
  const progress = outcome.progress !== undefined ? { progress: outcome.progress } : {};
  if (outcome.retry === false || attempts >= max) return { status: "failed", attempts, finished_at: iso, claimed_at: null, last_error: error, ...progress };
  return { status: "pending", attempts, claimed_at: null, last_error: error, due_at: new Date(now + backoffMs(attempts)).toISOString(), ...progress };
}

/** A claim this old belongs to a process that died mid-send. */
export function staleSending(row, now = Date.now(), staleMs = OUTBOX.STALE_MS) {
  return row?.status === "sending" && (!row.claimed_at || now - Date.parse(row.claimed_at) > staleMs);
}

/**
 * What to do with a send interrupted mid-attempt (the process died): a
 * channel that can't tell whether it went (push, email, SMS) drops it rather
 * than risk a second copy; a channel that can check (retryInterrupted) goes again.
 */
export function afterInterrupted(row, { retryInterrupted = false } = {}, now = Date.now()) {
  if (retryInterrupted) return { status: "pending", claimed_at: null, due_at: new Date(now).toISOString(), last_error: "interrupted mid-send; retried (the channel checks first)" };
  return { status: "dropped", claimed_at: null, finished_at: new Date(now).toISOString(), drop_reason: "interrupted mid-send — not repeated, so it is never sent twice" };
}

/**
 * The next row to work on for ONE order key. rows: that key's open rows (any
 * order). The oldest decides: nothing behind it is sent before it finishes.
 * → { row, action: "send" | "wait" | "busy" | "interrupted", dueInMs? } | null
 */
export function headOf(rows = [], now = Date.now()) {
  const open = (rows || []).filter((r) => OPEN.includes(r.status))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || String(a.id).localeCompare(String(b.id)));
  const head = open[0];
  if (!head) return null;
  if (head.status === "sending") return staleSending(head, now) ? { row: head, action: "interrupted" } : { row: head, action: "busy" };
  const due = Date.parse(head.due_at || head.created_at);
  if (Number.isFinite(due) && due > now) return { row: head, action: "wait", dueInMs: due - now };
  return { row: head, action: "send" };
}

/** A stable idempotency key: the same work always gets the same key. */
export function idemKey(...parts) {
  const flat = parts.flat().map((p) => (p === null || p === undefined ? "" : typeof p === "object" ? JSON.stringify(p) : String(p)));
  const joined = flat.join("|");
  return joined.length <= 180 ? joined : `${flat[0]}|${createHash("sha256").update(joined).digest("hex").slice(0, 40)}`;
}

/**
 * An outside action's journal row (channel "action:<kind>"), read before acting:
 *   none / failed             → act      (a failed act left nothing behind: it cleans up on throw)
 *   sent                      → reuse    (it happened: hand back its result, never do it again)
 *   sending, fresh            → busy     (another process is on it right now)
 *   sending, stale            → check    (interrupted mid-step: look for what it did before repeating)
 */
export function decideAction(row, now = Date.now(), staleMs = OUTBOX.STALE_MS) {
  if (!row) return "act";
  if (row.status === "sent") return "reuse";
  if (row.status === "sending") return staleSending(row, now, staleMs) ? "check" : "busy";
  return "act";
}
