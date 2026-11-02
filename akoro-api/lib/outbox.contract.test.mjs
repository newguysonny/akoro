// Store first, send after (Grand Plan Phase 18 item 5): the outbox's rules and
// its engine over an in-memory store, with the failure cases of §19.
process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { afterAttempt, afterInterrupted, backoffMs, decideAction, headOf, idemKey, OUTBOX } from "./outboxCore.js";
import { makeOutbox, memoryRepo } from "./outboxEngine.js";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");

/** A fake clock and a timer list the test advances by hand. */
function rig(sendImpl, { retryInterrupted = false } = {}) {
  let t = Date.parse("2026-11-02T10:00:00Z");
  const timers = [];
  const repo = memoryRepo();
  const sent = [];
  const channels = new Map([["push", { retryInterrupted, send: (p, ctx) => sendImpl(p, ctx, sent) }]]);
  const box = makeOutbox({ repo, channels, now: () => t, schedule: (ms, fn) => timers.push({ at: t + ms, fn }), log: { warn() {} } });
  const advance = async (ms) => {
    t += ms;
    for (const tm of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (tm.at <= t) await tm.fn(); else timers.push(tm);
    }
  };
  return { box, repo, sent, advance, now: () => t, set: (v) => { t = v; } };
}

test("backoff grows 5 s, doubling, capped at 300 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => backoffMs(n) / 1000), [5, 10, 20, 40, 80, 160, 300, 300]);
});

test("an attempt's outcome → sent · retry later · failed after N · dropped and why", () => {
  const now = Date.parse("2026-11-02T10:00:00Z");
  assert.equal(afterAttempt({ attempts: 0 }, { ok: true }, now).status, "sent");
  const retry = afterAttempt({ attempts: 1, max_attempts: 8 }, { ok: false, error: "503" }, now);
  assert.equal(retry.status, "pending");
  assert.equal(retry.attempts, 2);
  assert.equal(Date.parse(retry.due_at) - now, 10_000);
  const last = afterAttempt({ attempts: 7, max_attempts: 8 }, { ok: false, error: "503" }, now);
  assert.deepEqual([last.status, last.attempts, last.last_error], ["failed", 8, "503"]);
  const drop = afterAttempt({ attempts: 0 }, { ok: false, drop: "no device subscribed" }, now);
  assert.deepEqual([drop.status, drop.drop_reason], ["dropped", "no device subscribed"]);
  assert.equal(afterAttempt({ attempts: 0 }, { ok: false, error: "bad address", retry: false }, now).status, "failed");
});

test("ordering: the oldest open row of a key goes first; nothing jumps it", () => {
  const now = Date.parse("2026-11-02T10:00:00Z");
  const a = { id: "a", status: "pending", created_at: "2026-11-02T09:00:00Z", due_at: "2026-11-02T10:00:20Z" };
  const b = { id: "b", status: "pending", created_at: "2026-11-02T09:01:00Z", due_at: "2026-11-02T09:01:00Z" };
  assert.deepEqual([headOf([b, a], now).row.id, headOf([b, a], now).action], ["a", "wait"], "b is due but waits behind a");
  assert.equal(headOf([{ ...a, status: "sending", claimed_at: new Date(now - 1000).toISOString() }], now).action, "busy");
  assert.equal(headOf([{ ...a, status: "sending", claimed_at: new Date(now - OUTBOX.STALE_MS - 1).toISOString() }], now).action, "interrupted");
  assert.equal(headOf([], now), null);
});

test("idempotency keys are stable, and long ones are hashed", () => {
  assert.equal(idemKey("notify", "n1", "push"), "notify|n1|push");
  assert.equal(idemKey("notify", "n1", "push"), idemKey(["notify", "n1", "push"]));
  const long = idemKey("session", "x".repeat(300));
  assert.ok(long.length < 100 && long.startsWith("session|"));
});

