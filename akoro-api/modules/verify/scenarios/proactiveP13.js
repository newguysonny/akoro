/**
 * Phase 13 — the proactive agent, steps 4–8 (Grand Plan §7.16.8). One scenario
 * per step; the planner's model call is left out on purpose (it varies run to
 * run): each seeds what a cycle would have produced, then checks the parts
 * code owns — validation, delivery, approval, the report, consents, budget.
 */
import { deliverProactive } from "../../autonomy/index.js";
import { validateAndShapeProposals, gatherSignals } from "../../autonomy/index.js";
import { fixIts } from "../../autonomy/index.js";
import { runInstructorCycle } from "../../autonomy/index.js";

const db = async () => (await import("../../../db.js")).default;
const later = () => new Date(Date.now() + 15 * 60 * 1000);

/** Agent Online + suggestions on for this run, restored after; today's posts and runs cleared (test learner only). */
async function readyLearner(ctx, as) {
  const me = await ctx.as(as);
  const before = (await ctx.http({ as, path: "/api/agent/settings" })).body?.data || {};
  ctx.cleanup(() => ctx.http({ as, method: "PATCH", path: "/api/agent/settings", body: {
    agentOnline: !!before.agentOnline, proactive: before.proactive !== false, quietStart: before.quietStart || "20:00", quietEnd: before.quietEnd || "07:30",
    ...(before.timeZone ? { timeZone: before.timeZone } : {}) } }));
  await ctx.http({ as, method: "PATCH", path: "/api/agent/settings", body: { agentOnline: true, proactive: true } });
  const posted = (await ctx.db.rows("edu.agent_proposals", { user_id: me.id }, { columns: "id, posted_at", limit: 100 }))
    .filter((r) => r.posted_at && Date.now() - new Date(r.posted_at).getTime() < 864e5);
  for (const r of posted) await ctx.db.deleteOwned("edu.agent_proposals", { ownerColumn: "user_id", ownerId: me.id, filters: { id: r.id } });
  return me;
}

async function chat(ctx, as, me, title) {
  const r = await ctx.http({ as, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} ${title}` } });
  const id = r.body?.session?.id;
  if (!id) ctx.expect.blocked(`couldn't create a chat (${r.status})`);
  ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { id } }));
  await ctx.http({ as, method: "POST", path: `/api/adaptive/chat/sessions/${id}/messages`, body: { role: "user", text: `${ctx.marker} hello` } });
  return id;
}

async function seedProposal(ctx, me, row) {
  const { data, error } = await (await db()).schema("edu").from("agent_proposals").insert({ user_id: me.id, source: "cycle", ...row }).select("id").single();
  if (error) ctx.expect.blocked(`couldn't seed the proposal: ${error.message}`);
  ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_proposals", { ownerColumn: "user_id", ownerId: me.id, filters: { id: data.id } }));
  return data.id;
}

