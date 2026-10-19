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
    ctx.expect.ok("…without claiming it can't read the document", !/\bcan(?:'|no)?t\s+(?:see|read|open|access)\b[^.]*\b(?:document|notes?|file|inside)\b/i.test(String(turn.reply || "")), turn.reply);
    ctx.expect.ok("…and doesn't write flashcards in chat", !/\b(front|back)\s*:|card\s*1\b|Q1[:.)]/i.test(String(turn.reply || "")), turn.reply);
  },
};

// "Make me flashcards on photosynthesis" with nothing taught and nothing in the Library:
// the protégé doesn't write them from general knowledge — it says it wasn't taught,
// gives Teach me, offers Akoro's own material on it, and the first chip is the guide.
export const untaughtFlashcards = {
  name: "chat.untaught_flashcards", area: "chat", risk: "write",
  description: "Flashcards on a topic the protégé wasn't taught, with no material: no cards from general knowledge — 'not taught', Teach me, Akoro material offered, the teaching-guide chip first.",
  params: { learner: { default: "@tester01" }, topic: { default: "photosynthesis" } },
  async run(ctx, p) {
    const lib = await ctx.http({ as: p.learner, method: "GET", path: "/api/records" });
    const mine = (lib.body?.data || []).filter((r) => new RegExp(p.topic, "i").test(r.name || ""));
    if (mine.length) ctx.expect.blocked(`${p.learner} has ${p.topic} material in their Library — this checks the no-material case`);

    const turn = await ctx.agent.chat({ as: p.learner, prompt: `Make me flashcards on ${p.topic}.` });
    const reply = String(turn.reply || "");
    const ask = turn.tools.find((t) => t.tool === "ask_to_be_taught");
    ctx.note(`tools: ${turn.tools.map((t) => t.tool).join(", ") || "(none)"} · reply: ${reply.slice(0, 400)}`);
    if (!ask && /\[T\d+\]/.test(reply)) ctx.expect.blocked(`${p.learner} has taught ${p.topic} — the reply cites their notes`);
    ctx.expect.ok("asks to be taught (Teach me button)", !!ask, turn.tools.map((t) => t.tool));
    ctx.expect.ok("says it wasn't taught", /\b(haven['’]?t|have not|not yet|wasn['’]?t|never)\b[^.]{0,40}\b(taught|teach)/i.test(reply), reply.slice(0, 300));
    const cardLines = reply.split("\n").filter((l) => /^\s*(?:\d+[.)]|[-*•]|\*\*)?\s*(?:Q(?:uestion)?\s*\d*|Front|Card\s*\d+)\b[^:]{0,12}:/i.test(l) || /^\s*\d+[.)].*\?\s*$/.test(l));
    ctx.expect.ok("writes no flashcards from general knowledge", cardLines.length < 2, cardLines.slice(0, 4));

    const offered = ask?.result?.materials || [];
    ctx.note(`Akoro material offered: ${offered.map((m) => `${m.kind}:${m.title}`).join(" · ") || "(none on the sandbox)"}`);
    ctx.expect.ok("Akoro material, if offered, is real courses/posts with in-app links", offered.every((m) => ["course", "blog"].includes(m.kind) && /^\/(course|blog)\//.test(m.href)), offered);

    const chips = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/suggestions",
      body: { role: "student", ask: `Make me flashcards on ${p.topic}.`, reply, tools: turn.tools.map((t) => ({ tool: t.tool, topic: t.input?.topic || null })) } });
    const first = String((chips.body?.suggestions || [])[0] || "");
    ctx.note(`chips: ${JSON.stringify(chips.body?.suggestions || [])}`);
    ctx.expect.ok("the first chip is the teaching guide", /^Ask your teaching guide/i.test(first), chips.body?.suggestions);
  },
};
