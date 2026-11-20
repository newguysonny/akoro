// Self-tooling writes: saving, confirming, escalating, and undoing tool changes.
import { needCreate } from "./shared.js";

export async function runRegisterReuseDisable(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner);
    const name = `verify_${ctx.marker.slice(8, 16).replace(/[^a-z0-9]/g, "x")}`;
    const r = await ctx.agent.tool({ as: p.learner, tool: "create_tool", mode: "live", input: {
      goal: "How many tasks I have by status", name, label: `${ctx.marker} Tasks by status`, hint: { views: ["my_tasks"] } } });
    // create_tool may resolve to a canonical domain tool name (r.tool), not the
    // requested name — use the name it actually saved under.
    ctx.expect.ok("created (or reused)", r?.status === "created" || r?.status === "reused", r);
    if (r?.status !== "created" && r?.status !== "reused") return;
    const toolName = r.tool || name;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tools", { ownerColumn: "owner_id", ownerId: me.id, filters: { name: toolName } }));
    const row = (await ctx.db.rows("edu.agent_tools", { owner_id: me.id, name: toolName }, { columns: "id, status, mode, views", limit: 1 }))[0];
    ctx.expect.ok("saved for this learner", !!row && ["active", "disabled"].includes(row.status), row);
    if (!row) return;
    const again = await ctx.agent.tool({ as: p.learner, tool: toolName, learnerTool: true, mode: "live", input: {} });
    ctx.expect.ok("runs again by name", Array.isArray(again?.rows), again?.error);
    const other = await ctx.agent.tool({ as: "@tester23", tool: toolName, learnerTool: true, input: {} });
    ctx.expect.ok("another learner can't run it", !Array.isArray(other?.rows), other);
    const off = await ctx.http({ as: p.learner, method: "PATCH", path: `/api/self-tooling/tools/${row.id}`, body: { status: "disabled" } });
    ctx.expect.status("turned off", off, 200);
    const blocked = await ctx.agent.tool({ as: p.learner, tool: toolName, learnerTool: true, mode: "live", input: {} });
    ctx.expect.ok("stops once turned off", !!blocked?.error && !blocked?.rows, blocked);
}

