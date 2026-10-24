/**
 * Every teaching tool, asked for in chat the way a teacher asks: the agent runs
 * run_teaching_tool with the right tool and the right fields, the result is
 * saved to the Library, and it opens from there in the shape the Library's
 * viewer reads (the preview). One scenario per tool, so a tool the test
 * instructor hasn't unlocked (some are sold in the App Center) reports BLOCKED
 * for that tool alone.
 *
 * Teaching tools make resources for the instructor — there is no "assign" for
 * them; the draft-and-assign flow belongs to activities (instructorActivities.js).
 * Two tools share a name with an activity type ("Activities Creator", "Assignment
 * Creator"); they are asked for without the word that would start an activity draft.
 */
import { teacherOf, toolsOf, lastCall, cleanSlate, talk, toolVersion, draftRow } from "./instructorTools.js";

const INSTRUCTOR = "@tester51";

/** What each output type must look like once saved — the Library viewer reads these. */
// Every tool answers in the one result template (teaching/template.js).
const TEMPLATE = (c) => c.version === 2 && typeof c.title === "string" && c.title.length > 0
  && Array.isArray(c.entries) && c.entries.length >= 1
  && c.entries.every((e) => e.title !== undefined && Array.isArray(e.sections) && e.sections.length >= 1
    && e.sections.every((x) => ["text", "list", "chips", "fields", "script", "scores"].includes(x.kind)));

const SHAPES = {
  script: (c) => Array.isArray(c.turns) && c.turns.length >= 4 && c.turns.every((t) => t.speaker && t.text),
  doc: (c) => Array.isArray(c.cards) && c.cards.length >= 2,
  cards: (c) => Array.isArray(c.cards) && c.cards.length >= 5,
};

const CASES = [
  { key: "podcast", output: "script", name: "Podcast Generator",
    say: "Make a 3 minute podcast on photosynthesis for JSS1 Basic Science, with two hosts.",
    args: { tool: "podcast", minutes: "3" } },
  { key: "misconceptions", output: "doc", name: "Common Misconceptions",
    say: "What are the common misconceptions about fractions for JSS1 Mathematics?",
    args: { tool: "misconceptions" } },
  { key: "real-world", output: "doc", name: "Real-World Connections",
    say: "Real-world connections for simple interest, JSS1 Mathematics.",
    args: { tool: "real-world" } },
  { key: "lesson-hooks", output: "doc", name: "Lesson Hooks",
    say: "Give me lesson hooks for the water cycle, JSS1 Basic Science.",
    args: { tool: "lesson-hooks" } },
  { key: "vocabulary", output: "cards", name: "Vocabulary Builder",
    say: "Make a vocabulary list of 10 terms for photosynthesis, JSS1 Basic Science.",
    args: { tool: "vocabulary", count: "10" } },
  { key: "lesson-plan", output: "doc", name: "Lesson Plan",
    say: "Make a lesson plan on fractions for JSS1 Mathematics, 40 minutes.",
    args: { tool: "lesson-plan", duration: "40 minutes" } },
  { key: "activity", output: "doc", name: "Activities Creator",
    say: "Plan a group work exercise on the water cycle for JSS1 Basic Science, 20 minutes, using only a board and exercise books.",
    args: { tool: "activity" } },
  { key: "assignment", output: "doc", name: "Assignment Creator",
    say: "Make a homework sheet with a marking scheme on fractions for JSS1 Mathematics, 10 questions.",
    args: { tool: "assignment" } },
];

