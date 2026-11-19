// D44: the protégé's per-concept forgetting curve, on the live database.

export const conceptCurve = {
  name: "decay.concept_curve", area: "decay", risk: "write",
  description: "Knowledge decays per concept on the slow curve without compounding, and a review session is built from the topic's concepts, faded first.",
  params: { learner: { default: "@tester17" }, topic: { default: "Cells" }, subject: { default: "Biology" } },
  async run(ctx, p) {
    for (const [table, cols] of [["edu.agent_knowledge", "learned_confidence, learned_at, stability_days"], ["edu.decay_notifications", "concepts"]]) {
      const probe = await ctx.db.probe(table, cols);
      ctx.expect.ok(`${table} has ${cols}`, probe.ok, probe.error);
    }
    const me = await ctx.as(p.learner);
    const [agent] = await ctx.db.rows("edu.student_agents", { student_id: me.id }, { columns: "id", limit: 1 });
    if (!agent) ctx.expect.blocked(`${p.learner} has no learning agent`);
    const concepts = await ctx.db.rows("edu.agent_knowledge", { agent_id: agent.id, topic: p.topic }, { columns: "id, subtopic, confidence", limit: 50 });
    if (concepts.filter((c) => c.subtopic).length < 2) ctx.expect.blocked(`${p.learner} has no concept rows for ${p.topic} (2026-seed-sandbox-concepts.sql, sandbox only)`);

    const { decayEngine } = await import("../../adaptive-learning/index.js");
    // The nightly pass, twice: the second run must change nothing.
    await decayEngine.applyDecay(agent.id);
    const snap = async () => Object.fromEntries((await ctx.db.rows("edu.agent_knowledge", { agent_id: agent.id }, { columns: "id, confidence", limit: 500 })).map((r) => [r.id, Number(r.confidence)]));
    const first = await snap();
    await decayEngine.applyDecay(agent.id);
    const second = await snap();
    const drift = Object.keys(first).filter((id) => Math.abs(first[id] - second[id]) > 0.004);
    ctx.expect.eq("a second nightly run doesn't decay again", drift.length, 0);

    const session = await decayEngine.generateDecaySession(agent.id, me.id, p.subject, p.topic);
    const names = concepts.map((c) => c.subtopic).filter(Boolean);
    ctx.note(`review: ${JSON.stringify(session.mustKnowParts)}; faded ${JSON.stringify((session.fadedConcepts || []).map((c) => c.concept))}; topic ${Math.round((session.confidence || 0) * 100)}%`);
    ctx.expect.ok("the review is the topic's concepts (no model-made list)", session.mustKnowParts.length === names.length && session.mustKnowParts.every((n) => names.includes(n)), session.mustKnowParts);
    const confs = session.concepts.map((c) => c.confidence);
    ctx.expect.ok("weakest concept first", confs.every((c, i) => i === 0 || confs[i - 1] <= c), confs);
    ctx.expect.ok("a long-unreviewed concept is faded while recent ones aren't", (session.fadedConcepts || []).length >= 1 && (session.fadedConcepts || []).length < names.length, session.fadedConcepts);
  },
};
