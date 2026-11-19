// Teaching sessions run for the Python agent through the agent bridge
// (D43). The bridge's work is driven directly (teachingBridge) for a test
// learner: its HTTP layer only adds the gateway secret + capability check,
// which are unchanged and contract-tested.

export const bridgePersists = {
  name: "teaching.bridge_persists", area: "teaching", risk: "write",
  description: "A bridged teaching session is saved, its turns are saved, ending completes it, and a continuation restores it — only for its own learner.",
  params: { learner: { default: "@tester15" }, other: { default: "@tester16" }, topic: { default: "Fractions" }, subject: { default: "Mathematics" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const other = await ctx.as(p.other);
    const { teachingBridge } = await import("../../agent-tools/index.js");
    const claims = { sub: me.id, scope: "student" };
    const sid = (tag) => `gate-${tag}-${Date.now().toString(36)}`;
    const rows = new Set();
    const keep = (id, owner = me.id) => {
      if (!id || rows.has(id)) return;
      rows.add(id);
      ctx.cleanup(() => ctx.db.deleteOwned("edu.adaptive_sessions", { ownerColumn: "student_id", ownerId: owner, filters: { id } }));
    };
    const row = async (id) => (await ctx.db.rows("edu.adaptive_sessions", { id }, { columns: "id, student_id, status, block_history, topic", limit: 1 }))[0];

    // 1. Start: saved before it's offered, for the capability's learner.
    const s1 = sid("a");
    const started = await teachingBridge.startSession(claims, s1, { topic: p.topic, subject: p.subject, mode: "fresh" });
    const recordId = started.session?.recordId;
    keep(recordId);
    ctx.expect.ok("session saved at start (recordId)", !!recordId && started.session?.saved === true, JSON.stringify({ recordId, saved: started.session?.saved }));
    const r1 = recordId ? await row(recordId) : null;
    ctx.expect.eq("row belongs to the learner", r1?.student_id, me.id);
    ctx.expect.eq("row is active", r1?.status, "active");
    const before = (r1?.block_history || []).length;

    // 2. A turn is saved.
    const turn = await teachingBridge.runTurn(claims, s1, { message: "A fraction is a part of a whole — like one slice out of four slices of bread is one quarter.", turnId: `turn-${Date.now()}` });
    ctx.expect.ok("turn answered", !!turn.turn, JSON.stringify(turn).slice(0, 200));
    const r2 = recordId ? await row(recordId) : null;
    ctx.expect.gte("turn saved to the session", (r2?.block_history || []).length, before + 2);

    // 3. Ending completes the row.
    const ended = await teachingBridge.endSession(claims, s1);
    ctx.expect.eq("end reports the record", ended.recordId, recordId);
    ctx.expect.eq("row completed", (await row(recordId))?.status, "complete");

    // 4. A continuation restores the earlier conversation.
    const s2 = sid("b");
    const cont = await teachingBridge.startSession(claims, s2, { topic: p.topic, subject: p.subject, mode: "continuation", previousSessionId: recordId });
    keep(cont.session?.recordId);
    ctx.expect.eq("continuation session type", cont.session?.sessionType, "continuation");
    ctx.expect.gte("continuation restores the earlier conversation", (cont.session?.historyBlocks || []).length, 1);
    ctx.expect.ok("continuation is its own saved row", !!cont.session?.recordId && cont.session.recordId !== recordId);
    await teachingBridge.endSession(claims, s2).catch(() => {});

    // 5. Another learner can't continue it: their session starts empty.
    const s3 = sid("c");
    const foreign = await teachingBridge.startSession({ sub: other.id, scope: "student" }, s3, { topic: p.topic, subject: p.subject, mode: "continuation", previousSessionId: recordId });
    keep(foreign.session?.recordId, other.id);
    ctx.expect.eq("another learner gets none of the earlier conversation", (foreign.session?.historyBlocks || []).length, 0);
    await teachingBridge.endSession({ sub: other.id, scope: "student" }, s3).catch(() => {});

    // 6. A continuation needs its earlier session.
    let refused = null;
    try { await teachingBridge.startSession(claims, sid("d"), { topic: p.topic, mode: "continuation" }); } catch (e) { refused = e; }
    ctx.expect.eq("continuation without previousSessionId is refused", refused?.status, 422);
  },
};
