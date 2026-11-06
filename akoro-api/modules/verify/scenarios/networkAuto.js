/**
 * Phase 21 — agents talk on their own (agent-network/autoReply.js).
 *   network.friend_request_card   a friend request becomes an approval card in the
 *                                 recipient's chat; "Be friends" makes them friends
 *   network.auto_reply_consult    a study question is answered by the recipient's
 *                                 agent on its own, and the learner is told in chat
 *   network.chat_reply_setting    friendly chat asks by default; with study_chat the
 *                                 agent replies on its own
 *   network.offline_waits         an agent switched Offline leaves messages waiting
 */
const SENDER = "@tester01", RECIPIENT = "@tester02";

async function pair(ctx) {
  const from = await ctx.as(SENDER), to = await ctx.as(RECIPIENT);
  const { messageAgent } = await import("../../agent-network/messaging.js");
  const { processInbox } = await import("../../agent-network/autoReply.js");
  const { protegeDeps } = await import("../../adaptive-learning/chat.js");
  const send = (kind, text) => messageAgent(from.id, { to: to.id, kind, question: `${ctx.marker} ${text}` }, { deps: protegeDeps });
  // Every row this run makes is removed afterwards (both sides).
  ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_messages", { ownerColumn: "from_user", ownerId: from.id, filters: { body: { like: `${ctx.marker}%` } } }));
  return { from, to, send, process: (opts = {}) => processInbox(to.id, { deps: protegeDeps, force: true, ...opts }) };
}
const cleanCard = (ctx, to, a) => {
  if (a?.proposalId) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_proposals", { ownerColumn: "user_id", ownerId: to.id, filters: { id: a.proposalId } }));
};
async function withSetting(ctx, userId, mode) {
  const { getSettings, saveSettings } = await import("../../agent-network/network.js");
  const was = (await getSettings(userId)).auto_reply || "study";
  ctx.cleanup(() => saveSettings(userId, { auto_reply: was }));
  await saveSettings(userId, { auto_reply: mode });
}

export const friendRequestCard = {
  name: "network.friend_request_card", area: "agent-network", risk: "write",
  description: "A friend request becomes an approval card in the recipient's chat (no auto-accept); 'Be friends' makes them friends and tells the sender; a second request is refused.",
  async run(ctx) {
    const { from, to, send, process } = await pair(ctx);
    const sent = await send("friend_request", "Hi! We'd like to be friends and study together.");
    ctx.note(`sent: ${JSON.stringify(sent).slice(0, 200)}`);
    const out = await process();
    const a = (out.actions || []).find((x) => x.messageId === sent.messageId);
    cleanCard(ctx, to, a);
    ctx.expect.eq("the recipient's agent asks its learner (never accepts on its own)", a?.action, "ask_learner");
    const [prop] = await ctx.db.rows("edu.agent_proposals", { id: a?.proposalId }, { columns: "kind, status, chat_message_id, title" });
    ctx.expect.eq("an agent_friend card", prop?.kind, "agent_friend");
    const [card] = prop?.chat_message_id ? await ctx.db.rows("chat_messages", { id: prop.chat_message_id }, { columns: "text, meta, user_id" }) : [];
    if (card) ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: to.id, filters: { id: prop.chat_message_id } }));
    ctx.note(`card: ${card?.text?.slice(0, 160)}`);
    ctx.expect.ok("posted in the recipient's chat with Be friends", card?.user_id === to.id && card?.meta?.proposal?.yes === "Be friends", card?.meta);
    ctx.expect.ok("…saying who wants to be friends", /wants to be friends/.test(card?.text || ""), card?.text);

    const { approveProposal } = await import("../../agent-proposals/inbox.js");
    const r = await approveProposal(to.id, a.proposalId);
    ctx.note(`approve: ${JSON.stringify(r).slice(0, 200)}`);
    const [x, y] = [from.id, to.id].sort();
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_friends", { ownerColumn: "requested_by", ownerId: from.id, filters: { user_a: x, user_b: y } }));
    const [f] = await ctx.db.rows("edu.agent_friends", { user_a: x, user_b: y }, { columns: "status" });
    ctx.expect.eq("they are friends", f?.status, "accepted");
    const [m] = await ctx.db.rows("edu.agent_messages", { id: sent.messageId }, { columns: "status, answer" });
    ctx.expect.eq("the sender's agent gets the answer", m?.status, "answered");
    let again = null;
    try { await send("friend_request", "Friends again?"); } catch (e) { again = e.message; }
    ctx.expect.ok("a second request is refused (already friends)", /already friends/i.test(again || ""), again);
  },
};

