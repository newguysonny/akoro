/**
 * The instructor's agent tools, called the way instructors call them: from
 * chat. Two families:
 *
 *   teaching tools   run_teaching_tool — a lesson plan, hooks, vocabulary… made
 *                    in chat and saved to the Library (the workbench page is
 *                    retired; this is how they are made now).
 *   activity tools   prepare / list / get / discard drafts, list classes,
 *                    check outcomes, weekly routines — the activities page no
 *                    longer creates anything, so these are the only way in.
 *
 * Routing scenarios are dry (the model's choice of tool, nothing changes);
 * lifecycle scenarios are writes on a test instructor, each cleaning up after
 * itself.
 */

const DEFAULT_INSTRUCTOR = "@tester51";
const DEFAULT_LEARNER = "@tester19";

export async function teacherOf(ctx, who) {
  const teacher = await ctx.as(who);
  if (teacher.role !== "instructor") ctx.expect.blocked(`${who} isn't an instructor (seed 2026-seed-instructor-testers.sql)`);
  return teacher;
}

/**
 * A write scenario starts from a clean slate: any pending draft left on the test
 * instructor (by an earlier run cut short) changes how chat messages are read —
 * "make a worksheet" becomes an edit of the old draft. Test accounts only.
 */
export async function cleanSlate(ctx, teacher) {
  const n = await ctx.db.deleteOwned("activity_drafts", { ownerColumn: "created_by", ownerId: teacher.id, filters: { status: "draft" } });
  if (n) ctx.note(`cleared ${n} stale pending draft(s) left on ${teacher.username || "the test instructor"}`);
}

export const toolsOf = (turn) => (turn.tools || []).map((t) => t.tool);
export const lastCall = (turn, name) => (turn.tools || []).filter((t) => t.tool === name).at(-1) || null;

/** The draft as the preview reads it. */
export const draftRow = async (ctx, as, id) => (await ctx.http({ as, path: `/api/self-study/drafts/${id}` })).body?.data?.draft || null;

/** Wait for version `n` of a teaching-resource draft to finish: → { draft, v } (v.status ready | failed), or null. */
export async function toolVersion(ctx, as, draftId, n = 1, timeoutMs = 150_000) {
  return ctx.until(async () => {
    const draft = await draftRow(ctx, as, draftId);
    const v = (draft?.payload?.versions || []).find((x) => x.n === n);
    return v && v.status !== "drafting" ? { draft, v } : null;
  }, { timeoutMs, everyMs: 4_000 });
}

/** Every teaching tool answers in the one result template (teaching/template.js). */
export const isTemplate = (c) => !!c && c.version === 2 && typeof c.title === "string" && c.title.length > 0
  && Array.isArray(c.entries) && c.entries.length >= 1
  && c.entries.every((e) => e.title !== undefined && Array.isArray(e.sections) && e.sections.length >= 1
    && e.sections.every((x) => ["text", "list", "chips", "fields", "script", "scores"].includes(x.kind)));

/* ── Teaching tools ─────────────────────────────────────────────────────── */

const TEACHING_PROMPTS = [
  { say: "Make a lesson plan on fractions for JSS1 Mathematics, 40 minutes.", tool: "lesson-plan" },
  { say: "Give me lesson hooks for the water cycle, JSS1 Basic Science.", tool: "lesson-hooks" },
  { say: "Make a vocabulary list for photosynthesis, JSS1 Basic Science.", tool: "vocabulary" },
];

