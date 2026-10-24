/**
 * An activity's review battle (reference/Akoro Activity + Review — Plan.md):
 * a self study assigned from its draft with the review on; the review is kept
 * on the activity, the instructions gain the line, the runs wait in Postgres;
 * a run makes each learner's review (an Agent Check hosted by the teacher,
 * linked to the activity) once, SENT AS A CHALLENGE: it shows in the
 * learner's Challenges list and waits for them; accepting starts it; the
 * instructor's view lists them (sent, then running).
 *
 * The run is made in-process (runActivityReview, what the battle worker runs
 * at the review time), so the gate needn't wait for the clock.
 */
import { battleClass, BATTLE_INSTRUCTOR } from "./instructorActivities.js";
import { teacherOf, cleanSlate } from "./instructorTools.js";

export const activityReviewRuns = {
  name: "activity.review_battle", area: "activities", risk: "write", regression: false, timeoutMs: 300_000,
  description: "A self study assigned with its review battle: kept on the activity, the instruction line added, runs queued at the review time and the due date; a run reviews each learner once (a teacher-hosted Agent Check); the instructor's view lists them.",
  async run(ctx) {
    const probe = await ctx.db.probe("edu.self_study_targets", "id, review_battle_id");
    if (!probe.ok) ctx.expect.blocked(`no review_battle_id yet (migration 2026-activity-review.sql): ${probe.error}`);
    const teacher = await teacherOf(ctx, BATTLE_INSTRUCTOR);
    await cleanSlate(ctx, teacher);
    const found = await battleClass(ctx, BATTLE_INSTRUCTOR, 2);
    if (!found) ctx.expect.blocked(`${BATTLE_INSTRUCTOR} has no class with 2 test learners who have an agent`);
    const { classroom, learners } = found;
    const db = (await import("../../../db.js")).default;
    const { createActivityDraft } = await import("../../self-study/drafts.js");
    const { runActivityReview } = await import("../../self-study/activityReview.js");

    // A self-study draft, as the chat makes one.
    const { draft } = await createActivityDraft({
      instructor: { id: teacher.id, role: "instructor" }, channel: "verify",
      input: { type: "self_study", title: `${ctx.marker} Photosynthesis`, subject: "Basic Science", topic: "Photosynthesis",
        audience: { classroom_id: classroom.id, usernames: learners.map((l) => l.username) } },
    });
    ctx.cleanup(() => ctx.db.deleteOwned("activity_drafts", { ownerColumn: "created_by", ownerId: teacher.id, filters: { id: draft.id } }));

    // Assign it with the review on: the review a day from now, due in three.
    const at = new Date(Date.now() + 86400_000).toISOString();
    const due = new Date(Date.now() + 3 * 86400_000).toISOString();
    const res = await ctx.http({ as: BATTLE_INSTRUCTOR, method: "POST", path: `/api/self-study/drafts/${draft.id}/assign`, body: { due_at: due, review: { on: true, at, questions: 5 } } });
    ctx.expect.status("assigned", res, 201);
    const assignmentId = res.body?.data?.id;
    if (!assignmentId) return;
    ctx.cleanup(async () => {
      const { data: bs } = await db.from("battles").select("id").eq("activity_assignment_id", assignmentId);
      const ids = (bs || []).map((b) => b.id);
      if (ids.length) { await db.from("notifications").delete().in("related_id", ids); await db.from("battles").delete().in("id", ids); }
      await db.schema("edu").from("deferred_jobs").delete().like("job_key", `activity-review-${assignmentId}-%`);
      await db.schema("edu").from("self_study_targets").delete().eq("assignment_id", assignmentId);
      await db.schema("edu").from("self_study_assignments").delete().eq("id", assignmentId);
    });

    const [a] = await ctx.db.rows("edu.self_study_assignments", { id: assignmentId }, { columns: "details, instructions, due_at" });
    ctx.expect.eq("the review is kept on the activity", [a?.details?.review?.on, a?.details?.review?.questions, new Date(a?.details?.review?.at).getTime()], [true, 5, new Date(at).getTime()]);
    ctx.expect.ok("the learners' instructions gain the line", /After you submit, teach your agent this topic: your review battle is on/.test(a?.instructions || ""), a?.instructions);
    const waits = await ctx.db.rows("edu.deferred_jobs", { job_key: { like: `activity-review-${assignmentId}-%` } }, { columns: "job_key, due_at" });
    ctx.expect.eq("two runs wait in Postgres: the review time (submitters) and the due date (everyone left)", waits.map((w) => w.job_key.split("-").pop()).sort(), ["all", "submitted"]);

    // Nobody has submitted: the review-time run reviews nobody; the due-date run reviews everyone.
    const first = await runActivityReview(assignmentId, "submitted");
    ctx.expect.eq("at the review time, nobody had submitted: no reviews", first.reviewed, 0);
    const second = await runActivityReview(assignmentId, "all");
    if (second.reviewed === 0 && second.skipped) ctx.expect.blocked(`no review could be made (${second.skipped} skipped — see the logs: agents or question writing)`);
    ctx.expect.eq("at the due date, each learner is reviewed", second.reviewed, learners.length);
    const targets = await ctx.db.rows("edu.self_study_targets", { assignment_id: assignmentId }, { columns: "student_id, review_battle_id" });
    ctx.expect.ok("each learner's review is recorded", targets.every((t) => !!t.review_battle_id), targets);
    const battles = await ctx.db.rows("battles", { activity_assignment_id: assignmentId }, { columns: "id, battle_type, review_host, xp_prize, title" });
    ctx.expect.ok("each is an Agent Check hosted by the teacher, linked to the activity, with no prize", battles.length === learners.length && battles.every((b) => b.battle_type === "check" && b.review_host === "teacher" && b.xp_prize === 0), battles);
    const third = await runActivityReview(assignmentId, "all");
    ctx.expect.eq("a repeat run reviews nobody twice", third.reviewed, 0);

    // Sent as a challenge: waiting in the learner's Challenges, not started on its own.
    const mine = battles.find((b) => b.id === targets.find((t) => t.student_id === learners[0].id)?.review_battle_id);
    const seat = await ctx.db.rows("battle_participants", { battle_id: mine?.id }, { columns: "role, joined_at" });
    ctx.expect.ok("the review waits for the learner (an unanswered seat, nothing started)", seat.length === 1 && seat[0].role === "participant" && !seat[0].joined_at, seat);
    const list = await ctx.http({ as: `@${learners[0].username}`, path: "/api/battle/my-challenges" });
    ctx.expect.status("the learner's Challenges list answers", list, 200);
    const card = (list.body?.data || []).find((c) => c.id === mine?.id);
    ctx.expect.ok("…and shows the review, set by the teacher, at no coin cost", !!card && card.type === "check" && card.reviewHost === "teacher" && card.hostRole === "teacher" && card.entry?.coins === 0, card || (list.body?.data || []).map((c) => c.title));

    const view = await ctx.http({ as: BATTLE_INSTRUCTOR, path: `/api/self-study/${assignmentId}/reviews` });
    ctx.expect.status("the instructor's view answers", view, 200);
    ctx.expect.eq("…listing each learner's review as sent to their Challenges", (view.body?.data?.reviews || []).filter((r) => r.battleId).map((r) => r.status), learners.map(() => "sent"));

    // The learner accepts it: it starts (a review is one learner; it isn't cancelled for having one player).
    const acc = await ctx.http({ as: `@${learners[0].username}`, method: "POST", path: `/api/battle/challenges/${mine?.id}/accept` });
    ctx.expect.status("the learner accepts the review", acc, 200);
    const [after] = await ctx.db.rows("battles", { id: mine?.id }, { columns: "status" });
    ctx.expect.ok("…and it isn't cancelled", after && after.status !== "cancelled", after);
    const view2 = await ctx.http({ as: BATTLE_INSTRUCTOR, path: `/api/self-study/${assignmentId}/reviews` });
    ctx.expect.ok("the instructor sees it running (or done)", ["running", "done"].includes((view2.body?.data?.reviews || []).find((r) => r.battleId === mine?.id)?.status), view2.body?.data?.reviews);
  },
};
