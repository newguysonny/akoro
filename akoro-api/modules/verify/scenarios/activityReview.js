/**
 * An activity's review battle (reference/Akoro Activity + Review — Plan.md):
 * a self study assigned from its draft with the review on; the review is kept
 * on the activity, the instructions gain the line, and ONE class review battle
 * is sent: a teacher-hosted Agent Check with a seat for each learner, in their
 * Challenges list until the review time, when it starts with whoever accepted.
 * Accepting holds the seat (it doesn't start early); declining is a miss; the
 * instructor's view follows each learner.
 *
 * The send is made in-process (runActivityReview, what the battle worker runs
 * on assign), so the gate needn't wait for the worker; it never waits for the
 * start (a day away).
 */
import { battleClass, BATTLE_INSTRUCTOR } from "./instructorActivities.js";
import { teacherOf, cleanSlate } from "./instructorTools.js";

export const activityReviewRuns = {
  name: "activity.review_battle", area: "activities", risk: "write", regression: false, timeoutMs: 300_000,
  description: "A self study assigned with its review battle: kept on the activity, the instruction line added, one class review battle sent to every learner's Challenges, starting at the review time; accept holds a seat, decline is a miss; the instructor's view follows each learner.",
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
      for (const id of ids) await db.schema("edu").from("deferred_jobs").delete().eq("job_key", `start-${id}`);
      if (ids.length) { await db.from("notifications").delete().in("related_id", ids); await db.from("battles").delete().in("id", ids); }
      await db.from("notifications").delete().eq("related_id", assignmentId);
      await db.schema("edu").from("deferred_jobs").delete().like("job_key", `activity-review-${assignmentId}%`);
      await db.schema("edu").from("self_study_targets").delete().eq("assignment_id", assignmentId);
      await db.schema("edu").from("self_study_assignments").delete().eq("id", assignmentId);
    });

    const [a] = await ctx.db.rows("edu.self_study_assignments", { id: assignmentId }, { columns: "details, instructions, due_at" });
    ctx.expect.eq("the review is kept on the activity", [a?.details?.review?.on, a?.details?.review?.questions, new Date(a?.details?.review?.at).getTime()], [true, 5, new Date(at).getTime()]);
    ctx.expect.ok("the learners' instructions gain the line", /your class review battle is on .+ Accept it in your Challenges before it starts\./.test(a?.instructions || ""), a?.instructions);

    // The send (the worker runs it on assign; here in-process, so a racing worker run is fine: once per activity).
    const sent = await runActivityReview(assignmentId);
    const battleId = sent.battleId;
    if (!battleId && sent.skipped) ctx.expect.blocked(`the class review wasn't sent: ${sent.skipped}`);
    ctx.expect.ok("one class review is sent to every learner (or was, by the worker)", sent.sent === learners.length || sent.skipped === "already sent", sent);
    const again = await runActivityReview(assignmentId);
    ctx.expect.eq("a repeat run sends nothing twice", [again.sent, again.battleId], [0, battleId]);

    const battles = await ctx.db.rows("battles", { activity_assignment_id: assignmentId }, { columns: "id, battle_type, review_host, xp_prize, status, scheduled_start, expires_at, max_participants" });
    const b = battles[0];
    ctx.expect.ok("ONE battle for the class: a teacher-hosted Agent Check, no prize, a seat each", battles.length === 1 && b.battle_type === "check" && b.review_host === "teacher" && b.xp_prize === 0 && b.max_participants === learners.length, battles);
    ctx.expect.ok("it starts at the review time, and the accept window closes then", b?.status === "scheduled" && Math.abs(Date.parse(b.scheduled_start) - Date.parse(at)) < 1000 && Math.abs(Date.parse(b.expires_at) - Date.parse(at)) < 1000, b);
    const seats = await ctx.db.rows("battle_participants", { battle_id: battleId }, { columns: "user_id, role, joined_at" });
    ctx.expect.ok("every learner has an unanswered seat", seats.length === learners.length && seats.every((s) => s.role === "participant" && !s.joined_at) && learners.every((l) => seats.some((s) => s.user_id === l.id)), seats);
    const targets = await ctx.db.rows("edu.self_study_targets", { assignment_id: assignmentId }, { columns: "student_id, review_battle_id" });
    ctx.expect.ok("each learner's review is recorded as the class battle", targets.length === learners.length && targets.every((t) => t.review_battle_id === battleId), targets);

    // In each learner's Challenges list.
    for (const l of learners) {
      const list = await ctx.http({ as: `@${l.username}`, path: "/api/battle/my-challenges" });
      const card = (list.body?.data || []).find((c) => c.id === battleId);
      ctx.expect.ok(`@${l.username}'s Challenges list shows the class review, set by the teacher, at no coin cost`, !!card && card.battleType === "review" && card.reviewHost === "teacher" && card.hostRole === "teacher" && card.entry?.coins === 0 && card.maxParticipants === learners.length, card || (list.body?.data || []).map((c) => c.title));
    }
    const statuses = async () => {
      const v = await ctx.http({ as: BATTLE_INSTRUCTOR, path: `/api/self-study/${assignmentId}/reviews` });
      return Object.fromEntries((v.body?.data?.reviews || []).map((r) => [r.learnerId, r.status]));
    };
    ctx.expect.eq("the instructor sees everyone sent", Object.values(await statuses()), learners.map(() => "sent"));

    // One accepts: they're in, and it waits for its time (not started early, not cancelled).
    const [A, B] = learners;
    const acc = await ctx.http({ as: `@${A.username}`, method: "POST", path: `/api/battle/challenges/${battleId}/accept` });
    ctx.expect.status(`@${A.username} accepts`, acc, 200);
    // The other declines: a miss; the battle still runs at its time for whoever is in.
    const dec = await ctx.http({ as: `@${B.username}`, method: "POST", path: `/api/battle/challenges/${battleId}/decline` });
    ctx.expect.status(`@${B.username} declines`, dec, 200);
    const [after] = await ctx.db.rows("battles", { id: battleId }, { columns: "status" });
    ctx.expect.eq("it still waits for the review time", after?.status, "scheduled");
    const s2 = await statuses();
    ctx.expect.eq("the instructor sees one accepted, one missed", [s2[A.id], s2[B.id]], ["accepted", "missed"]);
  },
};
