// Self-tooling journeys: permission cards, admin approval, and using a built tool.
import { needCreate } from "./shared.js";

export async function runPermissionRequestIsReal(ctx, p) {
    const me = await ctx.as(p.learner);
    const since = new Date(Date.now() - 5_000).toISOString();
    // As in the learner's chat: first the ask, then "ask for permission".
    const t1 = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: String(p.first) });
    ctx.note(`turn 1: ${String(t1.reply || "").replace(/\s+/g, " ").slice(0, 250)} · tools ${JSON.stringify((t1.tools || []).map((t) => t.tool))}`);
    const turn = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: String(p.prompt),
      history: [{ role: "user", content: String(p.first) }, { role: "assistant", content: String(t1.reply || "") }] });
    ctx.expect.eq("turn answered", turn.status, 200);
    for (const t of turn.tools || []) ctx.note(`tool ${t.tool}: ${JSON.stringify(t.input || {}).slice(0, 200)} → ${JSON.stringify(t.result || {}).slice(0, 300)}`);
    const rows = (await ctx.db.rows("edu.agent_tool_requests", { requester_id: me.id }, { columns: "id, kind, requested_capability, title, status, created_at, updated_at", limit: 100 }))
      .filter((r) => Date.parse(r.updated_at || r.created_at) >= Date.parse(since));
    for (const r of rows) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_requests", { ownerColumn: "requester_id", ownerId: me.id, filters: { id: r.id } }));
    const claims = /\b(filed|submitted|sent|made|raised|logged)\b[^.]{0,40}\brequest\b|\brequest\b[^.]{0,40}\b(filed|submitted|sent|pending|made)\b|\bI(?:'ve| have) asked\b|\basked an admin\b/i.test(String(turn.reply || ""));
    ctx.note(`reply: ${String(turn.reply || "").replace(/\s+/g, " ").slice(0, 400)}`);
    ctx.note(`requests made this turn: ${rows.length} ${JSON.stringify(rows.map((r) => [r.kind, r.requested_capability, r.title]))}`);
    // An own-data change (deleting their tasks) is the learner's to allow: a permission card in the chat is the real request.
    const card = (turn.tools || []).find((t) => t.tool === "create_tool" && t.result?.status === "needs_permission")?.result?.confirmation;
    if (card?.confirmationId) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_write_confirmations", { ownerColumn: "principal_id", ownerId: me.id, filters: { id: card.confirmationId } }));
    ctx.expect.ok("if the reply says a request was made, it exists (admins' queue or the learner's card)", !claims || rows.length > 0 || !!card, { claims, rows, card: !!card, tools: (turn.tools || []).map((t) => t.tool) });
    ctx.expect.ok("the learner asked for permission outright: a real request (admins' queue, or a permission card for them)", rows.length > 0 || !!card, { rows, tools: (turn.tools || []).map((t) => t.tool), reply: String(turn.reply || "").slice(0, 300) });
}

