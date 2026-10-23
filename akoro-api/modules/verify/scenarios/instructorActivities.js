/**
 * The instructor's activity types, end to end from chat: the agent prepares a
 * draft, the instructor previews it, and it is assigned (or, for a battle,
 * created through the battle form) — then the data the instructor app reads
 * is checked: the Activities list, the learner's copy, the draft closed.
 *
 *   battle           draft → revise → the assign guard → battle created →
 *                    listed for instructor and learner (and as a study review)
 *   self study       draft → plan ready → revise the plan → assign → learner
 *                    starts and completes → progress on the Activities list
 *   assignment       draft → version 1 ready → assign → Activities list →
 *                    learner's copy → per-learner view
 *
 * Preconditions the sandbox may not have (a class with learners who have an
 * agent, the instructor's own agent, coins for questions) are BLOCKED with the
 * reason, never a silent pass.
 */
import { teacherOf, toolsOf, lastCall, talk, cleanSlate } from "./instructorTools.js";

const INSTRUCTOR = "@tester51";
const LEARNER = "@tester19";

const draftOf = async (ctx, as, id) => (await ctx.http({ as, path: `/api/self-study/drafts/${id}` })).body?.data?.draft || null;
const listOf = async (ctx, as) => {
  const r = await ctx.http({ as, path: "/api/self-study" });
  return Array.isArray(r.body?.data) ? r.body.data : [];
};

/** The assigned activity's rows are the gate's to remove, notifications included. */
function cleanAssigned(ctx, teacher, learner, id) {
  ctx.cleanup(() => ctx.db.deleteOwned("edu.self_study_assignments", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id } }));
  ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: learner.id, filters: { related_id: id } }));
}

/* ── Battle ─────────────────────────────────────────────────────────────── */

/** A class of the instructor's with test learners who have an agent (a battle needs agents). */
async function battleClass(ctx, as, need) {
  const classes = (await ctx.http({ as, path: "/api/instructor/classrooms" })).body?.data || [];
  for (const c of classes) {
    const roster = (await ctx.http({ as, path: `/api/instructor/classrooms/${c.id}/students` })).body?.data || [];
    const ok = roster.filter((r) => r.has_agent && /^tester\d+$/.test(r.username || ""));
    if (ok.length >= need) return { classroom: c, learners: ok.slice(0, need) };
  }
  return null;
}