function toolScenario(c) {
  return {
    name: `instructor.teaching_${c.key.replace(/-/g, "_")}`, area: "instructor-chat", risk: "write",
    description: `${c.name}, asked for in chat: the right tool and fields, saved to the Library, and the saved result opens in the shape the viewer reads.`,
    params: { instructor: { default: INSTRUCTOR } },
    async run(ctx, p) {
      const teacher = await teacherOf(ctx, p.instructor);
      await cleanSlate(ctx, teacher);
      const catalogue = await ctx.http({ as: p.instructor, path: "/api/teaching/tools" });
      const entry = (catalogue.body?.data || []).find((t) => t.key === c.key);
      ctx.expect.ok(`the ${c.name} tool exists`, !!entry, (catalogue.body?.data || []).map((t) => t.key));
      ctx.expect.eq(`${c.name} is open to the instructor (no tool is locked)`, entry?.locked, false);

      const startedAt = Date.now() - 5_000;
      const turn = await ctx.agent.chat({ as: p.instructor, mode: "live", model: p.model, prompt: c.say });
      ctx.expect.eq("turn answered", turn.status, 200);
      const run = lastCall(turn, "run_teaching_tool");
      ctx.expect.ok("the agent called run_teaching_tool", !!run, toolsOf(turn));
      ctx.expect.toolNotCalled(turn, "prepare_activity");   // a Library resource, not an activity for learners
      if (!run) return;
      if (run.result?.prepared === false && run.result?.code === "INSUFFICIENT_COINS") ctx.expect.blocked(`${p.instructor} can't pay for the tool: ${run.result.error}`);
      for (const [k, v] of Object.entries(c.args)) ctx.expect.eq(`the tool was given ${k}`, String(run.input?.[k] ?? ""), v);
      c.check?.(ctx, run);
      ctx.expect.ok("it was drafted for preview", run.result?.prepared === true && !!run.result?.draftId, run.result);
      const draftId = run.result?.draftId;
      if (!draftId) return;
      ctx.cleanup(() => ctx.db.deleteOwned("activity_drafts", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id: draftId } }));

      // A draft is not a Library item: nothing is saved until the instructor approves it.
      const early = await ctx.http({ as: p.instructor, path: `/api/instructor/tools/outputs?kind=${c.key}` });
      ctx.expect.ok("it is not in the Library yet", !(early.body?.outputs || []).some((o) => new Date(o.created_at).getTime() >= startedAt), early.body?.outputs);

      // Preview: version 1 is written in the background.
      const ready = await toolVersion(ctx, p.instructor, draftId, 1);
      ctx.expect.eq("version 1 was written", ready?.v?.status, "ready");
      if (ready?.v?.status !== "ready") return;
      ctx.expect.ok("the draft follows the shared template (title, entries of sections)", TEMPLATE(ready.v.result), Object.keys(ready.v.result || {}));

      // The approval: Save to Library.
      const saved = await ctx.http({ as: p.instructor, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { version: 1 } });
      ctx.expect.eq("saved", saved.status, 201);
      const outputId = saved.body?.data?.outputId;
      ctx.expect.ok("it returns the Library id the chat links to", !!outputId, saved.body);
      if (!outputId) return;
      ctx.cleanup(() => ctx.db.deleteOwned("edu.tool_outputs", { ownerColumn: "instructor_id", ownerId: teacher.id, filters: { id: outputId } }));
      const row = (await ctx.http({ as: p.instructor, path: `/api/instructor/tools/outputs?kind=${c.key}` })).body?.outputs?.find((o) => o.id === outputId);
      ctx.expect.ok("it is in the Library list", !!row, `no ${c.key} output ${outputId}`);
      ctx.expect.eq("filed under the teaching tool", row?.tool, `teaching_${c.key}`);

      // What the Library page opens.
      const full = await ctx.http({ as: p.instructor, path: `/api/instructor/tools/outputs/${outputId}` });
      ctx.expect.eq("it opens", full.status, 200);
      const body = full.body?.output?.content || {};
      ctx.expect.ok(`the saved result has the ${c.output} shape older readers use`, SHAPES[c.output](body), Object.keys(body));
      ctx.expect.ok("the saved result follows the shared template (title, entries of sections)", TEMPLATE(body), Object.keys(body));
      ctx.expect.ok("it also has the readable text", typeof body.content === "string" && body.content.length > 50, typeof body.content);
      // The same row, through the teaching tools' own listing (the older viewer path).
      const alt = await ctx.http({ as: p.instructor, path: `/api/teaching/tools/outputs/${outputId}` });
      ctx.expect.eq("it opens from the teaching tools listing too", alt.status, 200);
      ctx.expect.noBackendNames("reply has no backend names", turn.reply);
      ctx.expect.loopHealthy(turn);
    },
  };
}

export const teachingToolScenarios = CASES.map(toolScenario);

/* Versioning, like an assignment: a follow-up makes the NEXT version from the one on screen, the first stays,
   and only the version the instructor approves reaches the Library. */