export const teachingToolRouting = {
  name: "instructor.teaching_tool_routing", area: "instructor-chat", risk: "dry", repeats: 2,
  description: "Asking for a lesson plan, hooks or a vocabulary list runs run_teaching_tool with the right tool; asking for an assignment for the class prepares an activity instead.",
  params: { instructor: { default: DEFAULT_INSTRUCTOR } },
  async run(ctx, p) {
    await teacherOf(ctx, p.instructor);
    for (const c of TEACHING_PROMPTS) {
      const turn = await ctx.agent.chat({ as: p.instructor, model: p.model, prompt: c.say });
      ctx.expect.eq(`"${c.tool}": turn answered`, turn.status, 200);
      ctx.expect.toolCalled(turn, "run_teaching_tool");
      ctx.expect.toolArgs(turn, "run_teaching_tool", { tool: c.tool });
      ctx.expect.toolNotCalled(turn, "prepare_activity");
      ctx.expect.noBackendNames(`"${c.tool}": reply has no backend names`, turn.reply);
      ctx.expect.loopHealthy(turn);
    }
    // Work that goes to learners is an activity, not a Library resource.
    const turn = await ctx.agent.chat({ as: p.instructor, model: p.model, prompt: "Prepare an assignment on fractions for my whole class (JSS1 Mathematics): 5 questions." });
    ctx.expect.eq("assignment: turn answered", turn.status, 200);
    ctx.expect.toolCalled(turn, "prepare_activity");
    ctx.expect.toolNotCalled(turn, "run_teaching_tool");
  },
};

// One ask per tool, in the order the gate prefers them. Every tool is open to every instructor.
const RUNNABLE = [
  { key: "lesson-hooks", say: "Give me lesson hooks for the water cycle, JSS1 Basic Science.", name: "Lesson Hooks" },
  { key: "vocabulary",   say: "Make a vocabulary list for photosynthesis, JSS1 Basic Science.", name: "Vocabulary Builder" },
  { key: "misconceptions", say: "What are the common misconceptions about fractions for JSS1 Mathematics?", name: "Common Misconceptions" },
  { key: "real-world",   say: "Real-world connections for simple interest, JSS1 Mathematics.", name: "Real-World Connections" },
  { key: "lesson-plan",  say: "Make a lesson plan on fractions for JSS1 Mathematics, 40 minutes.", name: "Lesson Plan" },
];

