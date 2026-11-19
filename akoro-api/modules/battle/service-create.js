/**
 * battle/service-create.js — the two creation paths that are not invites:
 * an open lobby anyone enrolled can join, and a battle scoped to a live
 * session (the instructor's "Battle scope: This session").
 */
import { addLater } from "../../lib/deferredJobs.js";
import { cleanHpPerMiss } from "./hp.js";
import { entryCheck } from "./entry.js";
import { requestGuideReview } from "./guideReview.js";
import {
  res201, res400, res403, now, resolveAgent, isEligible,
  notifyUser, getBattleQueue, queueIdleExpiry, assignQuestions,
} from "./service-core.js";
import { acceptDeadline, idleDeadline, isFuture, expiryDelay, startDelay } from "./rules.js";
import { battles, seats, people } from "./store.js";

/**
 * POST /api/battle/guide-reviews  { sessionId? | subject + topic }
 * A review with the teaching guide (battle/guideReview.js): the guide asks,
 * your protégé answers, a mark sheet. Runs at once; it is in the Battles tab.
 */
export async function guideReview(req, res) {
  try {
    const out = await requestGuideReview({
      learnerId: req.user.id,
      sessionId: req.body?.sessionId || null,
      subject: req.body?.subject || null,
      topic: req.body?.topic || null,
    });
    res.status(201).json({ success: true, data: out });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ success: false, error: e.message });
    throw e;
  }
}

// POST /api/courses/:courseId/battles/open
export async function createOpenBattle(req, res) {
  const { courseId } = req.params;
  const {
    title, description, topic, subject,
    difficulty = "intermediate", total_questions = 15,
    time_limit_seconds = 900, xp_prize = 200,
    max_participants = 10, expires_in_minutes = 60, scheduled_for = null,
  } = req.body;

  if (!title) return res.status(400).json({ error: "title is required" });
  const { eligible } = await isEligible(req.user.id, courseId);
  if (!eligible) return res.status(403).json({ error: "Not enrolled" });

  const myAgent = await resolveAgent(req.user.id);
  if (!myAgent) return res.status(400).json({ error: "Create your agent first" });

  const isScheduled = isFuture(scheduled_for);
  // A deadline only where there is a start time to be a deadline. See
  // acceptDeadline; an unscheduled one stays open BATTLE_IDLE_HOURS.
  const expiresAt   = isScheduled ? acceptDeadline(scheduled_for) : idleDeadline();

  // A learner who creates a battle plays in it: they need the coins for their own agent's answers.
  {
    const creatorEntry = await entryCheck(req.user.id, { battle_type: "battle", total_questions, min_xp: 0 });
    if (!creatorEntry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: creatorEntry.message.replace("to join", "to start it"), requirements: creatorEntry });
  }
  const { data: battle, error } = await battles.insertBattle({
    hp_per_miss: cleanHpPerMiss(req.body?.hp_per_miss),
    min_xp: Math.max(0, Math.round(Number(req.body?.min_xp) || 0)),
    course_id: courseId, battle_type: "open", title, description: description ?? null,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize, xp_pool: xp_prize,
    max_participants, total_participants: 1,
    status: isScheduled ? "scheduled" : "lobby",
    scheduled_start: scheduled_for ?? null, expires_at: expiresAt, created_by: req.user.id,
  });
  if (error) throw new Error(error.message);
  // Unscheduled invitations don't wait for ever: after BATTLE_IDLE_HOURS it
  // runs with whoever accepted (if enough did) or expires.
  if (!isScheduled) await queueIdleExpiry(battle.id);

  await seats.insertSeat({
    battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id, role: "creator", joined_at: now(),
  });

  await assignQuestions(battle.id, courseId, topic, subject, difficulty, total_questions, time_limit_seconds);

  const q = await getBattleQueue();
  // No deadline, no expiry job — an unscheduled invitation waits.
  if (expiresAt) {
    await addLater(q, "expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: expiryDelay(expiresAt) });
  }
  if (isScheduled) {
    await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id },
      { delay: startDelay(scheduled_for) });
  }

  // Notify all enrolled students
  const { data: students } = await people.enrolledUserIdsExcept(courseId, req.user.id);
  for (const s of (students ?? [])) {
    await notifyUser(s.user_id, "open_battle", `Open battle: ${title}`,
      `${xp_prize} XP · ${difficulty} · Join now!`, battle.id);
  }

  res.status(201).json({ success: true, battle_id: battle.id, status: isScheduled ? "scheduled" : "lobby", expires_at: expiresAt, max_participants, current_participants: 1 });
}

/**
 * POST /api/battle/courses/:courseId/battles/session
 * Create a battle scoped to a specific live session.
 * Frontend "Battle scope: This session" option.
 */
export async function createSessionBattle(req, res) {
  const { courseId } = req.params;
  const {
    session_id, title, topic, subject,
    difficulty = "hard", total_questions = 10,
    time_limit_seconds = 600, xp_pool = 300,
    expires_in_minutes = 120,
  } = req.body;

  if (!session_id || !title) return res400(res, "session_id and title are required");

  const { data: course } = await people.courseInstructor(courseId);
  if (!course || course.instructor_id !== req.user.id) return res403(res, "Not your course");

  const teacherAgent = await resolveAgent(req.user.id);
  if (!teacherAgent) return res400(res, "Create your agent first");

  // Unscheduled (it starts five seconds from now): the idle deadline, as on the
  // other unscheduled routes. This read an undefined `scheduled_for` and threw.
  const expiresAt = idleDeadline();

  const { data: battle, error } = await battles.insertBattle({
    hp_per_miss: cleanHpPerMiss(req.body?.hp_per_miss),
    min_xp: Math.max(0, Math.round(Number(req.body?.min_xp) || 0)),
    course_id: courseId, battle_type: "classroom", title,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize: xp_pool, xp_pool,
    status: "lobby", expires_at: expiresAt, created_by: req.user.id,
    provider_response: { session_id, scope: "session" },
  });

  if (error) throw new Error(error.message);

  // Auto-register all enrolled students who have agents
  const { data: students } = await people.enrolledLearnersWithAgents(courseId, req.user.id);

  for (const s of (students ?? [])) {
    await seats.upsertSeat({
      battle_id: battle.id, user_id: s.user_id, agent_id: s.user_agents.id, role: "participant", joined_at: new Date().toISOString(),
    });
  }

  await battles.setTotalParticipants(battle.id, (students?.length ?? 0) + 1);
  await assignQuestions(battle.id, courseId, topic, subject, difficulty, total_questions, time_limit_seconds);

  const q = await getBattleQueue();
  if (expiresAt) {
    await addLater(q, "expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: expiryDelay(expiresAt) });
  }
  await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id }, { delay: 5000 });

  res201(res, { success: true, battle_id: battle.id, session_id, participants: (students?.length ?? 0) + 1 });
}