test("a send that fails twice then succeeds is delivered once, and in order", async () => {
  let failures = 2;
  const r = rig(async (p, ctx, sent) => {
    if (p.n === 1 && failures > 0) { failures -= 1; throw new Error("push service 503"); }
    sent.push(p.n);
    return {};
  });
  const one = await r.box.enqueue({ channel: "push", orderKey: "push:u1", idemKey: "k1", userId: "u1", payload: { n: 1 } });
  await one.done;
  const two = await r.box.enqueue({ channel: "push", orderKey: "push:u1", idemKey: "k2", userId: "u1", payload: { n: 2 } });
  await two.done;
  assert.deepEqual(r.sent, [], "both wait: the first is backing off, the second is behind it");
  assert.equal(r.repo.rows[0].attempts, 1);
  await r.advance(5_000);        // second try of #1: fails again
  assert.deepEqual(r.sent, []);
  assert.equal(r.repo.rows[0].attempts, 2);
  await r.advance(10_000);       // third try: sent, then #2 right after
  assert.deepEqual(r.sent, [1, 2], "once each, in order");
  assert.deepEqual(r.repo.rows.map((x) => [x.status, x.attempts]), [["sent", 3], ["sent", 1]]);
  // The same work again is a no-op: nothing is sent twice.
  const again = await r.box.enqueue({ channel: "push", orderKey: "push:u1", idemKey: "k1", userId: "u1", payload: { n: 1 } });
  assert.equal(again.duplicate, true);
  await r.box.drain();
  await r.advance(600_000);
  assert.deepEqual(r.sent, [1, 2]);
});

test("a send that always fails is kept as failed after N tries; a drop says why", async () => {
  const r = rig(async (p) => { if (p.drop) return { drop: "no device subscribed" }; throw new Error("down"); });
  await (await r.box.enqueue({ channel: "push", orderKey: "push:u2", idemKey: "f1", payload: {} })).done;
  for (let i = 0; i < 10; i++) await r.advance(300_000);
  assert.deepEqual([r.repo.rows[0].status, r.repo.rows[0].attempts, r.repo.rows[0].last_error], ["failed", OUTBOX.MAX_ATTEMPTS, "down"]);
  await (await r.box.enqueue({ channel: "push", orderKey: "push:u2", idemKey: "d1", payload: { drop: true } })).done;
  assert.deepEqual([r.repo.rows[1].status, r.repo.rows[1].drop_reason], ["dropped", "no device subscribed"]);
});

test("a partly done push: devices already reached are not pushed again on the retry", async () => {
  let tries = 0;
  const r = rig(async (p, { progress }, sent) => {
    tries += 1;
    const skip = new Set(progress?.done || []);
    const now = ["d1", "d2"].filter((d) => !skip.has(d));
    if (tries === 1) { sent.push("d1"); throw Object.assign(new Error("d2 failed"), { progress: { done: ["d1"] } }); }
    sent.push(...now);
    return {};
  });
  await (await r.box.enqueue({ channel: "push", orderKey: "push:u3", idemKey: "p1", payload: {} })).done;
  await r.advance(5_000);
  assert.deepEqual(r.sent, ["d1", "d2"], "d1 once, d2 on the retry");
});

test("a restart mid-send: the stale claim is dropped (never sent twice), the queue behind it moves on", async () => {
  const r = rig(async (p, ctx, sent) => { sent.push(p.n); return {}; });
  // A process claimed #1 and died; #2 waits behind it.
  await r.repo.insert({ idem_key: "s1", channel: "push", order_key: "push:u4", status: "sending", claimed_at: new Date(r.now() - 10_000).toISOString(), attempts: 0, due_at: new Date(r.now()).toISOString(), payload: { n: 1 } });
  await r.repo.insert({ idem_key: "s2", channel: "push", order_key: "push:u4", status: "pending", attempts: 0, due_at: new Date(r.now()).toISOString(), payload: { n: 2 } });
  await r.box.drain();
  assert.deepEqual(r.sent, [], "a fresh claim is someone else's: left alone");
  await r.advance(OUTBOX.STALE_MS);
  await r.box.drain();
  assert.deepEqual(r.sent, [2], "#1 is not repeated; #2 goes");
  assert.equal(r.repo.rows[0].status, "dropped");
  assert.match(r.repo.rows[0].drop_reason, /never sent twice/);
  assert.equal(afterInterrupted({}, { retryInterrupted: true }).status, "pending", "a channel that can check goes again");
});

test("outside action: decide act · reuse · busy · check", () => {
  const now = Date.parse("2026-11-02T10:00:00Z");
  assert.equal(decideAction(null, now), "act");
  assert.equal(decideAction({ status: "sent" }, now), "reuse");
  assert.equal(decideAction({ status: "failed" }, now), "act");
  assert.equal(decideAction({ status: "sending", claimed_at: new Date(now - 1000).toISOString() }, now), "busy");
  assert.equal(decideAction({ status: "sending", claimed_at: new Date(now - OUTBOX.STALE_MS - 1).toISOString() }, now), "check");
});

