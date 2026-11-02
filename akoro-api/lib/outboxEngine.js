/**
 * lib/outboxEngine.js — the outbox's moving parts over an injectable store
 * (Grand Plan Phase 18 item 5). lib/outbox.js gives it the Postgres store and
 * the clock; the contract tests give it an in-memory one. The rules are in
 * lib/outboxCore.js.
 *
 *   makeOutbox({ repo, channels, now, schedule, log })
 *     .enqueue({ channel, orderKey, idemKey, userId, payload })
 *         → { row, created, duplicate?, done }   written BEFORE any attempt; a second
 *                                                 write of the same idemKey is a no-op
 *     .pumpKey(orderKey)   work one order key in created order until it waits
 *     .drain()             every key with something due (the clock, and after a restart)
 *     .outsideAction({ kind, key, userId, act, check })
 *         → { result, reused?, recovered? }      a workflow's outside step, once:
 *                                                 done before → its result; interrupted
 *                                                 mid-step → check() what happened first
 *
 * repo: insert(row) → { row, created } · byKey(idemKey) · openFor(orderKey) ·
 *       claim(id, { status, claimed_at? }, patch) → row | null · update(id, patch) → row ·
 *       dueKeys(nowIso, staleIso, limit) → [orderKey] · sweep(beforeIso) → n
 * channels: Map name → { send(payload, ctx) → { result? } | { drop }, retryInterrupted?, onFinal?(row) }
 *           send throws to fail an attempt (err.retry === false: no retry; err.progress: what is done).
 */
import { afterAttempt, afterInterrupted, decideAction, headOf, OUTBOX } from "./outboxCore.js";

export function makeOutbox({ repo, channels = new Map(), now = () => Date.now(), schedule = defaultSchedule, log = console } = {}) {
  const pumping = new Map();   // orderKey → the running pump (one per key in this process)

  async function attempt(ch, row) {
    try {
      const r = await ch.send(row.payload || {}, { attempt: (Number(row.attempts) || 0) + 1, progress: row.progress || null, row });
      if (r && r.drop) return { ok: false, drop: r.drop };
      return { ok: true, result: r?.result };
    } catch (e) {
      return { ok: false, error: e?.message || String(e), retry: e?.retry !== false, ...(e?.progress !== undefined ? { progress: e.progress } : {}) };
    }
  }

  const final = (ch, row) => {
    if (row && ["failed", "dropped"].includes(row.status)) Promise.resolve().then(() => ch?.onFinal?.(row)).catch(() => {});
  };

  async function pumpOnce(orderKey) {
    for (let guard = 0; guard < 50; guard++) {
      const h = headOf(await repo.openFor(orderKey), now());
      if (!h || h.action === "busy") return;
      const ch = channels.get(h.row.channel);
      if (!ch) { log.warn?.(`[outbox] no sender for "${h.row.channel}" in this process — kept`); return; }
      if (h.action === "wait") { schedule(h.dueInMs, () => pumpKey(orderKey)); return; }
      if (h.action === "interrupted") {
        const done = await repo.claim(h.row.id, { status: "sending", claimed_at: h.row.claimed_at ?? null }, afterInterrupted(h.row, ch, now()));
        final(ch, done);
        continue;
      }
      const claimed = await repo.claim(h.row.id, { status: "pending" }, { status: "sending", claimed_at: new Date(now()).toISOString() });
      if (!claimed) return;   // another process took it: it pumps the key from here
      const patch = afterAttempt(claimed, await attempt(ch, claimed), now());
      const after = await repo.update(claimed.id, patch);
      final(ch, after);
      if (patch.status === "pending") { schedule(Date.parse(patch.due_at) - now(), () => pumpKey(orderKey)); return; }
    }
  }

  /** Work one order key until it waits. Concurrent calls in this process share one pump. */
  function pumpKey(orderKey) {
    if (pumping.has(orderKey)) return pumping.get(orderKey);
    const p = pumpOnce(orderKey).catch((e) => log.warn?.(`[outbox] ${orderKey}: ${e.message}`)).finally(() => pumping.delete(orderKey));
    pumping.set(orderKey, p);
    return p;
  }

  /** Store first; then the key is worked (the caller may await `done`). */
  async function enqueue({ channel, orderKey, idemKey, userId = null, payload = {}, maxAttempts = OUTBOX.MAX_ATTEMPTS }) {
    if (!channels.has(channel)) throw new Error(`outbox: unknown channel ${channel}`);
    if (!idemKey || !orderKey) throw new Error("outbox: idemKey and orderKey are required");
    const { row, created } = await repo.insert({
      idem_key: idemKey, channel, order_key: orderKey, user_id: userId, payload, status: "pending",
      attempts: 0, max_attempts: maxAttempts, due_at: new Date(now()).toISOString(),
    });
    if (!created) return { row, created: false, duplicate: true, done: Promise.resolve() };
    return { row, created: true, done: pumpKey(orderKey) };
  }

  /** The clock: every key with something due, or a claim left by a process that died. */
  async function drain({ limit = 50 } = {}) {
    const t = now();
    const keys = await repo.dueKeys(new Date(t).toISOString(), new Date(t - OUTBOX.STALE_MS).toISOString(), limit);
    for (const k of keys) await pumpKey(k);
    return { keys: keys.length };
  }

  /**
   * A workflow's outside step (a battle made, a session row created), at most once.
   * key: the step's stable id. act(): does it, returns a JSON result, cleans up on throw.
   * check(row): after an interruption, looks for what act() already did → result | null.
   */
  async function outsideAction({ kind, key, userId = null, act, check = null }) {
    const channel = `action:${kind}`;
    for (let round = 0; round < 3; round++) {
      const row = await repo.byKey(key);
      const d = decideAction(row, now());
      if (d === "reuse") return { result: row.result ?? null, reused: true };
      if (d === "busy") throw Object.assign(new Error("This step is already being done — try again in a moment."), { status: 409, code: "action_in_flight" });
      const stamp = new Date(now()).toISOString();
      let mine;
      if (d === "check") {
        let found = null;
        try {
          found = check ? await check(row) : null;
        } catch (e) {
          // Can't tell what the interrupted step did: stop here rather than risk doing it twice.
          if (e && typeof e === "object") { try { Object.defineProperty(e, "outboxActed", { value: true }); } catch { /* frozen */ } }
          throw e;
        }
        if (found) {
          await repo.update(row.id, { status: "sent", result: found, finished_at: stamp, claimed_at: null, last_error: "interrupted; found done on recovery" });
          return { result: found, reused: true, recovered: true };
        }
        mine = await repo.claim(row.id, { status: "sending", claimed_at: row.claimed_at ?? null }, { status: "sending", claimed_at: stamp, attempts: (Number(row.attempts) || 0) + 1 });
      } else if (!row) {
        const ins = await repo.insert({ idem_key: key, channel, order_key: `action:${key}`, user_id: userId, payload: { kind }, status: "sending", attempts: 1, max_attempts: 1, claimed_at: stamp, due_at: stamp });
        mine = ins.created ? ins.row : null;
      } else {
        mine = await repo.claim(row.id, { status: row.status }, { status: "sending", claimed_at: stamp, attempts: (Number(row.attempts) || 0) + 1, finished_at: null });
      }
      if (!mine) continue;   // raced: read again
      let result;
      try {
        result = await act();
      } catch (e) {
        await repo.update(mine.id, { status: "failed", claimed_at: null, finished_at: new Date(now()).toISOString(), last_error: String(e?.message || e).slice(0, 500) }).catch(() => null);
        // The action's own failure (not the journal's): callers must not act again on it.
        if (e && typeof e === "object") { try { Object.defineProperty(e, "outboxActed", { value: true }); } catch { /* frozen */ } }
        throw e;
      }
      // Done: a journal write failing now must not make anyone act again — the row stays
      // "sending", goes stale, and the next run's check() finds what this one did.
      await repo.update(mine.id, { status: "sent", result: result ?? null, claimed_at: null, finished_at: new Date(now()).toISOString() })
        .catch((e) => log.warn?.(`[outbox] action ${kind}: done, but not recorded (${e?.message}) — recovery will find it`));
      return { result };
    }
    throw Object.assign(new Error("This step is already being done — try again in a moment."), { status: 409, code: "action_in_flight" });
  }

  /** A done step was reversed (a charge refunded): the next run of that step acts afresh. */
  async function undoAction(key) {
    const row = await repo.byKey(key);
    if (!row || row.status !== "sent") return false;
    return !!(await repo.claim(row.id, { status: "sent" }, { status: "failed", last_error: "undone (reversed by its workflow)", finished_at: new Date(now()).toISOString() }));
  }

  return { enqueue, pumpKey, drain, outsideAction, undoAction, channels };
}