export const teachingToolVersions = {
  name: "instructor.teaching_tool_versions", area: "instructor-chat", risk: "write",
  description: "A teaching resource drafted in chat, changed by a follow-up into version 2 (version 1 kept), then version 2 saved — exactly one Library item, carrying version 2.",
  params: { instructor: { default: INSTRUCTOR } },
  async run(ctx, p) {
    const teacher = await teacherOf(ctx, p.instructor);
    await cleanSlate(ctx, teacher);
    const say = talk(ctx, p, teacher);
    const startedAt = Date.now() - 5_000;

    const t1 = await say("Give me lesson hooks for the water cycle, JSS1 Basic Science.", "draft");
    const run = lastCall(t1, "run_teaching_tool");
    ctx.expect.ok("the agent called run_teaching_tool", !!run, toolsOf(t1));
    if (run?.result?.prepared === false && run.result?.code === "INSUFFICIENT_COINS") ctx.expect.blocked(`${p.instructor} can't pay for the tool: ${run.result.error}`);
    const draftId = run?.result?.draftId;
    ctx.expect.ok("it was drafted", !!draftId, run?.result);
    if (!draftId) return;
    ctx.cleanup(() => ctx.db.deleteOwned("activity_drafts", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id: draftId } }));
    const v1 = await toolVersion(ctx, p.instructor, draftId, 1);
    ctx.expect.eq("version 1 was written", v1?.v?.status, "ready");
    if (v1?.v?.status !== "ready") return;

    // The follow-up changes the draft (version 2), it does not start another resource.
    const t2 = await say("Make the hooks more playful.", "follow-up");
    const rev = lastCall(t2, "revise_activity_draft");
    ctx.expect.ok("the agent revised the same draft", rev?.input?.draftId === draftId && rev?.success !== false, { tools: toolsOf(t2), input: rev?.input });
    ctx.expect.ok("it passed the instructor's words as the change request", String(rev?.input?.change_request || "").length > 5, rev?.input);
    ctx.expect.toolNotCalled(t2, "run_teaching_tool");
    ctx.expect.toolNotCalled(t2, "prepare_activity");
    const v2 = await toolVersion(ctx, p.instructor, draftId, 2);
    ctx.expect.eq("version 2 was written", v2?.v?.status, "ready");
    if (v2?.v?.status !== "ready") return;
    ctx.expect.eq("version 2 is built from version 1", v2.v.basedOn, 1);
    const after = await draftRow(ctx, p.instructor, draftId);
    const keptV1 = (after?.payload?.versions || []).find((x) => x.n === 1);
    ctx.expect.eq("version 1 is kept as it was", JSON.stringify(keptV1?.result), JSON.stringify(v1.v.result));
    ctx.expect.ok("version 2 differs from version 1", JSON.stringify(v2.v.result?.entries) !== JSON.stringify(v1.v.result?.entries), "identical entries");

    // Nothing is in the Library until the approval; then exactly one item, carrying the version picked.
    const before = await ctx.http({ as: p.instructor, path: "/api/instructor/tools/outputs?kind=lesson-hooks" });
    ctx.expect.ok("still not in the Library", !(before.body?.outputs || []).some((o) => new Date(o.created_at).getTime() >= startedAt), before.body?.outputs);
    const saved = await ctx.http({ as: p.instructor, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { version: 2 } });
    ctx.expect.eq("version 2 saved", saved.status, 201);
    const outputId = saved.body?.data?.outputId;
    ctx.expect.eq("it says which version it saved", saved.body?.data?.version, 2);
    if (!outputId) return;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.tool_outputs", { ownerColumn: "instructor_id", ownerId: teacher.id, filters: { id: outputId } }));
    const mine = ((await ctx.http({ as: p.instructor, path: "/api/instructor/tools/outputs?kind=lesson-hooks" })).body?.outputs || []).filter((o) => new Date(o.created_at).getTime() >= startedAt);
    ctx.expect.eq("exactly one Library item came of it", mine.length, 1);
    const full = await ctx.http({ as: p.instructor, path: `/api/instructor/tools/outputs/${outputId}` });
    ctx.expect.eq("the Library item carries version 2's content", JSON.stringify(full.body?.output?.content?.entries), JSON.stringify(v2.v.result?.entries));
  },
};