// Step 4 — a ready proposal: held to a real record, arrives with its preview, Yes replays it and reports in the thread.
export const readyProposal = {
  name: "agent.ready_proposal", area: "agent-chat", risk: "write",
  description: "The validator keeps a quiz from the learner's own record (with a preview written from facts) and drops a 'weak topic' that isn't; posted into the chat with its preview and button; Yes opens the quiz and the result is reported in the same chat.",
  params: { learner: { default: "@tester26" } },
  async run(ctx, p) {
    const as = p.learner;
    const me = await readyLearner(ctx, as);
    const made = await ctx.http({ as, method: "POST", path: "/api/records", body: { kind: "paste", name: `${ctx.marker} Cell transport notes`, content: "Osmosis is the movement of water across a partially permeable membrane.\n\nDiffusion is the spread of particles from high to low concentration." } });
    const rec = made.body?.data?.record || made.body?.data;
    if (!rec?.id) ctx.expect.blocked(`saving the record answered ${made.status}`);
    ctx.cleanup(() => ctx.http({ as, method: "DELETE", path: `/api/records/${rec.id}` }));

    // Validation: held to what is really there.
    const refs = { records: [{ id: rec.id, name: rec.name, topics: ["Osmosis", "Diffusion"] }], weak: [], goals: [] };
    const shaped = await validateAndShapeProposals(me.id, [
      { kind: "quiz_from_records", title: `${ctx.marker} A quiz from your Cell transport notes`, rationale: "You added these notes and haven't tested yourself on them.", from_note: null, payload: { record: 1, topic: "Osmosis" } },
      { kind: "teach_weak_topic", title: `${ctx.marker} Teach your agent photosynthesis`, rationale: "Your mastery is low on photosynthesis.", from_note: null, payload: { topic: "Photosynthesis" } },
    ], { refs, notes: [] });
    ctx.expect.eq("the quiz from their own record is kept; the 'weak topic' they don't have is dropped", shaped.map((x) => x.kind), ["quiz_from_records"]);
    const q = shaped[0];
    ctx.expect.ok("…its preview is written from the record, not the model", q?.preview?.record === rec.name && q.preview.topics.includes("Osmosis") && q.payload.recordId === rec.id, q);

    // Delivery with its preview and button.
    const chatId = await chat(ctx, as, me, "ready proposal");
    const pid = await seedProposal(ctx, me, { kind: q.kind, title: q.title, rationale: q.rationale, payload: q.payload, preview: q.preview, source_chat_id: chatId });
    const posted = await deliverProactive(me.id, { now: later(), ignoreQuietHours: true });
    ctx.expect.ok("posted into the chat it came from", posted.posted && posted.proposalId === pid && posted.chatId === chatId, posted);
    const msg = (await ctx.db.rows("chat_messages", { id: posted.messageId }, { columns: "text, meta" }))[0];
    ctx.expect.ok("…carrying the preview and what Yes does", msg?.meta?.proposal?.preview?.kind === "quiz" && msg.meta.proposal.yes === "Yes, open the quiz" && msg.meta.proposal.cost === "free", msg?.meta?.proposal);

    // Yes → the real thing, reported in the same thread.
    const yes = await ctx.http({ as, method: "POST", path: `/api/agent/proposals/inbox/p:${pid}/accept` });
    ctx.expect.ok("Yes opens the quiz on that record", yes.body?.data?.executed && yes.body.data.href === `/library?record=${rec.id}&tool=quiz`, yes.body);
    const report = yes.body?.data?.report;
    ctx.expect.ok("…and reports in the same chat with the quiz link", report?.meta?.materials?.[0]?.href === `/library?record=${rec.id}&tool=quiz`, report);
    const page = await ctx.http({ as, path: `/api/adaptive/chat/sessions/${chatId}/messages?limit=10` });
    const ms = page.body?.messages || [];
    ctx.expect.ok("the chat shows the suggestion as done and the report after it", ms.some((m) => m.meta?.proposal?.id === pid && m.meta.proposal.status === "executed") && ms.some((m) => m.meta?.reportOf === pid), ms.map((m) => [m.meta?.proposal?.status, m.meta?.reportOf]));
  },
};

// Step 5 — goal work: nudges only for a stale or close goal; a fix-it found by code, done on Yes.
export const goalWork = {
  name: "agent.goal_work", area: "agent-chat", risk: "write",
  description: "A goal nudge is kept for a goal untouched 9 days and dropped for one touched yesterday; an implied goal at most once a week; two overdue tasks become a fix-it that, on Yes, spreads them over the next days.",
  params: { learner: { default: "@tester26" } },
  async run(ctx, p) {
    const as = p.learner;
    const me = await readyLearner(ctx, as);
    const refs = { goals: [
      { id: "00000000-0000-0000-0000-00000000000a", title: "A in BECE English", days_left: 40, days_since_update: 9 },
      { id: "00000000-0000-0000-0000-00000000000b", title: "Finish Basic Science", days_left: 90, days_since_update: 1 },
    ], records: [], weak: [] };
    const nudge = (goal, t) => ({ kind: "goal_nudge", title: `${ctx.marker} ${t}`, rationale: "This goal hasn't moved in a while.", from_note: null, payload: { goal, title: `${ctx.marker} ${t}` } });
    const shaped = await validateAndShapeProposals(me.id, [nudge(1, "20 minutes on concord"), nudge(2, "Read chapter 3")], { refs, notes: [] });
    ctx.expect.eq("a nudge for the stale goal only", shaped.map((x) => x.payload?.goalId), [refs.goals[0].id]);
    const notes = [{ kind: "learner_goal", note: "wants to study medicine", chatId: null }, { kind: "learner_goal", note: "wants a scholarship", chatId: null }];
    const implied = await validateAndShapeProposals(me.id, [
      { kind: "goal", title: `${ctx.marker} Study medicine`, rationale: "You've mentioned medicine twice.", from_note: 1, payload: { title: "Study medicine" } },
      { kind: "goal", title: `${ctx.marker} Win a scholarship`, rationale: "You've mentioned a scholarship twice.", from_note: 2, payload: { title: "Win a scholarship" } },
    ], { refs, notes, impliedThisWeek: 0 });
    ctx.expect.eq("an implied goal at most once a week", implied.length, 1);

    // Two overdue tasks → a fix-it; Yes spreads them out.
    const ids = [];
    for (const t of ["revise titration", "past paper 2019"]) {
      const r = await ctx.http({ as, method: "POST", path: "/api/tasks", body: { title: `${ctx.marker} ${t}`, priority: "medium", dueAt: new Date(Date.now() + 864e5).toISOString().replace("Z", "+00:00") } });
      const id = r.body?.task?.id || r.body?.data?.id || r.body?.id;
      if (!id) ctx.expect.blocked(`making a task answered ${r.status}`);
      ids.push(id);
      ctx.cleanup(() => ctx.http({ as, method: "DELETE", path: `/api/tasks/${id}` }));
    }
    await (await db()).from("tasks").update({ due_at: new Date(Date.now() - 2 * 864e5).toISOString() }).in("id", ids).eq("creator_id", me.id);
    const fix = fixIts(await gatherSignals(me.id))[0];
    ctx.expect.ok("two overdue tasks → a fix-it naming them", fix?.kind === "fix_it" && ids.every((id) => fix.payload.taskIds.includes(id)), fix);
    if (!fix) return;
    const pid = await seedProposal(ctx, me, { kind: fix.kind, title: `${ctx.marker} ${fix.title}`, rationale: fix.rationale, payload: { ...fix.payload, taskIds: ids }, preview: fix.preview });
    const yes = await ctx.http({ as, method: "POST", path: `/api/agent/proposals/inbox/p:${pid}/accept` });
    ctx.expect.eq("Yes moves both", yes.body?.data?.moved, 2);
    const after = await ctx.db.rows("tasks", { creator_id: me.id }, { columns: "id, due_at", limit: 200 });
    ctx.expect.ok("…into the coming days", ids.every((id) => { const t = after.find((x) => x.id === id); return t && new Date(t.due_at).getTime() > Date.now(); }), after.filter((x) => ids.includes(x.id)));
  },
};

