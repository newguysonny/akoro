/**
 * The change permissions a learner can allow (self-tooling): for each one, the
 * full path the chat takes after the learner says yes — the tool is drafted
 * OFF, the card lists exactly what it would change, Approve turns it on for
 * this learner only, Confirm applies it, and only those rows change. Plus a
 * change nothing can make yet: offered, then (on yes) sent to the Akoro team.
 * The grants are the test learner's own and are revoked at the end.
 */
const needCreate = async (ctx) => {
  const { getLearnerChatTools } = await import("../../adaptive-learning/chat.js");
  if (!getLearnerChatTools().some((t) => t.name === "create_tool")) ctx.expect.blocked("self-tooling is off on this server");
};

/** One change: seed rows (3: two to change, one to keep), build → card → approve → confirm → check. */
async function changeFlow(ctx, p, { cap, goal, args = null, seed, current, changed, kept }) {
  const me = await ctx.as(p.learner);
  const { default: db } = await import("../../../db.js");
  const { learnerGrants } = await import("../../self-tooling/registry.js");
  const revoke = async () => { await db.schema("edu").from("capability_grants").update({ revoked_at: new Date().toISOString() }).eq("learner_id", me.id).eq("capability", cap).is("revoked_at", null); await learnerGrants(me.id, { fresh: true }); };
  await revoke(); ctx.cleanup(revoke);
  const tag = ctx.marker.slice(8, 16).replace(/[^a-z0-9]/g, "x");
  const name = `verify_${cap.replace(/\W/g, "_")}_${tag}`.slice(0, 48);
  ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tools", { ownerColumn: "owner_id", ownerId: me.id, filters: { name: { like: `${name}%` } } }));
  ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_write_confirmations", { ownerColumn: "principal_id", ownerId: me.id, filters: { tool_name: { like: `selftool:%${cap}` } } }));
  const rows = await seed(me, db);                  // → { change: [labels], keep: label }
  const r = await ctx.agent.tool({ as: p.learner, tool: "create_tool", mode: "live", input: { goal, name, label: `${ctx.marker} ${cap}`, hint: { capabilities: [cap] }, __agreed: true } });
  ctx.expect.eq(`${cap}: drafted and asked on a card`, `${r?.status}|${!!r?.drafted}`, "needs_permission|true");
  const perm = r?.confirmation;
  if (!perm?.confirmationId) { ctx.note(`${cap}: ${JSON.stringify(r).slice(0, 400)}`); return; }
  ctx.note(`${cap}: card "${perm.action}" · ${JSON.stringify(perm.items)}`);
  ctx.expect.eq(`${cap}: card lists exactly what it would change`, [...(perm.items || [])].sort().join(" | "), [...rows.change].sort().join(" | "));
  const ok = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-tooling/confirmations/${perm.confirmationId}/confirm` });
  ctx.expect.eq(`${cap}: approved → the tool is on`, ok.body?.data?.result?.status, "created");
  const next = ok.body?.data?.next;
  if (args) ctx.expect.ok(`${cap}: the Confirm card shows the value`, args.test(String(next?.action || "")), next?.action);
  ctx.expect.ok(`${cap}: nothing changed before Confirm`, (await current(me, db)).every((x) => !changed(x)), await current(me, db));
  if (!next?.confirmationId) { ctx.note(`${cap}: no Confirm card — ${JSON.stringify(ok.body?.data?.result || ok.body).slice(0, 300)}`); return; }
  const done = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-tooling/confirmations/${next.confirmationId}/confirm` });
  ctx.expect.eq(`${cap}: confirmed, both applied`, done.body?.data?.result?.done, 2);
  const after = await current(me, db);
  ctx.expect.ok(`${cap}: exactly those changed, the other kept`, rows.change.every((l) => after.some((x) => x.label === l && changed(x))) && kept(after, rows.keep), after);
}

const TASKS = (ctx, me, titles, extra = {}) => Promise.all(titles.map((title) => ctx.agent.tool({ as: me, tool: "create_task", mode: "live", input: { title, priority: "low", dueInMinutes: 120, ...extra } })));
const taskRows = (ctx) => async (me) => (await ctx.db.rows("tasks", { creator_id: me.id, title: { like: `${ctx.marker}%` } }, { columns: "title, priority, due_at" })).map((t) => ({ label: t.title, ...t }));

export const changeTasksReschedule = {
  name: "selftool.change_tasks_reschedule", area: "self-tooling", risk: "write",
  description: "Move tasks to a new date: drafted, card lists them, Approve, the Confirm card shows the date, only those move.",
  params: { learner: { default: "@tester30" } },
  async run(ctx, p) {
    await needCreate(ctx);
    ctx.cleanup(async () => { const me = await ctx.as(p.learner); await ctx.db.deleteOwned("tasks", { ownerColumn: "creator_id", ownerId: me.id, filters: { title: { like: `${ctx.marker}%` } } }); });
    const target = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
    await changeFlow(ctx, p, { cap: "tasks.reschedule", goal: `Move my tasks whose title starts with "${ctx.marker} move" to ${target}`, args: /move your tasks to/i,
      seed: async () => { await TASKS(ctx, p.learner, [`${ctx.marker} move fractions`, `${ctx.marker} move motion`, `${ctx.marker} keep essay`]); return { change: [`${ctx.marker} move fractions`, `${ctx.marker} move motion`], keep: `${ctx.marker} keep essay` }; },
      current: taskRows(ctx), changed: (x) => new Date(x.due_at).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }) === target,
      kept: (rows, l) => rows.some((x) => x.label === l && new Date(x.due_at).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }) !== target) });
  },
};