export async function runToolJourney(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner);
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} tool journey` } });
    ctx.expect.status("chat created", made, 201);
    const chatId = made.body?.session?.id;
    if (!chatId) ctx.expect.blocked("couldn't create the chat");
    const name = `probe_${ctx.marker.slice(8, 16).replace(/[^a-z0-9]/g, "x")}`;
    const label = `${ctx.marker} Probe check`;
    const goal = `${ctx.marker} show the gate probe's check-in time`;
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));
    ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: me.id, filters: { related_id: chatId } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tools", { ownerColumn: "owner_id", ownerId: me.id, filters: { name: { like: `${name}%` } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_requests", { ownerColumn: "requester_id", ownerId: me.id, filters: { goal } }));

    // 1. Learner: the build needs a permission that isn't on.
    const r = await ctx.agent.tool({ as: p.learner, tool: "create_tool", mode: "live", conversationId: chatId,
      input: { goal, name, label, hint: { capabilities: ["verify.probe"] } } });
    ctx.expect.eq("1. create: needs permission (escalated)", r?.status, "escalated");
    if (!r?.requestId) return;

    // 2. Admin: the request is on the Agent requests page, ready to decide.
    const queued = (await ctx.db.rows("edu.agent_tool_requests", { kind: "capability", status: "new", requester_id: me.id },
      { columns: "id, requested_capability, goal, proposed_tool, resume_status, last_status_changed_at", limit: 50 })).find((x) => x.id === r.requestId);
    ctx.expect.ok("2. admin page lists it (new, waiting, with the tool to build)",
      !!queued && queued.requested_capability === "verify.probe" && queued.resume_status === "waiting" && queued.proposed_tool?.name === name, queued);

    // 3. Admin approves.
    const { decideRequest, revokeGrant } = await import("../../../self-tooling/index.js");
    const { enqueueResume } = await import("../../../self-tooling/index.js");
    const admin = { id: null, label: "verification gate" };
    const decided = await decideRequest({ requestId: r.requestId, decision: "approve", note: "gate journey", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), admin, enqueue: enqueueResume });
    ctx.expect.ok("3. admin approved: permission granted", decided?.request?.status === "approved" && !!decided?.grant?.id, decided);
    const grantId = decided?.grant?.id;
    if (grantId) ctx.cleanup(() => revokeGrant({ grantId, admin }).catch(() => {}));

    // 4. The build resumes and answers in the learner's chat.
    const done = await ctx.until(async () => {
      const x = (await ctx.db.rows("edu.agent_tool_requests", { id: r.requestId }, { columns: "status, resume_status, resume_result", limit: 1 }))[0];
      return x && ["resumed", "failed"].includes(x.resume_status) ? x : null;
    }, { timeoutMs: 150_000, everyMs: 4_000 });
    ctx.note(`resume: ${JSON.stringify(done?.resume_result || null).slice(0, 1500)}`);
    ctx.expect.eq("4. build resumed", done?.resume_status, "resumed");
    ctx.expect.eq("4. request implemented", done?.status, "implemented");
    const tool = (await ctx.db.rows("edu.agent_tools", { owner_id: me.id, name: { like: `${name}%` } }, { columns: "name, label, capabilities, status", limit: 1 }))[0];
    ctx.expect.ok("4. tool saved, active, using the permission", !!tool && tool.status === "active" && (tool.capabilities || []).includes("verify.probe"), tool);
    const msgs = await ctx.db.rows("chat_messages", { session_id: chatId, user_id: me.id }, { columns: "role, text", limit: 10 });
    ctx.expect.ok("4. learner told in the same chat", msgs.some((m) => m.role === "agent" && /built|switched on/i.test(m.text)), msgs.map((m) => m.text.slice(0, 80)));
    ctx.expect.gte("4. learner notified", await ctx.db.count("notifications", { user_id: me.id, related_id: chatId }), 1);
    if (!tool) return;

    // 5. Learner uses it from Agent Chat.
    const turn = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model,
      prompt: `Run my "${tool.label || label}" tool and tell me what time the gate probe checked in.` });
    ctx.expect.eq("5. turn answered", turn.status, 200);
    const used = (turn.tools || []).find((t) => t.tool === tool.name);
    ctx.note(`tools: ${JSON.stringify((turn.tools || []).map((t) => t.tool))} · used → ${JSON.stringify(used?.result || null).slice(0, 300)}`);
    ctx.note(`reply: ${String(turn.reply || "").replace(/\s+/g, " ").slice(0, 300)}`);
    ctx.expect.ok("5. agent ran the learner's tool", !!used, (turn.tools || []).map((t) => t.tool));
    const rows = used?.result?.rows || [];
    ctx.expect.ok("5. tool answered (a check-in time)", !used?.result?.error && rows.some((x) => x?.checkedAt), used?.result);
    ctx.expect.ok("5. reply gives the answer", /\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|checked in/i.test(String(turn.reply || "")), String(turn.reply || "").slice(0, 300));
    ctx.expect.noBackendNames("5. reply has no backend names", turn.reply);

    // 6. Admin revokes: the tool stops at once.
    if (grantId) {
      await revokeGrant({ grantId, admin });
      const after = await ctx.agent.tool({ as: p.learner, tool: tool.name, learnerTool: true, mode: "live", input: {} });
      ctx.expect.ok("6. revoked: the tool stops", !!after?.error && !after?.rows, after);
    }
}

