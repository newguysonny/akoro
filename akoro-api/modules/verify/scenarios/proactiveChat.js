/**
 * Proactive suggestions in chat (Grand Plan §7.16.3, D49): a planner proposal
 * is posted as an agent message into the chat its idea came from (used in the
 * last 7 days), else the latest chat; never while the learner is mid-chat;
 * once a day; and a decision in Suggestions shows on the chat message.
 */
import { runQuietPass } from "../../agent-memory/quietLearning.js";
import { runAutonomyCycleForUser } from "../../autonomy/cycle.js";
import { deliverProactive } from "../../autonomy/deliver.js";
import { CHAT } from "./quietLearning.js";

const TRIGGER = "event:verify";

export const proactiveInChat = {
  name: "agent.proactive_in_chat", area: "agent-chat", risk: "write",
  description: "The planner's idea lands in the right chat as an agent message with its reason — not while the learner is mid-chat, once a day — and a decision made in Suggestions shows on that message.",
  params: { learner: { default: "@tester25" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const m = ctx.marker;
    const before = await ctx.http({ as: p.learner, path: "/api/adaptive/chat/autonomy" });
    const was = { enabled: !!before.body?.enabled, level: before.body?.level ?? 1 };
    const wasLearning = (await ctx.http({ as: p.learner, path: "/api/agent-memory/v1/settings" })).body?.learnFromChats !== false;
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: was }));
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "PATCH", path: "/api/agent-memory/v1/settings", body: { learnFromChats: wasLearning } }));
    // The planner's runs and proposals this scenario makes (its own trigger).
    ctx.cleanup(async () => {
      for (const r of await ctx.db.rows("edu.autonomy_runs", { user_id: me.id, trigger: TRIGGER }, { columns: "id" })) {
        await ctx.db.deleteOwned("edu.agent_proposals", { ownerColumn: "user_id", ownerId: me.id, filters: { run_id: r.id } });
        await ctx.db.deleteOwned("edu.autonomy_runs", { ownerColumn: "user_id", ownerId: me.id, filters: { id: r.id } });
      }
    });
    await ctx.http({ as: p.learner, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: { enabled: true, level: 2 } });
    await ctx.http({ as: p.learner, method: "PATCH", path: "/api/agent-memory/v1/settings", body: { learnFromChats: true } });

    // Two chats: the one the idea will come from, and a newer unrelated one.
    const chat = async (title) => {
      const r = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${m} ${title}` } });
      const id = r.body?.session?.id;
      if (!id) ctx.expect.blocked(`couldn't create a chat (${r.status})`);
      ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id } }));
      return id;
    };
    const source = await chat("chemistry");
    ctx.cleanup(() => ctx.db.deleteOwned("edu.learner_agent_memories", { ownerColumn: "user_id", ownerId: me.id, filters: { chat_session_id: source } }));
    for (const [role, text] of CHAT(m)) await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${source}/messages`, body: { role, text } });
    const pass = await runQuietPass({ userId: me.id, chatSessionId: source, force: true });
    if (pass.status !== "done") ctx.expect.blocked(`quiet learning didn't run (${pass.reason})`);
    const latest = await chat("english essay");
    await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${latest}/messages`, body: { role: "user", text: `${m} Can you check my essay introduction?` } });

    // The planner runs (its own delivery attempt may wait: the chats are busy).
    const run = await runAutonomyCycleForUser(me.id, TRIGGER);
    ctx.note(`cycle: ${JSON.stringify(run)}`);
    if (run.skipped) ctx.expect.blocked(`the planner skipped: ${run.skipped}`);
    if (!run.created) ctx.expect.blocked("the planner proposed nothing this time");
    const proposals = await ctx.db.rows("edu.agent_proposals", { user_id: me.id, status: "proposed" }, { columns: "id, title, rationale, source_chat_id, posted_at, created_at", order: { column: "created_at", ascending: false }, limit: 5 });
    ctx.note(`proposals: ${JSON.stringify(proposals.map((x) => [x.title, x.source_chat_id === source ? "from the chemistry chat" : x.source_chat_id, !!x.posted_at]))}`);
    const already = proposals.find((x) => x.posted_at);
    if (already) ctx.note("the cycle's own delivery posted one already");

    // Mid-chat: held back.
    if (!already) {
      const held = await deliverProactive(me.id, { ignoreQuietHours: true });
      ctx.expect.eq("not posted while the learner is mid-chat", held.reason, "chat_busy");
    }

    // 15 minutes later: posted.
    const later = new Date(Date.now() + 15 * 60 * 1000);
    const posted = already ? { posted: true, proposalId: already.id } : await deliverProactive(me.id, { now: later, ignoreQuietHours: true });
    ctx.note(`delivery: ${JSON.stringify(posted)}`);
    ctx.expect.ok("posted into a chat", posted.posted === true, posted);
    if (!posted.posted) return;
    const row = (await ctx.db.rows("edu.agent_proposals", { id: posted.proposalId }, { columns: "id, title, rationale, source_chat_id, chat_session_id, chat_message_id" }))[0];
    const expected = row.source_chat_id === source ? source : latest;
    ctx.expect.eq(row.source_chat_id === source ? "…the chat the idea came from" : "…the latest chat (the idea had no chat of its own)", row.chat_session_id, expected);
    const msg = (await ctx.db.rows("chat_messages", { id: row.chat_message_id }, { columns: "role, text, meta" }))[0];
    ctx.expect.ok("as an agent message that says what it noticed", msg?.role === "agent" && /^One thing I noticed:/.test(msg.text) && msg.text.includes(row.title), msg?.text);
    ctx.expect.ok("…carrying the suggestion for its buttons", msg?.meta?.proposal?.id === row.id && msg.meta.proposal.status === "proposed", msg?.meta);
    const page = await ctx.http({ as: p.learner, path: `/api/adaptive/chat/sessions/${row.chat_session_id}/messages?limit=10` });
    ctx.expect.ok("the chat shows it", (page.body?.messages || []).some((x) => x.meta?.proposal?.id === row.id));

    // Once a day.
    const again = await deliverProactive(me.id, { now: new Date(later.getTime() + 60_000), ignoreQuietHours: true });
    ctx.expect.eq("one proactive message a day", again.reason, "daily_cap");

    // Decided in Suggestions → the chat message shows it.
    const no = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/proposals/inbox/p:${row.id}/dismiss`, body: { reason: "wrong_time" } });
    ctx.expect.eq("dismissed from Suggestions", no.status, 200);
    const after = (await ctx.db.rows("chat_messages", { id: row.chat_message_id }, { columns: "meta" }))[0];
    ctx.expect.eq("…and the chat message shows it", after?.meta?.proposal?.status, "dismissed");
  },
};
