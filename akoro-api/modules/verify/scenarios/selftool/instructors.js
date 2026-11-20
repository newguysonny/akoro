// Self-tooling instructor checks: instructor views, scopes, and agent-built tools.
import { needCreate } from "./shared.js";

/** Truth from the database: per activity of this instructor, completed students and their average grade. */
async function activityTruth(ctx, instructorId) {
  const acts = await ctx.db.rows("edu.self_study_assignments", { created_by: instructorId }, { columns: "id, title" });
  const out = [];
  for (const a of acts) {
    const t = (await ctx.db.rows("edu.self_study_targets", { assignment_id: a.id }, { columns: "status, grade" })).filter((x) => x.grade != null);
    out.push({ title: a.title, graded: t.length, avg: t.length ? t.reduce((n, x) => n + x.grade, 0) / t.length : null });
  }
  return out;
}
const rowFor = (rows, title) => rows.find((r) => Object.values(r).some((v) => v === title));
const hasNumberNear = (row, n, tol = 0.6) => Object.values(row || {}).some((v) => typeof v === "number" && Math.abs(v - n) <= tol);

export async function runInstructorToolMatchesDb(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.instructor);
    if (me.role !== "instructor") ctx.expect.blocked(`${p.instructor} isn't an instructor (seed 2026-seed-instructor-testers.sql)`);
    const truth = await activityTruth(ctx, me.id);
    if (!truth.length) ctx.expect.blocked("the instructor tester has no activities — seed missing");
    const { executeChatTool } = await import("../../../adaptive-learning/index.js");
    const { runDry } = await import("../../../../lib/dryRunContext.js");
    const r = await runDry(() => executeChatTool("create_tool", {
      goal: "Average grade and number of graded students for each of my activities", name: "activity_grade_summary", label: "Grades by activity",
      hint: { views: ["my_activity_results"] } }, me.id, { role: "instructor", channel: "verify" }));
    ctx.note(`definition: ${JSON.stringify(r?.definition || null).slice(0, 300)}`);
    ctx.expect.eq("created", r?.status, "created");
    const rows = r?.result?.rows || [];
    ctx.expect.ok("reads only instructor views", JSON.stringify(r?.definition || {}).includes("my_activity_results") && !/"my_(tasks|goals|chats|battles|weak_topics)"/.test(JSON.stringify(r?.definition || {})));
    for (const a of truth.filter((x) => x.graded)) {
      const row = rowFor(rows, a.title);
      ctx.expect.ok(`"${a.title}" is listed`, !!row, rows.slice(0, 5));
      ctx.expect.ok(`"${a.title}" average grade ${a.avg.toFixed(1)}`, hasNumberNear(row, a.avg), row);
    }
}

export async function runInstructorScope(ctx, p) {
    const A = await ctx.as(p.a), B = await ctx.as(p.b), L = await ctx.as(p.learner);
    if (A.role !== "instructor" || B.role !== "instructor") ctx.expect.blocked("instructor testers missing (seed 2026-seed-instructor-testers.sql)");
    const { readView } = await import("../../../self-tooling/index.js");
    const { validateDefinition } = await import("../../../self-tooling/index.js");
    const bResults = await readView("my_activity_results", B.id);
    const aResults = await readView("my_activity_results", A.id);
    ctx.expect.gte("instructor B sees their own results", bResults.length, 1);
    ctx.expect.ok("B never sees A's activities", bResults.every((r) => !String(r.activity || "").includes("Tester Class A")), bResults.map((r) => r.activity));
    ctx.expect.ok("A never sees B's activities", aResults.every((r) => !String(r.activity || "").includes("Tester Class B")), aResults.map((r) => r.activity));
    const bStudents = await readView("my_class_students", B.id);
    ctx.expect.ok("B's roster is only Class B", bStudents.length > 0 && bStudents.every((r) => r.class === "Tester Class B"), bStudents.map((r) => r.class));
    ctx.expect.ok("students by name only (no ids, emails or contact details)", bStudents.every((r) => Object.keys(r).every((k) => ["student", "class", "status", "joined_at"].includes(k))), Object.keys(bStudents[0] || {}));
    const learnerRows = await readView("my_activity_results", L.id);
    ctx.expect.eq("a learner owns no instructor results", learnerRows.length, 0);
    const v = await validateDefinition({ kind: "spec", from: "my_activity_results" }, {}, { audience: "learner" });
    ctx.expect.ok("learner tools can't use instructor views", v.errors.some((e) => /isn't available to learner tools/.test(e)), v.errors);
    const w = await validateDefinition({ kind: "spec", from: "my_tasks" }, {}, { audience: "instructor" });
    ctx.expect.ok("instructor tools can't use learner views", w.errors.some((e) => /isn't available to instructor tools/.test(e)), w.errors);
}

export async function runInstructorAgentBuilds(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.instructor);
    if (me.role !== "instructor") ctx.expect.blocked(`${p.instructor} isn't an instructor`);
    const truth = (await activityTruth(ctx, me.id)).filter((x) => x.graded);
    const turn = await ctx.agent.chat({ as: p.instructor, model: p.model,
      prompt: "What's the average grade on each of my activities, and how many students have been graded on each?" });
    ctx.expect.eq("turn answered", turn.status, 200);
    const built = (turn.tools || []).filter((t) => t.tool === "create_tool").at(-1);
    ctx.expect.ok("agent called create_tool", !!built, (turn.tools || []).map((t) => t.tool));
    ctx.expect.eq("tool built", built?.result?.status, "created");
    const rows = built?.result?.result?.rows || [];
    for (const a of truth) {
      const row = rowFor(rows, a.title);
      ctx.expect.ok(`"${a.title}" average ${a.avg.toFixed(1)} in the tool's answer`, hasNumberNear(row, a.avg), rows.slice(0, 4));
      // Graded students, not everyone assigned (an answer once said 5 when 3 were graded).
      ctx.expect.ok(`"${a.title}" ${a.graded} graded in the tool's answer`, hasNumberNear(row, a.graded, 0.01), row);
    }
    ctx.expect.noBackendNames("reply has no backend names", turn.reply);
    ctx.expect.loopHealthy(turn);
}