export const autoReplyConsult = {
  name: "network.auto_reply_consult", area: "agent-network", risk: "write",
  description: "A study question is answered by the recipient's agent on its own (default setting) and the recipient is told in chat.",
  async run(ctx) {
    const { to, send, process } = await pair(ctx);
    await withSetting(ctx, to.id, "study");
    const sent = await send("consult", "How do you find the area of a triangle?");
    const out = await process();
    const a = (out.actions || []).find((x) => x.messageId === sent.messageId);
    // The arrival itself wakes the recipient's agent (its own background lane), which
    // may have claimed the message before this run: wait for whichever handled it.
    let m = null;
    for (let i = 0; i < 20; i++) {
      [m] = await ctx.db.rows("edu.agent_messages", { id: sent.messageId }, { columns: "status, answer, auto_replied, processed_at" });
      if (m?.status === "answered" && m.answer) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    ctx.note(`action here: ${JSON.stringify(a) || "handled by the background lane"} · delivered=${sent.delivered} · row=${JSON.stringify(m)}`);
    ctx.expect.ok("answered on its own (here, by the background lane, or live on arrival)",
      ["auto_answer", "tell_learner"].includes(a?.action) || (!a && m?.status === "answered" && (m.auto_replied || sent.delivered === "answered_now")), { a, m });
    ctx.expect.ok("the answer went back to the asking agent", m?.status === "answered" && !!m?.answer, m);
    ctx.expect.ok("handled once (processed)", !!m?.processed_at);
    const again = await process();
    ctx.expect.eq("a second run does nothing more with it", (again.actions || []).filter((x) => x.messageId === sent.messageId).length, 0);
  },
};

export const chatReplySetting = {
  name: "network.chat_reply_setting", area: "agent-network", risk: "write",
  description: "Friendly chat asks the learner by default ('Shall I reply for you?'); with study_chat the agent replies on its own.",
  async run(ctx) {
    const { to, send, process } = await pair(ctx);
    await withSetting(ctx, to.id, "study");
    const one = await send("chat", "Hello! How is your revision going this week?");
    const r1 = await process();
    const a1 = (r1.actions || []).find((x) => x.messageId === one.messageId);
    cleanCard(ctx, to, a1);
    ctx.expect.eq("default: asks the learner", a1?.action, "ask_learner");
    const [p1] = a1?.proposalId ? await ctx.db.rows("edu.agent_proposals", { id: a1.proposalId }, { columns: "kind, payload, chat_message_id" }) : [];
    if (p1?.chat_message_id) ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: to.id, filters: { id: p1.chat_message_id } }));
    ctx.expect.ok("…with a drafted reply to approve", p1?.kind === "agent_reply" && !!p1?.payload?.draft, p1?.payload);

    await withSetting(ctx, to.id, "study_chat");
    const two = await send("chat", "Good luck with your exams this term!");
    const r2 = await process();
    const a2 = (r2.actions || []).find((x) => x.messageId === two.messageId);
    ctx.note(`study_chat: ${JSON.stringify(a2)}`);
    const [m] = await ctx.db.rows("edu.agent_messages", { id: two.messageId }, { columns: "answer, auto_replied" });
    ctx.note(`reply: ${m?.answer}`);
    // A JSS/primary learner is always asked — the tester's level decides which is right.
    const { data: lvl } = await (await import("../../../db.js")).default.from("users").select("study_level, year_group").eq("id", to.id).maybeSingle();
    const { isProtectedLearner } = await import("../../agent-network/autoReplyCore.js");
    if (isProtectedLearner({ studyLevel: lvl?.study_level, yearGroup: lvl?.year_group })) {
      cleanCard(ctx, to, a2);
      ctx.expect.eq("a protected (primary/JSS) learner is still asked", a2?.action, "ask_learner");
    } else {
      ctx.expect.eq("study_chat: replies on its own", a2?.action, "auto_answer");
      ctx.expect.ok("…a short reply, sent back", !!m?.answer && m.answer.length <= 700 && m.auto_replied === true, m);
    }
  },
};

export const offlineWaits = {
  name: "network.offline_waits", area: "agent-network", risk: "write",
  description: "With its agent switched Offline, a message waits unprocessed; switched Online, it is handled.",
  async run(ctx) {
    const { to, send } = await pair(ctx);
    const { processInbox } = await import("../../agent-network/autoReply.js");
    const { protegeDeps } = await import("../../adaptive-learning/chat.js");
    const before = await ctx.http({ as: RECIPIENT, path: "/api/adaptive/chat/autonomy" });
    const was = { enabled: !!before.body?.enabled, level: before.body?.level ?? 1 };
    ctx.cleanup(() => ctx.http({ as: RECIPIENT, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: was }));
    await ctx.http({ as: RECIPIENT, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: { enabled: false, level: was.level } });
    const sent = await send("suggestion", "Try drawing the triangle before you calculate.");
    const off = await processInbox(to.id, { deps: protegeDeps });
    ctx.expect.eq("offline: it waits", off.waiting, "agent_offline");
    const [m1] = await ctx.db.rows("edu.agent_messages", { id: sent.messageId }, { columns: "processed_at" });
    ctx.expect.ok("…unprocessed", !m1?.processed_at);
    await ctx.http({ as: RECIPIENT, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: { enabled: true, level: was.level } });
    const on = await processInbox(to.id, { deps: protegeDeps });
    const a = (on.actions || []).find((x) => x.messageId === sent.messageId);
    ctx.expect.eq("online: the learner is told about the idea", a?.action, "tell_learner");
  },
};

export const NETWORK_AUTO = [friendRequestCard, autoReplyConsult, chatReplySetting, offlineWaits];