export const teachingToolRuns = {
  name: "instructor.teaching_tool_runs", area: "instructor-chat", risk: "write",
  description: "A teaching resource asked for in chat is drafted with an unlocked tool (Version 1 written in the background), is NOT in the Library until the instructor saves it, and opens from the Library once saved.",
  params: { instructor: { default: DEFAULT_INSTRUCTOR } },
  async run(ctx, p) {
    const teacher = await teacherOf(ctx, p.instructor);
    await cleanSlate(ctx, teacher);
    const catalogue = await ctx.http({ as: p.instructor, path: "/api/teaching/tools" });
    const keys = new Set((catalogue.body?.data || []).map((t) => t.key));
    const pick = RUNNABLE.find((r) => keys.has(r.key));
    ctx.expect.ok("the teaching tools are listed", !!pick, [...keys]);
    if (!pick) return;
    ctx.note(`using the ${pick.name} tool`);

    const startedAt = Date.now() - 5_000;
    const turn = await ctx.agent.chat({ as: p.instructor, mode: "live", model: p.model, prompt: pick.say });
    ctx.expect.eq("turn answered", turn.status, 200);

    const run = lastCall(turn, "run_teaching_tool");
    ctx.expect.ok("the agent called run_teaching_tool", !!run, toolsOf(turn));
    ctx.expect.toolNotCalled(turn, "prepare_activity");
    if (!run) return;
    // An empty wallet is a missing precondition, not a bug.
    if (run.result?.prepared === false && run.result?.code === "INSUFFICIENT_COINS") {
      ctx.expect.blocked(`${p.instructor} can't pay for the tool: ${run.result.error}`);
    }
    ctx.expect.eq("the tool the request asked for", run.input?.tool, pick.key);
    ctx.expect.ok("it was drafted for preview", run.result?.prepared === true && !!run.result?.draftId, run.result);
    const draftId = run.result?.draftId;
    if (!draftId) return;
    ctx.cleanup(() => ctx.db.deleteOwned("activity_drafts", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id: draftId } }));

    // A draft is not a Library item: nothing is saved until the instructor approves.
    const early = await ctx.http({ as: p.instructor, path: `/api/instructor/tools/outputs?kind=${pick.key}` });
    ctx.expect.ok("it is not in the Library yet", !(early.body?.outputs || []).some((o) => new Date(o.created_at).getTime() >= startedAt), early.body?.outputs);

    const ready = await toolVersion(ctx, p.instructor, draftId, 1);
    ctx.expect.eq("version 1 was written", ready?.v?.status, "ready");
    if (ready?.v?.status !== "ready") return;
    ctx.expect.ok("it follows the shared template", isTemplate(ready.v.result), Object.keys(ready.v.result || {}));

    // The approval (the Save to Library tap on the preview).
    const saved = await ctx.http({ as: p.instructor, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { version: 1 } });
    ctx.expect.eq("saved", saved.status, 201);
    const outputId = saved.body?.data?.outputId;
    ctx.expect.ok("it returns the Library id the chat links to", !!outputId, saved.body);
    if (!outputId) return;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.tool_outputs", { ownerColumn: "instructor_id", ownerId: teacher.id, filters: { id: outputId } }));
    ctx.expect.eq("the draft is closed", (await draftRow(ctx, p.instructor, draftId))?.status, "assigned");

    // …and opens, which is what the Library's page reads.
    const full = await ctx.http({ as: p.instructor, path: `/api/instructor/tools/outputs/${outputId}` });
    ctx.expect.eq("the saved resource opens", full.status, 200);
    const body = full.body?.output?.content;
    ctx.expect.ok("it follows the shared template", isTemplate(body), body && Object.keys(body));
    ctx.expect.ok("it is filed under the teaching tool", String(full.body?.output?.tool || "").startsWith("teaching_"), full.body?.output?.tool);
    ctx.expect.noBackendNames("reply has no backend names", turn.reply);
    ctx.expect.loopHealthy(turn);
  },
};

/* ── Activity tools ─────────────────────────────────────────────────────── */

const ACTIVITY_READS = [
  { say: "What activity drafts do I have waiting?", tool: "list_activity_drafts" },
  { say: "Which classes do I teach?", tool: "list_my_classrooms" },
  { say: "How did my last assignment go?", tool: "check_activity_outcomes" },
  { say: "What weekly routines do I have set up?", tool: "list_activity_routines" },
];

export const activityToolRouting = {
  name: "instructor.activity_tool_routing", area: "instructor-chat", risk: "dry", repeats: 2,
  description: "Questions about drafts, classes, results and routines go to the matching read tool — and never prepare a new activity.",
  params: { instructor: { default: DEFAULT_INSTRUCTOR } },
  async run(ctx, p) {
    await teacherOf(ctx, p.instructor);
    for (const c of ACTIVITY_READS) {
      const turn = await ctx.agent.chat({ as: p.instructor, model: p.model, prompt: c.say });
      ctx.expect.eq(`${c.tool}: turn answered`, turn.status, 200);
      ctx.expect.toolCalled(turn, c.tool);
      ctx.expect.toolNotCalled(turn, "prepare_activity");
      const call = lastCall(turn, c.tool);
      ctx.expect.ok(`${c.tool} ran without an error`, call && call.success !== false && !call.result?.error, call?.result);
      ctx.expect.loopHealthy(turn);
    }
  },
};

/** A conversation with the instructor's agent that carries its history, like the app. */
export function talk(ctx, p, teacher) {
  const history = [];
  return async (prompt, label) => {
    const turn = await ctx.agent.chat({ as: p.instructor, mode: "live", model: p.model, prompt, history: [...history] });
    ctx.expect.eq(`${label}: turn answered`, turn.status, 200);
    history.push({ role: "user", content: prompt }, { role: "assistant", content: String(turn.reply || "") });
    // Anything a turn prepared is the gate's to remove, strays included.
    for (const t of turn.tools || []) {
      const id = ["prepare_activity", "run_teaching_tool"].includes(t.tool) ? t.result?.draftId : null;
      if (id) ctx.cleanup(() => ctx.db.deleteOwned("activity_drafts", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id } }));
    }
    return turn;
  };
}

