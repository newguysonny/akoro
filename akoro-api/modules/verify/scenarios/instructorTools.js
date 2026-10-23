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

async function teacherOf(ctx, who) {
  const teacher = await ctx.as(who);
  if (teacher.role !== "instructor") ctx.expect.blocked(`${who} isn't an instructor (seed 2026-seed-instructor-testers.sql)`);
  return teacher;
}

const toolsOf = (turn) => (turn.tools || []).map((t) => t.tool);
const lastCall = (turn, name) => (turn.tools || []).filter((t) => t.tool === name).at(-1) || null;

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

export const teachingToolRuns = {
  name: "instructor.teaching_tool_runs", area: "instructor-chat", risk: "write",
  description: "A lesson plan asked for in chat is made, saved to the instructor's Library and opens from there.",
  params: { instructor: { default: DEFAULT_INSTRUCTOR } },
  async run(ctx, p) {
    const teacher = await teacherOf(ctx, p.instructor);
    const startedAt = Date.now() - 5_000;
    const turn = await ctx.agent.chat({ as: p.instructor, mode: "live", model: p.model, prompt: "Make a lesson plan on fractions for JSS1 Mathematics, 40 minutes." });
    ctx.expect.eq("turn answered", turn.status, 200);

    const run = lastCall(turn, "run_teaching_tool");
    ctx.expect.ok("the agent called run_teaching_tool", !!run, toolsOf(turn));
    if (!run) return;
    // A locked tool or an empty wallet is a missing precondition, not a bug.
    if (run.result?.created === false && ["TOOL_LOCKED", "INSUFFICIENT_COINS"].includes(run.result?.code)) {
      ctx.expect.blocked(`${p.instructor} can't run the lesson plan tool: ${run.result.error}`);
    }
    ctx.expect.eq("the lesson plan tool", run.input?.tool, "lesson-plan");
    ctx.expect.ok("it was created", run.result?.created === true, run.result);
    ctx.expect.eq("it says where it was saved", run.result?.savedTo, "Library");
    ctx.expect.gte("the preview carries the lesson", String(run.result?.preview || "").length, 200);

    // Saved for the instructor (the insert is fire-and-forget: give it a moment).
    const row = await ctx.until(async () => {
      const r = await ctx.http({ as: p.instructor, path: "/api/instructor/tools/outputs?kind=lesson-plan" });
      return (r.body?.outputs || []).find((o) => new Date(o.created_at).getTime() >= startedAt) || null;
    }, { timeoutMs: 20_000, everyMs: 2_000 });
    ctx.expect.ok("it is in the Library list", !!row, "no lesson-plan output after the turn");
    if (!row) return;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.tool_outputs", { ownerColumn: "instructor_id", ownerId: teacher.id, filters: { id: row.id } }));
    ctx.expect.ok("it is filed under the teaching tool", String(row.tool || "").startsWith("teaching_"), row.tool);

    // …and opens, which is what the Library's viewer reads.
    const full = await ctx.http({ as: p.instructor, path: `/api/instructor/tools/outputs/${row.id}` });
    ctx.expect.eq("the saved lesson opens", full.status, 200);
    const body = full.body?.output?.content;
    ctx.expect.ok("the saved lesson has content", !!(body && (body.content || body.cards)), body && Object.keys(body));
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
function talk(ctx, p, teacher) {
  const history = [];
  return async (prompt, label) => {
    const turn = await ctx.agent.chat({ as: p.instructor, mode: "live", model: p.model, prompt, history: [...history] });
    ctx.expect.eq(`${label}: turn answered`, turn.status, 200);
    history.push({ role: "user", content: prompt }, { role: "assistant", content: String(turn.reply || "") });
    // Anything a turn prepared is the gate's to remove, strays included.
    for (const t of turn.tools || []) {
      const id = t.tool === "prepare_activity" ? t.result?.draftId : null;
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

    const t3 = await say("Show me that draft.", "read");
    const got = lastCall(t3, "get_activity_draft");
    ctx.expect.ok("the agent called get_activity_draft", !!got, toolsOf(t3));
    ctx.expect.eq("it read the same draft", got?.input?.draftId, draftId);
    ctx.expect.eq("the draft is still pending", got?.result?.status, "draft");

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

    const t3 = await say("Cancel that routine.", "cancel");
    const cancelled = lastCall(t3, "cancel_activity_routine");
    ctx.expect.ok("the agent called cancel_activity_routine", !!cancelled, toolsOf(t3));
    ctx.expect.eq("it cancelled the same routine", cancelled?.input?.routineId, routineId);
    ctx.expect.ok("it was cancelled", cancelled?.result?.cancelled === true, cancelled?.result);

    const after = await ctx.http({ as: p.instructor, path: "/api/self-study/routines" });
    ctx.expect.ok("it is gone from the routines list", !(after.body?.data?.routines || []).some((r) => r.id === routineId), after.body?.data?.routines);
  },
};
