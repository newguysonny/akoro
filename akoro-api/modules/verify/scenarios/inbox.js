/**
 * One inbox (Grand Plan §7.16.8 step 1): the agent's chat suggestions and the
 * planner's proposals in one list, each idea once; accepting does what its
 * kind says (a task, a goal, the chat to start); a dismissal keeps its reason.
 */
export const inboxOneList = {
  name: "agent.inbox_one_list", area: "agent-chat", risk: "write",
  description: "Chat suggestions land in the one inbox once each; accept makes a task, a goal or hands back the chat to start; dismiss keeps the learner's reason; a decided suggestion can't be acted on twice.",
  params: { learner: { default: "@tester22" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const m = ctx.marker;
    ctx.cleanup(() => ctx.db.deleteOwned("agent_suggestions", { ownerColumn: "user_id", ownerId: me.id, filters: { title: { like: `%${m}%` } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("tasks", { ownerColumn: "creator_id", ownerId: me.id, filters: { title: { like: `%${m}%` } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.learner_goals", { ownerColumn: "user_id", ownerId: me.id, filters: { title: { like: `%${m}%` } } }));

    // The agent files four ideas in chat; the same one twice is refused.
    const file = (kind, title) => ctx.agent.tool({ as: p.learner, tool: "suggest_help", mode: "live", input: { kind, title, rationale: `${m} because the gate asks` } });
    const titles = { task: `${m} Revise titration`, goal: `${m} Score an A in Chemistry`, conversation: `${m} Talk through moles`, later: `${m} Make flashcards on bonding` };
    for (const [kind, title] of Object.entries(titles)) {
      const r = await file(kind === "later" ? "task" : kind, title);
      ctx.expect.ok(`filed: ${kind}`, r?.saved === true, r);
    }
    const again = await file("task", titles.task.toUpperCase());
    ctx.expect.ok("the same idea isn't filed twice (any case)", again?.saved === false && again?.duplicate === true, again);

    // One list, each once.
    const inbox = await ctx.http({ as: p.learner, path: "/api/agent/proposals/inbox" });
    ctx.expect.eq("inbox", inbox.status, 200);
    const mine = (inbox.body?.data || []).filter((it) => String(it.title).includes(m));
    ctx.expect.eq("the four ideas, once each", mine.length, 4);
    ctx.expect.ok("each with a ref, source and kind", mine.every((it) => /^s:/.test(it.ref) && it.source === "chat" && it.kind), mine);
    ctx.expect.ok("the dismiss reasons are listed", (inbox.body?.reasons || []).includes("wrong_time"), inbox.body?.reasons);
    const ref = (title) => mine.find((it) => it.title === title)?.ref;

    // Accept: what the kind says.
    const task = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/proposals/inbox/${ref(titles.task)}/accept` });
    ctx.expect.eq("task accepted", task.status, 200);
    ctx.expect.ok("…as a real task", !!task.body?.data?.task?.id && (await ctx.db.count("tasks", { id: task.body?.data?.task?.id })) === 1, task.body?.data);

    const goal = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/proposals/inbox/${ref(titles.goal)}/accept` });
    if (goal.status === 400 && /active goals/i.test(goal.body?.error || "")) ctx.note(`goal cap reached on ${p.learner}: ${goal.body.error}`);
    ctx.expect.eq("goal accepted", goal.status, 200);
    const g = (await ctx.db.rows("edu.learner_goals", { user_id: me.id, title: titles.goal }, { columns: "id, source, status" }))[0];
    ctx.expect.ok("…as a goal, marked as the agent's idea (not a task)", g?.source === "agent" && (await ctx.db.count("tasks", { creator_id: me.id, title: titles.goal })) === 0, g);

    const talk = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/proposals/inbox/${ref(titles.conversation)}/accept` });
    ctx.expect.eq("conversation accepted", talk.status, 200);
    ctx.expect.eq("…handed back as the chat to start", talk.body?.data?.prompt, titles.conversation);
    ctx.expect.eq("…and nothing created for it", await ctx.db.count("tasks", { creator_id: me.id, title: titles.conversation }), 0);

    // Dismiss with a reason.
    const no = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/proposals/inbox/${ref(titles.later)}/dismiss`, body: { reason: "wrong_time" } });
    ctx.expect.eq("dismissed", no.status, 200);
    const row = (await ctx.db.rows("agent_suggestions", { user_id: me.id, title: titles.later }, { columns: "status, dismiss_reason" }))[0];
    ctx.expect.ok("…with the learner's reason kept", row?.status === "dismissed" && row?.dismiss_reason === "wrong_time", row);

    // Decided once.
    const twice = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/proposals/inbox/${ref(titles.task)}/accept` });
    ctx.expect.ok("a decided suggestion can't be accepted again", [404, 409].includes(twice.status), twice.status);
    ctx.expect.eq("still one task", await ctx.db.count("tasks", { creator_id: me.id, title: titles.task }), 1);
    const left = await ctx.http({ as: p.learner, path: "/api/agent/proposals/inbox" });
    ctx.expect.eq("the inbox is empty of them now", (left.body?.data || []).filter((it) => String(it.title).includes(m)).length, 0);

    // Someone else's ref is not found.
    const bogus = await ctx.http({ as: p.learner, method: "POST", path: "/api/agent/proposals/inbox/x:nope/accept" });
    ctx.expect.eq("an unknown ref is refused", bogus.status, 400);
  },
};