export const draftLifecycle = {
  name: "instructor.draft_lifecycle", area: "instructor-chat", risk: "write",
  description: "Prepare a draft in chat, then list it, read it back and discard it — each through its own tool, ending with the draft closed and nothing sent to a learner.",
  params: { instructor: { default: DEFAULT_INSTRUCTOR }, learner: { default: DEFAULT_LEARNER } },
  async run(ctx, p) {
    const teacher = await teacherOf(ctx, p.instructor);
    await cleanSlate(ctx, teacher);
    const learner = await ctx.as(p.learner);
    const say = talk(ctx, p, teacher);

    const t1 = await say(`Set a Basic Science self study on photosynthesis for @${learner.username} (JSS1).`, "prepare");
    const prep = lastCall(t1, "prepare_activity");
    ctx.expect.ok("the agent called prepare_activity", !!prep, toolsOf(t1));
    const draftId = prep?.result?.draftId;
    ctx.expect.ok("a draft was prepared", !!draftId, prep?.result);
    if (!draftId) return;

    const t2 = await say("What drafts do I have waiting?", "list");
    const listed = lastCall(t2, "list_activity_drafts");
    ctx.expect.ok("the agent called list_activity_drafts", !!listed, toolsOf(t2));
    ctx.expect.ok("the new draft is in the list", (listed?.result?.drafts || []).some((d) => d.draftId === draftId), listed?.result);
    ctx.expect.toolNotCalled(t2, "prepare_activity");

    const t3 = await say("Show me that draft.", "read");
    const got = lastCall(t3, "get_activity_draft");
    ctx.expect.ok("the agent called get_activity_draft", !!got, toolsOf(t3));
    ctx.expect.eq("it read the same draft", got?.input?.draftId, draftId);
    // A long draft comes back to the gate truncated ({truncated, preview}): read the status from whichever is there.
    const gotText = typeof got?.result?.preview === "string" ? got.result.preview : JSON.stringify(got?.result || {});
    ctx.expect.ok("the draft is still pending", /"status":\s*"draft"/.test(gotText), gotText.slice(0, 200));
    ctx.expect.toolNotCalled(t3, "prepare_activity");   // reading a draft must not start another

    const t4 = await say("Discard it, I don't need it.", "discard");
    const gone = lastCall(t4, "discard_activity_draft");
    ctx.expect.ok("the agent called discard_activity_draft", !!gone, toolsOf(t4));
    ctx.expect.eq("it discarded the same draft", gone?.input?.draftId, draftId);
    ctx.expect.ok("it was discarded", gone?.result?.discarded === true, gone?.result);
    ctx.expect.toolNotCalled(t4, "prepare_activity");

    // Evidence in the data, not the reply: closed, and nothing reached the learner.
    const row = await ctx.http({ as: p.instructor, path: `/api/self-study/drafts/${draftId}` });
    ctx.expect.ok("the draft row is closed", row.status === 404 || row.body?.data?.draft?.status === "discarded", row.body?.data?.draft?.status ?? row.status);
    const mine = await ctx.http({ as: p.learner, path: "/api/self-study/mine" });
    const leaked = (Array.isArray(mine.body?.data) ? mine.body.data : []).filter((a) => /photosynthesis/i.test(a.title || "") && new Date(a.created_at || 0).getTime() > Date.now() - 15 * 60_000);
    ctx.expect.eq("nothing was assigned to the learner", leaked.length, 0);
  },
};

