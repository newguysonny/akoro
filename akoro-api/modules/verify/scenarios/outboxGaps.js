/**
 * Phase 18 item 5 follow-ups (store first, send after):
 *   outbox.bell_row_once          a bell row sent through the outbox (its first write failed) lands
 *                                 once, under the id chosen at the time — a second write of the same
 *                                 work, or a retry of the row itself, makes no second row
 *   outbox.proposal_battle_once   Allow on a revision_battle card makes one check battle; interrupted
 *                                 after it was made, the retry finds that battle instead of a second
 */
import { randomUUID } from "node:crypto";
import db from "../../../db.js";

const LEARNER = "@tester19";
const edu = () => db.schema("edu");

export const bellRowOnce = {
  name: "outbox.bell_row_once", area: "outbox", risk: "write",
  description: "A bell row queued in the outbox lands once under its chosen id; a duplicate enqueue or a retried write makes no second row.",
  params: { learner: { default: LEARNER } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { outbox } = await import("../../../lib/outbox.js");
    const { idemKey } = await import("../../../lib/outboxCore.js");
    const { writeInAppRow } = await import("../../notify.js");
    const id = randomUUID();
    const key = idemKey("notify", id, "in_app");
    const payload = { id, userId: me.id, type: "system", title: `${ctx.marker} bell check`, content: "outbox gate" };
    ctx.cleanup(() => db.from("notifications").delete().eq("id", id).eq("user_id", me.id));
    ctx.cleanup(() => edu().from("outbox").delete().eq("idem_key", key));
    const first = await outbox().enqueue({ channel: "in_app", orderKey: `in_app:${me.id}`, idemKey: key, userId: me.id, payload });
    await first.done;
    const again = await outbox().enqueue({ channel: "in_app", orderKey: `in_app:${me.id}`, idemKey: key, userId: me.id, payload });
    ctx.expect.ok("the second write of the same work is a duplicate", again.duplicate === true, again);
    const retried = await writeInAppRow(payload);
    ctx.expect.eq("a retried write finds the row already there", retried?.id, id);
    const rows = await ctx.db.rows("notifications", { id }, { columns: "id, user_id, title" });
    ctx.expect.eq("exactly one bell row", rows.length, 1);
    ctx.expect.eq("…the learner's", rows[0]?.user_id, me.id);
    const [box] = await ctx.db.rows("edu.outbox", { idem_key: key }, { columns: "status, attempts, channel" });
    ctx.expect.eq("the outbox recorded it sent", box?.status, "sent");
  },
};

export const proposalBattleOnce = {
  name: "outbox.proposal_battle_once", area: "outbox", risk: "write", timeoutMs: 240_000,
  description: "Allow on a revision_battle card makes one check battle; after an interruption the retry finds it rather than making a second.",
  params: { learner: { default: LEARNER } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const topic = `${ctx.marker} Osmosis`;
    const { data: prop, error } = await edu().from("agent_proposals").insert({
      user_id: me.id, kind: "revision_battle", title: `Revision battle: ${topic}`, rationale: "outbox gate",
      payload: { topic, subject: "Biology" }, status: "proposed", expires_at: new Date(Date.now() + 864e5).toISOString(),
      basis: "inferred", basis_rule: "gate:outbox",
    }).select("id").single();
    if (error) ctx.expect.blocked(`couldn't make the card: ${error.message}`);
    const key = `proposal:${prop.id}:battle`;
    ctx.cleanup(() => edu().from("agent_proposals").delete().eq("id", prop.id).eq("user_id", me.id));
    ctx.cleanup(() => edu().from("outbox").delete().eq("idem_key", key));
    ctx.cleanup(async () => {
      const { data: bs } = await db.from("battles").select("id").eq("battle_type", "check").eq("topic", topic);
      for (const b of bs || []) { await db.from("battle_participants").delete().eq("battle_id", b.id); await db.from("battles").delete().eq("id", b.id); }
    });

    const { approveProposal, madeCheckBattle } = await import("../../agent-proposals/inbox.js");
    const r = await approveProposal(me.id, prop.id).catch((e) => ({ error: e.message }));
    ctx.note(`approve: ${JSON.stringify(r).slice(0, 240)}`);
    const [journal] = await ctx.db.rows("edu.outbox", { idem_key: key }, { columns: "id, status, result, channel" });
    ctx.expect.ok("the battle step is journaled and done", journal?.status === "sent" && journal?.channel === "action:proposal_check_battle", journal);
    const battleId = journal?.result?.battleId;
    ctx.expect.ok("…with the battle it made", !!battleId, journal?.result);

    // An interruption after the battle was made: the journal row left "sending", gone stale.
    await edu().from("outbox").update({ status: "sending", claimed_at: new Date(Date.now() - 3600_000).toISOString(), result: null }).eq("id", journal.id);
    const { outsideAction } = await import("../../../lib/outbox.js");
    let madeAgain = false;
    const again = await outsideAction({ kind: "proposal_check_battle", key, userId: me.id,
      act: async () => { madeAgain = true; return { battleId: "should-not-happen" }; },
      check: (j) => madeCheckBattle({ learnerId: me.id, topic, since: j.created_at }) });
    ctx.note(`retry: ${JSON.stringify(again).slice(0, 200)}`);
    ctx.expect.ok("the retry finds the battle, makes none", !madeAgain && again?.result?.battleId === battleId, again);
    const { data: bs } = await db.from("battles").select("id").eq("battle_type", "check").eq("topic", topic);
    ctx.expect.eq("one check battle in all", (bs || []).length, 1);
  },
};

export const OUTBOX_GAPS = [bellRowOnce, proposalBattleOnce];
