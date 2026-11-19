// Phase 18 items 4 and 7 through the gate.
//
//   ratings.saved_not_in_prompt   item 4 — a rating on a test learner's own reply
//                                 is saved, is absent from what the next turn's
//                                 prompt is built from, and appears on the episode
//                                 as a human label (when that learner's turns are
//                                 recorded at all).
//   prompts.override_flagged      item 7 — every prompt part reads with a status; an
//                                 override based on an older default is still the
//                                 text the loader serves and is flagged
//                                 default_updated with both texts. Read only: an
//                                 edit would change every learner's agent.

const ADMIN = "@tester90";

export const ratingSavedNotInPrompt = {
  name: "ratings.saved_not_in_prompt", area: "agent-chat", risk: "write",
  description: "A thumbs-down with a reason on a test learner's own reply is saved; the next turn's context (durable transcript, history, doctrine) doesn't contain it; it joins the episode as a human label; clearing it clears both. Rating someone else's message is 404.",
  params: { learner: { default: "@tester07" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { labelKeyFor } = await import("../../agent-ratings/index.js");
    const { saveEpisode, recordsRealTraffic } = await import("../../agent-contract/index.js");
    const { createEpisodeRecorder } = await import("../../agent-contract/index.js");
    const { loadLearnerAgentConversationContext } = await import("../../agent-tools/index.js");
    const { safeHistory } = await import("../../adaptive-learning/index.js");
    const { assembleChatDoctrine } = await import("../../agent-context/index.js");

    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} rating` } });
    ctx.expect.status("chat created", made, 201);
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked("couldn't create the chat");
    ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { session_id: chatId } }));
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));
    await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${chatId}/messages`, body: { role: "user", text: `${ctx.marker} explain fractions` } });
    const reply = await ctx.http({ as: p.learner, method: "POST", path: `/api/adaptive/chat/sessions/${chatId}/messages`, body: { role: "agent", text: "A fraction is part of a whole." } });
    ctx.expect.status("a reply to rate", reply, 201);
    const messageId = reply.body?.message?.id;
    if (!messageId) ctx.expect.blocked("no reply id");
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_message_ratings", { ownerColumn: "learner_id", ownerId: me.id, filters: { message_id: messageId } }));

    // The episode this reply produced (a synthetic one through the store's own path), keyed to the reply.
    const key = labelKeyFor("agent_chat", messageId);
    if (!key) ctx.expect.blocked("No label secret on this server — ratings can't be joined to episodes");
    const rec = createEpisodeRecorder({ surface: "agent_chat", source: "synthetic", messages: [{ role: "user", content: "explain fractions" }], meta: {} });
    rec.decision({ reply: "A fraction is part of a whole." });
    const ep = rec.finish({ scenario: `verify:${ctx.marker}` });
    const stored = await saveEpisode(ep, { labelKey: key });
    if (stored === "stored") {
      ctx.cleanup(async () => { const { default: db } = await import("../../../db.js"); await db.schema("edu").from("agent_episodes").delete().eq("id", ep.id).eq("scenario", `verify:${ctx.marker}`); });
    }

    const canary = `${ctx.marker} RATING-CANARY skipped my question`;
    const put = await ctx.http({ as: p.learner, method: "PUT", path: `/api/adaptive/ratings/agent_chat/${messageId}`, body: { rating: "down", reason: canary } });
    ctx.expect.status("rating saved", put, 200);
    const rows = await ctx.db.rows("edu.agent_message_ratings", { learner_id: me.id, message_id: messageId }, { columns: "rating, reason" });
    ctx.expect.eq("one row, down", rows.map((r) => r.rating), ["down"]);
    ctx.expect.ok("the reason is stored", String(rows[0]?.reason || "").includes("RATING-CANARY"));
    const notMine = await ctx.http({ as: p.learner, method: "PUT", path: "/api/adaptive/ratings/agent_chat/7b0f3c2a-1d4e-4f5a-9b6c-2e8d7a1c3f40", body: { rating: "up" } });
    ctx.expect.status("a message that isn't theirs is not found", notMine, 404);

    // The next turn's context: the durable transcript, the history fallback, the doctrine.
    const next = await loadLearnerAgentConversationContext({ conversationId: chatId, userId: me.id });
    ctx.expect.ok("the durable transcript has the reply", (next.messages || []).some((m) => m.content === "A fraction is part of a whole."));
    ctx.expect.ok("the rating is absent from the next turn's context", !JSON.stringify(next).includes("RATING-CANARY"));
    ctx.expect.ok("history items carry no rating", !JSON.stringify(safeHistory([{ role: "assistant", content: "x", rating: "down", reason: canary }])).includes("RATING-CANARY"));
    ctx.expect.ok("the doctrine has no rating", !(await assembleChatDoctrine({ role: "student" })).includes("RATING-CANARY"));

    // On the episode, next to the code's verdict.
    const recorded = await recordsRealTraffic(me.id);
    const epRows = stored === "stored" ? await ctx.db.rows("edu.agent_episodes", { id: ep.id }, { columns: "verdict, human_label" }) : [];
    const cleared = await ctx.http({ as: p.learner, method: "DELETE", path: `/api/adaptive/ratings/agent_chat/${messageId}` });
    ctx.expect.status("rating cleared", cleared, 200);
    ctx.expect.eq("no rating row left", (await ctx.db.rows("edu.agent_message_ratings", { learner_id: me.id, message_id: messageId }, { columns: "id" })).length, 0);
    if (stored !== "stored") ctx.expect.blocked(`The episode store didn't keep the episode (${stored}) — AGENT_EPISODES is off here`);
    if (!recorded) {
      ctx.expect.eq("no label: this learner's turns aren't recorded (mode / opt-out)", epRows[0]?.human_label ?? null, null);
      ctx.expect.blocked("AGENT_EPISODES doesn't record this learner's turns (synthetic mode, or opted out) — the label is correctly withheld; run where the mode is consented/all to see it joined");
    }
    ctx.expect.eq("the human label is on the episode", epRows[0]?.human_label?.rating, "down");
    ctx.expect.ok("the code's verdict is beside it", ["pass", "fail"].includes(epRows[0]?.verdict));
    ctx.expect.ok("the label holds no identity", !/learner_id|user_id/.test(JSON.stringify(epRows[0]?.human_label || {})));
    const after = await ctx.db.rows("edu.agent_episodes", { id: ep.id }, { columns: "human_label" });
    ctx.expect.eq("clearing the rating cleared the label", after[0]?.human_label ?? null, null);
  },
};

