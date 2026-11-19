/**
 * Phase 18 items 1 and 5 — watch-only mode for proactive work, and store
 * first, send after. Test learners only (@testerNN); every change to a kind's
 * mode is scoped to the tester and restored afterwards.
 *
 *   agent.kind_observe_then_live   an observe kind runs a cycle: recorded, nothing shown, nothing
 *                                  spent; switched live for that learner: delivered into their chat
 *   outbox.delivery                a send that fails twice then succeeds goes once, in order; the
 *                                  same work again is a no-op
 */
import { runAutonomyCycleForUser } from "../../autonomy/index.js";
import { deliverProactive } from "../../autonomy/index.js";
import { forgetKindModes } from "../../autonomy/index.js";
import { LEARNER_PROACTIVE_KINDS } from "../../autonomy/index.js";
import { budgetState } from "../../../lib/budget.js";

const db = async () => (await import("../../../db.js")).default;
const later = () => new Date(Date.now() + 15 * 60 * 1000);

/** Put every learner kind in `mode` for this one learner (a scope on each row), restoring each row afterwards. */
async function scopeLearner(ctx, userId, modeFor) {
  const edu = (await db()).schema("edu");
  const { data: rows, error } = await edu.from("agent_kind_modes").select("*").in("kind", [...LEARNER_PROACTIVE_KINDS]);
  if (error) ctx.expect.blocked(`kind modes unreadable (migration not applied?): ${error.message}`);
  const byKind = new Map((rows || []).map((r) => [r.kind, r]));
  for (const kind of LEARNER_PROACTIVE_KINDS) {
    const before = byKind.get(kind);
    if (before?.scope_mode && before.scope_mode !== "observe" && before.scope_mode !== "live") ctx.expect.blocked(`${kind} has an admin scope (${before.scope_mode}) — not touched`);
    if (before?.scope_mode && (before.scope_user_ids?.length > 1 || before.scope_school_ids?.length)) ctx.expect.blocked(`${kind} has an admin scope — not touched`);
  }
  const restore = async () => {
    for (const kind of LEARNER_PROACTIVE_KINDS) {
      const before = byKind.get(kind);
      if (before) await edu.from("agent_kind_modes").update({ scope_mode: before.scope_mode, scope_user_ids: before.scope_user_ids, scope_school_ids: before.scope_school_ids }).eq("kind", kind);
      else await edu.from("agent_kind_modes").delete().eq("kind", kind).eq("note", "verify gate");
    }
    forgetKindModes();
  };
  ctx.cleanup(restore);
  const set = async (fn) => {
    for (const kind of LEARNER_PROACTIVE_KINDS) {
      const m = fn(kind);
      const base = byKind.get(kind)?.mode || "live";
      const patch = m === base ? { scope_mode: null, scope_user_ids: [], scope_school_ids: [] } : { scope_mode: m, scope_user_ids: [userId], scope_school_ids: [] };
      if (byKind.get(kind)) await edu.from("agent_kind_modes").update(patch).eq("kind", kind);
      else await edu.from("agent_kind_modes").insert({ kind, audience: "learner", mode: base, note: "verify gate", ...patch });
    }
    forgetKindModes();
  };
  await set(modeFor);
  return set;
}

