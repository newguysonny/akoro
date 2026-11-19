/**
 * Smarter memory (2026-11-03): agents don't start from scratch.
 *   memory.search_chats     — the agent finds the past chat where something
 *                             was discussed (by the words in the messages,
 *                             not the title), reads around the match, and
 *                             never sees another learner's chats.
 *   teaching.memory_notes   — what the learner told their agent in chat
 *                             (quiet-learning notes) reaches a new teaching
 *                             session's tutor; with no notes the prompt is
 *                             unchanged; proctored practice never reads them.
 */
import { runQuietPass } from "../../agent-memory/index.js";

export const searchChatsFinds = {
  name: "memory.search_chats", area: "agent-chat", risk: "write",
  description: "search_chats finds a past chat by what was said in it (not its title), read_chat lands around the match, and another learner's search finds nothing.",
  params: { learner: { default: "@tester28" }, other: { default: "@tester24" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    await ctx.as(p.other);
    const m = ctx.marker;
    // A made-up word so only THIS chat can match it, deep inside the chat.
    const word = `quokkaflux${String(Date.now()).slice(-5)}`;

    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${m} misc` } });
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked(`couldn't create the chat (${made.status})`);
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));
    const msgs = [
      ["user", "Can we start with fractions today?"], ["agent", "Sure — a fraction is part of a whole."],
      ["user", `My teacher used the word ${word} for water moving across a membrane. What is it?`],
      ["agent", `${word} sounds like your teacher's name for osmosis: water moves from a dilute to a concentrated solution.`],
      ...Array.from({ length: 8 }, (_, i) => [i % 2 ? "agent" : "user", `Filler message ${i} about decimals.`]),
    ];
    for (const [role, text] of msgs) {
      const r = await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${chatId}/messages`, body: { role, text } });
      if (r.status >= 300) ctx.expect.blocked(`adding a message answered ${r.status}`);
    }

    // The title search can't find it…
    const byTitle = await ctx.agent.tool({ as: p.learner, tool: "list_chats", input: { search: word } });
    ctx.expect.eq("list_chats (titles) doesn't find it", (byTitle?.chats || []).length, 0);

    // …search_chats does, by the words said in it.
    const found = await ctx.agent.tool({ as: p.learner, tool: "search_chats", input: { query: `what did we say about ${word}?` } });
    ctx.note(`search: ${JSON.stringify(found).slice(0, 400)}`);
    const hit = (found?.chats || []).find((c) => c.chatId === chatId);
    ctx.expect.ok("search_chats finds the chat", !!hit, found?.error || (found?.chats || []).map((c) => c.title));
    ctx.expect.ok("…by the words in its messages", hit?.matchedBy?.includes("words"), hit?.matchedBy);
    ctx.expect.ok("…with a snippet of the match", new RegExp(word).test(hit?.snippet || ""), hit?.snippet);

    // read_chat around the match lands on it (the latest page is filler).
    const latest = await ctx.agent.tool({ as: p.learner, tool: "read_chat", input: { chatId, limit: 4 } });
    ctx.expect.ok("the latest page doesn't contain it", !(latest?.messages || []).some((x) => x.text.includes(word)));
    const around = await ctx.agent.tool({ as: p.learner, tool: "read_chat", input: { chatId, limit: 4, around: hit?.matchedAt } });
    ctx.expect.ok("read_chat around=matchedAt shows it", (around?.messages || []).some((x) => x.text.includes(word)), around?.error || around?.messages);

    // Another learner's search finds nothing of this learner's.
    const foreign = await ctx.agent.tool({ as: p.other, tool: "search_chats", input: { query: word } });
    ctx.expect.ok("another learner's search doesn't find it", !(foreign?.chats || []).some((c) => c.chatId === chatId), foreign?.chats);
  },
};

const NOTE_CHAT = (m) => [
  ["user", `${m} I'm in JSS3 and I'm writing BECE next year.`],
  ["agent", "Great. What would you like to work on?"],
  ["user", "Fractions. I understand best when you use football examples — league tables, goals per match."],
  ["agent", "Football it is: if a team wins 3 of 4 matches, they won three quarters."],
  ["user", "Yes! That makes sense. Long paragraphs lose me though, keep it short."],
  ["agent", "Short and with football, got it."],
  ["user", "We didn't finish dividing fractions, let's do that next time."],
  ["agent", "Noted — dividing fractions next time."],
];

export const teachingMemoryNotes = {
  name: "teaching.memory_notes", area: "teaching", risk: "write",
  description: "A teaching session starts with what the learner told their agent before: the quiet-learning notes reach the session (protégé and NaNa), the prompt is unchanged without notes.",
  params: { learner: { default: "@tester27" }, topic: { default: "Fractions" }, subject: { default: "Mathematics" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const m = ctx.marker;

    // Consent: agent Online with learning on — restored afterwards.
    const before = await ctx.http({ as: p.learner, path: "/api/adaptive/chat/autonomy" });
    const was = { enabled: !!before.body?.enabled, level: before.body?.level ?? 1 };
    const set = await ctx.http({ as: p.learner, path: "/api/agent-memory/v1/settings" });
    const wasLearning = set.body?.learnFromChats !== false;
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: was }));
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "PATCH", path: "/api/agent-memory/v1/settings", body: { learnFromChats: wasLearning } }));
    await ctx.http({ as: p.learner, method: "PATCH", path: "/api/adaptive/chat/autonomy", body: { enabled: true, level: was.level } });
    await ctx.http({ as: p.learner, method: "PATCH", path: "/api/agent-memory/v1/settings", body: { learnFromChats: true } });

    // A chat where the learner says how they learn; the quiet pass remembers it.
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${m} fractions` } });
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked(`couldn't create the chat (${made.status})`);
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.learner_agent_memories", { ownerColumn: "user_id", ownerId: me.id, filters: { chat_session_id: chatId } }));
    for (const [role, text] of NOTE_CHAT(m)) {
      const r = await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${chatId}/messages`, body: { role, text } });
      if (r.status >= 300) ctx.expect.blocked(`adding a message answered ${r.status}`);
    }
    const pass = await runQuietPass({ userId: me.id, chatSessionId: chatId, force: true });
    ctx.note(`quiet pass: ${JSON.stringify(pass).slice(0, 300)}`);
    const active = await ctx.db.rows("edu.learner_agent_memories", { user_id: me.id, status: "active" }, { columns: "kind, content", limit: 200 });
    if (!active.some((x) => /football/i.test(x.content))) ctx.expect.blocked(`the quiet pass kept no football note (${pass.status}) — nothing to carry`);

    // A fresh teaching session: the notes are loaded and reach both voices.
    const { prepareTeachingSession } = await import("../../adaptive-learning/index.js");
    const { guideTeachPrompt } = await import("../../adaptive-learning/index.js");
    const prepared = await prepareTeachingSession({ studentId: me.id, topic: p.topic, subject: p.subject, mode: "fresh" });
    const notes = prepared.learnerNotes || [];
    ctx.note(`notes: ${JSON.stringify(notes)}`);
    ctx.expect.ok("the session starts with the learner's notes", notes.length > 0, notes);
    ctx.expect.ok("…including how they like to learn (football)", notes.some((n) => /football/i.test(n.content)), notes);
    ctx.expect.ok("…the protégé has them", (prepared.orchestrator?.studentAgent?.learnerNotes || []).length === notes.length);
    const base = { topic: p.topic, part: "Dividing fractions", move: "explain", phaseLabel: "Phase 2", evidence: {}, history: [] };
    const withNotes = guideTeachPrompt({ ...base, notes: prepared.orchestrator?.learnerNotes });
    ctx.expect.ok("…NaNa's teaching prompt carries them", /football/i.test(withNotes), withNotes.slice(0, 300));
    ctx.expect.ok("…as guidance, never evidence", /never evidence/.test(withNotes));
    ctx.expect.eq("without notes NaNa's prompt is unchanged", guideTeachPrompt({ ...base, notes: [] }), guideTeachPrompt(base));
    // Nothing about the gate changed: the session still starts at the beginning, no evidence credited.
    ctx.expect.ok("notes credit no evidence", !prepared.orchestrator?.teachingEvidence || Object.values(prepared.orchestrator.teachingEvidence?.concepts || {}).every((c) => !c?.verified));
  },
};

export const MEMORY_RECALL = [searchChatsFinds, teachingMemoryNotes];
