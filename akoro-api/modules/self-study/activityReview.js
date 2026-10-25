/**
 * self-study/activityReview.js — the review battle an assignment or self
 * study comes with (reference/Akoro Activity + Review — Plan.md).
 *
 * On assign (drafts.js assignActivityDraft) the instructor's choice is kept on
 * the activity (details.review = { on, at, questions }), the learners'
 * instructions gain one line, and the review is SENT right away (a job held
 * in Postgres, so the assign request doesn't wait on question writing):
 *
 *   ONE class review battle for the whole audience — an Agent Check
 *   (battle/agentCheck.js) hosted by the teacher, a seat for every learner
 *   with an agent, sent as a challenge: it sits in each learner's Challenges
 *   list until the review time, and starts then with everyone who accepted.
 *   Whoever didn't accept missed it.
 *
 * Every protégé answers the same questions, written from the activity's
 * topic, concepts and objectives; each learner gets a mark sheet (the class
 * ranking is the Ranking page's). No HP, no prize, not graded.
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

/** PURE: the line the learners' instructions gain. */
export function reviewInstruction(at, tz = "Africa/Lagos") {
  const when = new Date(at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz });
  return `After you submit, teach your agent this topic: your class review battle is on ${when}. Accept it in your Challenges before it starts.`;
}

async function queue() { return (await import("../battle/worker.js")).battleQueue; }

/** On assign: keep the choice, send the review (the worker makes it now). → the kept review, or null */
export async function scheduleActivityReview(assignment, review) {
  if (!review || !REVIEWABLE.includes(assignment.type)) return null;
  const details = { ...(assignment.details || {}), review };
  await edu().from("self_study_assignments").update({ details }).eq("id", assignment.id);
  const q = await queue();
  await addLater(q, "activity-review", { action: "activity-review", assignmentId: assignment.id },
    { delay: 0, jobId: `activity-review-${assignment.id}` });
  return review;
}

async function notify(userId, title, content, relatedId) {
  await db.from("notifications").insert({ user_id: userId, type: "activity_review", title, content, related_id: relatedId });
  global.io?.to(`user:${userId}`).emit("notification", { type: "activity_review", title, content, relatedId });
}

const whenOf = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Africa/Lagos" });

/** The worker's job: make the class review and send it. Once per activity. → { battleId, sent, noAgent } */
export async function runActivityReview(assignmentId) {
  const { data: a } = await edu().from("self_study_assignments")
    .select("id, type, title, subject, topic, subtopics, created_by, due_at, details").eq("id", assignmentId).maybeSingle();
  if (!a || !a.details?.review?.on) return { sent: 0, skipped: "no review" };
  const firstOf = async () => (await db.from("battles").select("id").eq("activity_assignment_id", a.id)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1)).data?.[0]?.id ?? null;
  const existing = a.details.review.battle_id || await firstOf();
  if (existing) return { sent: 0, skipped: "already sent", battleId: existing };
  const { data: targets } = await edu().from("self_study_targets").select("student_id").eq("assignment_id", assignmentId);
  const learnerIds = [...new Set((targets || []).map((t) => t.student_id))];
  if (!learnerIds.length) return { sent: 0, skipped: "no learners" };
  const { createCheckBattle } = await import("../battle/agentCheck.js");
  const { reviewFocus } = await import("../battle/guideReview.js");
  const at = a.details.review.at;
  let made;
  try {
    made = await createCheckBattle({
      learnerIds, startsAt: at, subject: a.subject,
      topic: reviewFocus(a.topic || a.title, Array.isArray(a.subtopics) ? a.subtopics : []),
      total: a.details.review.questions || REVIEW_LIMITS.DEFAULT_Q,
      // The questions the draft's Battle questions tab showed, when it prepared them.
      preset: Array.isArray(a.details.review.items) ? a.details.review.items : null,
      title: `Class review: ${a.title}`,
      extra: { review_host: "teacher", requested_by: a.created_by, activity_assignment_id: a.id },
    });
  } catch (e) {
    console.warn(`[activity-review] ${a.id}: not sent — ${e.message}`);
    if (e.status === 409) for (const id of learnerIds) await notify(id, `Your class review for ${a.title} couldn't be sent`, "Create your agent first: the review is your agent answering.", a.id).catch(() => {});
    if (e.status === 409) return { sent: 0, skipped: e.message };
    throw e;   // question writing failed: the job retries
  }
  // Two runs at once (the worker's and a retry) each made one: the first made keeps it.
  const first = await firstOf();
  if (first && first !== made.battleId) {
    await db.from("battles").delete().eq("id", made.battleId);
    return { sent: 0, skipped: "already sent", battleId: first };
  }
  await edu().from("self_study_assignments").update({ details: { ...a.details, review: { ...a.details.review, battle_id: made.battleId } } }).eq("id", a.id);
  await edu().from("self_study_targets").update({ review_battle_id: made.battleId }).eq("assignment_id", a.id).in("student_id", made.seated);
  for (const id of made.seated) {
    await notify(id, `Class review battle: ${a.title}`, `It's in your Challenges — accept it before ${whenOf(at)}, when it starts. Your agent answers what you taught it, alongside your class. A mark sheet for you and your teacher; it doesn't count toward your grade.`, made.battleId);
  }
  for (const id of made.noAgent) {
    await notify(id, `Your class review for ${a.title} needs your agent`, "Create your agent first: the review is your agent answering.", a.id).catch(() => {});
  }
  return { battleId: made.battleId, sent: made.seated.length, noAgent: made.noAgent.length };
}