export const kindObserveThenLive = {
  name: "agent.kind_observe_then_live", area: "agent-chat", risk: "write",
  description: "With every proposal kind in observe for a test learner, a planner cycle (its reasoning stubbed with a fixed proposal) records 'would have proposed' with its reason and run, creates no suggestion, posts nothing and spends nothing; with `task` switched live for that learner the same cycle creates the suggestion and it is delivered into their chat.",
  params: { learner: { default: "@tester27" } },
  async run(ctx, p) {
    const as = p.learner;
    const me = await ctx.as(as);
    const before = (await ctx.http({ as, path: "/api/agent/settings" })).body?.data || {};
    ctx.cleanup(() => ctx.http({ as, method: "PATCH", path: "/api/agent/settings", body: { agentOnline: !!before.agentOnline, proactive: before.proactive !== false } }));
    await ctx.http({ as, method: "PATCH", path: "/api/agent/settings", body: { agentOnline: true, proactive: true } });
    const edu = (await db()).schema("edu");
    // Room in the inbox and no post today (test learner only): the live half must be able to deliver.
    await edu.from("agent_proposals").update({ status: "expired" }).eq("user_id", me.id).eq("status", "proposed");
    const today = (await ctx.db.rows("edu.agent_proposals", { user_id: me.id }, { columns: "id, posted_at", limit: 200 }))
      .filter((r) => r.posted_at && Date.now() - new Date(r.posted_at).getTime() < 864e5);
    for (const r of today) await ctx.db.deleteOwned("edu.agent_proposals", { ownerColumn: "user_id", ownerId: me.id, filters: { id: r.id } });
    const chat = await ctx.http({ as, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} kind modes` } });
    const chatId = chat.body?.session?.id;
    if (chatId) ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));

    const title = `${ctx.marker} Revise osmosis for 20 minutes`;
    const reason = async () => ({ summary: `${ctx.marker} gate`, tokens: 0, costUsd: 0, ideas: [],
      proposals: [{ kind: "task", title, rationale: "Your mastery on osmosis is 30% and a review is due.", from_note: null, payload: { title, priority: "medium" } }] });
    const cleanupRuns = (runId) => runId && ctx.cleanup(() => ctx.db.deleteOwned("edu.autonomy_runs", { ownerColumn: "user_id", ownerId: me.id, filters: { id: runId } }));

    // 1. Observe: everything watch-only for this learner.
    const set = await scopeLearner(ctx, me.id, () => "observe");
    const spentBefore = (await budgetState(me.id).catch(() => null))?.spentUsd ?? null;
    const watched = await runAutonomyCycleForUser(me.id, "gate", { reason, force: true });
    cleanupRuns(watched.runId);
    ctx.note(`observe run: ${JSON.stringify(watched)}`);
    ctx.expect.ok("the cycle ran watch-only and recorded one observation", watched.ok && watched.watchOnly === true && watched.observed >= 1 && watched.created === 0, watched);
    const obs = await ctx.db.rows("edu.agent_observations", { user_id: me.id, kind: "task" }, { columns: "id, title, reason, run_id", limit: 20, order: { column: "created_at" } });
    const mine = obs.find((o) => o.title === title);
    if (mine) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_observations", { ownerColumn: "user_id", ownerId: me.id, filters: { id: mine.id } }));
    ctx.expect.ok("…'would have proposed' with its reason and cycle", !!mine && /mastery on osmosis/.test(mine.reason || "") && mine.run_id === watched.runId, mine);
    ctx.expect.eq("…and no suggestion was created", (await ctx.db.rows("edu.agent_proposals", { user_id: me.id, title }, { columns: "id" })).length, 0);
    const run = (await ctx.db.rows("edu.autonomy_runs", { id: watched.runId }, { columns: "observe_only, observed" }))[0];
    ctx.expect.ok("the run is marked watch-only (outside the learner's run caps)", run?.observe_only === true, run);
    const spentAfter = (await budgetState(me.id).catch(() => null))?.spentUsd ?? null;
    ctx.expect.eq("nothing charged to the learner's weekly budget", spentAfter, spentBefore);
    ctx.expect.eq("nothing posted to their chat", (await deliverProactive(me.id, { now: later(), ignoreQuietHours: true })).reason, "nothing_to_post");

    // 2. Live for this learner: the same cycle delivers.
    await set((kind) => (kind === "task" ? "live" : "observe"));
    const live = await runAutonomyCycleForUser(me.id, "gate", { reason, force: true });
    cleanupRuns(live.runId);
    ctx.note(`live run: ${JSON.stringify(live)}`);
    const prop = (await ctx.db.rows("edu.agent_proposals", { user_id: me.id, title }, { columns: "id, status, posted_at, chat_session_id" }))[0];
    if (prop) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_proposals", { ownerColumn: "user_id", ownerId: me.id, filters: { id: prop.id } }));
    ctx.expect.ok("switched live: the suggestion is created", live.ok && live.created === 1 && !!prop, { live, prop });
    const posted = prop?.posted_at ? { posted: true, proposalId: prop.id } : await deliverProactive(me.id, { now: later(), ignoreQuietHours: true });
    ctx.expect.ok("…and delivered into their chat", posted.posted && posted.proposalId === prop?.id, posted);
  },
};

export const outboxDelivery = {
  name: "outbox.delivery", area: "platform", risk: "write",
  description: "Store first, send after: two messages for a test learner on a probe channel, the first failing twice — both stored before any try, the first sent on its third try with backoff (5 s, 10 s), the second only after it, each exactly once; the same work again is a no-op.",
  params: { learner: { default: "@tester27" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { outbox } = await import("../../../lib/outbox.js");
    const box = outbox();
    const sent = [];
    let failures = 2;
    const channel = `gate_probe_${String(ctx.marker).replace(/\W/g, "").slice(0, 20)}`;
    box.channels.set(channel, { async send(payload) {
      if (payload.n === 1 && failures > 0) { failures -= 1; throw new Error("probe: simulated provider 503"); }
      sent.push(payload.n);
      return {};
    } });
    ctx.cleanup(() => box.channels.delete(channel));
    const orderKey = `${channel}:${me.id}`;
    const keys = [1, 2].map((n) => `gate|${ctx.marker}|${n}`);
    ctx.cleanup(async () => { for (const k of keys) await ctx.db.deleteOwned("edu.outbox", { ownerColumn: "user_id", ownerId: me.id, filters: { idem_key: k } }); });

    const first = await box.enqueue({ channel, orderKey, idemKey: keys[0], userId: me.id, payload: { n: 1 } });
    const second = await box.enqueue({ channel, orderKey, idemKey: keys[1], userId: me.id, payload: { n: 2 } });
    ctx.expect.ok("both stored before any attempt", first.created && second.created, { first: first.row?.status, second: second.row?.status });
    await first.done; await second.done;
    ctx.expect.eq("after the first failure nothing has gone (the second waits its turn)", sent, []);
    const done = await ctx.until(async () => (sent.length >= 2 ? sent : null), { timeoutMs: 45_000, everyMs: 2_000 });
    ctx.expect.eq("delivered once each, in order", done, [1, 2]);
    const rows = await ctx.db.rows("edu.outbox", { user_id: me.id, order_key: orderKey }, { columns: "idem_key, status, attempts, last_error", order: { column: "created_at", ascending: true } });
    ctx.expect.eq("kept with their outcome", rows.map((r) => [r.status, r.attempts]), [["sent", 3], ["sent", 1]]);
    const again = await box.enqueue({ channel, orderKey, idemKey: keys[0], userId: me.id, payload: { n: 1 } });
    await again.done;
    ctx.expect.ok("the same work again is a no-op", again.duplicate === true && sent.length === 2, { duplicate: again.duplicate, sent });
  },
};
