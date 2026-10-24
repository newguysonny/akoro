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

/** An assigned activity and its review battle are the gate's to remove: battles, jobs, notifications, targets. */
export function cleanReviewedActivity(ctx, assignmentId) {
  ctx.cleanup(async () => {
    const db = (await import("../../../db.js")).default;
    const { data: bs } = await db.from("battles").select("id").eq("activity_assignment_id", assignmentId);
    const ids = (bs || []).map((b) => b.id);
    for (const id of ids) await db.schema("edu").from("deferred_jobs").delete().eq("job_key", `start-${id}`);
    if (ids.length) { await db.from("notifications").delete().in("related_id", ids); await db.from("battles").delete().in("id", ids); }
    await db.from("notifications").delete().eq("related_id", assignmentId);
    await db.schema("edu").from("deferred_jobs").delete().like("job_key", `activity-review-${assignmentId}%`);
    await db.schema("edu").from("self_study_targets").delete().eq("assignment_id", assignmentId);
    await db.schema("edu").from("self_study_assignments").delete().eq("id", assignmentId);
  });
}

/** A self study for 2 test learners, assigned with its review on (a day away, due in three). Cleans up after. */
async function assignWithReview(ctx) {
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
    if (!assignmentId) return {};
    cleanReviewedActivity(ctx, assignmentId);

    return { teacher, learners, assignmentId, db, runActivityReview, at, due };
}

