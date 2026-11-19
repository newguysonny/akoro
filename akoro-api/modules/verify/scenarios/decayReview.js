/**
 * Phase 8 on a live server: a Decay Review end to end — the short Agent Check
 * really runs (the battle worker), code decides retained / decayed, the recall
 * rounds take hints and are scored on the server (the key never reaches the
 * learner), the retest runs, a failed retest asks for re-teaching, and the
 * review completes with the forgetting curve updated.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const decayReviewFlow = {
  name: "decay.review_flow", area: "decay", risk: "write", timeoutMs: 600_000,
  description: "A Decay Review: the Review tap starts a 3-question Agent Check; code decides retained/decayed; decayed → recall rounds with the hint ladder, scored server-side (no answer key in what the learner sees) → retest → re-teaching if it fails → the last retest; completed with the curve updated and the review closed.",
  params: { learner: { default: "@tester19" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { getOrCreateStudentAgent } = await import("../../adaptive-learning/index.js");
    const agent = await getOrCreateStudentAgent(me.id);
    const known = await ctx.db.rows("edu.agent_knowledge", { agent_id: agent.id }, { columns: "topic, subject", limit: 20 });
    const pick = known.find((k) => k.topic) || null;
    if (!pick) ctx.expect.blocked(`${p.learner}'s agent has no knowledge to review`);
    const get = async (id) => (await ctx.http({ as: p.learner, path: `/api/adaptive/decay-reviews/${id}` })).body?.review;
    const battles = [];
    let wfId = null;
    ctx.cleanup(async () => {
      const { discardCheckBattle } = await import("../../battle/index.js");
      for (const b of battles) await discardCheckBattle(b, me.id).catch(() => {});
      if (wfId) await ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: wfId } });
    });
    // Any earlier open review of this topic is left alone: start returns it.
    const started = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/decay-reviews", body: { topic: pick.topic, subject: pick.subject } });
    const v0 = started.body?.review;
    ctx.expect.status("the Review tap starts it", started, 200);
    wfId = v0?.workflowId;
    ctx.expect.eq("it opens with the short check", v0?.state, "diagnostic");
    if (v0?.check?.battleId) battles.push(v0.check.battleId);
    // The in-between states (code deciding, the recall question being written) pass by themselves.
    const PASSING = { diagnostic: ["diagnostic", "evaluating", "decayed", "retained"], retest: ["retest", "adapt_strategy"] };
    const waitPast = async (state, ms = 240_000) => {
      const until = Date.now() + ms;
      const states = PASSING[state] || [state];
      let v = await get(wfId);
      while (states.includes(v?.state) && Date.now() < until) { await sleep(5_000); v = await get(wfId); }
      return v;
    };
    let v = await waitPast("diagnostic");
    ctx.note(`check: ${JSON.stringify(v?.check ? { correct: v.check.correct, total: v.check.total, score: v.check.score } : null)} → ${v?.state}`);
    ctx.expect.ok("the check ran and code decided", ["completed", "intervention"].includes(v?.state), v?.state);
    if (v?.state === "completed") {
      ctx.expect.eq("retained → completed", v.outcome?.retained, true);
      ctx.expect.ok("…with the curve updated", v.outcome?.retentionAfter != null || v.outcome?.nextReviewDue != null, v.outcome);
      return;
    }
    // Decayed: the recall rounds.
    ctx.expect.ok("decayed → a recall question", !!v.retrieval?.current?.question, v.retrieval);
    ctx.expect.eq("no hint until asked", (v.retrieval?.current?.hints || []).length, 0);
    const h = await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/decay-reviews/${wfId}/hint` });
    ctx.expect.eq("a hint on request", (h.body?.review?.retrieval?.current?.hints || []).length, 1);
    for (let i = 0; i < 3; i++) {
      const a = await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/decay-reviews/${wfId}/answer`, body: { answer: "I don't remember." } });
      ctx.expect.ok(`recall ${i + 1} scored on the server`, ["correct", "partial", "incorrect"].includes(a.body?.result?.outcome), a.body);
      v = a.body?.review;
      if (i < 2 && v?.state === "intervention") ctx.expect.ok("the answer key isn't in what the learner sees", !JSON.stringify(v.retrieval?.current || {}).includes('"key"'));
    }
    ctx.expect.eq("after the rounds: the retest", v?.state, "retest");
    if (v?.retest?.battleId) battles.push(v.retest.battleId);
    v = await waitPast("retest");
    ctx.note(`retest 1 → ${v?.state} ${JSON.stringify(v?.retest ? { correct: v.retest.correct, total: v.retest.total } : null)}`);
    if (v?.state === "intervention") {
      ctx.expect.ok("a failed retest asks for re-teaching", v.teaching?.needed === true, v.teaching);
      // The re-teaching session's end (what end_session does for a tied session).
      const { decayReview } = await import("../../adaptive-learning/index.js");
      v = await decayReview().teachingDone({ workflowId: wfId, learnerId: me.id });
      ctx.expect.eq("re-teaching done → the last retest", v?.state, "retest");
      ctx.expect.eq("…the second and last", v?.retests, 2);
      if (v?.retest?.battleId) battles.push(v.retest.battleId);
      v = await waitPast("retest");
    }
    ctx.expect.eq("the review completes", v?.state, "completed");
    ctx.expect.ok("…with an honest outcome", typeof v?.outcome?.retained === "boolean" && Array.isArray(v?.outcome?.evidence), v?.outcome);
    ctx.expect.ok("…and the recall rounds in its evidence", (v?.outcome?.evidence || []).some((e) => /^retrieval_/.test(e.kind)));
  },
};
