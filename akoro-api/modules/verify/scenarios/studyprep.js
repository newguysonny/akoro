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