function defaultSchedule(ms, fn) {
  const t = setTimeout(fn, Math.max(0, ms));
  t.unref?.();
  return t;
}

/** An in-memory store with the repo's contract (tests, and a reference for the Postgres one). */
export function memoryRepo() {
  const rows = [];
  let seq = 0;
  const OPEN = ["pending", "sending"];
  const copy = (r) => (r ? JSON.parse(JSON.stringify(r)) : null);
  return {
    rows,
    async insert(row) {
      const hit = rows.find((r) => r.idem_key === row.idem_key);
      if (hit) return { row: copy(hit), created: false };
      seq += 1;
      const r = { id: `row-${String(seq).padStart(4, "0")}`, created_at: new Date(Date.now() + seq).toISOString(), claimed_at: null, progress: null, result: null, ...row };
      rows.push(r);
      return { row: copy(r), created: true };
    },
    async byKey(k) { return copy(rows.find((r) => r.idem_key === k)); },
    async openFor(k) { return rows.filter((r) => r.order_key === k && OPEN.includes(r.status)).map(copy); },
    async claim(id, match, patch) {
      const r = rows.find((x) => x.id === id && x.status === match.status && (match.claimed_at === undefined || (x.claimed_at ?? null) === match.claimed_at));
      if (!r) return null;
      Object.assign(r, patch);
      return copy(r);
    },
    async update(id, patch) { const r = rows.find((x) => x.id === id); if (r) Object.assign(r, patch); return copy(r); },
    async dueKeys(nowIso, staleIso, limit = 50) {
      const keys = rows.filter((r) => (r.status === "pending" && r.due_at <= nowIso) || (r.status === "sending" && r.claimed_at && r.claimed_at < staleIso)).map((r) => r.order_key);
      return [...new Set(keys)].slice(0, limit);
    },
    async sweep() { return 0; },
  };
}