test("a restart mid-step repeats nothing: the battle made before the crash is found, not made again", async () => {
  const r = rig(async () => ({}));
  const battles = [];
  const makeBattle = async () => { battles.push({ id: `b${battles.length + 1}`, at: r.now() }); return { battleId: battles.at(-1).id }; };
  const check = async (journal) => battles.find((b) => b.at >= Date.parse(journal.created_at) - 5) ? { battleId: battles.at(-1).id } : null;

  // Run 1: the battle is made, then the process dies before the journal says so.
  await r.repo.insert({ idem_key: "step:1", channel: "action:study_prep_check", order_key: "action:step:1", status: "sending", attempts: 1, max_attempts: 1, claimed_at: new Date(r.now()).toISOString(), due_at: new Date(r.now()).toISOString(), payload: {} });
  r.repo.rows[0].created_at = new Date(r.now()).toISOString();
  await makeBattle();
  // Right after the restart, another tap: the step is still claimed → refused, nothing made.
  await assert.rejects(r.box.outsideAction({ kind: "study_prep_check", key: "step:1", act: makeBattle, check }), (e) => e.code === "action_in_flight");
  // Once the claim is stale: check first → the existing battle, no second one.
  await r.advance(OUTBOX.STALE_MS + 1);
  const resumed = await r.box.outsideAction({ kind: "study_prep_check", key: "step:1", act: makeBattle, check });
  assert.deepEqual([resumed.recovered, resumed.result.battleId, battles.length], [true, "b1", 1]);
  // And again later: reused from the journal.
  const later = await r.box.outsideAction({ kind: "study_prep_check", key: "step:1", act: makeBattle, check });
  assert.deepEqual([later.reused, later.result.battleId, battles.length], [true, "b1", 1]);
});

test("an outside step: done once; a failed act can be tried again; an undone step acts afresh", async () => {
  const r = rig(async () => ({}));
  let calls = 0;
  const act = async () => { calls += 1; if (calls === 1) throw new Error("questions not ready"); return { charge: calls }; };
  await assert.rejects(r.box.outsideAction({ kind: "charge", key: "c:1", act }), /questions not ready/);
  assert.deepEqual((await r.box.outsideAction({ kind: "charge", key: "c:1", act })).result, { charge: 2 });
  assert.deepEqual((await r.box.outsideAction({ kind: "charge", key: "c:1", act })).result, { charge: 2 });
  assert.equal(calls, 2);
  assert.equal(await r.box.undoAction("c:1"), true);   // refunded
  assert.deepEqual((await r.box.outsideAction({ kind: "charge", key: "c:1", act })).result, { charge: 3 });
});

test("wiring: notifications and session notices go through the outbox, with the direct send as the fallback", async () => {
  const [notify, svc, outbox, app, harness, decay, decayWiring, handoff, spWiring] = await Promise.all([
    read("../modules/notify.js"), read("../services/notificationService.js"), read("./outbox.js"), read("../app.js"),
    read("../modules/adaptive-learning/study-prep/harness.js"), read("../modules/adaptive-learning/decay-review/service.js"),
    read("../modules/adaptive-learning/decay-review/wiring.js"), read("../modules/adaptive-learning/study-prep/teaching-handoff.js"),
    read("../modules/adaptive-learning/study-prep/wiring.js"),
  ]);
  assert.match(notify, /outboxSend\("push", \{ orderKey: `push:\$\{userId\}`/);
  assert.match(notify, /\(\) => sendPushToUser\(userId, push\)\)/, "direct push is the fallback");
  assert.match(notify, /outboxSend\("email", \{ orderKey: `email:\$\{userId\}`/);
  for (const ch of ["session_email", "sms", "session_push", "whatsapp"]) assert.match(svc, new RegExp(`dispatch\\("${ch}"`));
  assert.match(outbox, /return fallback\(`not stored/, "an outbox write that fails sends directly");
  assert.match(app, /skipJob\("outbox"\)/);
  assert.match(harness, /steps\.once\(\{ kind: "study_prep_check"/);
  assert.match(harness, /steps\.once\(\{ kind: "study_prep_charge"/);
  assert.match(decay, /actionKey: `decay_review:\$\{wf\.id\}:check`/);
  assert.match(decay, /actionKey: `decay_review:\$\{wf\.id\}:retest:\$\{retests\}`/);
  assert.match(decayWiring, /outsideAction\(\{ kind: "decay_check"/);
  assert.match(handoff, /if \(stalledApproval\(child, Date\.parse\(now\(\)\)\)\) return resumeApproval\(child, auto\);/);
  assert.match(spWiring, /objectives->studyPrep->>workflowId/, "the session row is looked for before it is made");
});
