// Suggestion chips through their real REST routes, as a test learner (risk:
// write — each is one small billed model call). An empty list is how both
// routes report a failure, so the server's own warning lines ride along as
// evidence.
import { readLogs, logSeq } from "../../../lib/logTap.js";

const CELL = "The cell wall is a rigid layer outside the cell membrane of plant cells. It gives the cell its shape and stops it bursting " +
  "when water enters by osmosis. Mitochondria are the sites of aerobic respiration and release the energy stored in glucose.";

export const suggestionsAnswer = {
  name: "chat.suggestions_answer", area: "chat", risk: "write",
  description: "Agent Chat follow-up chips and the guide chat's Learn suggestions come back non-empty and about the material.",
  params: { learner: { default: "@tester17" } },
  async run(ctx, p) {
    const since = logSeq();
    const follow = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/suggestions",
      body: { ask: "What does the cell wall do?", reply: CELL } });
    const learn = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/learn-suggestions",
      body: { topic: "Cell structure", subject: "Biology", title: "BIO 111 Cell Structure", excerpt: CELL } });
    for (const line of readLogs({ since, filter: "suggestions" }).lines) ctx.note(`log: ${String(line.msg).slice(0, 300)}`);
    ctx.expect.status("follow-ups answer 200", follow, 200);
    ctx.expect.gte("follow-up chips", follow.body?.suggestions?.length ?? 0, 2);
    ctx.expect.status("learn suggestions answer 200", learn, 200);
    const items = learn.body?.suggestions || [];
    ctx.expect.gte("learn suggestions", items.length, 3);
    ctx.expect.ok("learn suggestions name the material", items.some((s) => /cell|mitochondri|osmosis|respiration/i.test(s)), JSON.stringify(items));
  },
};

// The chips under a reply are saved with it: a refresh (a reopened chat) shows them again.
export const suggestionsSurviveRefresh = {
  name: "chat.suggestions_survive_refresh", area: "chat", risk: "write",
  description: "The follow-up chips under the latest reply are saved on it, so a refreshed chat shows them again.",
  params: { learner: { default: "@tester17" } },
  async run(ctx, p) {
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} chips` } });
    const chatId = made.body?.session?.id;
    ctx.expect.ok("a chat", !!chatId, made.body);
    if (!chatId) return;
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "DELETE", path: `/api/adaptive/chat/sessions/${chatId}` }));
    const ask = "What does the cell wall do?";
    await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${chatId}/messages`, body: { role: "user", text: ask } });
    await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${chatId}/messages`, body: { role: "agent", text: CELL } });
    const s = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/suggestions", body: { ask, reply: CELL, role: "student", conversationId: chatId } });
    const chips = s.body?.suggestions || [];
    ctx.expect.gte("chips come back", chips.length, 2);
    let saved = [];
    for (let i = 0; i < 6 && !saved.length; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const msgs = await ctx.http({ as: p.learner, method: "GET", path: `/api/adaptive/chat/sessions/${chatId}/messages?limit=10` });
      saved = (msgs.body?.messages || []).filter((m) => m.role !== "user").pop()?.meta?.ideas || [];
    }
    ctx.note(`chips: ${JSON.stringify(chips)} · saved: ${JSON.stringify(saved)}`);
    ctx.expect.ok("…and are saved on the reply, so a refresh keeps them", saved.length === chips.length && saved.every((x, i) => x === chips[i]), { chips, saved });
  },
};

// "Make flashcards from my notes": the reader builds them; the agent links there instead of writing them in chat.
export const studyToolRouting = {
  name: "chat.study_tool_routing", area: "chat", risk: "write",
  description: "Asked for flashcards from their notes, the agent finds the document and links the reader's Flashcards tool instead of writing cards in chat.",
  params: { learner: { default: "@tester17" } },
  async run(ctx, p) {
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/records", body: { kind: "paste", name: `${ctx.marker} Cell wall notes`, content: CELL } });
    const record = made.body?.data?.record || made.body?.data;
    ctx.expect.ok("a note in the Library", !!record?.id, made.body);
    if (!record?.id) return;
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "DELETE", path: `/api/records/${record.id}` }));
    const turn = await ctx.agent.chat({ as: p.learner, prompt: `Make me flashcards from my "${ctx.marker} Cell wall notes".` });
    const call = turn.tools.find((t) => t.tool === "search_my_library");
    ctx.note(`tools: ${turn.tools.map((t) => `${t.tool}${t.input?.tool ? `(${t.input.tool})` : ""}`).join(", ")} · reply: ${String(turn.reply || "").slice(0, 300)}`);
    ctx.expect.ok("it searches the Library with the Flashcards tool", call?.input?.tool === "flashcards", turn.tools);
    ctx.expect.ok("…finds the note, linked to open the reader on Flashcards",
      (call?.result?.records || []).some((r) => r.recordId === record.id && r.tool === "flashcards"), call?.result);
    ctx.expect.ok("…and doesn't write flashcards in chat", !/\b(front|back)\s*:|card\s*1\b|Q1[:.)]/i.test(String(turn.reply || "")), turn.reply);
  },
};
