/**
 * Quiet learning (Grand Plan §7.16.6): a settled chat gets one background
 * pass — a real summary and merged memories, nothing sensitive, once per
 * watermark, only with the learner's consent; the learner can forget it.
 * The gate runs the pass itself (force: the 30-minute settle wait skipped).
 */
import { runQuietPass } from "../../agent-memory/index.js";

export const CHAT = (m) => [
  ["user", `${m} Hi! I'm in SS2 and I'm writing WAEC in May. I want an A in Chemistry.`],
  ["agent", "Great goal. Where shall we start?"],
  ["user", "Titration. I learn best with diagrams and short quizzes, long explanations lose me."],
  ["agent", "Here is a labelled diagram of a titration set-up, then three quick questions."],
  ["user", "Got 2 of 3. I keep mixing up the end point and the equivalence point."],
  ["agent", "The equivalence point is where the moles match; the end point is where the indicator changes colour."],
  ["user", "Honestly I've been feeling anxious and my doctor gave me tablets, so I'm tired."],
  ["agent", "I'm sorry you're tired. Let's keep this short today."],
  ["user", "Ok. Remind me to revise titration curves tomorrow, we didn't get to them."],
  ["agent", "Will do — titration curves tomorrow."],
];

export const quietLearningPass = {
  name: "agent.quiet_learning", area: "agent-chat", risk: "write",
  description: "A settled chat gets one platform-paid pass: a real summary, the learner's preferences/goals/facts/open threads remembered, nothing sensitive; a replay does nothing; with learning paused nothing is read; a forgotten memory is gone.",
  params: { learner: { default: "@tester23" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const m = ctx.marker;

    // Consent: the agent Online with learning on — restored afterwards.
    const before = await ctx.http({ as: p.learner, path: "/api/adaptive/chat/autonomy" });
    const was = { enabled: !!before.body?.enabled, level: before.body?.level ?? 1 };
    const set = await ctx.http({ as: p.learner, path: "/api/agent-memory/v1/settings" });
    const wasLearning = set.body?.learnFromChats !== false;
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: was }));
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "PATCH", path: "/api/agent-memory/v1/settings", body: { learnFromChats: wasLearning } }));
    ctx.expect.eq("agent online", (await ctx.http({ as: p.learner, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: { enabled: true, level: was.level } })).status, 200);
    ctx.expect.eq("learning on", (await ctx.http({ as: p.learner, method: "PATCH", path: "/api/agent-memory/v1/settings", body: { learnFromChats: true } })).status, 200);

    // A chat of ten messages.
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${m} chemistry` } });
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked(`couldn't create the chat (${made.status})`);
    // Cleanups run last-in first-out: the memories go before the chat (deleting
    // the chat first would null their chat id and leave them behind).
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.learner_agent_memories", { ownerColumn: "user_id", ownerId: me.id, filters: { chat_session_id: chatId } }));
    for (const [role, text] of CHAT(m)) {
      const r = await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${chatId}/messages`, body: { role, text } });
      if (r.status >= 300) ctx.expect.blocked(`adding a message answered ${r.status}`);
    }

    // The pass.
    const t0 = new Date(Date.now() - 2_000).toISOString();
    const pass = await runQuietPass({ userId: me.id, chatSessionId: chatId, force: true });
    ctx.note(`pass: ${JSON.stringify(pass)}`);
    ctx.expect.eq("the pass ran", pass.status, "done");
    const summary = (await ctx.db.rows("edu.learner_agent_conversation_summaries", { chat_session_id: chatId }, { columns: "summary, source_message_count" }))[0];
    ctx.expect.ok("a real summary (not the concatenated one)", summary?.summary && !/^Latest learner request/.test(summary.summary) && /titration|chemistry/i.test(summary.summary), summary);
    ctx.expect.eq("…up to this point of the chat", summary?.source_message_count, 10);
    // New notes from this chat, and the learner's earlier notes this pass refined (a merge, not a copy).
    const mems = await ctx.db.rows("edu.learner_agent_memories", { user_id: me.id, chat_session_id: chatId, status: "active" }, { columns: "id, kind, content, source" });
    const active = await ctx.db.rows("edu.learner_agent_memories", { user_id: me.id, status: "active" }, { columns: "id, kind, content, updated_at", limit: 200 });
    const touched = active.filter((x) => x.updated_at >= t0);
    ctx.note(`new: ${JSON.stringify(mems.map((x) => [x.kind, x.content]))} · touched: ${JSON.stringify(touched.map((x) => [x.kind, x.content]))}`);
    ctx.expect.ok("it remembered what matters (≥ 2 new notes)", mems.length >= 2, mems.length);
    // Already remembered from an earlier chat is right too: the pass doesn't copy what the agent knows.
    ctx.expect.ok("…the learner's preference (new, merged, or already known)", active.some((x) => /diagram|quiz/i.test(x.content)), active.map((x) => x.content));
    ctx.expect.ok("…their goal or class", touched.some((x) => /waec|ss2|chemistry/i.test(x.content)), touched.map((x) => x.content));
    ctx.expect.ok("…and what was left unfinished", touched.some((x) => x.kind === "open_thread" || /curves|tomorrow/i.test(x.content)), touched.map((x) => [x.kind, x.content]));
    ctx.expect.ok("nothing sensitive is remembered", !touched.some((x) => /anxi|doctor|tablet|tired/i.test(x.content)), touched.map((x) => x.content));
    ctx.expect.ok("new notes are marked as quiet learning", mems.every((x) => x.source === "quiet_learning"), mems.map((x) => x.source));
    ctx.expect.eq("the run is logged", (await ctx.db.rows("edu.quiet_learning_runs", { chat_session_id: chatId }, { columns: "status, watermark" }))[0]?.status, "done");

    // A replay does nothing.
    const again = await runQuietPass({ userId: me.id, chatSessionId: chatId, force: true });
    ctx.expect.eq("a replay does nothing", again.status, "skipped");
    ctx.expect.eq("…no new notes", (await ctx.db.count("edu.learner_agent_memories", { chat_session_id: chatId, status: "active" })), mems.length);

    // The learner sees and forgets.
    const listed = await ctx.http({ as: p.learner, path: "/api/agent-memory/v1/memories" });
    const shown = (listed.body?.memories || []).filter((x) => mems.some((y) => y.id === x.id));
    ctx.expect.eq("the learner sees them", shown.length, mems.length);
    const gone = await ctx.http({ as: p.learner, method: "DELETE", path: `/api/agent-memory/v1/memories/${mems[0]?.id}` });
    ctx.expect.eq("forget one", gone.status, 200);
    const relisted = await ctx.http({ as: p.learner, path: "/api/agent-memory/v1/memories" });
    ctx.expect.ok("…and it is gone", !(relisted.body?.memories || []).some((x) => x.id === mems[0]?.id));

    // Learning paused: more talk, nothing read.
    ctx.expect.eq("pause learning", (await ctx.http({ as: p.learner, method: "PATCH", path: "/api/agent-memory/v1/settings", body: { learnFromChats: false } })).status, 200);
    for (const [role, text] of CHAT(m).slice(0, 6)) await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${chatId}/messages`, body: { role, text } });
    const paused = await runQuietPass({ userId: me.id, chatSessionId: chatId, force: true });
    ctx.expect.eq("with learning paused nothing runs", paused.reason, "learning_paused");
  },
};
