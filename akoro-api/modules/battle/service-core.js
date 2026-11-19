/**
 * battle/service-core.js — the shared machinery every battle request uses:
 * the queue registry, response helpers, notifications, eligibility, the
 * question assignment a created battle gets, and the "everyone answered"
 * check. Request orchestration, never SQL — the queries live in store.js.
 *
 * battleQueue() is the ONLY way the HTTP surface touches the queue. It is a
 * registry lookup against worker.js, so the router never imports the worker
 * (which would construct BullMQ + Redis at import time).
 */
import { addLater } from "../../lib/deferredJobs.js";
import { perQuestionSeconds } from "./questionSource.js";
import { toCard } from "./card.js";
import { minPlayersFor } from "./entry.js";
import { seatSummary, IDLE_HOURS } from "./rules.js";
import { battles, seats, questions, people, insertNotification } from "./store.js";

// ─── queue (lazy; never import the worker eagerly) ────────────────────────────

let _battleQueue = null;
export async function getBattleQueue() {
  if (_battleQueue) return _battleQueue;
  const { battleQueue } = await import("./worker.js");
  _battleQueue = battleQueue;
  return _battleQueue;
}

export const now = () => new Date().toISOString();

/** An unscheduled invitation runs or expires after BATTLE_IDLE_HOURS. */
export async function queueIdleExpiry(battleId) {
  await addLater(await getBattleQueue(), "expire-battle", { action: "expire-battle", battleId },
    { delay: IDLE_HOURS * 3600_000, jobId: `idle-${battleId}` });
}

// ─── response helpers ─────────────────────────────────────────────────────────

export const res200 = (res, data)      => res.status(200).json({ success: true,  data });
export const res201 = (res, data)      => res.status(201).json({ success: true,  data });
export const res400 = (res, message)   => res.status(400).json({ success: false, error: message });
export const res403 = (res, message)   => res.status(403).json({ success: false, error: message });
export const res404 = (res, message)   => res.status(404).json({ success: false, error: message });

// ─── notifications ────────────────────────────────────────────────────────────

export async function notifyUser(userId, type, title, content, relatedId) {
  if (!userId) return;   // a platform-made battle (an activity's review) has no creator to tell
  await insertNotification(userId, type, title, content, relatedId);
  global.io?.to(`user:${userId}`).emit("notification", { type, title, content, relatedId });
}

// ─── eligibility ──────────────────────────────────────────────────────────────

export async function isEligible(userId, courseId) {
  const { data: course } = await people.courseInstructor(courseId);
  if (!course) return { eligible: false, isInstructor: false, course: null };
  const isInstructor = course.instructor_id === userId;
  if (isInstructor) return { eligible: true, isInstructor: true, course };
  const { data: enrolled } = await people.enrolmentForUser(userId, courseId);
  return { eligible: !!enrolled, isInstructor: false, course };
}

/**
 * canRunCourseBattles — who may create/see battles for a course.
 *
 * isEligible() answers "enrolled or owns it", which is right for learners and
 * the teacher. School admins own neither: they administer the school the
 * teacher belongs to. Without this they'd get a 403 on their own school's
 * courses, which is exactly what the school app does today.
 */
export async function canRunCourseBattles(userId, role, courseId) {
  const base = await isEligible(userId, courseId);
  if (base.eligible) return base;
  if (role === "admin") return { ...base, eligible: true, isInstructor: true };

  const { data: school } = await people.schoolAdministeredBy(userId);
  if (!school || !base.course) return base;

  const { data: link } = await people.schoolTeacherLink(school.id, base.course.instructor_id);
  return link ? { ...base, eligible: true, isInstructor: true } : base;
}

export async function resolveAgent(userId) {
  const { data } = await people.agentOfUser(userId);
  return data;
}

// ─── question assignment (creation paths) ─────────────────────────────────────

export async function assignQuestions(battleId, courseId, topic, subject, difficulty, total, durationSeconds = null) {
  const { data: questionsFound } = await questions.bankForAssignment({ courseId, topic, subject, difficulty, total });
  const picked = questionsFound ?? [];

  // Fallback if not enough
  if (picked.length < total) {
    const needed  = total - picked.length;
    const usedIds = picked.map((q) => q.id);
    const { data: fallback } = await questions.bankFallback({ courseId, excludeIds: usedIds, needed });
    picked.push(...(fallback ?? []));
  }

  for (let i = 0; i < picked.length; i++) {
    const q = picked[i];
    await questions.insertBattleQuestion({
      battle_id: battleId, question_order: i + 1,
      question_text: q.question_text, options_json: q.options_json,
      correct_answer_index: q.correct_answer_index,
      // The battle's Duration, shared across the questions — this was a hard 15
      // regardless of what the creator asked for.
      topic: q.topic, xp_value: q.xp_value,
      time_limit_seconds: perQuestionSeconds(durationSeconds, picked.length),
    });
    try { await questions.recordQuestionUse(q.id); } catch {}
  }
  return picked.length;
}