function battleScenario({ key, mode, learnersNeeded, description }) {
  const review = mode === "review";
  return {
    name: `instructor.${key}`, area: "instructor-chat", risk: "write", description,
    params: { instructor: { default: INSTRUCTOR } },
    async run(ctx, p) {
      const teacher = await teacherOf(ctx, p.instructor);
      await cleanSlate(ctx, teacher);
      const found = await battleClass(ctx, p.instructor, learnersNeeded);
      if (!found) ctx.expect.blocked(`${p.instructor} has no class with ${learnersNeeded} test learner(s) who have an agent — a battle needs them`);
      const { classroom, learners } = found;
      const who = learners.map((l) => `@${l.username}`).join(" and ");
      const say = talk(ctx, p, teacher);

      // 1. Chat → a battle DRAFT (the agent drafts intent; the form completes it).
      const t1 = await say(`Set a battle on fractions for ${who} in ${classroom.name} (JSS1 Mathematics).`, "prepare");
      const prep = lastCall(t1, "prepare_activity");
      ctx.expect.ok("the agent called prepare_activity", !!prep, toolsOf(t1));
      ctx.expect.eq("it is a battle", prep?.input?.type, "battle");
      ctx.expect.toolNotCalled(t1, "run_teaching_tool");
      const draftId = prep?.result?.draftId;
      ctx.expect.ok("a draft was prepared", !!draftId, prep?.result);
      if (!draftId) return;

      // 2. Preview: what the instructor sees in the panel.
      let draft = await draftOf(ctx, p.instructor, draftId);
      ctx.expect.eq("the draft is a battle", draft?.type, "battle");
      ctx.expect.eq("still pending", draft?.status, "draft");
      ctx.expect.ok("it carries the topic", /fraction/i.test(`${draft?.topic || ""} ${draft?.payload?.details?.topic || ""}`), draft?.payload?.details);

      // 3. A conversational revision lands on the same draft.
      const t2 = await say("Make it a hard battle, and add the note: bring a calculator.", "revise");
      const rev = lastCall(t2, "revise_activity_draft");
      ctx.expect.ok("the agent revised the same draft", rev?.input?.draftId === draftId && rev?.success !== false, { tools: toolsOf(t2), input: rev?.input });
      ctx.expect.toolNotCalled(t2, "prepare_activity");
      draft = await draftOf(ctx, p.instructor, draftId);
      ctx.expect.eq("difficulty is hard", draft?.payload?.difficulty, "hard");
      ctx.expect.ok("the note is kept", /calculator/i.test(draft?.payload?.details?.note || ""), draft?.payload?.details);

      // 4. The approval guard: a battle can't be assigned like other activities.
      const guard = await ctx.http({ as: p.instructor, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { title: `${ctx.marker} guard` } });
      ctx.expect.eq("assigning a battle draft directly is refused", guard.status, 400);
      ctx.expect.eq("the draft is still pending after the refusal", (await draftOf(ctx, p.instructor, draftId))?.status, "draft");

      // 5. The battle form's own path: create the battle, then record it on the draft.
      const title = `${ctx.marker} Fractions ${review ? "review" : "battle"}`;
      const made = await ctx.http({ as: p.instructor, method: "POST", path: `/api/battle/classes/${classroom.id}/battles/invite`, body: {
        title, subject: "Mathematics", topic: "Fractions", difficulty: "hard", total_questions: 3,
        // the question bank, not AI generation: bounded in time (AI-filled questions can outlast the gate's request limit)
        time_limit_seconds: 600, xp_prize: 100, question_source: "bank", expires_in_minutes: 60,
        usernames: learners.map((l) => l.username), ...(review ? { mode: "review" } : {}),
      } });
      if (made.status >= 400 && made.status < 500) ctx.expect.blocked(`creating the battle was refused (${made.status}): ${made.body?.error || made.body?.message || "no reason given"}`);
      ctx.expect.ok("the battle was created", made.status >= 200 && made.status < 300, made.body);
      const battleId = made.body?.data?.battle?.id ?? made.body?.battle?.id ?? made.body?.data?.id ?? made.body?.id ?? null;
      ctx.expect.ok("it has an id", !!battleId, made.body);
      if (!battleId) return;
      ctx.cleanup(() => ctx.http({ as: p.instructor, method: "DELETE", path: `/api/battle/battles/${battleId}` }));
      for (const l of learners) {
        const acct = await ctx.as(`@${l.username}`);
        ctx.cleanup(() => ctx.db.deleteOwned("notifications", { ownerColumn: "user_id", ownerId: acct.id, filters: { related_id: battleId } }));
      }
      const closed = await ctx.http({ as: p.instructor, method: "PATCH", path: `/api/self-study/drafts/${draftId}`, body: { status: "assigned", assignment_id: battleId } });
      ctx.expect.eq("the draft records the battle", closed.status, 200);
      draft = await draftOf(ctx, p.instructor, draftId);
      ctx.expect.eq("the draft is closed as assigned", draft?.status, "assigned");
      ctx.expect.eq("…and points at the battle", draft?.assignment_id, battleId);

      // 6. The Activities page's data: the battle, in the right stage and shape.
      const mine = (await ctx.http({ as: p.instructor, path: "/api/battle/my-battles" })).body?.data || [];
      const row = mine.find((b) => b.id === battleId);
      ctx.expect.ok("it is on the instructor's battles list", !!row, mine.map((b) => b.title));
      ctx.expect.ok("it is in a stage the page shows", ["lobby", "scheduled", "live"].includes(row?.status), row?.status);
      ctx.expect.eq(review ? "it is a study review" : "it is a class battle (not a review)", review ? row?.type === "review" : row?.type !== "review", true);
      ctx.expect.ok("it can be edited and deleted by its owner", row?.mine === true, row?.mine);

      // 7. The learner is invited.
      const theirs = (await ctx.http({ as: `@${learners[0].username}`, path: "/api/battle/my-battles" })).body?.data || [];
      ctx.expect.ok("the learner sees it", theirs.some((b) => b.id === battleId), theirs.map((b) => b.title));
    },
  };
}

export const battleFromChat = battleScenario({
  key: "battle_from_chat", mode: "battle", learnersNeeded: 2,
  description: "A class battle set in chat: drafted, revised, refused by the direct-assign guard, created through the battle form, closed on the draft, and listed for the instructor and the learner.",
});
export const battleReviewFromChat = battleScenario({
  key: "battle_review_from_chat", mode: "review", learnersNeeded: 1,
  description: "The same flow as a study review for one learner: created in review mode and listed as a review.",
});

/* ── Self study ─────────────────────────────────────────────────────────── */

