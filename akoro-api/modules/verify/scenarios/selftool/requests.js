// Self-tooling requests: components, bug reports, and status updates for the learner.

export async function runComponentRequest(ctx, p) {
    const me = await ctx.as(p.learner);
    const since = new Date(Date.now() - 5_000).toISOString();

    // 1. A real agent turn — the prompt, tool calls and reply are stored in
    //    evidence.agent; lay out a readable transcript as evidence notes too.
    const turn = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: String(p.prompt) });
    ctx.expect.eq("turn answered", turn.status, 200);
    ctx.note(`TRANSCRIPT · ${me.username}`);
    ctx.note(`You: ${String(p.prompt).replace(/\s+/g, " ").slice(0, 480)}`);
    for (const t of turn.tools || []) ctx.note(`· tool ${t.tool}: ${JSON.stringify(t.input || {}).slice(0, 160)} → ${JSON.stringify(t.result || {}).slice(0, 220)}`);
    ctx.note(`Agent: ${String(turn.reply || "").replace(/\s+/g, " ").slice(0, 480)}`);

    // 2. Honesty: if the reply says a request was filed, a real component request exists.
    const claims = /\b(filed|submitted|sent|made|raised|logged)\b[^.]{0,40}\brequest\b|\brequest\b[^.]{0,40}\b(filed|submitted|sent|pending|made)\b/i.test(String(turn.reply || ""));
    const turnRows = (await ctx.db.rows("edu.agent_tool_requests", { requester_id: me.id, kind: "component" }, { columns: "id, kind, title, description, status, created_at", limit: 50 }))
      .filter((r) => Date.parse(r.created_at || "") >= Date.parse(since));
    for (const r of turnRows) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_requests", { ownerColumn: "requester_id", ownerId: me.id, filters: { id: r.id } }));
    ctx.expect.ok("if the reply says a request was filed, it exists as a component request", !claims || turnRows.length > 0, { claims, rows: turnRows });
    for (const r of turnRows) ctx.expect.eq("the agent's request is kind=component (not a tool)", r.kind, "component");

    // 3. Deterministic companion (independent of the model): the tool accepts and
    //    stores kind='component', and a repeat is deduped.
    const input = {
      title: `${ctx.marker} Spaced-review component`,
      description: "A spaced-review learning component that re-tests a concept after 1, 3 and 7 days.",
      category: "study_support", kind: "component",
    };
    const direct = await ctx.agent.tool({ as: p.learner, tool: "submit_tool_request", mode: "live", input });
    ctx.expect.ok("submit_tool_request accepts kind=component", direct?.submitted === true || direct?.duplicate === true, direct);
    const mine = await ctx.db.rows("edu.agent_tool_requests", { requester_id: me.id, kind: "component", title: { like: `${ctx.marker}%` } }, { columns: "id, kind, title, status", limit: 5 });
    for (const r of mine) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_requests", { ownerColumn: "requester_id", ownerId: me.id, filters: { id: r.id } }));
    ctx.expect.ok("the request is stored as a component", mine.length > 0 && mine.every((r) => r.kind === "component"), mine);
    ctx.note(`component requests filed this run: ${JSON.stringify(mine.map((r) => [r.kind, r.title, r.status]))}`);
    const again = await ctx.agent.tool({ as: p.learner, tool: "submit_tool_request", mode: "live", input });
    ctx.expect.ok("asking again returns the same request (deduped)", again?.duplicate === true || again?.submitted === false, again);
}