export const changeTasksPriority = {
  name: "selftool.change_tasks_priority", area: "self-tooling", risk: "write",
  description: "Set tasks' priority: drafted, card lists them, Approve, the Confirm card shows the priority, only those change.",
  params: { learner: { default: "@tester31" } },
  async run(ctx, p) {
    await needCreate(ctx);
    ctx.cleanup(async () => { const me = await ctx.as(p.learner); await ctx.db.deleteOwned("tasks", { ownerColumn: "creator_id", ownerId: me.id, filters: { title: { like: `${ctx.marker}%` } } }); });
    await changeFlow(ctx, p, { cap: "tasks.set_priority", goal: `Make my tasks whose title starts with "${ctx.marker} exam" high priority`, args: /high priority/i,
      seed: async () => { await TASKS(ctx, p.learner, [`${ctx.marker} exam algebra`, `${ctx.marker} exam cells`, `${ctx.marker} tidy desk`]); return { change: [`${ctx.marker} exam algebra`, `${ctx.marker} exam cells`], keep: `${ctx.marker} tidy desk` }; },
      current: taskRows(ctx), changed: (x) => x.priority === "high", kept: (rows, l) => rows.some((x) => x.label === l && x.priority === "low") });
  },
};

const goalRows = (ctx) => async (me) => (await ctx.db.rows("edu.learner_goals", { user_id: me.id, title: { like: `${ctx.marker}%` } }, { columns: "title, status" })).map((g) => ({ label: g.title, ...g }));
const seedGoals = (ctx, p, change, keep) => async () => {
  for (const title of [...change, keep]) { const g = await ctx.agent.tool({ as: p.learner, tool: "create_goal", mode: "live", input: { title, category: "exam" } }); if (g?.error) ctx.note(`create_goal: ${g.error}`); }
  return { change, keep };
};

export const changeGoals = {
  name: "selftool.change_goals", area: "self-tooling", risk: "write",
  description: "Mark goals achieved, then dismiss goals: each drafted, carded, approved, confirmed; only those goals change.",
  params: { learner: { default: "@tester32" } },
  async run(ctx, p) {
    await needCreate(ctx);
    ctx.cleanup(async () => { const me = await ctx.as(p.learner); await ctx.db.deleteOwned("edu.learner_goals", { ownerColumn: "user_id", ownerId: me.id, filters: { title: { like: `${ctx.marker}%` } } }); });
    const M = ctx.marker;
    await changeFlow(ctx, p, { cap: "goals.complete", goal: `Mark my goals whose title starts with "${M} hit" as achieved`,
      seed: seedGoals(ctx, p, [`${M} hit 70 in maths`, `${M} hit 10 sessions`], `${M} read 5 books`),
      current: goalRows(ctx), changed: (x) => x.status === "achieved", kept: (rows, l) => rows.some((x) => x.label === l && x.status === "active") });
    await changeFlow(ctx, p, { cap: "goals.dismiss", goal: `Dismiss my goals whose title starts with "${M} old"`,
      seed: seedGoals(ctx, p, [`${M} old chess club`, `${M} old piano`], `${M} keep reading`),
      current: goalRows(ctx), changed: (x) => x.status === "dismissed", kept: (rows, l) => rows.some((x) => x.label === l && x.status === "active") });
  },
};

export const changeInboxRead = {
  name: "selftool.change_inbox_read", area: "self-tooling", risk: "write",
  description: "Mark agent inbox messages read: drafted, carded, approved, confirmed; only those messages are marked.",
  params: { learner: { default: "@tester33" }, from: { default: "@tester34" } },
  async run(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner), them = await ctx.as(p.from);
    const { default: db } = await import("../../../db.js");
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_messages", { ownerColumn: "to_user", ownerId: me.id, filters: { body: { like: `${ctx.marker}%` } } }));
    const T = `${ctx.marker.slice(1, 15)}`;
    await changeFlow(ctx, p, { cap: "inbox.mark_read", goal: `Mark my agent inbox messages about the topic "${T} photosynthesis" or "${T} osmosis" as read`,
      seed: async () => {
        const mk = (topic) => ({ from_user: them.id, to_user: me.id, kind: "suggestion", subject: "Biology", topic, body: `${ctx.marker} ${topic}`, status: "delivered" });
        const { error } = await db.schema("edu").from("agent_messages").insert([mk(`${T} photosynthesis`), mk(`${T} osmosis`), mk(`${T} genetics`)]);
        if (error) ctx.expect.blocked(`couldn't seed the inbox: ${error.message}`);
        return { change: [`suggestion · ${T} photosynthesis`, `suggestion · ${T} osmosis`], keep: `suggestion · ${T} genetics` };
      },
      current: async () => (await ctx.db.rows("edu.agent_messages", { to_user: me.id, body: { like: `${ctx.marker}%` } }, { columns: "kind, topic, read_at" })).map((m) => ({ label: `${m.kind} · ${m.topic}`, ...m })),
      changed: (x) => !!x.read_at, kept: (rows, l) => rows.some((x) => x.label === l && !x.read_at) });
  },
};

