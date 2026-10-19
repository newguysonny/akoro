// Real changes on TEST learners only (risk: write). Every row a scenario
// creates carries ctx.marker and is removed by ctx.cleanup; writes.no_residue
// proves nothing was left behind. On production these need VERIFY_ALLOW_WRITES=true.
//
// `realUserSafe` (phase V4): an admin may run this once on a real account. Only
// for scenarios that undo everything they create, send nothing to anyone else
// and spend no coins. `what` / `changes` complete the owner's notice: "ran an
// automatic check of <what> ... It <changes>."

export const followUpDeliverIntoChat = {
  name: "followups.deliver_into_chat", area: "agent-chat", risk: "write",
  description: "A message scheduled into an existing chat is delivered there on time, with a notification.",
  params: { learner: { default: "@tester06" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const health = await ctx.health();
    if (health.body?.redisQuota?.paused) ctx.expect.blocked("Redis quota guard has paused the workers — follow-ups can't be delivered");

    // An existing chat to deliver into.
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} follow-up target` } });
    ctx.expect.status("chat created", made, 201);
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked("couldn't create the target chat");
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));

    const text = `${ctx.marker} Time to revise fractions — ten questions, go!`;
    const r = await ctx.agent.tool({ as: p.learner, tool: "schedule_chat_follow_up", mode: "live",
      input: { message: text, title: `${ctx.marker} check-in`, inMinutes: 1, where: "chat", chatId } });
    ctx.expect.ok("scheduled", r?.scheduled === true, r?.error);
    const followUpId = r?.followUpId || r?.id;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.scheduled_chat_follow_ups", { ownerColumn: "user_id", ownerId: me.id, filters: { message: text } }));
    ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: me.id, filters: { related_id: chatId } }));
    if (!r?.scheduled) return;

    const row = (await ctx.db.rows("edu.scheduled_chat_follow_ups", { user_id: me.id, message: text }, { columns: "id, chat_session_id, status, scheduled_at", limit: 1 }))[0];
    ctx.expect.eq("follow-up targets the chosen chat", row?.chat_session_id, chatId);
    ctx.note(`follow-up ${followUpId || row?.id} scheduled for ${row?.scheduled_at}`);

    // Delivery: the worker posts the message into the chat after ~1 minute.
    const delivered = await ctx.until(async () => {
      const msgs = await ctx.db.rows("chat_messages", { session_id: chatId, user_id: me.id }, { columns: "id, role, text", limit: 10 });
      return msgs.find((m) => m.role === "agent" && m.text === text) || null;
    }, { timeoutMs: 100_000, everyMs: 5_000 });
    ctx.expect.ok("message delivered into the same chat", !!delivered, "not delivered within 100 s — is the follow-ups worker running?");
    const status = (await ctx.db.rows("edu.scheduled_chat_follow_ups", { user_id: me.id, message: text }, { columns: "status", limit: 1 }))[0]?.status;
    ctx.expect.eq("follow-up marked delivered", status, "delivered");
    const notes = await ctx.db.count("notifications", { user_id: me.id, related_id: chatId });
    ctx.expect.gte("learner notified", notes, 1);
  },
};

export const taskDueInMinutes = {
  name: "tasks.create_due_in_minutes", area: "agent-chat", risk: "write",
  realUserSafe: { what: "creating a task with your agent", changes: "created one test task and deleted it straight away", roles: ["student"] },
  description: "A task 'due in 30 minutes' is saved with a precise due time and shows in the learner's tasks.",
  params: { learner: { default: "@tester06" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const title = `${ctx.marker} Revise photosynthesis`;
    ctx.cleanup(() => ctx.db.deleteOwned("tasks", { ownerColumn: "creator_id", ownerId: me.id, filters: { title } }));
    const t0 = Date.now();
    const r = await ctx.agent.tool({ as: p.learner, tool: "create_task", mode: "live", input: { title, priority: "low", dueInMinutes: 30 } });
    ctx.expect.ok("task created", !r?.error, r?.error);
    const row = (await ctx.db.rows("tasks", { creator_id: me.id, title }, { columns: "id, status, priority, due_at", limit: 1 }))[0];
    ctx.expect.ok("task row exists", !!row);
    const drift = row?.due_at ? Math.abs(new Date(row.due_at).getTime() - (t0 + 30 * 60_000)) : Infinity;
    ctx.expect.lte("due time is now + 30 min (± 2 min)", Math.round(drift / 1000), 120);
    ctx.expect.eq("status pending", row?.status, "pending");
    const list = await ctx.agent.tool({ as: p.learner, tool: "list_tasks", input: {} });
    ctx.expect.ok("list_tasks shows it", JSON.stringify(list || {}).includes(title));
  },
};

export const noResidue = {
  name: "writes.no_residue", area: "platform", risk: "read",
  description: "Nothing created by gate write scenarios is left on the test learners.",
  async run(ctx) {
    const like = { like: "[verify:%" };
    ctx.expect.eq("no leftover tasks", await ctx.db.count("tasks", { title: like }), 0);
    ctx.expect.eq("no leftover chats", await ctx.db.count("chat_sessions", { title: like }), 0);
    ctx.expect.eq("no leftover follow-ups", await ctx.db.count("edu.scheduled_chat_follow_ups", { title: like }), 0);
    ctx.expect.eq("no leftover notifications", await ctx.db.count("notifications", { title: like }), 0);
    ctx.expect.eq("no leftover built tools", await ctx.db.count("edu.agent_tools", { label: like }), 0);
    ctx.expect.eq("no leftover capability requests", await ctx.db.count("edu.agent_tool_requests", { goal: like }), 0);
    ctx.expect.eq("no leftover study-prep sessions", await ctx.db.count("edu.study_prep_sessions", { goal: like }), 0);
    ctx.expect.eq("no leftover activities", await ctx.db.count("edu.self_study_assignments", { title: like }), 0);
    ctx.expect.eq("no leftover records", await ctx.db.count("edu.records", { name: like }), 0);
    ctx.expect.eq("no leftover teaching sessions", await ctx.db.count("edu.adaptive_sessions", { topic: like }), 0);
  },
};

/**
 * A gate run cut short (a redeploy mid-run, a timed-out client) leaves its
 * rows behind and every later writes.no_residue fails on them. This clears
 * gate-marked rows older than 30 minutes — so a run still going keeps its
 * own — on TEST learners only (a real owner is skipped, never touched).
 */
const STALE_MS = 30 * 60 * 1000;
const SWEEPABLE = [
  { table: "tasks", owner: "creator_id", marked: "title" },
  { table: "chat_sessions", owner: "user_id", marked: "title" },
  { table: "edu.records", owner: "user_id", marked: "name" },
  { table: "edu.study_prep_sessions", owner: "learner_id", marked: "goal" },
];
export const sweepStale = {
  name: "writes.sweep_stale", area: "platform", risk: "write",
  description: "Clears gate-marked rows older than 30 minutes left on test learners by runs that were cut short.",
  async run(ctx) {
    const cutoff = Date.now() - STALE_MS;
    let swept = 0, skipped = 0;
    for (const { table, owner, marked } of SWEEPABLE) {
      const rows = await ctx.db.rows(table, { [marked]: { like: "[verify:%" } }, { columns: `id, ${owner}, created_at, ${marked}`, limit: 200 });
      for (const row of rows.filter((r) => new Date(r.created_at).getTime() < cutoff)) {
        let acct;
        try { acct = await ctx.as(row[owner]); } catch { skipped += 1; continue; }
        if (!acct?.tester) { skipped += 1; continue; }
        await ctx.db.deleteOwned(table, { ownerColumn: owner, ownerId: acct.id, filters: { id: row.id } });
        ctx.note(`swept ${table}: ${String(row[marked]).slice(0, 80)} (@${acct.username})`);
        swept += 1;
      }
    }
    ctx.note(`swept ${swept}, skipped ${skipped} (not a test learner)`);
    ctx.expect.ok("the sweep ran", true);
  },
};
