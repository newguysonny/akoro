// Platform guarantees: rate limits and battle entry gates.
export const rateLimitCountedOnce = {
  name: "ratelimit.counted_once", area: "platform", risk: "read",
  description: "One request costs exactly one unit of the per-minute budget (the triple-count 429 fix).",
  async run(ctx) {
    const path = "/api/blogs/__verify_probe_does_not_exist";
    const a = await ctx.http({ path });
    const b = await ctx.http({ path });
    const rem = (r) => Number(r.headers["ratelimit-remaining"] ?? r.headers["x-ratelimit-remaining"]);
    if (!Number.isFinite(rem(a)) || !Number.isFinite(rem(b))) ctx.expect.blocked("the API sent no RateLimit-Remaining header");
    ctx.expect.eq("budget drops by exactly 1 per request", rem(a) - rem(b), 1);
  },
};

export const battleEntryGates = {
  name: "battles.entry_gates", area: "battles", risk: "read",
  description: "Battle entry: a learner with coins (school-billed) may join; one with 0 coins is told why not.",
  async run(ctx) {
    const rows = await ctx.db.rows("battles", { title: "Scheduled: Energy battle" }, { columns: "id, total_questions", limit: 1 });
    if (!rows.length) ctx.expect.blocked("seeded battle 'Scheduled: Energy battle' not found");
    const path = `/api/battle/battles/${rows[0].id}/entry`;
    const rich = await ctx.http({ as: "@tester01", path });
    ctx.expect.status("entry check answers", rich, 200);
    ctx.expect.eq("tester01 (school coins) may enter", rich.body?.data?.ok ?? rich.body?.ok, true);
    // Fixture check: tester35 must be an independent learner with an empty
    // wallet, or this proves nothing (a school link bills the school instead).
    const t35 = await ctx.as("@tester35");
    const links = [
      ...(await ctx.db.rows("classroom_students", { user_id: t35.id, status: "active" }, { columns: "classroom_id", limit: 5 })),
      ...(await ctx.db.rows("mgmt.students", { user_id: t35.id }, { columns: "school_id", limit: 5 })),
    ];
    if (links.length) ctx.expect.blocked("fixture drift: tester35 is linked to a school, so its battles bill the school — re-run 2026-seed-agent-testers.sql / check 2026-seed-demo-schools.sql");
    const wallet = await ctx.db.rows("coin_accounts", { owner_type: "user", owner_id: t35.id }, { columns: "balance", limit: 1 });
    if (Number(wallet[0]?.balance || 0) >= Number(rows[0].total_questions || 10)) ctx.expect.blocked("fixture drift: tester35's wallet isn't empty");
    const broke = await ctx.http({ as: "@tester35", path });
    const r = broke.body?.data ?? broke.body;
    ctx.expect.eq("tester35 (0 coins) may not enter", r?.ok, false);
    ctx.expect.ok("and is told about coins", /coin/i.test(String(r?.message || "")), r?.message);
  },
};