// Step 6 — Ideas: listed live, "Do it" hands back the brief once, "Not for me" closes it.
export const ideasFlow = {
  name: "agent.ideas", area: "agent-chat", risk: "write",
  description: "Live ideas are listed (≤ 6, newest first); Do it returns the brief to send and closes the idea; Not for me closes the other; a used idea can't be used again.",
  params: { learner: { default: "@tester26" } },
  async run(ctx, p) {
    const as = p.learner;
    const me = await ctx.as(as);
    const { data: rows, error } = await (await db()).schema("edu").from("agent_ideas").insert([
      { user_id: me.id, title: `${ctx.marker} Turn your Biology notes into a quiz`, why: "You added them on Monday.", brief: "Make me a 10-question quiz from my Biology notes", icon: "quiz", context: { kind: "record", label: "Biology notes" } },
      { user_id: me.id, title: `${ctx.marker} Teach your agent osmosis`, why: "It's your weakest topic (30%).", brief: "I want to teach you osmosis", icon: "teach", context: { kind: "weak", label: "Osmosis" } },
    ]).select("id, title");
    if (error) ctx.expect.blocked(`couldn't seed ideas: ${error.message}`);
    for (const r of rows) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_ideas", { ownerColumn: "user_id", ownerId: me.id, filters: { id: r.id } }));
    const list = (await ctx.http({ as, path: "/api/agent/ideas" })).body?.data || [];
    ctx.expect.ok("both are listed, at most 6", rows.every((r) => list.some((i) => i.id === r.id)) && list.length <= 6, list.map((i) => i.title));
    const use = await ctx.http({ as, method: "POST", path: `/api/agent/ideas/${rows[0].id}/use` });
    ctx.expect.eq("Do it hands back the brief to send", use.body?.data?.brief, "Make me a 10-question quiz from my Biology notes");
    const again = await ctx.http({ as, method: "POST", path: `/api/agent/ideas/${rows[0].id}/use` });
    ctx.expect.status("…once", again, 404);
    const no = await ctx.http({ as, method: "POST", path: `/api/agent/ideas/${rows[1].id}/dismiss` });
    ctx.expect.eq("Not for me closes it", no.body?.data?.status, "dismissed");
    const left = (await ctx.http({ as, path: "/api/agent/ideas" })).body?.data || [];
    ctx.expect.ok("…neither is listed now", !left.some((i) => rows.some((r) => r.id === i.id)), left.map((i) => i.title));
  },
};

