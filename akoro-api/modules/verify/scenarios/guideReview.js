/**
 * Guide reviews (reference/Akoro Battles — Model.md): a learner asks the
 * teaching guide for a review; it runs at once on the Agent Check machinery —
 * one seat (the learner's protégé), a mark sheet, no opponent.
 */
export const guideReviewRuns = {
  name: "battles.guide_review", area: "battles", risk: "write", regression: false,
  timeoutMs: 180_000,
  description: "A learner requests a review with the teaching guide: a check battle marked review_host 'guide', one seat (their protégé), it starts on its own; someone else's teaching session is refused.",
  params: { learner: { default: "@tester17" }, subject: { default: "Biology" }, topic: { default: "Photosynthesis" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const probe = await ctx.db.probe("battles", "id, review_host, requested_by, teaching_session_id");
    if (!probe.ok) ctx.expect.blocked(`battles has no guide-review columns yet (migration 2026-guide-review.sql): ${probe.error}`);

    const r = await ctx.http({ as: p.learner, method: "POST", path: "/api/battle/guide-reviews", body: { subject: p.subject, topic: p.topic } });
    if (r.status === 429) ctx.expect.blocked(`the learner is at today's guide-review limit: ${r.body?.error}`);
    ctx.expect.status("the review is requested", r, 201);
    const battleId = r.body?.data?.battleId;
    if (!battleId) return;
    ctx.cleanup(async () => { const { discardCheckBattle } = await import("../../battle/agentCheck.js"); await discardCheckBattle(battleId, me.id); });

    const [b] = await ctx.db.rows("battles", { id: battleId }, { columns: "id, battle_type, review_host, requested_by, title, total_questions, xp_prize, hp_per_miss" });
    ctx.expect.eq("it runs as a check (the guide asks, the protégé answers)", b?.battle_type, "check");
    ctx.expect.eq("…hosted by the guide", b?.review_host, "guide");
    ctx.expect.eq("…asked for by this learner", b?.requested_by, me.id);
    ctx.expect.eq("…titled as a review", b?.title, `Review: ${p.topic}`);
    ctx.expect.ok("…with its questions written", (b?.total_questions ?? 0) >= 3, b);
    ctx.expect.eq("no prize and no HP: a mark sheet, not a battle", [b?.xp_prize, b?.hp_per_miss], [0, 0]);
    const seats = await ctx.db.rows("battle_participants", { battle_id: battleId }, { columns: "user_id, agent_id, joined_at" });
    ctx.expect.eq("one seat: the learner's protégé (no opponent)", seats.map((s) => s.user_id), [me.id]);

    const st = await ctx.http({ as: p.learner, path: `/api/battle/battles/${battleId}/state` });
    ctx.expect.eq("the arena knows the guide hosts it", st.body?.reviewHost, "guide");
    const started = await ctx.until(async () => {
      const [x] = await ctx.db.rows("battles", { id: battleId }, { columns: "status" });
      return ["live", "completed"].includes(x?.status) ? x.status : null;
    }, { timeoutMs: 60_000, everyMs: 4_000 });
    ctx.expect.ok("it starts on its own", !!started, { status: started });

    // Someone else's teaching session is not this learner's to review.
    const [other] = await ctx.db.rows("edu.adaptive_sessions", {}, { columns: "id, student_id", limit: 20 })
      .then((rows) => rows.filter((s) => s.student_id !== me.id)).catch(() => []);
    if (other) {
      const denied = await ctx.http({ as: p.learner, method: "POST", path: "/api/battle/guide-reviews", body: { sessionId: other.id } });
      ctx.expect.status("another learner's session is refused", denied, 403);
    } else ctx.note("no other learner's teaching session to try");
  },
};