/**
 * PURE: one learner's state in the class review.
 *   waiting   not sent yet · no_agent   no seat (no agent when it was sent)
 *   sent      in their Challenges, not answered · accepted   in, waiting for the start
 *   running · done · missed (declined, or didn't accept before it started)
 */
export function reviewStatus(battle, seat, { sent = !!battle } = {}) {
  if (!battle) return "waiting";
  if (!seat) return sent && !["lobby", "scheduled"].includes(battle.status) ? "missed" : "no_agent";
  if (seat.declined_at) return "missed";
  if (battle.status === "completed") return seat.joined_at ? "done" : "missed";
  if (battle.status === "live") return seat.joined_at ? "running" : "missed";
  if (["cancelled", "expired"].includes(battle.status)) return "missed";
  return seat.joined_at ? "accepted" : "sent";
}

/** The instructor's view: when it runs, each learner's state and mark. */
export async function activityReviews(assignmentId) {
  const { data: a } = await edu().from("self_study_assignments").select("details").eq("id", assignmentId).maybeSingle();
  const { data: targets } = await edu().from("self_study_targets").select("student_id, review_battle_id").eq("assignment_id", assignmentId);
  const battleId = a?.details?.review?.battle_id ?? null;
  const [{ data: battle }, { data: seats }] = battleId ? await Promise.all([
    db.from("battles").select("id, status, scheduled_start").eq("id", battleId).maybeSingle(),
    db.from("battle_participants").select("user_id, joined_at, declined_at").eq("battle_id", battleId).neq("role", "teacher"),
  ]) : [{ data: null }, { data: [] }];
  const seatOf = new Map((seats || []).map((s) => [s.user_id, s]));
  const { checkResults } = await import("../battle/agentCheck.js");
  const out = [];
  for (const t of targets || []) {
    const seat = seatOf.get(t.student_id);
    // A learner whose seat the start dropped (never accepted) was sent it: missed, not "no agent".
    const status = reviewStatus(battle, seat, { sent: !!t.review_battle_id });
    const r = status === "done" ? await checkResults(battleId, t.student_id).catch(() => null) : null;
    out.push({ learnerId: t.student_id, battleId: t.review_battle_id ? battleId : null, status, score: r?.score ?? null, correct: r?.correct ?? null, total: r?.total ?? null });
  }
  return { reviews: out, battleId, battleStatus: battle?.status ?? null, startsAt: battle?.scheduled_start ?? null, made: battleId ? 1 : 0 };
}
