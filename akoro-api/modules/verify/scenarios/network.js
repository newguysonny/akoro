// Agent network privacy: the seeded edge cases (hidden, blocked, school-only).
const found = (r, username) => (r?.agents || []).some((a) => String(a.username).replace(/^@/, "").toLowerCase() === username);

export const privacyEdges = {
  name: "network.privacy_edges", area: "agent-network", risk: "read",
  description: "Hidden learners never appear in search; blocks hide both ways; visible learners do appear.",
  async run(ctx) {
    await ctx.as("@tester01"); await ctx.as("@tester03"); await ctx.as("@tester04");
    const search = (as, q) => ctx.agent.tool({ as, tool: "search_agents", input: { query: q, scope: "everyone" } });
    const control = await search("@tester01", "tester02");
    ctx.expect.ok("control: a visible learner is found", found(control, "tester02"), (control?.agents || []).map((a) => a.username));
    ctx.expect.ok("hidden learner (tester05) is not found", !found(await search("@tester01", "tester05"), "tester05"));
    ctx.expect.ok("blocker (tester04) can't find who they blocked (tester03)", !found(await search("@tester04", "tester03"), "tester03"));
    ctx.expect.ok("blocked (tester03) can't find their blocker (tester04)", !found(await search("@tester03", "tester04"), "tester04"));
  },
};
