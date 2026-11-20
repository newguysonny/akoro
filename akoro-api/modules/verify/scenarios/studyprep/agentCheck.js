// A confirmed plan with its first Agent Check started (the agent-check
// scenarios' setup).

export async function startAgentCheckFor(ctx, p) {
  const me = await ctx.as(p.learner);
  const base = "/api/adaptive/study-prep/sessions";
  await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
  const active = await ctx.http({ as: p.learner, path: base });
  if (active.body?.session?.id) await ctx.http({ as: p.learner, method: "POST", path: `${base}/${active.body.session.id}/cancel`, body: {} });
  ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

  const made = await ctx.http({ as: p.learner, method: "POST", path: base,
    body: { goal: `${ctx.marker} Revise ${p.subject} cells before my test`, subject: p.subject, classLevel: p.classLevel, examBoard: "WAEC" } });
  const id = made.body?.session?.id;
  if (made.body?.session?.status !== "awaiting_confirmation") ctx.expect.blocked(`planning didn't reach a plan (${made.body?.session?.status || made.status})`);
  // The protégé's thread for this session, and its notifications.
  ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { session_id: id } }));
  ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id } }));
  ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: me.id, filters: { related_id: id } }));
  const confirmed = await ctx.http({ as: p.learner, method: "POST", path: `${base}/${id}/confirm`, body: {} });
  ctx.expect.status("plan confirmed", confirmed, [200, 201]);
  const topic = (confirmed.body?.topics || []).find((t) => t.status === "active");
  if (!topic) ctx.expect.blocked("no active topic after confirming the plan");

  const [acct] = await ctx.db.rows("coin_accounts", { owner_id: me.id }, { columns: "id, balance", limit: 1 });
  if (!acct) ctx.expect.blocked(`${p.learner} has no coin account`);
  const t0 = new Date(Date.now() - 1000).toISOString();
  const { getAgentCheckHarness } = await import("../../../adaptive-learning/index.js");
  const harness = getAgentCheckHarness({ questions: 3, secondsPerQuestion: 10 });
  let started;
  try {
    started = await harness.startTopicPractice({ sessionId: id, learnerId: me.id, topicId: topic.id, mode: "diagnostic" });
  } catch (e) {
    if (e.code === "insufficient_balance") ctx.expect.blocked(`${p.learner} can't afford a practice`);
    throw e;
  }
  if (started.skipped) {
    ctx.note(`${p.learner} has no notes on "${topic.label}" — the check was skipped with nothing charged (the no-notes rule)`);
    const debits = (await ctx.db.rows("coin_transactions", { account_id: acct.id }, { columns: "delta, type, feature, created_at", limit: 10, order: { column: "created_at", ascending: false } }))
      .filter((t) => t.created_at >= t0 && t.type === "debit");
    ctx.expect.eq("nothing charged when there is nothing to check", debits.length, 0);
    ctx.expect.blocked(`no notes on "${topic.label}" to check — teach ${p.learner}'s agent this topic, or pick a learner with notes on it`);
  }
  const battleId = started.check?.battleId;
  ctx.expect.ok("a check battle was created", !!battleId, JSON.stringify(started.check || null));
  // Registered after the session's cleanup, so it runs first (cleanups run newest first).
  ctx.cleanup(async () => {
    const { discardCheckBattle } = await import("../../../battle/index.js");
    await discardCheckBattle(battleId, me.id);
  });
  ctx.note(`topic "${topic.label}", battle ${battleId}, ${started.check?.questions} questions`);
  return { me, id, topic, acct, t0, battleId, started };
}
