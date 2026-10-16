// Smoke: the deployed server is up, reports its build, and serves the tools.
export const healthBuild = {
  name: "smoke.health_build", area: "smoke", risk: "read",
  description: "/health answers OK and reports the deployed commit.",
  async run(ctx) {
    const r = await ctx.health();
    ctx.expect.status("health answers 200", r, 200);
    ctx.expect.ok("health reports a build commit", !!r.body?.build?.git, "RENDER_GIT_COMMIT is set on Render");
    ctx.note(`build ${r.body?.build?.git || "unknown"}`);
  },
};

export const toolsCatalogue = {
  name: "smoke.tools_catalogue", area: "smoke", risk: "read",
  description: "The learner tool catalogue loads and contains the core tools.",
  async run(ctx) {
    const { getLearnerChatTools } = await import("../../adaptive-learning/chat.js");
    const names = getLearnerChatTools().map((t) => t.name);
    ctx.expect.gte("tool count", names.length, 40);
    for (const t of ["get_learner_context", "create_task", "schedule_chat_follow_up", "list_chats", "read_chat", "post_to_chat", "search_agents"]) {
      ctx.expect.includes(`catalogue has ${t}`, names, t);
    }
    ctx.expect.eq("no duplicate tool names", names.length, new Set(names).size);
  },
};