export const changeChatsDelete = {
  name: "selftool.change_chats_delete", area: "self-tooling", risk: "write",
  description: "Delete chats: drafted, carded, approved, confirmed; only those chats are deleted.",
  params: { learner: { default: "@tester35" } },
  async run(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner);
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { title: { like: `${ctx.marker}%` } } }));
    const M = ctx.marker;
    await changeFlow(ctx, p, { cap: "chats.delete", goal: `Delete my chats whose title starts with "${M} empty"`,
      seed: async () => {
        for (const title of [`${M} empty one`, `${M} empty two`, `${M} keep revision`]) await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title } });
        return { change: [`${M} empty one`, `${M} empty two`], keep: `${M} keep revision` };
      },
      // Deleted rows are gone: "changed" = absent, so check presence from the list of titles.
      current: async () => {
        const left = (await ctx.db.rows("chat_sessions", { user_id: me.id, title: { like: `${M}%` } }, { columns: "title" })).map((c) => c.title);
        return [`${M} empty one`, `${M} empty two`, `${M} keep revision`].map((label) => ({ label, gone: !left.includes(label) }));
      },
      changed: (x) => x.gone, kept: (rows, l) => rows.some((x) => x.label === l && !x.gone) });
  },
};

/** A change nothing can make: the agent says so and offers to ask; on yes, a Tool idea for the Akoro team. */
export const changeUnsupported = {
  name: "selftool.change_unsupported", area: "self-tooling", risk: "write",
  description: "Asked for a change no tool can make (renaming chats), the agent says it can't yet and offers to ask the Akoro team; on yes, a clear request lands on the admins' Tool ideas.",
  params: { learner: { default: "@tester36" }, first: { default: "Rename my chats so each title starts with its subject." }, agree: { default: "Yes please, ask them." } },
  async run(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner);
    const since = new Date(Date.now() - 5_000).toISOString();
    const t1 = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: String(p.first) });
    ctx.note(`turn 1: ${String(t1.reply || "").replace(/\s+/g, " ").slice(0, 300)} · tools ${JSON.stringify((t1.tools || []).map((t) => [t.tool, t.result?.status]))}`);
    ctx.expect.ok("1. says it can't yet and offers to ask the team", /\b(can'?t|cannot|not able|isn'?t possible|don'?t have)\b/i.test(String(t1.reply || "")) && /\b(ask|request|team|admins?)\b/i.test(String(t1.reply || "")), String(t1.reply || "").slice(0, 300));
    const early = (await ctx.db.rows("edu.agent_tool_requests", { requester_id: me.id }, { columns: "id, created_at", limit: 50 })).filter((r) => Date.parse(r.created_at) >= Date.parse(since));
    ctx.expect.eq("1. nothing sent before the learner says yes", early.length, 0);
    const t2 = await ctx.agent.chat({ as: p.learner, mode: "live", model: p.model, prompt: String(p.agree),
      history: [{ role: "user", content: String(p.first) }, { role: "assistant", content: String(t1.reply || "") }] });
    ctx.note(`turn 2: ${String(t2.reply || "").replace(/\s+/g, " ").slice(0, 300)} · tools ${JSON.stringify((t2.tools || []).map((t) => [t.tool, t.result?.status]))}`);
    const rows = (await ctx.db.rows("edu.agent_tool_requests", { requester_id: me.id }, { columns: "id, kind, title, description, status, created_at, updated_at", limit: 50 }))
      .filter((r) => Date.parse(r.updated_at || r.created_at) >= Date.parse(since));
    for (const r of rows) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tool_requests", { ownerColumn: "requester_id", ownerId: me.id, filters: { id: r.id } }));
    ctx.note(`requests: ${JSON.stringify(rows.map((r) => [r.kind, r.title]))}`);
    ctx.expect.ok("2. a request for the change is on the admins' Tool ideas", rows.some((r) => r.kind !== "capability" && /rename|chat/i.test(`${r.title} ${r.description}`)), rows);
    ctx.expect.ok("2. the reply says it was sent", /\b(sent|asked|passed|request(ed)?)\b/i.test(String(t2.reply || "")), String(t2.reply || "").slice(0, 300));
  },
};

export const SELFTOOL_CHANGES = [changeTasksReschedule, changeTasksPriority, changeGoals, changeInboxRead, changeChatsDelete, changeUnsupported];
