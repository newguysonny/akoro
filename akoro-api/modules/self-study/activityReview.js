/**
 * self-study/activityReview.js — the review battle an assignment or self
 * study comes with (reference/Akoro Activity + Review — Plan.md).
 *
 * On assign (drafts.js assignActivityDraft) the instructor's choice is kept on
 * the activity (details.review = { on, at, questions }), the learners'
 * instructions gain one line, and the runs are queued (Postgres-held, so a
 * review days away costs no Redis):
 *
 *   at the review time   every learner who has SUBMITTED gets their review
 *   at the due date      everyone not reviewed yet (the decision: a learner
 *                        who hasn't submitted is reviewed at the due date)
 *
 * (When the review time is at or after the due date, one run reviews
 * everyone.) A review is an Agent Check (battle/agentCheck.js) hosted by the
 * teacher: the learner's protégé answers questions written from the
 * activity's topic, concepts and objectives; a mark sheet, not graded.
 * Each learner is reviewed once (self_study_targets.review_battle_id).
 */
import db from "../../db.js";
import { addLater } from "../../lib/deferredJobs.js";

const edu = () => db.schema("edu");
const invalid = (message, status = 400) => Object.assign(new Error(message), { status });
export const REVIEW_LIMITS = Object.freeze({ MIN_Q: 5, MAX_Q: 10, DEFAULT_Q: 8 });
const REVIEWABLE = ["assignment", "self_study", "project"];

/** PURE: the instructor's choice → what is kept, or null (no review). Throws when it can't run. */
export function cleanReview(review, { dueAt = null, now = Date.now() } = {}) {
  if (!review || review.on === false) return null;
  const at = review.at ? new Date(review.at) : dueAt ? new Date(dueAt) : null;
  if (!at || Number.isNaN(at.getTime())) throw invalid("Set when the review battle runs, or give the activity a due date.");
  if (at.getTime() < now - 60_000) throw invalid("The review battle's time has passed — pick a later one.");
  const q = Math.round(Number(review.questions) || REVIEW_LIMITS.DEFAULT_Q);
  return { on: true, at: at.toISOString(), questions: Math.min(REVIEW_LIMITS.MAX_Q, Math.max(REVIEW_LIMITS.MIN_Q, q)) };
}

/** PURE: the runs to queue. → [{ at, who: 'submitted' | 'all' }] */
export function reviewRuns({ at, dueAt = null }) {
  const a = new Date(at).getTime(), d = dueAt ? new Date(dueAt).getTime() : null;
  return d && d > a ? [{ at: new Date(a).toISOString(), who: "submitted" }, { at: new Date(d).toISOString(), who: "all" }] : [{ at: new Date(a).toISOString(), who: "all" }];
}

/** PURE: the line the learners' instructions gain. */
export function reviewInstruction(at, tz = "Africa/Lagos") {
  const when = new Date(at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz });
  return `After you submit, teach your agent this topic: your review battle is on ${when}.`;
}

/** PURE: who a run reviews. targets: [{ student_id, status, submission, review_battle_id }] */
export function dueForReview(targets, who) {
  return (targets || []).filter((t) => !t.review_battle_id && (who === "all" || t.status === "complete" || !!t.submission?.submittedAt)).map((t) => t.student_id);
}

async function queue() { return (await import("../battle/worker.js")).battleQueue; }

/** On assign: keep the choice, queue the runs. → the kept review, or null */
export async function scheduleActivityReview(assignment, review) {
  if (!review || !REVIEWABLE.includes(assignment.type)) return null;
  const details = { ...(assignment.details || {}), review };
  await edu().from("self_study_assignments").update({ details }).eq("id", assignment.id);
  const q = await queue();
  for (const run of reviewRuns({ at: review.at, dueAt: assignment.due_at })) {
    await addLater(q, "activity-review", { action: "activity-review", assignmentId: assignment.id, who: run.who },
      { delay: Math.max(0, Date.parse(run.at) - Date.now()), jobId: `activity-review-${assignment.id}-${run.who}` });
  }
  return review;
}

async function notify(userId, title, content, relatedId) {
  await db.from("notifications").insert({ user_id: userId, type: "activity_review", title, content, related_id: relatedId });
  global.io?.to(`user:${userId}`).emit("notification", { type: "activity_review", title, content, relatedId });
}

/** The worker's job: make the reviews this run owes. → { reviewed, skipped } */
export async function runActivityReview(assignmentId, who = "all") {
  const { data: a } = await edu().from("self_study_assignments")
    .select("id, type, title, subject, topic, subtopics, created_by, due_at, details").eq("id", assignmentId).maybeSingle();
  if (!a || !a.details?.review?.on) return { reviewed: 0, skipped: "no review" };
  const { data: targets } = await edu().from("self_study_targets")
    .select("id, student_id, status, submission, review_battle_id").eq("assignment_id", assignmentId);
  const learners = dueForReview(targets, who);
  const { createCheckBattle } = await import("../battle/agentCheck.js");
  const { reviewFocus } = await import("../battle/guideReview.js");
  const topic = reviewFocus(a.topic || a.title, Array.isArray(a.subtopics) ? a.subtopics : []);
  let reviewed = 0;
  const skipped = [];
  for (const learnerId of learners) {
    try {
      const made = await createCheckBattle({
        learnerId, subject: a.subject, topic, total: a.details.review.questions || REVIEW_LIMITS.DEFAULT_Q,
        title: `Review: ${a.title}`,
        extra: { review_host: "teacher", requested_by: a.created_by, activity_assignment_id: a.id },
      });
      await edu().from("self_study_targets").update({ review_battle_id: made.battleId }).eq("assignment_id", a.id).eq("student_id", learnerId);
      await notify(learnerId, `Your review battle is starting: ${a.title}`, "Your agent answers what you taught it. A mark sheet for you and your teacher — it doesn't count toward your grade.", made.battleId);
      reviewed++;
    } catch (e) {
      skipped.push({ learnerId, why: e.message });
      if (e.status === 409) await notify(learnerId, `Your review for ${a.title} couldn't run`, "Create your agent first: the review is your agent answering.", a.id).catch(() => {});
    }
  }
  if (skipped.length) console.warn(`[activity-review] ${a.id} ${who}: ${skipped.length} skipped`, skipped.slice(0, 3));
  return { reviewed, skipped: skipped.length };
}

/** The instructor's view: each learner's review and its mark. */
export async function activityReviews(assignmentId) {
  const { data: targets } = await edu().from("self_study_targets").select("student_id, review_battle_id").eq("assignment_id", assignmentId);
  const ids = (targets || []).map((t) => t.review_battle_id).filter(Boolean);
  const { data: battles } = ids.length ? await db.from("battles").select("id, status").in("id", ids) : { data: [] };
  const statusOf = new Map((battles || []).map((b) => [b.id, b.status]));
  const { checkResults } = await import("../battle/agentCheck.js");
  const out = [];
  for (const t of targets || []) {
    if (!t.review_battle_id) { out.push({ learnerId: t.student_id, status: "waiting" }); continue; }
    const done = statusOf.get(t.review_battle_id) === "completed";
    const r = done ? await checkResults(t.review_battle_id).catch(() => null) : null;
    out.push({ learnerId: t.student_id, battleId: t.review_battle_id, status: done ? "done" : "running", score: r?.score ?? null, correct: r?.correct ?? null, total: r?.total ?? null });
  }
  return { reviews: out, made: ids.length };
}