export async function runComponentRequestDelivered(ctx, p) {
    const me = await ctx.as(p.learner);

    // 1. File a component request (deterministic tool call).
    const input = {
      title: `${ctx.marker} Delivered component: active recall`,
      description: "An active-recall learning component that hides the learner's notes and asks them to recall the content from memory.",
      category: "study_support", kind: "component",
    };
    const filed = await ctx.agent.tool({ as: p.learner, tool: "submit_tool_request", mode: "live", input });
    ctx.expect.ok("component request filed", filed?.submitted === true || filed?.duplicate === true, filed);
    const rows = await ctx.db.rows("edu.agent_tool_requests", { requester_id: me.id, kind: "component", title: { like: `${ctx.marker}%` } }, { columns: "id, kind, status", limit: 5 });
    for (const r of rows) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_requests", { ownerColumn: "requester_id", ownerId: me.id, filters: { id: r.id } }));
    ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: me.id, filters: { type: "agent_tool_request" } }));
    ctx.expect.ok("stored as a component, waiting", rows.length > 0 && rows.every((r) => r.kind === "component" && r.status === "new"), rows);
    const req = rows[0];
    if (!req) return;

    // 2. An admin marks it implemented with a note → the learner is notified.
    const { reviewToolRequest } = await import("../../../agent-tool-requests/index.js");
    const delivered = await reviewToolRequest({
      requestId: req.id, status: "implemented",
      adminNote: "Active recall is now available as a Learning Session component.",
      admin: { id: null, label: "verification gate" },
    });
    ctx.expect.eq("marked implemented", delivered?.request?.status, "implemented");
    ctx.expect.ok("the learner was notified", delivered?.notified === true, delivered);
    ctx.expect.gte("a notification row exists for the requester", await ctx.db.count("notifications", { user_id: me.id, type: "agent_tool_request" }), 1);

    // 2b. The agent also posts the news into a chat (not only the bell).
    const chatMsgs = await ctx.db.rows("chat_messages", { user_id: me.id, role: "agent" }, { columns: "id, session_id, text, created_at", limit: 50 });
    const informed = chatMsgs.find((m) => String(m.text || "").includes(ctx.marker));
    for (const m of chatMsgs.filter((x) => String(x.text || "").includes(ctx.marker))) {
      ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { id: m.id } }));
      ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: m.session_id } }));
    }
    ctx.expect.ok("the agent messaged the learner in chat too", !!informed, informed);

    // 3. The learner's agent can confirm it, through the same tool the app uses.
    const check = await ctx.agent.tool({ as: p.learner, tool: "check_my_requests", mode: "live", input: {} });
    const mine = (check?.requests || []).find((r) => String(r.title || "").startsWith(ctx.marker));
    ctx.expect.ok("check_my_requests lists it as ready", !!mine && mine.status === "implemented" && mine.ready === true, check);

    // 4. A real agent turn: the learner asks if it is ready; the agent checks and confirms. Transcript kept.
    const turn = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: "Is my active-recall component request ready? If it is, tell me what I can do now." });
    ctx.expect.eq("turn answered", turn.status, 200);
    ctx.note(`TRANSCRIPT · ${me.username}`);
    ctx.note(`You: Is my active-recall component request ready? If it is, tell me what I can do now.`);
    for (const t of turn.tools || []) ctx.note(`· tool ${t.tool}: ${JSON.stringify(t.input || {}).slice(0, 120)} → ${JSON.stringify(t.result || {}).slice(0, 220)}`);
    ctx.note(`Agent: ${String(turn.reply || "").replace(/\s+/g, " ").slice(0, 480)}`);
    ctx.expect.ok("the agent checked the request status", (turn.tools || []).some((t) => t.tool === "check_my_requests"), (turn.tools || []).map((t) => t.tool));
    ctx.expect.ok("and told the learner it is ready", /ready|available|built|implemented/i.test(String(turn.reply || "")), String(turn.reply || "").slice(0, 200));
}

export async function runBugReportDelivered(ctx, p) {
    const me = await ctx.as(p.learner);
    const filed = await ctx.agent.tool({ as: p.learner, tool: "submit_bug_report", mode: "live", input: {
      title: `${ctx.marker} Library count shows 6 instead of 51`,
      description: "The Library count tool reports a total of 6 while the subject rows add to 51; expected the total to equal the sum of documents.",
      category: "other" } });
    ctx.expect.ok("bug report filed", filed?.submitted === true || filed?.duplicate === true, filed);
    const rows = await ctx.db.rows("edu.agent_tool_requests", { requester_id: me.id, kind: "bug", title: { like: `${ctx.marker}%` } }, { columns: "id, kind, status, title", limit: 5 });
    for (const r of rows) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_requests", { ownerColumn: "requester_id", ownerId: me.id, filters: { id: r.id } }));
    ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: me.id, filters: { type: "agent_tool_request" } }));
    ctx.expect.ok("stored as kind=bug, waiting", rows.length > 0 && rows[0].kind === "bug" && rows[0].status === "new", rows);
    const req = rows[0];
    if (!req) return;

    const { reviewToolRequest } = await import("../../../agent-tool-requests/index.js");
    const fixed = await reviewToolRequest({ requestId: req.id, status: "implemented", adminNote: "Fixed: the total now counts documents.", admin: { id: null, label: "verification gate" } });
    ctx.expect.eq("marked implemented", fixed?.request?.status, "implemented");
    ctx.expect.ok("the learner was notified", fixed?.notified === true, fixed);
    ctx.expect.gte("a notification row exists", await ctx.db.count("notifications", { user_id: me.id, type: "agent_tool_request" }), 1);

    const chatMsgs = await ctx.db.rows("chat_messages", { user_id: me.id, role: "agent" }, { columns: "id, session_id, text", limit: 50 });
    const informed = chatMsgs.find((m) => String(m.text || "").includes(ctx.marker));
    for (const m of chatMsgs.filter((x) => String(x.text || "").includes(ctx.marker))) {
      ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { id: m.id } }));
      ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: m.session_id } }));
    }
    ctx.expect.ok("the agent messaged the learner in chat too", !!informed, informed);

    const check = await ctx.agent.tool({ as: p.learner, tool: "check_my_requests", mode: "live", input: {} });
    const mine = (check?.requests || []).find((r) => String(r.title || "").startsWith(ctx.marker));
    ctx.expect.ok("check_my_requests lists the bug as fixed", !!mine && mine.kind === "bug" && mine.status === "implemented", check);
}