export async function runEscalateAndResume(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner);
    // The probe capability is harmless (it returns the time) and never offered by
    // schema_lookup, so a grant made here changes nothing for real learners.
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} escalation` } });
    ctx.expect.status("chat created", made, 201);
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked("couldn't create the chat");
    const name = `probe_${ctx.marker.slice(8, 16).replace(/[^a-z0-9]/g, "x")}`;
    const goal = `${ctx.marker} show when the gate probe last checked in`;
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));
    ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: me.id, filters: { related_id: chatId } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tools", { ownerColumn: "owner_id", ownerId: me.id, filters: { name: { like: `${name}%` } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_requests", { ownerColumn: "requester_id", ownerId: me.id, filters: { goal } }));

    const input = { goal, name, label: `${ctx.marker} Probe check`, hint: { capabilities: ["verify.probe"] } };
    const r = await ctx.agent.tool({ as: p.learner, tool: "create_tool", mode: "live", conversationId: chatId, input });
    ctx.expect.eq("escalated", r?.status, "escalated");
    ctx.expect.ok("returns the request it made", !!r?.requestId, r);
    if (!r?.requestId) return;
    const row = (await ctx.db.rows("edu.agent_tool_requests", { id: r.requestId }, { columns: "kind, requested_capability, status, resume_status, conversation_id, requester_id", limit: 1 }))[0];
    ctx.expect.ok("request row: capability, waiting, this chat, this learner",
      row?.kind === "capability" && row?.requested_capability === "verify.probe" && row?.status === "new" && row?.resume_status === "waiting" && row?.conversation_id === chatId && row?.requester_id === me.id, row);
    const again = await ctx.agent.tool({ as: p.learner, tool: "create_tool", mode: "live", conversationId: chatId, input });
    ctx.expect.ok("asking again returns the same request", again?.requestId === r.requestId && again?.duplicate === true, again);

    // The admin decision (in-process, as the gate): approve for everyone, short expiry.
    const { decideRequest, revokeGrant } = await import("../../../self-tooling/index.js");
    const { enqueueResume } = await import("../../../self-tooling/index.js");
    const decided = await decideRequest({ requestId: r.requestId, decision: "approve", note: "gate test", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      admin: { id: null, label: "verification gate" }, enqueue: enqueueResume });
    ctx.expect.ok("approved with a grant", decided?.request?.status === "approved" && !!decided?.grant?.id, decided);
    const grantId = decided?.grant?.id;
    if (grantId) ctx.cleanup(() => revokeGrant({ grantId, admin: { id: null, label: "verification gate" } }).catch(() => {}));

    // Resume: the build re-runs as the learner and answers in the same chat.
    const done = await ctx.until(async () => {
      const x = (await ctx.db.rows("edu.agent_tool_requests", { id: r.requestId }, { columns: "status, resume_status, resume_result", limit: 1 }))[0];
      return x && ["resumed", "failed"].includes(x.resume_status) ? x : null;
    }, { timeoutMs: 120_000, everyMs: 4_000 });
    ctx.expect.eq("resumed", done?.resume_status, "resumed");
    ctx.expect.eq("request implemented", done?.status, "implemented");
    ctx.note(`resume result: ${JSON.stringify(done?.resume_result || null).slice(0, 300)}`);
    const msgs = await ctx.db.rows("chat_messages", { session_id: chatId, user_id: me.id }, { columns: "role, text, meta", limit: 10 });
    const told = msgs.find((m) => m.role === "agent" && /permission/i.test(m.text) && /built/i.test(m.text));
    ctx.expect.ok("answer posted into the same chat", !!told, msgs.map((m) => m.text.slice(0, 80)));
    ctx.expect.ok("it carries a Run it now button for the tool (nothing run in the background)", !!told?.meta?.runTool?.label && /Run it now/.test(told?.text || ""), told?.meta);
    ctx.expect.gte("learner notified", await ctx.db.count("notifications", { user_id: me.id, related_id: chatId }), 1);
    const tool = (await ctx.db.rows("edu.agent_tools", { owner_id: me.id, name: { like: `${name}%` } }, { columns: "name, capabilities, status", limit: 1 }))[0];
    ctx.expect.ok("tool saved with the capability", !!tool && tool.status === "active" && (tool.capabilities || []).includes("verify.probe"), tool);
    // The learner taps Run it now: a normal agent turn runs the tool and explains what it found.
    if (tool && told?.meta?.runTool?.label) {
      const t = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: `Run "${told.meta.runTool.label}" now.`,
        history: [{ role: "user", content: goal }, { role: "assistant", content: told.text }] });
      ctx.note(`Run it now: ${String(t.reply || "").replace(/\s+/g, " ").slice(0, 300)} · tools ${JSON.stringify((t.tools || []).map((x) => x.tool))}`);
      ctx.expect.ok("Run it now: the agent runs the tool in its turn", (t.tools || []).some((x) => x.tool === tool.name), (t.tools || []).map((x) => x.tool));
      ctx.expect.ok("…and answers in words, not a raw row dump", String(t.reply || "").trim().length > 20 && !/^•/m.test(String(t.reply || "")), String(t.reply || "").slice(0, 200));
    }

    // Revoke: the saved tool stops at once.
    if (grantId && tool) {
      await revokeGrant({ grantId, admin: { id: null, label: "verification gate" } });
      const after = await ctx.agent.tool({ as: p.learner, tool: tool.name, learnerTool: true, mode: "live", input: {} });
      ctx.expect.ok("revoked capability stops the tool", !!after?.error && !after?.rows, after);
    }
}

export async function runWriteConfirm(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner);
    await ctx.as(p.other);
    const { default: db } = await import("../../../../db.js");
    const { activeGrants } = await import("../../../self-tooling/index.js");
    const tag = ctx.marker.slice(8, 16).replace(/[^a-z0-9]/g, "x");
    const name = `verify_done_${tag}`;
    const titles = [`${ctx.marker} revise fractions`, `${ctx.marker} revise motion`];

    // The hidden write probe, granted only for this run (it can only mark tasks done, and every write needs a tap).
    const { data: grant, error: gErr } = await db.schema("edu").from("capability_grants")
      .insert({ capability: "verify.task_done", note: `gate ${ctx.marker}`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }).select("id").single();
    if (gErr) ctx.expect.blocked(`couldn't grant the probe: ${gErr.message}`);
    ctx.cleanup(async () => { await db.schema("edu").from("capability_grants").update({ revoked_at: new Date().toISOString() }).eq("id", grant.id); await activeGrants({ fresh: true }); });
    await activeGrants({ fresh: true });
    ctx.cleanup(() => ctx.db.deleteOwned("tasks", { ownerColumn: "creator_id", ownerId: me.id, filters: { title: { like: `${ctx.marker}%` } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tools", { ownerColumn: "owner_id", ownerId: me.id, filters: { name } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_write_confirmations", { ownerColumn: "principal_id", ownerId: me.id, filters: { tool_name: "selftool:verify.task_done" } }));

    for (const title of titles) {
      const t = await ctx.agent.tool({ as: p.learner, tool: "create_task", mode: "live", input: { title, priority: "low", dueInMinutes: 60 } });
      ctx.expect.ok(`task "${title.slice(-15)}" created`, !t?.error, t?.error);
    }
    const statusOf = async () => (await ctx.db.rows("tasks", { creator_id: me.id, title: { like: `${ctx.marker}%` } }, { columns: "title, status" })).map((r) => r.status);

    const r = await ctx.agent.tool({ as: p.learner, tool: "create_tool", mode: "live", input: {
      goal: `Mark my tasks whose title starts with "${ctx.marker}" as done`, name, label: `${ctx.marker} Finish gate tasks`,
      hint: { views: ["my_tasks"], capabilities: ["verify.task_done"] } } });
    ctx.expect.eq("tool created", r?.status, "created");
    const card = r?.result?.confirmation;
    ctx.expect.eq("running it asks for confirmation", r?.result?.status, "needs_confirmation");
    ctx.note(`definition: ${JSON.stringify(r?.definition || null).slice(0, 300)}; items: ${JSON.stringify(card?.items || [])}`);
    if (!card?.confirmationId) return;
    ctx.expect.eq("lists exactly the two gate tasks", (card.items || []).length, 2);
    ctx.expect.ok("lists only the gate tasks", (card.items || []).every((x) => String(x).startsWith(ctx.marker)), card.items);
    ctx.expect.ok("nothing changed before confirming", (await statusOf()).every((s) => s !== "done"), await statusOf());

    const theirs = await ctx.http({ as: p.other, method: "POST", path: `/api/self-tooling/confirmations/${card.confirmationId}/confirm` });
    ctx.expect.status("another learner can't confirm it", theirs, 404);
    const declined = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-tooling/confirmations/${card.confirmationId}/reject` });
    ctx.expect.eq("declined", declined.body?.data?.status, "rejected");
    ctx.expect.ok("declining changed nothing", (await statusOf()).every((s) => s !== "done"));

    // Dry run: says what would change, proposes nothing.
    const before = await ctx.db.count("edu.agent_tool_write_confirmations", { principal_id: me.id, tool_name: "selftool:verify.task_done" });
    const dry = await ctx.agent.tool({ as: p.learner, tool: name, learnerTool: true, mode: "dry", input: {} });
    ctx.expect.eq("dry run only describes", dry?.status, "would_need_confirmation");
    ctx.expect.eq("dry run proposed nothing", await ctx.db.count("edu.agent_tool_write_confirmations", { principal_id: me.id, tool_name: "selftool:verify.task_done" }), before);

    const again = await ctx.agent.tool({ as: p.learner, tool: name, learnerTool: true, mode: "live", input: {} });
    const card2 = again?.confirmation;
    ctx.expect.ok("asking again gives a fresh card", card2?.confirmationId && card2.confirmationId !== card.confirmationId && card2.status === "pending", again);
    if (!card2?.confirmationId) return;
    const ok = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-tooling/confirmations/${card2.confirmationId}/confirm` });
    ctx.expect.status("confirmed", ok, 200);
    ctx.expect.eq("both applied", ok.body?.data?.result?.done, 2);
    // Server-side continuation: the outcome is posted into the chat by the server,
    // not left only on the card (which the UI drops after the choice).
    const posted = await ctx.db.rows("chat_messages", { user_id: me.id }, { columns: "id, text, role", limit: 100 });
    ctx.expect.ok("the server posted the outcome into the chat", posted.some((m) => m.role === "agent" && /Done — 2 changed/.test(String(m.text || ""))), posted.map((m) => m.text).filter((t) => /changed/.test(String(t))));
    ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { text: { like: "Done — %" } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { text: { like: "Not changed — %" } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { title: "Your change" } }));
    ctx.expect.ok("the tasks are done now", (await statusOf()).every((s) => s === "done"), await statusOf());
    const twice = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-tooling/confirmations/${card2.confirmationId}/confirm` });
    ctx.expect.status("can't be used twice", twice, 409);
}

export async function runGroupTotal(ctx, p) {
    const me = await ctx.as(p.learner);
    const made = [];
    for (let i = 0; i < 2; i++) {
      const t = await ctx.agent.tool({ as: p.learner, tool: "create_task", mode: "live", input: { title: `${ctx.marker} total probe ${i}`, priority: "medium" } });
      if (t?.taskId) { made.push(t.taskId); ctx.cleanup(() => ctx.db.deleteOwned("tasks", { ownerColumn: "creator_id", ownerId: me.id, filters: { id: t.taskId } })); }
    }
    ctx.expect.gte("created probe tasks", made.length, 2);
    const { runDefinition } = await import("../../../self-tooling/index.js");
    const out = await runDefinition({ kind: "spec", from: "my_tasks", group: { by: ["priority"], count: true }, select: ["priority", "count"] }, {}, { learnerId: me.id });
    const sum = (out.rows || []).reduce((n, r) => n + (Number(r.count) || 0), 0);
    ctx.expect.ok("total equals the sum of group counts (records, not groups)", out.total === sum && sum >= 2, { total: out.total, sum, rows: out.rows });
}

export async function runDecisionFollowUp(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../../db.js");
    const { activeGrants } = await import("../../../self-tooling/index.js");
    const tag = ctx.marker.slice(8, 16).replace(/[^a-z0-9]/g, "x");
    const name = `verify_done_${tag}`;

    const { data: grant, error: gErr } = await db.schema("edu").from("capability_grants")
      .insert({ capability: "verify.task_done", note: `gate ${ctx.marker}`, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }).select("id").single();
    if (gErr) ctx.expect.blocked(`couldn't grant the probe: ${gErr.message}`);
    ctx.cleanup(async () => { await db.schema("edu").from("capability_grants").update({ revoked_at: new Date().toISOString() }).eq("id", grant.id); await activeGrants({ fresh: true }); });
    await activeGrants({ fresh: true });
    ctx.cleanup(() => ctx.db.deleteOwned("tasks", { ownerColumn: "creator_id", ownerId: me.id, filters: { title: { like: `${ctx.marker}%` } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tools", { ownerColumn: "owner_id", ownerId: me.id, filters: { name } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_write_confirmations", { ownerColumn: "principal_id", ownerId: me.id, filters: { tool_name: "selftool:verify.task_done" } }));
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { title: "Your agent" } }));
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { title: "Your change" } }));
    ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: me.id, filters: { title: { like: "Your %" } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { text: { like: "Done — %" } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { text: { like: "Not changed — %" } } }));

    const t = await ctx.agent.tool({ as: p.learner, tool: "create_task", mode: "live", input: { title: `${ctx.marker} revise vectors`, priority: "low", dueInMinutes: 60 } });
    ctx.expect.ok("task created", !t?.error, t?.error);

    const r = await ctx.agent.tool({ as: p.learner, tool: "create_tool", mode: "live", input: {
      goal: `Mark my tasks whose title starts with "${ctx.marker}" as done`, name, label: `${ctx.marker} finish`, hint: { views: ["my_tasks"], capabilities: ["verify.task_done"] } } });
    const card = r?.result?.confirmation;
    if (!card?.confirmationId) { ctx.expect.blocked(`no card: ${r?.result?.status || r?.error || "unknown"}`); return; }

    const ok = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-tooling/confirmations/${card.confirmationId}/confirm` });
    ctx.expect.status("confirmed", ok, 200);

    // The deterministic follow-up id the async agent turn posts.
    const { createHash } = await import("node:crypto");
    const expectedId = `00000000-0000-4000-8000-${createHash("sha256").update(`followup-${card.confirmationId}`).digest("hex").slice(0, 12)}`;
    let row = null;
    for (let i = 0; i < 40 && !row; i++) {
      [row] = await ctx.db.rows("chat_messages", { id: expectedId }, { columns: "id, role, text" });
      if (!row) await new Promise((resolve) => setTimeout(resolve, 900));
    }
    ctx.cleanup(() => ctx.db.deleteOwned("chat_messages", { ownerColumn: "user_id", ownerId: me.id, filters: { id: expectedId } }));
    ctx.expect.ok("the agent's decision follow-up was posted (server ran the turn)", !!row && row.role === "agent" && String(row.text || "").trim().length > 0, row);
}