export async function runDeleteTasks(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../../db.js");
    const { learnerGrants } = await import("../../../self-tooling/index.js");
    const revokeMine = async () => {
      await db.schema("edu").from("capability_grants").update({ revoked_at: new Date().toISOString() }).eq("learner_id", me.id).eq("capability", "tasks.delete").is("revoked_at", null);
      await learnerGrants(me.id, { fresh: true });
    };
    await revokeMine();          // start from "can't do it yet"
    ctx.cleanup(revokeMine);
    const since = new Date(Date.now() - 5_000).toISOString();
    const tag = ctx.marker.slice(8, 16).replace(/[^a-z0-9]/g, "x");
    const name = `verify_del_${tag}`;
    ctx.cleanup(() => ctx.db.deleteOwned("tasks", { ownerColumn: "creator_id", ownerId: me.id, filters: { title: { like: `${ctx.marker}%` } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tools", { ownerColumn: "owner_id", ownerId: me.id, filters: { name: { like: `${name}%` } } }));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_write_confirmations", { ownerColumn: "principal_id", ownerId: me.id, filters: { tool_name: { like: "selftool:%tasks.delete" } } }));

    const cardOf = (turn) => (turn.tools || []).find((t) => t.tool === "create_tool" && t.result?.status === "needs_permission")?.result?.confirmation || null;
    const say = (turn) => String(turn.reply || "").replace(/\s+/g, " ").slice(0, 300);
    const reject = (c) => (c?.confirmationId ? ctx.http({ as: p.learner, method: "POST", path: `/api/self-tooling/confirmations/${c.confirmationId}/reject` }) : null);

    // 0. A chat that already holds the old "only an admin can grant" answer: it still looks up, and drafts it with the card.
    const stale = "I can't delete them — that needs a permission only an admin can grant, and I won't pretend otherwise. Want me to file the delete request anyway, or will you clear them in the Tasks tab?";
    const t0 = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: String(p.first),
      history: [{ role: "user", content: String(p.first) }, { role: "assistant", content: stale }] });
    ctx.note(`turn 0 (stale chat): ${say(t0)} · tools ${JSON.stringify((t0.tools || []).map((t) => [t.tool, t.result?.status]))}`);
    ctx.expect.ok("0. looks up what it can build first", (t0.tools || [])[0]?.tool === "schema_lookup", (t0.tools || []).map((t) => t.tool));
    ctx.expect.ok("0. not 'ask an admin'", !/only an admin|admin (can|must|has to) (grant|approve)/i.test(String(t0.reply || "")), say(t0));
    await reject(cardOf(t0));

    // 1. In chat: the card comes in the SAME reply as the draft (no "shall I build it?" round) — no admin request.
    const t1 = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: String(p.first) });
    ctx.note(`turn 1: ${say(t1)} · tools ${JSON.stringify((t1.tools || []).map((t) => [t.tool, t.result?.status]))}`);
    const card = cardOf(t1);
    ctx.expect.ok("1. a permission card for deleting tasks, in the first reply", card?.kind === "permission" && /delete your tasks/i.test(card?.action || ""), card);
    ctx.expect.ok("1. the reply points to the card (nothing done yet)", /approv|allow|card/i.test(String(t1.reply || "")) && !/\b(I've deleted|have been deleted|are deleted)\b/i.test(String(t1.reply || "")), say(t1));
    const asked = (await ctx.db.rows("edu.agent_tool_requests", { requester_id: me.id }, { columns: "id, kind, created_at", limit: 50 })).filter((r) => Date.parse(r.created_at) >= Date.parse(since));
    for (const r of asked) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_requests", { ownerColumn: "requester_id", ownerId: me.id, filters: { id: r.id } }));
    ctx.expect.eq("1. no admin request was made", asked.length, 0);
    if (card?.confirmationId) {
      const no = await reject(card);
      ctx.expect.eq("1. 'Not now' leaves it off", no.body?.data?.status, "rejected");
    }
    ctx.expect.eq("1. still off for the learner", (await learnerGrants(me.id, { fresh: true })).has("tasks.delete"), false);

    // 2. Approve on the card (as the app does: the chat carries on): on for this learner; the agent's next turn
    //    runs the tool and shows ONE change card; after Confirm it checks again and reports.
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} delete tasks` } });
    const chatId = made.body?.session?.id;
    if (chatId) {
      ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id: chatId } }));
      ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: me.id, filters: { related_id: chatId } }));
    }
    const old = [`${ctx.marker} old fractions`, `${ctx.marker} old motion`], keep = `${ctx.marker} keep essay`;
    for (const title of [...old, keep]) {
      const t = await ctx.agent.tool({ as: p.learner, tool: "create_task", mode: "live", input: { title, priority: "low", dueInMinutes: 60 } });
      ctx.expect.ok(`task "${title.slice(-12)}" created`, !t?.error, t?.error);
    }
    const titles = async () => (await ctx.db.rows("tasks", { creator_id: me.id, title: { like: `${ctx.marker}%` } }, { columns: "title" })).map((r) => r.title).sort();
    const ask = { goal: `Delete my tasks whose title starts with "${ctx.marker} old"`, name, label: `${ctx.marker} Clear old tasks`, hint: { views: ["my_tasks"], capabilities: ["tasks.delete"] } };
    const r = await ctx.agent.tool({ as: p.learner, tool: "create_tool", mode: "live", conversationId: chatId, input: ask });
    ctx.expect.eq("2. create_tool drafts it and asks the learner at once (not an admin, no offer round)", r?.status, "needs_permission");
    const perm = r?.confirmation;
    if (!perm?.confirmationId) return;
    ctx.expect.ok("2. the tool is drafted first, and the card shows what it would change", perm.drafted === true && r?.drafted === true, perm);
    ctx.expect.eq("2. card lists exactly the two old tasks", [...(perm.items || [])].sort().join(" | "), [...old].sort().join(" | "));
    const draftRow = async () => (await ctx.db.rows("edu.agent_tools", { owner_id: me.id, name }, { columns: "status, capabilities", limit: 1 }))[0];
    ctx.expect.eq("2. the draft is OFF until approved", (await draftRow())?.status, "disabled");
    const { learnerToolDefs } = await import("../../../self-tooling/index.js");
    ctx.expect.ok("2. and not usable by the agent yet", !(await learnerToolDefs(me.id)).some((d) => d.function?.name === name));
    const approved = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-tooling/confirmations/${perm.confirmationId}/confirm`, body: { continueInChat: true } });
    ctx.note(`approve → ${JSON.stringify(approved.body?.data?.result || approved.body).slice(0, 400)}`);
    ctx.expect.status("2. approved", approved, 200);
    ctx.expect.eq("2. approval switched it on", (await draftRow())?.status, "active");
    ctx.expect.eq("2. on for this learner", (await learnerGrants(me.id, { fresh: true })).has("tasks.delete"), true);
    const { capabilityStatus } = await import("../../../self-tooling/index.js");
    ctx.expect.eq("2. still off for everyone else", await capabilityStatus("tasks.delete"), "locked");
    ctx.expect.ok("2. no second change card from the approval itself", !approved.body?.data?.next, approved.body?.data?.next);
    ctx.expect.eq("2. nothing deleted before Confirm", (await titles()).length, 3);
    // The app's follow-up turn after Approve: the agent runs the tool → one Confirm card.
    const label = approved.body?.data?.result?.label || ask.label;
    const t3 = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: `Approved "${label}" — go ahead.`,
      history: [{ role: "user", content: ask.goal }, { role: "assistant", content: `I've drafted "${label}". Approve it on the card and I'll run it.` }] });
    ctx.note(`after Approve: ${say(t3)} · tools ${JSON.stringify((t3.tools || []).map((t) => [t.tool, t.result?.status || (t.result?.confirmation ? "card" : null)]))}`);
    const change = (t3.tools || []).map((t) => t.result?.confirmation).find((c) => c?.confirmationId && c.kind !== "permission");
    ctx.expect.ok("2. after Approve the agent runs the tool and shows one change card", !!change, (t3.tools || []).map((t) => t.tool));
    ctx.expect.eq("2. its change card lists exactly the two old tasks", [...(change?.items || [])].sort().join(" | "), [...old].sort().join(" | "));
    ctx.expect.eq("2. still nothing deleted before Confirm", (await titles()).length, 3);
    if (!change?.confirmationId) return;
    const ok = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-tooling/confirmations/${change.confirmationId}/confirm` });
    ctx.expect.status("2. confirmed", ok, 200);
    ctx.expect.eq("2. only the kept task is left", (await titles()).join(" | "), keep);
    // The app's follow-up after Confirm: the agent looks again and reports.
    const t4 = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: "Confirmed the change to 2 items — check it went through and tell me if anything is left.",
      history: [{ role: "user", content: `Approved "${label}" — go ahead.` }, { role: "assistant", content: String(t3.reply || "") }] });
    ctx.note(`after Confirm: ${say(t4)} · tools ${JSON.stringify((t4.tools || []).map((t) => t.tool))}`);
    ctx.expect.ok("2. after Confirm it looks again before reporting", (t4.tools || []).length > 0, (t4.tools || []).map((t) => t.tool));

    // 3. Admins see the new tool (Agent tools), marked as one that changes data.
    const { listTools } = await import("../../../self-tooling/index.js");
    const listed = await listTools({ scope: "learner", status: "active", search: "Clear old tasks", limit: 20 }).catch((e) => ({ error: e.message }));
    const row = (listed?.tools || []).find((t) => String(t.label).startsWith(ctx.marker));
    ctx.expect.ok("3. on the admins' Agent tools page, marked as changing data", !!row && (row.changes || []).length > 0, listed);
}