export const routineLifecycle = {
  name: "instructor.routine_lifecycle", area: "instructor-chat", risk: "write",
  description: "A weekly routine set in chat is stored, listed and cancelled — and only ever prepares drafts, never assigns.",
  params: { instructor: { default: DEFAULT_INSTRUCTOR }, learner: { default: DEFAULT_LEARNER } },
  async run(ctx, p) {
    const teacher = await teacherOf(ctx, p.instructor);
    const learner = await ctx.as(p.learner);
    const say = talk(ctx, p, teacher);
    const title = `${ctx.marker} Friday revision`;

    const t1 = await say(`Every Friday, prepare a Basic Science self study on revision for @${learner.username}. Call the routine "${title}".`, "schedule");
    const made = lastCall(t1, "schedule_activity_routine");
    ctx.expect.ok("the agent called schedule_activity_routine", !!made, toolsOf(t1));
    const routineId = made?.result?.routineId;
    ctx.expect.ok("the routine was scheduled", made?.result?.scheduled === true && !!routineId, made?.result);
    if (routineId) ctx.cleanup(() => ctx.db.deleteOwned("draft_routines", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id: routineId } }));
    else return;
    ctx.expect.eq("on Friday", String(made.input?.day || "").toLowerCase(), "friday");
    ctx.expect.toolNotCalled(t1, "prepare_activity");

    const t2 = await say("What weekly routines do I have?", "list");
    const listed = lastCall(t2, "list_activity_routines");
    ctx.expect.ok("the agent called list_activity_routines", !!listed, toolsOf(t2));
    ctx.expect.ok("the routine is in the list", (listed?.result?.routines || []).some((r) => r.routineId === routineId), listed?.result);
    ctx.expect.toolNotCalled(t2, "prepare_activity");

    const t3 = await say("Cancel that routine.", "cancel");
    const cancelled = lastCall(t3, "cancel_activity_routine");
    ctx.expect.ok("the agent called cancel_activity_routine", !!cancelled, toolsOf(t3));
    ctx.expect.eq("it cancelled the same routine", cancelled?.input?.routineId, routineId);
    ctx.expect.ok("it was cancelled", cancelled?.result?.cancelled === true, cancelled?.result);
    ctx.expect.toolNotCalled(t3, "prepare_activity");   // cancelling must not start a draft

    const after = await ctx.http({ as: p.instructor, path: "/api/self-study/routines" });
    ctx.expect.ok("it is gone from the routines list", !(after.body?.data?.routines || []).some((r) => r.id === routineId), after.body?.data?.routines);
  },
};

/** No tool is locked or priced: the catalogue says so for every tool, for every instructor. */
export const toolsAllOpen = {
  name: "instructor.tools_all_open", area: "instructor-chat", risk: "read",
  description: "Every teaching tool is open (not locked, no price) and every platform tool in the catalogue shows as included.",
  params: { instructor: { default: DEFAULT_INSTRUCTOR } },
  async run(ctx, p) {
    await teacherOf(ctx, p.instructor);
    const teaching = (await ctx.http({ as: p.instructor, path: "/api/teaching/tools" })).body?.data || [];
    ctx.expect.gte("the teaching tools are listed", teaching.length, 9);
    ctx.expect.eq("none is locked", teaching.filter((t) => t.locked).map((t) => t.key), []);
    ctx.expect.eq("none has a price", teaching.filter((t) => (t.priceKobo || 0) > 0).map((t) => t.key), []);
    const catalogue = (await ctx.http({ as: p.instructor, path: "/api/instructor/tools" })).body || {};
    const tools = catalogue.tools || [];
    ctx.note(`${tools.length} platform tools in the catalogue`);
    ctx.expect.eq("every platform tool is owned (included)", tools.filter((t) => !t.owned).map((t) => t.key), []);
    ctx.expect.eq("every platform tool is free", tools.filter((t) => (t.priceKobo || 0) > 0 || (t.price || 0) > 0).map((t) => t.key), []);
  },
};
