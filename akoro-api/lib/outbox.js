/**
 * lib/outbox.js — store first, send after (Grand Plan Phase 18 item 5).
 *
 * Every outgoing message (web push, email, SMS, WhatsApp) and every outside
 * action a workflow takes is written to edu.outbox before it is attempted,
 * sent with growing backoff (5 s doubling to 300 s), in created order per
 * order key (one recipient + channel), and kept with its outcome: sent ·
 * failed after N tries · dropped and why. The idempotency key makes a second
 * write of the same work a no-op — nothing is sent twice.
 *
 *   outboxSend(channel, { orderKey, idemKey, userId, payload }, direct)
 *       the one call the senders use. If the outbox can't be written (db
 *       down, AKORO_OUTBOX=off) it logs and runs `direct` — the send as it was
 *       before — so a failed outbox write never breaks a learner's request.
 *   outsideAction({ kind, key, userId, act, check })
 *       a workflow's outside step at most once (see lib/outboxEngine.js); if the
 *       journal can't be read it just acts, as before.
 *   startOutbox()   the clock: retries and anything a restart left behind. It
 *                   reads Postgres only (like the deferred-jobs release clock,
 *                   lib/deferredJobs.js — no Redis), every 15 s, and sweeps
 *                   finished rows older than 14 days once an hour.
 *
 * The channels (what "send" means for each) are in lib/outboxChannels.js.
 */
import db from "../db.js";
import { makeOutbox } from "./outboxEngine.js";
import { OUTBOX } from "./outboxCore.js";
import { outboxChannels } from "./outboxChannels.js";

const table = () => db.schema("edu").from("outbox");
const OPEN = ["pending", "sending"];
const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

/** The Postgres store (edu.outbox, migrations/2026-outbox.sql). */
export const postgresRepo = {
  async insert(row) {
    const { data, error } = await table().insert(row).select("*").single();
    if (!error) return { row: data, created: true };
    if (error.code === "23505" || /duplicate key|uq_outbox_idem/i.test(error.message)) {
      return { row: must(await table().select("*").eq("idem_key", row.idem_key).maybeSingle()), created: false };
    }
    throw new Error(error.message);
  },
  async byKey(key) { return must(await table().select("*").eq("idem_key", key).maybeSingle()); },
  async openFor(orderKey) { return must(await table().select("*").eq("order_key", orderKey).in("status", OPEN).order("created_at").limit(20)) || []; },
  async claim(id, match, patch) {
    let q = table().update(patch).eq("id", id).eq("status", match.status);
    if (match.claimed_at !== undefined) q = match.claimed_at === null ? q.is("claimed_at", null) : q.eq("claimed_at", match.claimed_at);
    return must(await q.select("*").maybeSingle());
  },
  async update(id, patch) { return must(await table().update(patch).eq("id", id).select("*").maybeSingle()); },
  async dueKeys(nowIso, staleIso, limit = 50) {
    const [due, stale] = await Promise.all([
      table().select("order_key").eq("status", "pending").lte("due_at", nowIso).order("due_at").limit(limit * 4),
      table().select("order_key").eq("status", "sending").lt("claimed_at", staleIso).limit(limit),
    ]);
    return [...new Set([...(must(due) || []), ...(must(stale) || [])].map((r) => r.order_key))]
      // An outside action's journal row is resolved by its own step (outsideAction), never by the clock.
      .filter((k) => !k.startsWith("action:")).slice(0, limit);
  },
  async sweep(beforeIso) {
    return (must(await table().delete().lt("finished_at", beforeIso).select("id")) || []).length;
  },
};

let _outbox = null;
export const outbox = () => (_outbox ||= makeOutbox({ repo: postgresRepo, channels: outboxChannels() }));

export const outboxEnabled = (env = process.env) => String(env.AKORO_OUTBOX ?? "on").toLowerCase() !== "off";

/**
 * Store first, send after — or, if the outbox can't take it, the direct send
 * as before. Never throws. → { via: "outbox" | "direct" | "duplicate", done }
 */
export async function outboxSend(channel, { orderKey, idemKey, userId = null, payload = {} }, direct = null) {
  const fallback = async (why) => {
    if (why) console.warn(`[outbox] ${channel}: ${why} — sending directly`);
    const done = direct ? Promise.resolve().then(direct).catch((e) => console.warn(`[outbox] direct ${channel} failed:`, e?.message)) : Promise.resolve();
    return { via: "direct", done };
  };
  if (!outboxEnabled()) return fallback(null);
  try {
    const r = await outbox().enqueue({ channel, orderKey, idemKey, userId, payload });
    return { via: r.duplicate ? "duplicate" : "outbox", done: r.done, row: r.row };
  } catch (e) {
    return fallback(`not stored (${e.message})`);
  }
}

/** A workflow's outside step, at most once; the journal unreadable → it just acts, as before. */
export async function outsideAction({ kind, key, userId = null, act, check = null }) {
  if (!outboxEnabled() || !key) return { result: await act() };
  try {
    return await outbox().outsideAction({ kind, key, userId, act, check });
  } catch (e) {
    // The action's own failure, or another process on the same step: as is.
    if (e?.code === "action_in_flight" || e?.outboxActed) throw e;
    // The journal itself failed before acting: act directly, as before the outbox.
    console.warn(`[outbox] action ${kind}: journal unavailable (${e?.message}) — acting directly`);
    return { result: await act() };
  }
}

/** A done step reversed by its workflow (e.g. a refund): the next run acts afresh. Never throws. */
export async function undoOutsideAction(key) {
  if (!outboxEnabled() || !key) return false;
  try { return await outbox().undoAction(key); } catch (e) { console.warn("[outbox] undo failed:", e?.message); return false; }
}

let timer = null;
/** The clock (retries and what a restart left). Postgres only. */
export function startOutbox({ everyMs = 15_000 } = {}) {
  if (timer || !outboxEnabled()) return;
  let running = false;
  let ticks = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await outbox().drain();
      if (r.keys) console.log(`[outbox] worked ${r.keys} key(s)`);
      if (++ticks % Math.max(1, Math.round(3_600_000 / everyMs)) === 1) {
        const n = await postgresRepo.sweep(new Date(Date.now() - OUTBOX.KEEP_DAYS * 864e5).toISOString()).catch(() => 0);
        if (n) console.log(`[outbox] swept ${n} finished row(s)`);
      }
    } catch (e) {
      console.warn("[outbox] tick failed:", e.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, everyMs);
  timer.unref?.();
  setTimeout(tick, 5_000).unref?.();
}