export async function runRequestStatusLifecycle(ctx, p) {
    const me = await ctx.as(p.learner);
    const title = `${ctx.marker} PDF-to-flashcards tool`;
    const filed = await ctx.agent.tool({ as: p.learner, tool: "submit_tool_request", mode: "live", input: {
      title,
      description: "A tool that turns an uploaded PDF chapter into flashcards automatically, so revision starts from my own notes.",
      category: "study_support", kind: "tool",
    } });
    ctx.expect.ok("tool request filed", filed?.submitted === true || filed?.duplicate === true, filed);
    const rows = await ctx.db.rows("edu.agent_tool_requests", { requester_id: me.id, kind: "tool", title: { like: `${ctx.marker}%` } }, { columns: "id, kind, status, title", limit: 5 });
    for (const r of rows) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_requests", { ownerColumn: "requester_id", ownerId: me.id, filters: { id: r.id } }));
    const req = rows[0];
    if (!req) return;
    ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: me.id, filters: { related_id: req.id } }));
    ctx.expect.eq("filed as a tool request, waiting", [req.kind, req.status], ["tool", "new"]);

    const { reviewToolRequest } = await import("../../../agent-tool-requests/index.js");
    const words = {
      under_review: /under[ _]?review|in review|reviewing/i,
      planned: /plan/i,
      declined: /declin|not taken forward/i,
      implemented: /ready|available|implemented/i,
    };

    for (const status of ["under_review", "planned", "declined", "implemented"]) {
      const out = await reviewToolRequest({ requestId: req.id, status, adminNote: `Verification: moved to ${status}`, admin: { id: null, label: "verification gate" } });
      ctx.expect.eq(`${status}: saved`, out?.request?.status, status);
      ctx.expect.ok(`${status}: requester notified`, out?.notified === true, out);
      const notif = (await ctx.db.rows("notifications", { user_id: me.id, related_id: req.id }, { columns: "title, content", limit: 20 })).find((n) => words[status].test(String(n.title || "")));
      ctx.expect.ok(`${status}: notification matches the status`, !!notif, notif);
      const chat = (await ctx.db.rows("chat_messages", { user_id: me.id, role: "agent", text: { like: `%${ctx.marker}%` } }, { columns: "id, session_id, text", limit: 50 })).find((m) => words[status].test(String(m.text || "")));
      ctx.expect.ok(`${status}: agent messaged the learner in chat`, !!chat, chat);
      const check = await ctx.agent.tool({ as: p.learner, tool: "check_my_requests", mode: "live", input: {} });
      const mine = (check?.requests || []).find((r) => String(r.title || "").startsWith(ctx.marker));
      ctx.expect.eq(`${status}: check_my_requests shows it`, mine?.status, status);

      // Real agent turn: the learner asks for the status; the agent must check and relay it.
      const turn = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model,
        prompt: `Use check_my_requests and tell me the current status of my request titled "${title}". Quote the status word exactly.` });
      ctx.expect.eq(`${status}: turn answered`, turn.status, 200);
      ctx.expect.ok(`${status}: agent checked the request`, (turn.tools || []).some((t) => t.tool === "check_my_requests"), (turn.tools || []).map((t) => t.tool));
      ctx.expect.ok(`${status}: agent told the learner the status`, words[status].test(String(turn.reply || "")), String(turn.reply || "").slice(0, 200));
      ctx.note(`TRANSCRIPT ${status} · Agent: ${String(turn.reply || "").replace(/\s+/g, " ").slice(0, 320)}`);
    }

    // The agent chat updates carry the run marker in the request title — clean them up.
    const msgs = await ctx.db.rows("chat_messages", { user_id: me.id, role: "agent", text: { like: `%${ctx.marker}%` } }, { columns: "id, session_id", limit: 50 });
    for (const m of msgs) {
      ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { id: m.id } }));
      ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: m.session_id } }));
    }
}