export const promptOverrideFlagged = {
  name: "prompts.override_flagged", area: "agent-chat", risk: "read",
  description: "Every prompt part lists with a status; an override based on an older default keeps being served after the default changed and is flagged default_updated with both texts (checked on the live files without writing); each stored override is what the loader serves.",
  params: {},
  async run(ctx) {
    const list = await ctx.http({ as: ADMIN, path: "/api/admin/agent-prompts" });
    ctx.expect.status("the parts list answers", list, 200);
    const parts = list.body?.parts || [];
    ctx.expect.gte("parts listed", parts.length, 10);
    ctx.expect.ok("every part has a status", parts.every((x) => ["default", "overridden", "default_updated"].includes(x.status)));
    const flagged = parts.filter((x) => x.status === "default_updated").map((x) => x.file);
    if (flagged.length) ctx.note(`Default updated under an override: ${flagged.join(", ")}`);

    // A deploy changed the default under an override (simulated in memory on a live file).
    const O = await import("../../agent-context/index.js");
    const CM = await import("../../agent-context/index.js");
    const file = "channels/CHAT.md";
    const shipped = await CM.loadDefaultRaw(file);
    const older = `${shipped}\n(an older default)`;
    const mine = { text: `${shipped}\nAdmin's line.`, base_hash: O.hashText(older) };
    ctx.expect.eq("an override based on an older default is flagged", O.partStatus({ defaultText: shipped, override: mine }), "default_updated");
    const cache = O.createOverrideCache({ fetchRows: async () => [{ file, ...mine }] });
    ctx.expect.eq("the admin's text is still what an override serves", (await cache.get()).get(file)?.text, mine.text);
    ctx.expect.eq("keep mine (re-based) clears the flag", O.partStatus({ defaultText: shipped, override: { ...mine, base_hash: O.hashText(shipped) } }), "overridden");
    const part = await ctx.http({ as: ADMIN, path: `/api/admin/agent-prompts/part?file=${encodeURIComponent(file)}` });
    ctx.expect.status("one part reads", part, 200);
    ctx.expect.eq("its default is the shipped file", part.body?.part?.default?.text, shipped);

    // Each stored override is what the loader serves now (it survived every deploy since).
    const stored = await ctx.db.rows("edu.agent_prompt_overrides", {}, { columns: "file, text" });
    ctx.note(`${stored.length} stored override(s)`);
    if (O.overridesInstalled() && String(process.env.AGENT_PROMPT_OVERRIDES || "").toLowerCase() !== "off") {
      for (const o of stored) ctx.expect.eq(`${o.file} loads the admin's text`, (await CM.loadRaw(o.file)), o.text);
    }
    const asm = await ctx.http({ as: ADMIN, path: "/api/admin/agent-prompts/assembled?set=persona_nana" });
    ctx.expect.status("the assembled persona prompt reads", asm, 200);
    ctx.expect.ok("it has every file of the set", (asm.body?.prompt?.files || []).length >= 5);
  },
};