// Step 8 — consents, quiet hours in their zone, the budget shown.
export const consentsQuietBudget = {
  name: "agent.consents_quiet", area: "agent-chat", risk: "write",
  description: "Suggestions switched off → nothing is posted; quiet hours set around now, in the learner's time zone → held; a bad time zone is refused; Settings shows this week's budget.",
  params: { learner: { default: "@tester26" } },
  async run(ctx, p) {
    const as = p.learner;
    const me = await readyLearner(ctx, as);
    const chatId = await chat(ctx, as, me, "consents");
    await seedProposal(ctx, me, { kind: "task", title: `${ctx.marker} Revise osmosis`, rationale: "Your mastery on osmosis is 30%.", payload: { title: `${ctx.marker} Revise osmosis`, priority: "medium" }, source_chat_id: chatId });

    await ctx.http({ as, method: "PATCH", path: "/api/agent/settings", body: { proactive: false } });
    const s1 = (await ctx.http({ as, path: "/api/agent/settings" })).body?.data;
    ctx.expect.eq("Suggestions and ideas: off", s1?.proactive, false);
    ctx.expect.eq("…nothing is posted", (await deliverProactive(me.id, { now: later(), ignoreQuietHours: true })).reason, "consent_off");

    // Quiet hours around this very minute, in New York time.
    const ny = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(later());
    const [h] = ny.split(":").map(Number);
    const hh = (n) => String((n + 24) % 24).padStart(2, "0");
    const set = await ctx.http({ as, method: "PATCH", path: "/api/agent/settings", body: { proactive: true, timeZone: "America/New_York", quietStart: `${hh(h - 1)}:00`, quietEnd: `${hh(h + 2)}:00` } });
    ctx.expect.eq("quiet hours and time zone saved", [set.body?.data?.timeZone, set.body?.data?.quietStart], ["America/New_York", `${hh(h - 1)}:00`]);
    ctx.expect.eq("…held in their quiet hours", (await deliverProactive(me.id, { now: later() })).reason, "quiet_hours");
    const bad = await ctx.http({ as, method: "PATCH", path: "/api/agent/settings", body: { timeZone: "Mars/Olympus" } });
    ctx.expect.status("a time zone that doesn't exist is refused", bad, 422);
    const s2 = (await ctx.http({ as, path: "/api/agent/settings" })).body?.data;
    ctx.expect.ok("Settings shows this week's background budget", Number.isFinite(s2?.budget?.usedPct) && !!s2.budget.resetsAt, s2?.budget);
  },
};

// Step 7 — an instructor's classes: missing work found from their own activity, Yes reminds those learners.
export const instructorProactive = {
  name: "agent.instructor_proactive", area: "agent-chat", risk: "write",
  description: "An activity due tomorrow that 3 of 3 learners haven't started → a 'remind them' suggestion for the instructor who set it (from the activity alone, no chats read); Yes reminds exactly those learners.",
  params: { instructor: { default: "@tester52" }, learners: { default: ["@tester19", "@tester20", "@tester21"] } },
  async run(ctx, p) {
    const teacher = await ctx.as(p.instructor);
    const kids = [];
    for (const l of p.learners) kids.push(await ctx.as(l));
    const d = await db();
    const { data: act, error } = await d.schema("edu").from("self_study_assignments").insert({
      created_by: teacher.id, title: `${ctx.marker} Linear equations`, subject: "Mathematics", topic: "Linear equations",
      due_at: new Date(Date.now() + 864e5).toISOString(), created_at: new Date(Date.now() - 4 * 864e5).toISOString(),
    }).select("id").single();
    if (error) ctx.expect.blocked(`couldn't seed the activity: ${error.message}`);
    ctx.cleanup(() => ctx.db.deleteOwned("edu.self_study_assignments", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id: act.id } }));
    await d.schema("edu").from("self_study_targets").insert(kids.map((k) => ({ assignment_id: act.id, student_id: k.id, status: "assigned" })));

    const run = await runInstructorCycle(teacher.id, { force: true });
    ctx.note(`run: ${JSON.stringify(run)}`);
    const props = await ctx.db.rows("edu.agent_proposals", { user_id: teacher.id, kind: "chase_missing" }, { columns: "id, title, rationale, payload, status", limit: 20 });
    const mine = props.find((x) => x.payload?.assignmentId === act.id);
    for (const x of props.filter((y) => y.payload?.assignmentId === act.id)) ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_proposals", { ownerColumn: "user_id", ownerId: teacher.id, filters: { id: x.id } }));
    ctx.expect.ok("a 'remind them' suggestion for this activity, from its facts", !!mine && /3 of 3 haven't started/.test(mine.rationale), mine);
    ctx.expect.ok("…naming exactly its learners", mine && kids.every((k) => mine.payload.studentIds.includes(k.id)) && mine.payload.studentIds.length === 3, mine?.payload);
    if (!mine) return;
    const yes = await ctx.http({ as: p.instructor, method: "POST", path: `/api/agent/proposals/inbox/p:${mine.id}/accept` });
    ctx.expect.eq("Yes reminds those 3 learners", yes.body?.data?.reminded, 3);
  },
};
