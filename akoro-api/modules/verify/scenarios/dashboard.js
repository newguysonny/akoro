/**
 * Phase 11 and Phase 18 item 2 on a live server: the dashboard's descriptors
 * (one per open workflow run, computed from state, never from reply text,
 * with one deterministic route that carries the workflowId) and the one
 * "needs you" list (each run in exactly one category or none; counts equal
 * the lists; another learner sees none of it). The runs are made straight
 * through the engine on a test learner and removed by id afterwards.
 */
const engineFor = async () => {
  const [{ default: db }, { createWorkflowEngine }, { makeSupabaseWorkflowStore }] = await Promise.all([
    import("../../../db.js"), import("../../workflows/index.js"), import("../../workflows/index.js")]);
  // Registers every type (the engine refuses an unregistered one).
  await import("../../../lib/workflowRegistrations.js");
  return createWorkflowEngine({ store: makeSupabaseWorkflowStore(db) });
};

/** Make runs for a test learner (keyed with the run marker), removed by id at the end. */
async function seedRuns(ctx, me, specs) {
  const engine = await engineFor();
  const made = {};
  ctx.cleanup(async () => {
    for (const r of Object.values(made)) await ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: r.id } });
  });
  for (const [name, s] of Object.entries(specs)) {
    const parent = s.parent ? made[s.parent] : null;
    const { instance } = await engine.create({
      workflowType: s.type, learnerId: me.id, state: s.state, idempotencyKey: `${ctx.marker}:${name}`,
      ...(parent ? { parent: parent.id, source: { workflowId: parent.id } } : {}),
      metadata: { topic: `${ctx.marker} ${s.topic || name}`, subject: "Basic Science", ...(s.metadata || {}) },
    });
    made[name] = instance;
  }
  return made;
}

