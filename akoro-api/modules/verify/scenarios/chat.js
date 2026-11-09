// Agent Chat: real turns through the real route, as a test learner.
const READ_TOOLS = [
  ["get_learner_context", {}], ["get_agent_capabilities", {}], ["list_tasks", {}], ["check_progress", {}],
  ["get_ranking", {}], ["get_weak_topics", {}], ["get_my_learning_sessions", {}], ["get_my_school", {}],
  ["list_school_subjects", {}], ["list_my_teachers", {}], ["list_my_goals", {}], ["list_scheduled_chat_follow_ups", {}],
  ["list_chats", {}], ["search_agents", {}], ["check_agent_inbox", {}], ["find_battles", {}],
  ["search_challenge_requests", {}], ["list_my_blogs", {}], ["get_learning_overview", {}], ["get_knowledge_map", {}],
  ["get_agent_preferences", {}], ["get_autonomy_status", {}], ["list_my_proposals", {}], ["get_weekly_league", {}],
  ["get_past_question_practice", {}],
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

export const pastQuestionsTruth = {
  name: "chat.past_questions_truth", area: "agent-chat", risk: "dry", repeats: 3,
  description: "Asked about past questions, the agent reads the learner's real practice and never claims there is none when there is.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const rows = await ctx.db.rows("edu.past_question_attempts", { user_id: me.id }, { columns: "attempted, correct" });
    if (!rows.length) ctx.expect.blocked(`${p.learner} has no past-question practice to test against`);
    const attempted = rows.reduce((n, r) => n + (Number(r.attempted) || 0), 0);
    const correct = rows.reduce((n, r) => n + (Number(r.correct) || 0), 0);
    const turn = await ctx.agent.chat({ as: p.learner, model: p.model, prompt: "How am I doing on past questions overall? Give me the numbers." });
    ctx.expect.toolCalled(turn, "get_past_question_practice");
    const reply = String(turn.reply || "");
    const pct = Math.round((correct / attempted) * 100);
    // The false claim is "no practice" WITHOUT the real figures ("none for WAEC
    // yet" next to the real BECE numbers is accurate, not a false claim).
    const saysNone = /\b(no|haven['’]?t|have not)\b[^.]{0,40}\b(attempts?|practi[cs]ed?|past questions?)\b/i.test(reply);
    const hasFigures = reply.includes(String(attempted)) || reply.includes(`${pct}%`);
    ctx.expect.ok("doesn't claim there's no practice", !(saysNone && !hasFigures), reply.slice(0, 200));
    ctx.expect.ok(`reply has the real figures (${correct}/${attempted}, ${pct}%)`,
      reply.includes(String(attempted)) || reply.includes(`${pct}%`) || reply.includes(String(correct)), reply.slice(0, 200));
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

export const protegeIdentity = {
  name: "chat.protege_identity", area: "agent-chat", risk: "dry", repeats: 3,
  description: "The learner's agent speaks as their protégé: it knows its own name, says the learner teaches it, and asks to be taught instead of tutoring an untaught topic.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const [agent] = await ctx.db.rows("edu.student_agents", { student_id: me.id }, { columns: "name", limit: 1 });
    if (!agent?.name) ctx.expect.blocked(`${p.learner} has no learning agent`);

    const who = await ctx.agent.chat({ as: p.learner, model: p.model, prompt: "Who are you, and how do you learn things?" });
    ctx.expect.eq("turn answered", who.status, 200);
    const intro = String(who.reply || "");
    ctx.expect.ok(`names itself (${agent.name})`, intro.toLowerCase().includes(agent.name.toLowerCase()), intro.slice(0, 200));
    ctx.expect.ok("says the learner teaches it", /\b(you teach|you('ve| have) taught|teach(ing)? me|learn from you|taught by you)\b/i.test(intro), intro.slice(0, 200));
    ctx.expect.ok("doesn't call itself a tutor or general assistant", !/\bI(['’]m| am) (your|an?) (personal )?(tutor|AI assistant|assistant)\b/i.test(intro), intro.slice(0, 200));

    // The Krebs cycle: far outside what any test learner has taught their agent.
    const ask = await ctx.agent.chat({ as: p.learner, model: p.model, prompt: "Explain the Krebs cycle to me step by step." });
    ctx.expect.eq("turn answered", ask.status, 200);
    const reply = String(ask.reply || "");
    ctx.expect.ok("asks to be taught or says it wasn't taught",
      (ask.tools || []).some((t) => t.tool === "ask_to_be_taught") || /\b(haven['’]?t|have not|not yet) (been )?taught\b|\bteach me\b/i.test(reply), reply.slice(0, 200));
    ctx.expect.ok("doesn't tutor the steps itself", !/\b(acetyl[- ]?CoA|oxaloacetate|isocitrate|succinate)\b/i.test(reply), reply.slice(0, 200));
    ctx.expect.noBackendNames("reply has no backend names", reply);
    ctx.expect.loopHealthy(ask);
  },
};

// The chat history loads a page at a time (the learner app asks for 10).
export const historyPages = {
  name: "chat.history_pages", area: "agent-chat", risk: "write",
  description: "A chat's history comes a page at a time, newest first, walking back with `before` until hasMore is false — and without a limit it is still the whole transcript (copy chat).",
  params: { learner: { default: "@tester07" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const base = "/api/adaptive/chat/sessions";
    const made = await ctx.http({ as: p.learner, method: "POST", path: base, body: { title: `${ctx.marker} history pages` } });
    const id = made.body?.session?.id;
    if (!id) ctx.expect.blocked(`creating a chat answered ${made.status}`);
    ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { session_id: id } }));
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id } }));
    const total = 23;
    for (let i = 1; i <= total; i++) {
      const sent = await ctx.http({ as: p.learner, method: "POST", path: `${base}/${id}/messages`, body: { role: i % 2 ? "user" : "agent", text: `${ctx.marker} message ${i}` } });
      if (sent.status >= 300) ctx.expect.blocked(`adding message ${i} answered ${sent.status}`);
    }
    const n = (m) => Number(String(m.text).split("message ")[1]);
    const pages = [];
    let before = null;
    for (let guard = 0; guard < 5; guard++) {
      const res = await ctx.http({ as: p.learner, path: `${base}/${id}/messages?limit=10${before ? `&before=${encodeURIComponent(before)}` : ""}` });
      ctx.expect.status(`page ${guard + 1}`, res, 200);
      const msgs = res.body?.messages || [];
      pages.push({ numbers: msgs.map(n), hasMore: res.body?.hasMore });
      if (!res.body?.hasMore || !msgs.length) break;
      before = msgs[0].created_at;
    }
    ctx.note(`pages: ${JSON.stringify(pages)}`);
    ctx.expect.eq("three pages for 23 messages", pages.length, 3);
    ctx.expect.eq("page 1 is the newest 10, oldest first", JSON.stringify(pages[0]?.numbers), JSON.stringify([14, 15, 16, 17, 18, 19, 20, 21, 22, 23]));
    ctx.expect.eq("page 2 is the 10 before", JSON.stringify(pages[1]?.numbers), JSON.stringify([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
    ctx.expect.eq("page 3 is the rest", JSON.stringify(pages[2]?.numbers), JSON.stringify([1, 2, 3]));
    ctx.expect.eq("the last page says there is no more", pages[2]?.hasMore, false);
    const all = await ctx.http({ as: p.learner, path: `${base}/${id}/messages` });
    ctx.expect.eq("no limit: the whole transcript (copy chat)", (all.body?.messages || []).length, total);
  },
};

// "every hour" — the hourly repeat option on scheduled chat messages (previously
// impossible: daily/weekdays only). Bounded to a 1-day series by default.
export const hourlyFollowUp = {
  name: "chat.hourly_follow_up", area: "agent-chat", risk: "write",
  description: "Scheduling an HOURLY check-in works: repeat='hourly' is stored, the series is bounded (1 day by default), and cancelling removes it.",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const out = await ctx.agent.tool({ as: p.learner, tool: "schedule_chat_follow_up", mode: "live",
      input: { message: `${ctx.marker} hourly check-in`, inMinutes: 60, repeat: "hourly", repeatDays: 1, where: "new" } });
    ctx.expect.ok("scheduled hourly", out?.scheduled === true && out?.repeat === "hourly", out);
    const rows = await ctx.db.rows("edu.scheduled_chat_follow_ups", { user_id: me.id }, { columns: "id, repeat, repeat_until, scheduled_at, message", limit: 20 });
    const mine = rows.find((r) => String(r.message || "").includes(ctx.marker));
    for (const r of rows.filter((x) => String(x.message || "").includes(ctx.marker))) ctx.cleanup(() => ctx.db.deleteOwned("edu.scheduled_chat_follow_ups", { ownerColumn: "user_id", ownerId: me.id, filters: { id: r.id } }));
    ctx.expect.ok("stored with repeat=hourly", mine?.repeat === "hourly", mine);
    if (mine) {
      const span = Math.round((Date.parse(mine.repeat_until) - Date.parse(mine.scheduled_at)) / 86_400_000);
      ctx.expect.eq("series spans one day", span, 1);
    }
    // Remove the queued delivery so nothing fires after the test.
    if (out?.followUpId) {
      ctx.cleanup(async () => { try { await ctx.agent.tool({ as: p.learner, tool: "cancel_scheduled_chat_follow_up", mode: "live", input: { followUpId: out.followUpId } }); } catch { /* best effort */ } });
    }
  },
};

// Repeating to-dos: create a daily task, complete it, and the next occurrence is
// spawned with the due date advanced by the interval.
export const recurringTask = {
  name: "tasks.recurring_task", area: "agent-chat", risk: "write",
  description: "A repeating study task ('daily') carries its recurrence, and completing it spawns the next occurrence about one interval later (pending, still repeating).",
  params: { learner: { default: "@tester01" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const created = await ctx.agent.tool({ as: p.learner, tool: "create_task", mode: "live",
      input: { title: `${ctx.marker} Daily reading`, priority: "medium", dueInMinutes: 120, repeat: "daily" } });
    ctx.expect.ok("task created with a daily repeat", created?.created === true && created?.repeatsEveryDays === 1, created);
    const taskId = created?.taskId;
    if (!taskId) return;
    ctx.cleanup(() => ctx.db.deleteOwned("tasks", { ownerColumn: "creator_id", ownerId: me.id, filters: { id: taskId } }));
    const row = (await ctx.db.rows("tasks", { id: taskId }, { columns: "id, title, due_at, payload", limit: 1 }))[0];
    ctx.expect.eq("stored recurrence everyDays=1", Number(row?.payload?.recurrence?.everyDays), 1);

    const toggled = await ctx.http({ as: p.learner, method: "PATCH", path: `/api/tasks/${taskId}/toggle` });
    ctx.expect.status("toggled done", toggled, 200);
    const next = toggled.body?.next;
    ctx.expect.ok("a next occurrence was created", !!next?.id, toggled.body);
    if (!next?.id) return;
    ctx.cleanup(() => ctx.db.deleteOwned("tasks", { ownerColumn: "creator_id", ownerId: me.id, filters: { id: next.id } }));
    const delta = (new Date(next.due_at).getTime() - new Date(row.due_at).getTime()) / 86_400_000;
    ctx.expect.ok("next due is one day later", Math.abs(delta - 1) < 0.001, { prev: row.due_at, next: next.due_at, delta });
    ctx.expect.eq("next is pending and still repeating", [next.status, Number(next.payload?.recurrence?.everyDays)], ["pending", 1]);
  },
};
