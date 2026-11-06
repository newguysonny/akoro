/**
 * Chat continuity fixes from a learner's 32-message transcript (2026-11-06):
 *   chat.history_order      the model gets the LATEST turns, oldest → newest
 *                           (it used to get the oldest 24, backwards, so the
 *                           first question was answered again in every reply).
 *   chat.daily_follow_up    "remind me every day at 4:30pm" is one repeating
 *                           check-in: delivering one schedules the next day's,
 *                           in the same chat; cancelling ends the series.
 */
export const historyOrder = {
  name: "chat.history_order", area: "agent-chat", risk: "write",
  description: "A 32-message chat loads as its latest 24 turns, oldest to newest, ending with the newest message.",
  params: { learner: { default: "@tester28" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} order` } });
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked(`couldn't create the chat (${made.status})`);
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));
    for (let i = 1; i <= 32; i++) {
      const r = await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${chatId}/messages`,
        body: { role: i % 2 ? "user" : "agent", text: i === 1 ? "Which subject have I earned the most XP in?" : `turn ${i}` } });
      if (r.status >= 300) ctx.expect.blocked(`adding a message answered ${r.status}`);
    }
    const { loadLearnerAgentConversationContext } = await import("../../agent-tools/conversation-context-routes.js");
    const c = await loadLearnerAgentConversationContext({ conversationId: chatId, userId: me.id });
    const texts = (c.messages || []).map((m) => m.content);
    ctx.note(`first=${texts[0]} last=${texts.at(-1)} n=${texts.length}`);
    ctx.expect.eq("the last message the model sees is the newest", texts.at(-1), "turn 32");
    ctx.expect.ok("the first question has dropped out of the window", !texts.includes("Which subject have I earned the most XP in?"));
    ctx.expect.ok("oldest to newest", texts.every((t, i) => i === 0 || Number(t.split(" ")[1]) > Number(texts[i - 1].split(" ")[1])), texts.slice(0, 4));
  },
};

export const dailyFollowUp = {
  name: "chat.daily_follow_up", area: "agent-chat", risk: "write",
  description: "schedule_chat_follow_up with repeat='daily' saves one repeating check-in; delivering it schedules tomorrow's in the same chat at the same time; cancelling the pending one ends the series.",
  params: { learner: { default: "@tester28" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} reminders` } });
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked(`couldn't create the chat (${made.status})`);
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));
    const { scheduleChatFollowUp, deliverChatFollowUp, cancelChatFollowUp } = await import("../../adaptive-learning/chat-follow-ups.js");
    const first = await scheduleChatFollowUp({ userId: me.id, targetSessionId: chatId, defaultTimezone: "Africa/Lagos",
      input: { message: `${ctx.marker} Time to check the subjects you haven't studied.`, inMinutes: 2, repeat: "daily", repeatDays: 3 } });
    ctx.cleanup(() => ctx.db.deleteOwned("edu.scheduled_chat_follow_ups", { ownerColumn: "user_id", ownerId: me.id, filters: { chat_session_id: chatId } }));
    ctx.expect.eq("saved as a daily series", first.repeat, "daily");

    const out = await deliverChatFollowUp(first.followUpId);
    ctx.note(`deliver: ${JSON.stringify(out)}`);
    ctx.expect.ok("delivered into the chosen chat", out.delivered && out.sessionId === chatId, out);
    ctx.expect.ok("the next one is scheduled", !!out.nextFollowUpId, out);
    const [next] = await ctx.db.rows("edu.scheduled_chat_follow_ups", { id: out.nextFollowUpId }, { columns: "chat_session_id, scheduled_at, status, repeat, series_id" });
    const [orig] = await ctx.db.rows("edu.scheduled_chat_follow_ups", { id: first.followUpId }, { columns: "scheduled_at, status" });
    ctx.expect.eq("…in the same chat", next?.chat_session_id, chatId);
    ctx.expect.eq("…one day later, same time", Date.parse(next?.scheduled_at) - Date.parse(orig?.scheduled_at), 86_400_000);
    ctx.expect.eq("…as part of the same series", next?.series_id, first.followUpId);
    ctx.expect.eq("…waiting", next?.status, "scheduled");

    // A retried delivery doesn't chain a second one.
    await deliverChatFollowUp(first.followUpId);
    ctx.expect.eq("one pending occurrence per series", await ctx.db.count("edu.scheduled_chat_follow_ups", { series_id: first.followUpId, status: "scheduled" }), 1);

    // Cancelling the pending one ends the series.
    const cancelled = await cancelChatFollowUp({ userId: me.id, followUpId: out.nextFollowUpId });
    ctx.note(`cancel: ${JSON.stringify(cancelled)}`);
    ctx.expect.eq("cancelling ends the series", await ctx.db.count("edu.scheduled_chat_follow_ups", { series_id: first.followUpId, status: "scheduled" }), 0);
  },
};

export const CHAT_CONTINUITY = [historyOrder, dailyFollowUp];