export const selfStudyFull = {
  name: "instructor.self_study_full", area: "instructor-chat", risk: "write",
  description: "A self study set in chat: the plan is written, revised in conversation, assigned, seen by the learner, started and completed — and the Activities list shows each step.",
  params: { instructor: { default: INSTRUCTOR }, learner: { default: LEARNER } },
  async run(ctx, p) {
    const teacher = await teacherOf(ctx, p.instructor);
    await cleanSlate(ctx, teacher);
    const learner = await ctx.as(p.learner);
    const say = talk(ctx, p, teacher);

    // 1. Chat → draft, with a due date.
    const t1 = await say(`Set a Basic Science self study on photosynthesis for @${learner.username} (JSS1), due next Friday at 5pm.`, "prepare");
    const prep = lastCall(t1, "prepare_activity");
    ctx.expect.ok("the agent called prepare_activity", !!prep, toolsOf(t1));
    ctx.expect.eq("it is a self study", prep?.input?.type, "self_study");
    ctx.expect.toolNotCalled(t1, "run_teaching_tool");
    const draftId = prep?.result?.draftId;
    ctx.expect.ok("a draft was prepared", !!draftId, prep?.result);
    if (!draftId) return;

    // 2. Preview: the study plan is written in the background — wait for it.
    const ready = await ctx.until(async () => {
      const d = await draftOf(ctx, p.instructor, draftId);
      return ["ready", "fallback"].includes(d?.payload?.plan_status) ? d : null;
    }, { timeoutMs: 120_000, everyMs: 4_000 });
    ctx.expect.ok("the study plan finished", !!ready, "still pending after 2 minutes");
    if (!ready) return;
    ctx.expect.eq("the plan was generated (not the fallback)", ready.payload.plan_status, "ready");
    const plan = ready.payload.subtopics || [];
    ctx.expect.gte("the plan has several subtopics", plan.length, 3);
    ctx.expect.ok("every subtopic has objectives", plan.every((s) => (ready.payload.objectives?.[s] || []).length >= 1), ready.payload.objectives);
    ctx.expect.ok("a due date was captured", !!(ready.payload.due_at || ready.payload.due_hint), { due_at: ready.payload.due_at, due_hint: ready.payload.due_hint });
    ctx.expect.eq("the draft names the subject", ready.subject, "Basic Science");

    // 3. Revise the plan in conversation: the full list comes back with the change.
    const t2 = await say("Add a subtopic on the light reactions, and make it hard.", "revise");
    const rev = lastCall(t2, "revise_activity_draft");
    ctx.expect.ok("the agent revised the same draft", rev?.input?.draftId === draftId && rev?.success !== false, { tools: toolsOf(t2), input: rev?.input });
    ctx.expect.toolNotCalled(t2, "prepare_activity");
    const revised = await draftOf(ctx, p.instructor, draftId);
    ctx.expect.ok("the new subtopic is in the plan", (revised?.payload?.subtopics || []).some((s) => /light/i.test(s)), revised?.payload?.subtopics);
    const kept = plan.filter((s) => !(revised?.payload?.subtopics || []).includes(s));
    ctx.expect.eq("every earlier subtopic is kept (adding must not replace the plan)", kept, []);
    ctx.expect.eq("exactly one entry was added", (revised?.payload?.subtopics || []).length, plan.length + 1);
    ctx.expect.eq("difficulty is hard", revised?.payload?.difficulty, "hard");

    // 4. The instructor assigns it (the Assign tap on the preview).
    const made = await ctx.http({ as: p.instructor, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { title: `${ctx.marker} Photosynthesis` } });
    ctx.expect.eq("assigned", made.status, 201);
    const id = made.body?.data?.id;
    ctx.expect.ok("an activity was created", !!id, made.body);
    if (!id) return;
    cleanAssigned(ctx, teacher, learner, id);
    const closed = await draftOf(ctx, p.instructor, draftId);
    ctx.expect.eq("the draft is closed as assigned", closed?.status, "assigned");

    // 5. The learner has it, and was told.
    const copy = ((await ctx.http({ as: p.learner, path: "/api/self-study/mine" })).body?.data || []).find((a) => a.id === id);
    ctx.expect.ok("it is on the learner's list", !!copy, id);
    ctx.expect.eq("as a self study", copy?.type || "self_study", "self_study");
    ctx.expect.gte("the learner was notified", await ctx.db.count("notifications", { user_id: learner.id, related_id: id }), 1);

    // 6. The Activities list (what the instructor's page reads) and the per-learner view.
    let row = (await listOf(ctx, p.instructor)).find((a) => a.id === id);
    ctx.expect.ok("it is on the Activities list", !!row, id);
    ctx.expect.eq("typed self_study", row?.type || "self_study", "self_study");
    ctx.expect.eq("one learner assigned", row?.progress?.assigned, 1);
    ctx.expect.eq("none done yet", row?.progress?.complete, 0);
    const detail = await ctx.http({ as: p.instructor, path: `/api/self-study/${id}` });
    ctx.expect.eq("the per-learner view opens", detail.status, 200);
    ctx.expect.ok("it lists the learner", (detail.body?.data?.targets || []).some((t) => t.student_id === learner.id), detail.body?.data?.targets);

    // 7. The learner works through it — the list follows.
    const started = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${id}/start`, body: {} });
    ctx.expect.ok("the learner started it", started.status >= 200 && started.status < 300, started.body);
    row = (await listOf(ctx, p.instructor)).find((a) => a.id === id);
    ctx.expect.eq("one started", row?.progress?.started, 1);
    const done = await ctx.http({ as: p.learner, method: "POST", path: `/api/self-study/${id}/complete`, body: { text: "Plants make food from light, water and carbon dioxide." } });
    ctx.expect.eq("the learner completed it", done.status, 200);
    row = (await listOf(ctx, p.instructor)).find((a) => a.id === id);
    ctx.expect.eq("one complete — the Completed stage", row?.progress?.complete, 1);
  },
};

/* ── Assignment ─────────────────────────────────────────────────────────── */

export const assignmentPreviewAssign = {
  name: "instructor.assignment_preview_assign", area: "instructor-chat", risk: "write",
  description: "An assignment set in chat: version 1 is written, previewed with its summary, assigned, and appears on the Activities list, the learner's copy and the per-learner view.",
  params: { instructor: { default: INSTRUCTOR }, learner: { default: LEARNER } },
  async run(ctx, p) {
    const teacher = await teacherOf(ctx, p.instructor);
    await cleanSlate(ctx, teacher);
    const learner = await ctx.as(p.learner);
    const say = talk(ctx, p, teacher);

    const t1 = await say(`Prepare a Basic Science assignment on photosynthesis for @${learner.username} (JSS1): 3 questions — 2 MCQ and 1 short answer.`, "prepare");
    const prep = lastCall(t1, "prepare_activity");
    ctx.expect.ok("the agent called prepare_activity", !!prep, toolsOf(t1));
    ctx.expect.eq("it is an assignment", prep?.input?.type, "assignment");
    ctx.expect.toolNotCalled(t1, "run_teaching_tool");
    const draftId = prep?.result?.draftId;
    ctx.expect.ok("a draft was prepared", !!draftId, prep?.result);
    if (!draftId) return;

    // Preview: version 1 drafts in the background; what the panel shows.
    const v1 = await ctx.until(async () => {
      const v = ((await draftOf(ctx, p.instructor, draftId))?.payload?.versions || [])[0];
      return v && v.status !== "drafting" ? v : null;
    }, { timeoutMs: 150_000, everyMs: 5_000 });
    ctx.expect.eq("version 1 is ready", v1?.status, "ready");
    if (v1?.status !== "ready") return;
    const qs = v1.paper?.questions || [];
    ctx.expect.eq("3 questions", qs.length, 3);
    ctx.expect.eq("2 multiple choice", qs.filter((q) => Array.isArray(q.options)).length, 2);
    ctx.expect.ok("the preview has a summary line", !!v1.summary?.line, v1.summary);
    ctx.expect.eq("no warning for the teacher", v1.warning || null, null);

    const made = await ctx.http({ as: p.instructor, method: "POST", path: `/api/self-study/drafts/${draftId}/assign`, body: { title: `${ctx.marker} Photosynthesis`, version: 1 } });
    ctx.expect.eq("assigned", made.status, 201);
    const id = made.body?.data?.id;
    ctx.expect.ok("an activity was created", !!id, made.body);
    if (!id) return;
    cleanAssigned(ctx, teacher, learner, id);
    ctx.expect.eq("the draft is closed as assigned", (await draftOf(ctx, p.instructor, draftId))?.status, "assigned");

    const row = (await listOf(ctx, p.instructor)).find((a) => a.id === id);
    ctx.expect.ok("it is on the Activities list", !!row, id);
    ctx.expect.eq("typed assignment", row?.type, "assignment");
    ctx.expect.eq("one learner assigned", row?.progress?.assigned, 1);
    const copy = ((await ctx.http({ as: p.learner, path: "/api/self-study/mine" })).body?.data || []).find((a) => a.id === id);
    ctx.expect.eq("the learner's copy has the questions", (copy?.details?.questions || []).length, 3);
    const detail = await ctx.http({ as: p.instructor, path: `/api/self-study/${id}` });
    ctx.expect.ok("the per-learner view lists the learner", (detail.body?.data?.targets || []).some((t) => t.student_id === learner.id), detail.body?.data?.targets);
    ctx.expect.gte("the learner was notified", await ctx.db.count("notifications", { user_id: learner.id, related_id: id }), 1);
  },
};
