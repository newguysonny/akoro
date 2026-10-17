// Study Prep through its real REST route, as a test learner (risk: write —
// a session row is created, then cancelled and deleted).

export const planCompletes = {
  name: "studyprep.plan_completes", area: "study-prep", risk: "write",
  description: "Starting a Study Prep session runs the planning agent to a proposed plan — not a session stuck in 'planning'.",
  params: { learner: { default: "@tester12" }, subject: { default: "Basic Science" }, classLevel: { default: "JSS1" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    // One active session per learner: remove sessions earlier gate runs left
    // (they carry a run marker in the goal), then cancel any other active one.
    const stale = await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
    if (stale) ctx.note(`removed ${stale} leftover gate session(s)`);
    const active = await ctx.http({ as: p.learner, path: "/api/adaptive/study-prep/sessions" });
    const prior = active.body?.session;
    if (prior?.id) await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/study-prep/sessions/${prior.id}/cancel`, body: {} });
    // Registered before creating: even a failed create leaves nothing behind.
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/study-prep/sessions",
      body: { goal: `${ctx.marker} Prepare for my ${p.classLevel} ${p.subject} test next week`, subject: p.subject, classLevel: p.classLevel, examBoard: "WAEC" } });
    const session = made.body?.session;
    ctx.expect.status("session created", made, 201);
    const events = made.body?.events || [];
    const failures = events.filter((e) => e.eventType === "observation" && e.facts?.ok === false).map((e) => e.facts?.error?.message || e.facts?.error || "error");
    ctx.note(`loop: ${JSON.stringify(made.body?.loop || null)}; status ${session?.status}; ${events.length} events${failures.length ? `; failed tool calls: ${failures.slice(0, 3).join(" | ")}` : ""}`);
    if (made.status >= 400) ctx.note(`error: ${JSON.stringify(made.body).slice(0, 300)}`);
    ctx.expect.eq("planning ends with a plan to confirm", session?.status, "awaiting_confirmation");
    ctx.expect.gte("plan has topics", Array.isArray(session?.plan) ? session.plan.length : 0, 1);
  },
};

export const practiceChargedOnce = {
  name: "studyprep.practice_charged_once", area: "study-prep", risk: "write",
  description: "One Study Prep practice costs the learner exactly the flat practice price — the question generation is not billed on top.",
  params: { learner: { default: "@tester13" }, subject: { default: "Basic Science" }, classLevel: { default: "JSS1" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const base = "/api/adaptive/study-prep/sessions";
    await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
    const active = await ctx.http({ as: p.learner, path: base });
    if (active.body?.session?.id) await ctx.http({ as: p.learner, method: "POST", path: `${base}/${active.body.session.id}/cancel`, body: {} });
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

    const made = await ctx.http({ as: p.learner, method: "POST", path: base,
      body: { goal: `${ctx.marker} Revise ${p.subject} before my test`, subject: p.subject, classLevel: p.classLevel, examBoard: "WAEC" } });
    const id = made.body?.session?.id;
    if (made.body?.session?.status !== "awaiting_confirmation") ctx.expect.blocked(`planning didn't reach a plan (${made.body?.session?.status || made.status}) — run studyprep.plan_completes`);
    const confirmed = await ctx.http({ as: p.learner, method: "POST", path: `${base}/${id}/confirm`, body: {} });
    ctx.expect.status("plan confirmed", confirmed, [200, 201]);
    const topic = (confirmed.body?.topics || []).find((t) => t.status === "active");
    if (!topic) ctx.expect.blocked("no active topic after confirming the plan");

    const [acct] = await ctx.db.rows("coin_accounts", { owner_id: me.id }, { columns: "id, balance", limit: 1 });
    if (!acct) ctx.expect.blocked(`${p.learner} has no coin account`);
    const t0 = new Date(Date.now() - 1000).toISOString();
    const practice = await ctx.http({ as: p.learner, method: "POST", path: `${base}/${id}/topics/${topic.id}/practice`, body: { mode: "diagnostic" } });
    if (practice.status === 402) ctx.expect.blocked(`${p.learner} can't afford a practice`);
    ctx.expect.status("practice generated", practice, [200, 201]);
    const runId = practice.body?.run?.id;
    if (runId) ctx.cleanup(() => ctx.db.deleteOwned("edu.learner_exam_prep_runs", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: runId } }));

    // Token charges are written just after the provider answers — give them a moment.
    await new Promise((r) => setTimeout(r, 8000));
    const recent = (await ctx.db.rows("coin_transactions", { account_id: acct.id }, { columns: "delta, type, feature, created_at", limit: 30, order: { column: "created_at", ascending: false } }))
      .filter((t) => t.created_at >= t0 && t.type === "debit");
    ctx.note(`debits since the practice started: ${JSON.stringify(recent.map((t) => ({ feature: t.feature, delta: t.delta })))}`);
    const flat = recent.filter((t) => t.feature === "study_prep_practice");
    ctx.expect.eq("one flat practice charge", flat.length, 1);
    ctx.expect.eq("flat charge is 2 coins", flat[0]?.delta, -2);
    ctx.expect.eq("question generation not billed to the learner", recent.filter((t) => t.feature !== "study_prep_practice").length, 0);
  },
};