export const dashboardDescriptors = {
  name: "workflow.dashboard_descriptors", area: "workflows", risk: "write",
  description: "A test learner with open Study Prep, teaching, decay review and Agent Check runs: GET /api/workflows/dashboard lists one descriptor per open run (a finished one is not a card), each with a title, what it waits for, a state badge, progress and one route that names the modal/tab and carries its workflowId; GET /dashboard/:id gives the same; another learner gets 404.",
  params: { learner: { default: "@tester39" }, other: { default: "@tester40" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    await ctx.as(p.other);
    const runs = await seedRuns(ctx, me, {
      prep: { type: "study_prep", state: "topic_active", metadata: { subject: `${ctx.marker} Basic Science` } },
      teach: { type: "teaching", state: "teaching_active", parent: "prep", topic: "Evaporation", metadata: { focus: ["Evaporation vs transpiration"], progress: { done: 1, of: 3 } } },
      review: { type: "decay_review", state: "intervention", topic: "Photosynthesis", metadata: { retrieval: { round: 1, done: [] } } },
      check: { type: "practice", state: "running", topic: "Algebra", metadata: { kind: "agent_check", battleId: "00000000-0000-4000-8000-000000000000", answered: 2, total: 5 } },
      done: { type: "decay_review", state: "completed", topic: "Finished" },
    });
    const dash = await ctx.http({ as: p.learner, path: "/api/workflows/dashboard" });
    ctx.expect.status("the dashboard loads", dash, 200);
    const cards = new Map((dash.body?.workflows || []).map((d) => [d.workflowId, d]));
    ctx.expect.ok("one descriptor per open run", ["prep", "teach", "review", "check"].every((k) => cards.has(runs[k].id)), [...cards.keys()]);
    ctx.expect.ok("…and none for the finished one", !cards.has(runs.done.id));
    const want = { prep: "agent_chat", teach: "teaching_modal", review: "decay_review_modal", check: "battle" };
    for (const [k, surface] of Object.entries(want)) {
      const d = cards.get(runs[k].id);
      ctx.expect.eq(`${k}: its route opens ${surface}`, d?.action?.route?.surface, surface);
      ctx.expect.eq(`${k}: …with its workflowId`, d?.action?.route?.workflowId, runs[k].id);
      ctx.expect.ok(`${k}: title, waits-for and a badge`, !!d?.title && !!d?.waitsFor?.label && !!d?.badge?.label, d);
    }
    ctx.expect.eq("teaching: progress from its counted parts", cards.get(runs.teach.id)?.progress?.label, "1 of 3 parts taught");
    ctx.expect.eq("teaching: its source is the Study Prep run", cards.get(runs.teach.id)?.source?.workflowId, runs.prep.id);
    ctx.expect.ok("Agent Check: the route is the battle", /battle=00000000-0000-4000-8000-000000000000/.test(cards.get(runs.check.id)?.action?.route?.href || ""));
    const one = await ctx.http({ as: p.learner, path: `/api/workflows/dashboard/${runs.teach.id}` });
    ctx.expect.status("one descriptor by id", one, 200);
    ctx.expect.eq("…the same route as on the list", one.body?.workflow?.action?.route?.href, cards.get(runs.teach.id)?.action?.route?.href);
    const theirs = await ctx.http({ as: p.other, path: `/api/workflows/dashboard/${runs.teach.id}` });
    ctx.expect.eq("another learner can't read it", theirs.status, 404);
  },
};

export const needsYouCategories = {
  name: "workflow.needs_you_categories", area: "workflows", risk: "write",
  description: "Runs in a state for each category — teaching to start (answer), a plan to check (review), a teaching offer (decision), a paused plan (blocked) — and a healthy one: GET /api/workflows/needs-you lists each in exactly its category, leaves the healthy one out, every count equals its list, another learner's list holds none of them, and an instructor gets their own list.",
  params: { learner: { default: "@tester39" }, other: { default: "@tester40" }, instructor: { default: "@tester52" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    await ctx.as(p.other);
    const runs = await seedRuns(ctx, me, {
      answer: { type: "teaching", state: "scheduled", topic: "Evaporation" },
      review: { type: "study_prep", state: "awaiting_confirmation", metadata: { subject: `${ctx.marker} Maths` } },
      decision: { type: "teaching", state: "proposed", topic: "Condensation" },
      blocked: { type: "study_prep", state: "paused", metadata: { subject: `${ctx.marker} English` } },
      healthy: { type: "decay_review", state: "diagnostic", topic: "Cells" },
    });
    const res = await ctx.http({ as: p.learner, path: "/api/workflows/needs-you" });
    ctx.expect.status("the list loads", res, 200);
    const items = res.body?.items || [];
    const byRef = new Map(items.map((it) => [it.ref, it]));
    for (const cat of ["answer", "review", "decision", "blocked"]) {
      const it = byRef.get(`w:${runs[cat].id}`);
      ctx.expect.eq(`${cat}: in its category`, it?.category, cat);
      ctx.expect.ok(`${cat}: says whom it waits for and carries its action`, it?.waitsFor?.who === "you" && !!it?.action?.href, it);
    }
    ctx.expect.ok("a healthy run takes no row", !byRef.has(`w:${runs.healthy.id}`));
    const counts = res.body?.counts || {};
    for (const cat of ["answer", "review", "decision", "blocked", "failed"]) {
      ctx.expect.eq(`count of ${cat} = its list`, counts[cat], items.filter((it) => it.category === cat).length);
    }
    ctx.expect.eq("total = the list", counts.total, items.length);
    ctx.expect.ok("each row in exactly one category", new Set(items.map((it) => it.ref)).size === items.length);
    const theirs = await ctx.http({ as: p.other, path: "/api/workflows/needs-you" });
    ctx.expect.ok("another learner's list holds none of them", !(theirs.body?.items || []).some((it) => Object.values(runs).some((r) => it.ref === `w:${r.id}`)));
    const teacher = await ctx.http({ as: p.instructor, path: "/api/workflows/needs-you" });
    ctx.expect.status("an instructor's list loads", teacher, 200);
    ctx.expect.eq("…as the instructor's", teacher.body?.audience, "instructor");
    ctx.expect.eq("…its count = its list", teacher.body?.counts?.total, (teacher.body?.items || []).length);
    ctx.expect.ok("…with no learner's runs on it", !(teacher.body?.items || []).some((it) => it.source === "workflow"));
  },
};
