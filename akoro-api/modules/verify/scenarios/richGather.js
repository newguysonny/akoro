/**
 * The planner's rich gather (Grand Plan §7.16.8 step 3): what the agent
 * remembers (quiet learning) reaches the overnight planner — framed as data,
 * only with "Learn from my conversations" on, nothing sensitive — and a real
 * planning call draws on it. The platform pays (D46); nothing is persisted.
 */
import { runQuietPass } from "../../agent-memory/index.js";
import { gatherSignals, planningMessages, reasonAboutSignals, validateAndShapeProposals } from "../../autonomy/index.js";
import { CHAT } from "./quietLearning.js";

export const plannerRichGather = {
  name: "agent.planner_rich_gather", area: "agent-chat", risk: "write",
  description: "The overnight planner sees the learner's notes and chat summaries (as data, with consent, nothing sensitive), their goals' progress and time zone; a real planning call proposes from them.",
  params: { learner: { default: "@tester24" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const m = ctx.marker;
    const before = await ctx.http({ as: p.learner, path: "/api/adaptive/chat/autonomy" });
    const was = { enabled: !!before.body?.enabled, level: before.body?.level ?? 1 };
    const wasLearning = (await ctx.http({ as: p.learner, path: "/api/agent-memory/v1/settings" })).body?.learnFromChats !== false;
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: was }));
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "PATCH", path: "/api/agent-memory/v1/settings", body: { learnFromChats: wasLearning } }));
    await ctx.http({ as: p.learner, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: { enabled: true, level: was.level } });
    await ctx.http({ as: p.learner, method: "PATCH", path: "/api/agent-memory/v1/settings", body: { learnFromChats: true } });

    // What the agent will know: a chat, remembered by quiet learning.
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${m} chemistry` } });
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked(`couldn't create the chat (${made.status})`);
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.learner_agent_memories", { ownerColumn: "user_id", ownerId: me.id, filters: { chat_session_id: chatId } }));
    for (const [role, text] of CHAT(m)) await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${chatId}/messages`, body: { role, text } });
    const pass = await runQuietPass({ userId: me.id, chatSessionId: chatId, force: true });
    if (pass.status !== "done") ctx.expect.blocked(`quiet learning didn't run (${pass.reason})`);

    // The gather.
    const signals = await gatherSignals(me.id);
    ctx.note(`memories: ${JSON.stringify(signals.memories)} · summaries: ${signals.chatSummaries.length} · tz ${signals.timeZone} · weak ${signals.weakConcepts.length} · alerts ${signals.reviewAlerts.length} · records ${signals.recentRecords.length}`);
    ctx.expect.ok("the planner sees what the agent remembers", signals.memories.some((x) => /titration|waec|ss2|chemistry/i.test(x.note)), signals.memories);
    ctx.expect.ok("…and the conversation's summary", signals.chatSummaries.some((t) => /titration|chemistry/i.test(t)), signals.chatSummaries);
    ctx.expect.ok("…never anything sensitive", ![...signals.memories.map((x) => x.note), ...signals.chatSummaries].some((t) => /anxi|doctor|tablet/i.test(t)));
    ctx.expect.ok("…in the learner's time zone", typeof signals.timeZone === "string" && signals.timeZone.includes("/"), signals.timeZone);
    ctx.expect.ok("goals carry days left and progress", signals.goals.every((g) => "days_left" in g && "progress_note" in g), signals.goals);

    // Framed as data.
    const [sys, user] = planningMessages(signals);
    ctx.expect.ok("the learner's words are framed as data", /did not write/i.test(sys.content) && /<<<UNTRUSTED_[0-9a-f]+>>>\nSource: the learner's own words and notes[\s\S]*(titration|waec|chemistry)/i.test(user.content), user.content.slice(-600));

    // A real planning call (platform-paid, nothing saved) draws on it.
    const plan = await reasonAboutSignals(me.id, signals);
    const raw = Array.isArray(plan.proposals) ? plan.proposals : [];
    // What the learner would get: the server's validator decides, not the model.
    const props = await validateAndShapeProposals(me.id, raw);
    ctx.note(`proposed: ${JSON.stringify(raw.map((x) => [x.kind, x.title, x.rationale]))} · kept: ${props.length}`);
    ctx.expect.ok("at most 3 kept, each saying what it noticed", props.length <= 3 && props.every((x) => String(x.rationale || "").length >= 12), props.map((x) => x.rationale));
    ctx.expect.ok("…drawing on what the agent remembers", props.some((x) => /titration|curve|waec|chemistry|end point|equivalence/i.test(`${x.title} ${x.rationale}`)), props.map((x) => x.title));
    ctx.expect.ok("…and nothing sensitive", !props.some((x) => /anxi|doctor|tablet|tired/i.test(`${x.title} ${x.rationale}`)));

    // Without consent the planner gets no notes or summaries.
    await ctx.http({ as: p.learner, method: "PATCH", path: "/api/agent-memory/v1/settings", body: { learnFromChats: false } });
    const blind = await gatherSignals(me.id);
    ctx.expect.ok("with learning paused the planner sees no notes or summaries", !blind.memories.length && !blind.chatSummaries.length, { memories: blind.memories.length, summaries: blind.chatSummaries.length });
  },
};
