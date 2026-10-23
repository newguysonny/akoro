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
import { teacherOf, toolsOf, lastCall, cleanSlate } from "./instructorTools.js";

const INSTRUCTOR = "@tester51";

const ESSAYS = [
  "Amaka: Plants make their own food by photosynthesis. They take in light, water and carbon dioxide, and they give out oxygen. This happens in the leaves because they contain chlorophyll.",
  "Tunde: Photosynthesis is when plants eat soil. They use the sun to dig deeper and make flowers.",
].join("\n---\n");

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
  grades: (c) => Array.isArray(c.grades) && c.grades.length === 2 && c.grades.every((g) => Number.isFinite(Number(g.score)) && Number(g.score) <= Number(g.outOf)),
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
  { key: "essay-grader", output: "grades", name: "Essay Grader",
    say: `Grade these two essays on photosynthesis for JSS1 Basic Science, out of 10. Marking scheme: 4 marks for correct science, 3 for explanation, 3 for clarity. Essays, separated by ---:\n${ESSAYS}`,
    // the rubric and the essay text must reach the tool's own fields
    check: (ctx, run) => {
      ctx.expect.ok("the rubric reached the tool", /marks/i.test(run.input?.rubric || ""), run.input);
      ctx.expect.ok("both essays reached the tool", /Amaka/.test(run.input?.essays || "") && /Tunde/.test(run.input?.essays || ""), run.input);
    },
    args: { tool: "essay-grader" } },
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
      if (run.result?.created === false && run.result?.code === "INSUFFICIENT_COINS") ctx.expect.blocked(`${p.instructor} can't pay for the tool: ${run.result.error}`);
      for (const [k, v] of Object.entries(c.args)) ctx.expect.eq(`the tool was given ${k}`, String(run.input?.[k] ?? ""), v);
      c.check?.(ctx, run);
      ctx.expect.ok("it was created", run.result?.created === true, run.result);
      ctx.expect.eq("it says where it was saved", run.result?.savedTo, "Library");

      // Saved for the instructor (the insert is fire-and-forget: give it a moment).
      const row = await ctx.until(async () => {
        const r = await ctx.http({ as: p.instructor, path: `/api/instructor/tools/outputs?kind=${c.key}` });
        return (r.body?.outputs || []).find((o) => new Date(o.created_at).getTime() >= startedAt) || null;
      }, { timeoutMs: 20_000, everyMs: 2_000 });
      ctx.expect.ok("it is in the Library list", !!row, `no ${c.key} output after the turn`);
      if (!row) return;
      ctx.cleanup(() => ctx.db.deleteOwned("edu.tool_outputs", { ownerColumn: "instructor_id", ownerId: teacher.id, filters: { id: row.id } }));
      ctx.expect.eq("filed under the teaching tool", row.tool, `teaching_${c.key}`);

      // The preview: what the Library opens.
      const full = await ctx.http({ as: p.instructor, path: `/api/instructor/tools/outputs/${row.id}` });
      ctx.expect.eq("it opens", full.status, 200);
      const body = full.body?.output?.content || {};
      ctx.expect.ok(`the saved result has the ${c.output} shape the viewer reads`, SHAPES[c.output](body), Object.keys(body));
      ctx.expect.ok("the saved result follows the shared template (title, entries of sections)", TEMPLATE(body), Object.keys(body));
      ctx.expect.ok("it also has the readable text", typeof body.content === "string" && body.content.length > 50, typeof body.content);
      // The same row, through the teaching tools' own listing (the older viewer path).
      const alt = await ctx.http({ as: p.instructor, path: `/api/teaching/tools/outputs/${row.id}` });
      ctx.expect.eq("it opens from the teaching tools listing too", alt.status, 200);
      ctx.expect.noBackendNames("reply has no backend names", turn.reply);
      ctx.expect.loopHealthy(turn);
    },
  };
}

export const teachingToolScenarios = CASES.map(toolScenario);