// ─── challenge cards / deadlines that belong to a battle ──────────────────────

/**
 * A battle invitation as the learner's challenge card shows it — the same
 * shape as GET /my-challenges, so a card that arrives live has the deadline,
 * question count, HP rule and entry requirements a reloaded one has.
 */
export async function challengeCardFor(battleId, me) {
  const { data: b } = await battles.battleForCard(battleId);
  return b ? toCard({ ...b, users: { full_name: me?.full_name ?? null, avatar_url: me?.avatar_url ?? null } }) : null;
}

/**
 * The questions a battle DRAFT prepared (self-study/drafts.js): a battle made
 * from that draft asks exactly those — the instructor saw them in the preview.
 * Only the instructor's own pending battle draft, and only when the form still
 * has the draft's subject (a changed subject draws fresh ones).
 */
export async function draftPreset(req, subject) {
  const id = String(req.body?.draft_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || req.series) return null;   // a series' later battles draw their own
  const { data: d } = await people.activityDraft(id);
  if (!d || d.type !== "battle" || d.status !== "draft" || d.created_by !== req.user.id) return null;
  const qs = d.payload?.details?.questions;
  // "Mathematics" and "General Mathematics" are the same subject; "English" and "Chemistry" aren't.
  const norm = (x) => String(x || "").toLowerCase().replace(/\b(general|further|basic)\b/g, "").replace(/[^a-z]/g, "");
  const same = !subject || !d.payload?.subject || norm(subject).includes(norm(d.payload.subject)) || norm(d.payload.subject).includes(norm(subject));
  return same && Array.isArray(qs) && qs.length ? qs : null;
}

// ─── start / cancel rules shared by accept and decline ────────────────────────

/**
 * Everyone has answered — is there anything left to wait for?
 *
 * A group battle is queued to start when its invite window closes. Once the
 * last invitee has answered, that wait buys nothing, so bring it forward.
 *
 * This must be reachable from BOTH answers. It first lived only in accept, and
 * a battle whose final answer was a DECLINE then sat in its lobby for the full
 * hour with nobody left to hear from — the common case of one learner turning
 * it down while the rest are ready.
 *
 * Counts every non-teacher seat, creator included: a learner who makes a battle
 * competes in it. The worker counts the same way, so the two cannot disagree
 * about whether there are enough players.
 */
export async function maybeStartEarly(battle) {
  const { data: all } = await seats.seatAnswers(battle.id);
  const { invited, answered, players } = seatSummary(all);

  // A study review is ONE learner working through a paper. Two is the minimum
  // for a contest, not for this — and the "everyone answered but fewer than
  // two are playing" branch below would otherwise cancel a review the instant
  // its single learner accepted it.
  const minPlayers = minPlayersFor(battle);   // a review or an Agent Check is one learner

  const startsAt = battle.scheduled_start ? new Date(battle.scheduled_start).getTime() : null;

  // Everyone answered, but there are not two of them left. Nothing more is
  // coming — and an unscheduled battle has no deadline to end the wait — so it
  // would sit on "waiting for players to accept" for ever. Close it, and say
  // why, rather than leaving a dead battle in the list.
  if (answered && players < minPlayers && !startsAt) {
    await battles.setBattleStatus(battle.id, "cancelled");
    await notifyUser(battle.created_by, "battle_cancelled",
      `Battle cancelled: ${battle.title}`,
      players ? "Only one learner accepted, so there was nobody to compete against."
              : "Everyone invited declined.", battle.id);
    return { started: false, cancelled: true, invited, players };
  }

  // A scheduled battle keeps its time even when everyone is ready early — the
  // teacher picked that hour for a reason.
  if (!answered || players < minPlayers || (startsAt && startsAt > Date.now())) {
    return { started: false, invited, players };
  }

  const q = await getBattleQueue();
  // Same jobId as the invite route queued, so this REPLACES that job rather
  // than running the battle twice.
  await q.remove(`start-${battle.id}`).catch(() => {});
  await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id },
    { delay: 3000, jobId: `start-${battle.id}` });
  return { started: true, invited, players };
}

export { minPlayersFor };