export const activityReviewRuns = {
  name: "activity.review_battle", area: "activities", risk: "write", regression: false, timeoutMs: 300_000,
  description: "A self study assigned with its review battle: kept on the activity, the instruction line added, one class review battle sent to every learner's Challenges, starting at the review time; accept holds a seat, decline is a miss; the instructor's view follows each learner.",
  async run(ctx) {
    const { learners, assignmentId, runActivityReview, at } = await assignWithReview(ctx);
    if (!assignmentId) return;

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

/**
 * The class review played through: one learner taught their agent the topic,
 * the other didn't; both accept, the start is brought forward to now (what
 * the review time does), and the worker runs it. The taught agent answers
 * from its notes, the untaught one gives no answer (agents never guess); each
 * learner gets their own mark sheet and the instructor sees both done.
 */
export const activityReviewPlay = {
  name: "activity.review_battle_play", area: "activities", risk: "write", regression: false, timeoutMs: 600_000,
  description: "A class review battle played through: one learner taught their agent the topic, one didn't; both accept, the start is brought forward to now, the worker runs it; the taught agent answers, the untaught one gives no answer; each gets their own mark sheet, the instructor sees both done with marks.",
  async run(ctx) {
    const { learners, assignmentId, runActivityReview, db } = await assignWithReview(ctx);
    if (!assignmentId) return;
    const sent = await runActivityReview(assignmentId);
    const battleId = sent.battleId;
    if (!battleId) ctx.expect.blocked(`the class review wasn't sent: ${sent.skipped}`);

    // The first learner "submits and teaches": their agent gets a note on the topic (as a teaching
    // session writes one). The second taught it nothing. Agents answer only from their learner's notes.
    const [taught, untaught] = learners;
    const ks = await import("../../adaptive-learning/agents/student/knowledge.js");
    const { data: had } = await db.schema("edu").from("student_knowledge").select("id")
      .eq("student_id", taught.id).eq("topic", "Photosynthesis").eq("subtopic", "").maybeSingle();
    if (!had) {
      const agent = await ks.getOrCreateStudentAgent(taught.id);
      const note = await ks.saveStudentKnowledge({
        studentId: taught.id, agentId: agent?.id, topic: "Photosynthesis", subject: "Basic Science", confidence: 0.8,
        content: "Photosynthesis is how green plants make their own food (glucose) from carbon dioxide and water, using light energy trapped by chlorophyll in the chloroplasts of leaf cells. Word equation: carbon dioxide + water → (light, chlorophyll) → glucose + oxygen. Oxygen is released as a by-product through the stomata. Leaves are green because chlorophyll reflects green light and absorbs red and blue light. The raw materials are carbon dioxide (from the air, through the stomata) and water (from the soil, through the roots and xylem). The glucose is used for respiration (energy), stored as starch, or made into cellulose for cell walls. The rate rises with light intensity, carbon dioxide concentration and a suitable temperature.",
      });
      ctx.cleanup(() => note?.id && db.schema("edu").from("student_knowledge").delete().eq("id", note.id));
    } else ctx.note(`@${taught.username} already has a Photosynthesis note; it is used as is`);

    for (const l of learners) {
      const acc = await ctx.http({ as: `@${l.username}`, method: "POST", path: `/api/battle/challenges/${battleId}/accept` });
      ctx.expect.status(`@${l.username} accepts`, acc, 200);
    }

    // The review time, brought forward: the day-away start moves to now.
    const { cancelLater, addLater } = await import("../../../lib/deferredJobs.js");
    const { battleQueue } = await import("../../battle/worker.js");
    await cancelLater(battleQueue, `start-${battleId}`);
    const nowIso = new Date().toISOString();
    await db.from("battles").update({ scheduled_start: nowIso, expires_at: nowIso }).eq("id", battleId);
    await addLater(battleQueue, "start-battle", { action: "start-battle", battleId }, { delay: 2000, jobId: `start-${battleId}` });

    const live = await ctx.until(async () => {
      const [b] = await ctx.db.rows("battles", { id: battleId }, { columns: "status" });
      return ["live", "completed", "cancelled"].includes(b?.status) ? b.status : null;
    }, { timeoutMs: 90_000, everyMs: 3_000 });
    ctx.expect.ok("it starts at the (brought-forward) review time", live === "live" || live === "completed", { status: live });
    const seated = await ctx.db.rows("battle_participants", { battle_id: battleId }, { columns: "id, user_id, joined_at" });
    ctx.expect.eq("both learners' agents are in it", seated.filter((s) => s.joined_at).length, learners.length);

    const done = await ctx.until(async () => {
      const [b] = await ctx.db.rows("battles", { id: battleId }, { columns: "status" });
      return ["completed", "cancelled"].includes(b?.status) ? b.status : null;
    }, { timeoutMs: 420_000, everyMs: 5_000 });
    ctx.expect.eq("it plays through to the end", done, "completed");
    if (done !== "completed") return;

    const { data: answers } = await db.from("battle_answers").select("participant_id").in("participant_id", seated.map((x) => x.id));
    const seatOf = (l) => seated.find((x) => x.user_id === l.id)?.id;
    const { data: noAnswers } = await db.from("battle_log").select("user_id, message, meta_json").eq("battle_id", battleId).eq("event_type", "no_answer");
    const why = (l) => (noAnswers || []).filter((x) => x.user_id === l.id).map((x) => { try { return JSON.parse(x.meta_json || "{}").reason; } catch { return null; } });
    const answered = (l) => (answers || []).filter((x) => x.participant_id === seatOf(l)).length;
    ctx.expect.ok(`the taught agent (@${taught.username}) answers from its notes`, answered(taught) >= 1, { answered: answered(taught), noAnswer: why(taught) });
    ctx.expect.ok(`the untaught agent (@${untaught.username}) gives no answer, for want of notes (never a guess, never out of credit)`, answered(untaught) === 0 && why(untaught).length >= 1 && why(untaught).every((r) => r === "no_knowledge"), { answered: answered(untaught), noAnswer: why(untaught) });

    // Each learner's own mark sheet.
    for (const l of learners) {
      const r = await ctx.http({ as: `@${l.username}`, path: `/api/battle/battles/${battleId}/results` });
      ctx.expect.status(`@${l.username}'s results answer`, r, 200);
      ctx.expect.ok(`…as their own mark sheet`, r.body?.learner?.userId === l.id && (r.body?.score?.total ?? 0) >= 3 && Array.isArray(r.body?.markSheet) && r.body.markSheet.length === r.body.score.total, { learner: r.body?.learner, score: r.body?.score, keys: Object.keys(r.body || {}) });
    }

    // The Questions tab's "Download as PDF": the finished battle's questions as a PDF.
    const pdf = await ctx.http({ as: `@${taught.username}`, path: `/api/battle/battles/${battleId}/questions.pdf` });
    ctx.expect.ok("the questions download as a PDF once it has finished", pdf.status === 200 && /application\/pdf/.test(pdf.headers["content-type"] || "") && String(pdf.body).startsWith("%PDF-"), { status: pdf.status, type: pdf.headers["content-type"] });

    const v = await ctx.http({ as: BATTLE_INSTRUCTOR, path: `/api/self-study/${assignmentId}/reviews` });
    const reviews = v.body?.data?.reviews || [];
    ctx.expect.ok("the instructor sees both done, each with a mark", reviews.length === learners.length && reviews.every((r) => r.status === "done" && r.total >= 3 && r.correct != null), reviews);
    const markOf = (l) => reviews.find((r) => r.learnerId === l.id);
    ctx.expect.ok("…the taught learner's mark above the untaught one's", (markOf(taught)?.correct ?? 0) > (markOf(untaught)?.correct ?? 0), reviews.map((r) => [r.name, r.correct, r.total]));
  },
};
