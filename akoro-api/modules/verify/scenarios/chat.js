// Agent Chat: real turns through the real route, as a test learner.
const READ_TOOLS = [
  ["get_learner_context", {}], ["get_agent_capabilities", {}], ["list_tasks", {}], ["check_progress", {}],
  ["get_ranking", {}], ["get_weak_topics", {}], ["get_my_learning_sessions", {}], ["get_my_school", {}],
  ["list_school_subjects", {}], ["list_my_teachers", {}], ["list_my_goals", {}], ["list_scheduled_chat_follow_ups", {}],
  ["list_chats", {}], ["search_agents", {}], ["check_agent_inbox", {}], ["find_battles", {}],
  ["search_challenge_requests", {}], ["list_my_blogs", {}], ["get_learning_overview", {}], ["get_knowledge_map", {}],
  ["get_agent_preferences", {}], ["get_autonomy_status", {}], ["list_my_proposals", {}], ["get_weekly_league", {}],
];

export const scheduleMessageHere = {
  name: "chat.schedule_message_here", area: "agent-chat", risk: "dry", repeats: 3,
  description: "'Message me here in 10 minutes' schedules a message into THIS chat (not a task with no time).",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const turn = await ctx.agent.chat({ as: p.learner, model: p.model, prompt: "Priority low, I want you to send me a message in the next 10 minutes, the message should be sent here" });
    ctx.expect.eq("turn answered", turn.status, 200);
    ctx.expect.toolCalled(turn, "schedule_chat_follow_up");
    ctx.expect.toolArgs(turn, "schedule_chat_follow_up", { where: "here", inMinutes: 10 });
    ctx.expect.toolNotCalled(turn, "create_task");
    ctx.expect.noBackendNames("reply has no backend names", turn.reply);
    ctx.expect.loopHealthy(turn);
  },
};

export const toolErrorHonesty = {
  name: "chat.tool_error_honesty", area: "agent-chat", risk: "dry", repeats: 3,
  description: "When a tool fails (a chat that doesn't exist), the agent says so instead of pretending.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const turn = await ctx.agent.chat({ as: p.learner, model: p.model,
      prompt: "Read my chat 7b0f3c2a-1d4e-4f5a-9b6c-2e8d7a1c3f40 and tell me what we discussed there." });
    ctx.expect.eq("turn answered", turn.status, 200);
    ctx.expect.toolCalled(turn, "read_chat");
    ctx.expect.ok("read_chat failed (the chat doesn't exist)", (turn.tools || []).some((t) => t.tool === "read_chat" && t.success === false));
    ctx.expect.honest(turn);
    ctx.expect.loopHealthy(turn);
  },
};

export const historyTools = {
  name: "chat.history_tools", area: "agent-chat", risk: "read",
  description: "list_chats / read_chat return only the learner's own chats.",
  params: { learner: { default: "@tester01" }, other: { default: "@tester02" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const other = await ctx.as(p.other);
    const list = await ctx.agent.tool({ as: p.learner, tool: "list_chats", input: { limit: 30 } });
    ctx.expect.ok("list_chats ran", !list?.error, list?.error);
    const ids = (list?.chats || []).map((c) => c.chatId);
    const owned = ids.length ? await ctx.db.rows("chat_sessions", { id: { in: ids } }, { columns: "id, user_id" }) : [];
    ctx.expect.ok("every listed chat belongs to the learner", owned.length === ids.length && owned.every((r) => r.user_id === me.id),
      `${owned.filter((r) => r.user_id !== me.id).length} foreign`);
    const theirs = await ctx.db.rows("chat_sessions", { user_id: other.id }, { columns: "id", limit: 1 });
    if (!theirs.length) ctx.expect.blocked(`${p.other} has no chats to test against`);
    const peek = await ctx.agent.tool({ as: p.learner, tool: "read_chat", input: { chatId: theirs[0].id } });
    ctx.expect.ok("reading another learner's chat is refused", !!peek?.error && !peek?.messages, peek?.messages ? "messages returned!" : peek?.error);
    if (ids.length) {
      const mine = await ctx.agent.tool({ as: p.learner, tool: "read_chat", input: { chatId: ids[0] } });
      ctx.expect.ok("reading an own chat works", Array.isArray(mine?.messages), mine?.error);
    }
  },
};

export const readToolsRun = {
  name: "chat.read_tools_run", area: "agent-chat", risk: "read",
  description: "Every read-only learner tool runs for the learner without an error.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const { getLearnerChatTools } = await import("../../adaptive-learning/chat.js");
    const enabled = new Set(getLearnerChatTools().map((t) => t.name));
    let ran = 0;
    for (const [tool, input] of READ_TOOLS) {
      if (!enabled.has(tool)) { ctx.note(`${tool} not enabled here — skipped`); continue; }
      const r = await ctx.agent.tool({ as: p.learner, tool, input });
      ran++;
      ctx.expect.ok(`${tool} runs`, r && !r.error && !r.threw, r?.error || r?.threw);
    }
    ctx.expect.gte("read tools exercised", ran, 15);
  },
};

export const dryRunNoWrites = {
  name: "chat.dry_run_no_writes", area: "agent-chat", risk: "dry",
  description: "In dry mode, write tools are simulated and nothing changes in the database.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const before = {
      tasks: await ctx.db.count("tasks", { creator_id: me.id }),
      goals: await ctx.db.count("edu.learner_goals", { user_id: me.id }),
      followUps: await ctx.db.count("edu.scheduled_chat_follow_ups", { user_id: me.id }),
    };
    for (const [tool, input] of [
      ["create_task", { title: "Verify gate dry task", priority: "low" }],
      ["create_goal", { title: "Verify gate dry goal" }],
      ["schedule_chat_follow_up", { message: "Verify gate dry follow-up", inMinutes: 30 }],
    ]) {
      const r = await ctx.agent.tool({ as: p.learner, tool, input, mode: "dry" });
      ctx.expect.ok(`${tool} was simulated`, r?.dryRun === true && r?.wouldDo === tool, JSON.stringify(r)?.slice(0, 160));
    }
    const after = {
      tasks: await ctx.db.count("tasks", { creator_id: me.id }),
      goals: await ctx.db.count("edu.learner_goals", { user_id: me.id }),
      followUps: await ctx.db.count("edu.scheduled_chat_follow_ups", { user_id: me.id }),
    };
    ctx.expect.eq("database unchanged", after, before);
  },
};
