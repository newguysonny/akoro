/**
 * modules/battle/routes.js  —  Akoro Battle System
 *
 * Adapted from piabam-battles (SQLite + raw DB) to:
 *   • Supabase JS client via ../../db.js
 *   • Shared public.users identity (same JWT as rest of platform)
 *   • Knowledge confidence updates on answer submit:
 *       - Correct answer  → raise confidence for that topic in edu.student_knowledge
 *       - Wrong answer    → lower confidence
 *       - Topic unknown   → insert with negative starting score
 *   • global.io for Socket.io (set in app.js)
 *
 * Usage in app.js:
 *   import battleModule from "./modules/battle/routes.js";
 *   app.use("/api", battleModule);
 *
 * Battle types:
 *   1v1 Challenge  — student or teacher challenges a specific opponent
 *   Open Lobby     — anyone enrolled can join up to max_participants
 *   Classroom      — teacher starts, all enrolled students auto-registered
 *
 * Endpoints (27):
 *   POST /api/courses/:courseId/battles/challenge
 *   POST /api/courses/:courseId/battles/open
 *   POST /api/courses/:courseId/battles/classroom
 *   GET  /api/courses/:courseId/challenges
 *   GET  /api/challenges/:id
 *   POST /api/challenges/:id/accept
 *   POST /api/challenges/:id/decline
 *   DELETE /api/challenges/:id
 *   GET  /api/courses/:courseId/battles/open
 *   POST /api/battles/:id/join
 *   GET  /api/courses/:courseId/battles
 *   GET  /api/battles/:id
 *   POST /api/battles/:id/answer          ← updates knowledge confidence
 *   POST /api/battles/:id/heartbeat
 *   GET  /api/battles/:id/state
 *   POST /api/battles/:id/start
 *   POST /api/battles/:id/end
 *   GET  /api/battles/:id/results
 *   GET  /api/battles/:id/questions
 *   GET  /api/battles/:id/log
 *   GET  /api/courses/:courseId/leaderboard
 *   GET  /api/leaderboard/global
 *   GET  /api/courses/:courseId/questions-bank
 *   POST /api/courses/:courseId/questions-bank
 *   PUT  /api/questions-bank/:id
 *   DELETE /api/questions-bank/:id
 *   POST /api/courses/:courseId/questions-bank/generate
 */

import { Router }                         from "express";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { openai, OPENAI_MODEL } from "../../lib/aiModel.js";
import { cleanHpPerMiss } from "./hp.js";
import { entryCheck, minPlayersFor, isMarkSheet } from "./entry.js";
import { toCard } from "./card.js";
import { buildQuestions, perQuestionSeconds } from "./questionSource.js";
import { InsufficientCoins } from "../../lib/coins.js";

import { addLater } from "../../lib/deferredJobs.js";
import { requestGuideReview } from "./guideReview.js";
import { createSeries, seriesCards, skipOne, optOut, endSeries } from "./series.js";
import { seriesTemplate } from "./seriesCore.js";
// ─── Lazy-load battle queue ───────────────────────────────────────────────────
let _battleQueue = null;
async function getBattleQueue() {
  if (_battleQueue) return _battleQueue;
  const { battleQueue } = await import("./worker.js");
  _battleQueue = battleQueue;
  return _battleQueue;
}

const router = Router();

// ─── Health check (public) ────────────────────────────────────────────────────
// Diagnoses the real-time pipeline: is Redis reachable and is the battle queue
// live? If this reports redis:down, seeded 'live' battles will render their
// first question but never advance (grading/reveal runs in the worker).
router.get("/health", async (req, res) => {
  const out = { socket: !!global.io };

  // Redis / queue
  try {
    const q = await getBattleQueue();
    out.redis = "up";
    out.queue = await q.getJobCounts("active", "waiting", "delayed", "completed", "failed");
  } catch (err) { out.redis = "down"; out.queueError = err.message; }

  // Data coverage — do live battles actually have questions to render?
  try {
    const { data: liveB } = await db.from("battles").select("id, title, total_questions, battle_type").eq("status", "live").limit(100);
    const ids = (liveB ?? []).map((b) => b.id);
    const { data: qrows } = ids.length ? await db.from("battle_questions").select("battle_id").in("battle_id", ids) : { data: [] };
    const withQ = new Set((qrows ?? []).map((r) => r.battle_id));
    const missing = (liveB ?? []).filter((b) => !withQ.has(b.id));
    out.battles = {
      live: ids.length,
      withQuestions: ids.length - missing.length,
      missingQuestions: missing.length,
      sampleMissing: missing.slice(0, 3).map((b) => ({ id: b.id, title: b.title })),
      sampleReady:   (liveB ?? []).filter((b) => withQ.has(b.id)).slice(0, 3).map((b) => ({ id: b.id, title: b.title, type: b.battle_type })),
    };
  } catch (err) { out.battlesError = err.message; }

  // ── Is anything actually PLAYING? ────────────────────────────────────────
  // "The battle doesn't play" has several possible causes that look identical
  // from the outside: agents were never scheduled (a battle started by an older
  // deploy), the queue is not draining, or it is simply early — with a
  // 15-minute duration over 15 questions each agent answers somewhere in a
  // 60-second window, so a freshly started battle showing 0–0 is normal.
  // Guessing between those cost a diagnosis, so the answer is reported here.
  try {
    const q = await getBattleQueue();
    const { data: liveB } = await db.from("battles")
      .select("id, title, actual_start").eq("status", "live").limit(20);

    const jobs = await q.getJobs(["delayed", "waiting", "active"]);
    const pendingByBattle = new Map();
    for (const j of jobs) {
      if (j?.name !== "agent-answer") continue;
      const id = j.data?.battleId;
      pendingByBattle.set(id, (pendingByBattle.get(id) ?? 0) + 1);
    }

    const ids = (liveB ?? []).map((b) => b.id);
    const { data: answered } = ids.length
      ? await db.from("battle_answers").select("battle_id").in("battle_id", ids)
      : { data: [] };
    const answerCount = new Map();
    for (const a of (answered ?? [])) answerCount.set(a.battle_id, (answerCount.get(a.battle_id) ?? 0) + 1);

    out.play = (liveB ?? []).map((b) => {
      const answers = answerCount.get(b.id) ?? 0;
      const pending = pendingByBattle.get(b.id) ?? 0;
      const ageSec  = b.actual_start ? Math.round((Date.now() - new Date(b.actual_start)) / 1000) : null;
      return {
        id: b.id, title: b.title, startedSecondsAgo: ageSec,
        answers, pendingAgentJobs: pending,
        // The verdict, in one word, so nobody has to interpret the numbers.
        // `ageSec ?? 0` would have read a NULL actual_start as "0 seconds old"
        // and so reported "just started" for ever — which is exactly the kind of
        // reassuring-but-false answer this endpoint exists to avoid. A live
        // battle with no start time never really started.
        verdict: answers > 0        ? "playing"
               : pending > 0        ? "agents queued — waiting for their thinking time"
               : ageSec == null     ? "live but never started — no actual_start"
               : ageSec < 90        ? "just started — no answers yet is normal"
               : "STUCK — no answers and no agent jobs queued",
      };
    });
  } catch (err) { out.playError = err.message; }

  res.json({ ok: out.redis === "up", ...out });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const now = () => new Date().toISOString();

/**
 * How long AFTER a scheduled battle's start time the expiry job runs.
 *
 * A scheduled battle's start time and its accept deadline are now the same
 * instant, by design — you cannot accept a battle that has begun. But that puts
 * start-battle and expire-battle on the same timestamp, and if expire won the
 * race, a battle a whole class had accepted was marked 'expired' instead of
 * being played.
 *
 * Ten seconds orders them deterministically without being a delay anybody
 * notices. expireBattle also refuses to expire a battle that has players, so
 * this is the first of two defences rather than the only one.
 */
const EXPIRE_AFTER_START_MS = 10_000;

/** How long an unscheduled invitation stays open (BATTLE_IDLE_HOURS, default 48h). */
const IDLE_HOURS = Math.max(1, Number(process.env.BATTLE_IDLE_HOURS ?? 48) || 48);
const idleDeadline = () => new Date(Date.now() + IDLE_HOURS * 3600_000).toISOString();
async function queueIdleExpiry(battleId) {
  await addLater(await getBattleQueue(), "expire-battle", { action: "expire-battle", battleId },
    { delay: IDLE_HOURS * 3600_000, jobId: `idle-${battleId}` });
}

/**
 * A battle invitation as the learner's challenge card shows it — the same
 * shape as GET /my-challenges, so a card that arrives live has the deadline,
 * question count, HP rule and entry requirements a reloaded one has.
 */
async function challengeCardFor(battleId, me) {
  const { data: b } = await db.from("battles").select("*").eq("id", battleId).maybeSingle();
  return b ? toCard({ ...b, users: { full_name: me?.full_name ?? null, avatar_url: me?.avatar_url ?? null } }) : null;
}

/**
 * When does an invitation stop being acceptable?
 *
 * A SCHEDULED battle: the moment it starts. There is nothing to accept after
 * that, and the start time is a deadline the teacher actually chose.
 *
 * An UNSCHEDULED battle: after BATTLE_IDLE_HOURS (idleDeadline), when it runs
 * with whoever accepted or expires. Before that it was never; and before that an hour, from a default parameter
 * no form exposed — so a battle set in the morning for an afternoon lesson had
 * its invitations expire before break, and the learners who had not opened the
 * app simply never saw it. An invitation with no fixed start has no natural
 * deadline, so it waits until it is answered.
 *
 * NULL means no deadline. Every reader must be null-safe: `new Date(null)` is
 * the epoch, so a naive `< new Date()` marks an open invitation expired.
 */
const acceptDeadline = (scheduledFor) => {
  if (!scheduledFor) return null;
  const at = new Date(scheduledFor);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

/** Has an invitation with a deadline passed? No deadline never has. */
const fmtDuration = (secs) =>
  `${String(Math.floor((secs ?? 0) / 60)).padStart(2, "0")}:${String((secs ?? 0) % 60).padStart(2, "0")}`;

const deadlinePassed = (expiresAt) => !!expiresAt && new Date(expiresAt) < new Date();

async function isEligible(userId, courseId) {
  const { data: course } = await db.from("courses").select("instructor_id").eq("id", courseId).single();
  if (!course) return { eligible: false, isInstructor: false, course: null };
  const isInstructor = course.instructor_id === userId;
  if (isInstructor) return { eligible: true, isInstructor: true, course };
  const { data: enrolled } = await db
    .from("enrollments").select("id")
    .eq("user_id", userId).eq("course_id", courseId).eq("status", "active").single();
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
async function canRunCourseBattles(userId, role, courseId) {
  const base = await isEligible(userId, courseId);
  if (base.eligible) return base;
  if (role === "admin") return { ...base, eligible: true, isInstructor: true };

  const { data: school } = await db.from("school_profiles")
    .select("id").eq("admin_user_id", userId).limit(1).maybeSingle();
  if (!school || !base.course) return base;

  const { data: link } = await db.from("school_teachers")
    .select("id").eq("school_id", school.id).eq("teacher_id", base.course.instructor_id).maybeSingle();
  return link ? { ...base, eligible: true, isInstructor: true } : base;
}

async function resolveAgent(userId) {
  const { data } = await db.from("user_agents").select("*").eq("user_id", userId).single();
  return data;
}

async function notifyUser(userId, type, title, content, relatedId) {
  if (!userId) return;   // a platform-made battle (an activity's review) has no creator to tell
  await db.from("notifications").insert({ user_id: userId, type, title, content, related_id: relatedId });
  global.io?.to(`user:${userId}`).emit("notification", { type, title, content, relatedId });
}

async function assignQuestions(battleId, courseId, topic, subject, difficulty, total, durationSeconds = null) {
  let query = db.from("question_bank").select("*")
    .eq("course_id", courseId).eq("is_active", true).eq("difficulty", difficulty ?? "intermediate");
  if (topic)   query = query.eq("topic", topic);
  if (subject) query = query.eq("subject", subject);

  const { data: questions } = await query.limit(total);
  const picked = questions ?? [];

  // Fallback if not enough
  if (picked.length < total) {
    const needed  = total - picked.length;
    const usedIds = picked.map((q) => q.id);
    let fb = db.from("question_bank").select("*").eq("course_id", courseId).eq("is_active", true);
    if (usedIds.length) fb = fb.not("id", "in", `(${usedIds.join(",")})`);
    const { data: fallback } = await fb.limit(needed);
    picked.push(...(fallback ?? []));
  }

  for (let i = 0; i < picked.length; i++) {
    const q = picked[i];
    await db.from("battle_questions").insert({
      battle_id: battleId, question_order: i + 1,
      question_text: q.question_text, options_json: q.options_json,
      correct_answer_index: q.correct_answer_index,
      // The battle's Duration, shared across the questions — this was a hard 15
      // regardless of what the creator asked for.
      topic: q.topic, xp_value: q.xp_value,
      time_limit_seconds: perQuestionSeconds(durationSeconds, picked.length),
    });
    try { await db.rpc("increment_question_uses", { q_id: q.id }); } catch {}
  }
  return picked.length;
}

// Knowledge confidence lives in ./knowledge.js — the worker writes it now that
// agents answer, and importing the router from the worker to reach it would
// couple the queue to the whole HTTP surface.

// ─── CREATION ROUTES ─────────────────────────────────────────────────────────

// POST /api/courses/:courseId/battles/challenge
/**
 * POST /api/battle/guide-reviews  { sessionId? | subject + topic }
 * A review with the teaching guide (battle/guideReview.js): the guide asks,
 * your protégé answers, a mark sheet. Runs at once; it is in the Battles tab.
 */
router.post("/guide-reviews", authenticateToken, asyncHandler(async (req, res) => {
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
}));

router.post("/courses/:courseId/battles/challenge", authenticateToken, asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const {
    opponent_id, title, description, topic, subject,
    difficulty = "intermediate", total_questions = 15,
    time_limit_seconds = 900, xp_prize = 200,
    expires_in_minutes = 30, scheduled_for = null,
  } = req.body;

  if (!opponent_id || !title) return res.status(400).json({ error: "opponent_id and title are required" });
  if (opponent_id === req.user.id) return res.status(400).json({ error: "You cannot challenge yourself" });

  const { eligible } = await isEligible(req.user.id, courseId);
  if (!eligible) return res.status(403).json({ error: "Not enrolled in this course" });

  const opponentCheck = await isEligible(opponent_id, courseId);
  if (!opponentCheck.eligible) return res.status(400).json({ error: "Opponent is not in this course" });

  const [myAgent, oppAgent] = await Promise.all([resolveAgent(req.user.id), resolveAgent(opponent_id)]);
  if (!myAgent)  return res.status(400).json({ error: "Create your agent first" });
  if (!oppAgent) return res.status(400).json({ error: "Opponent has no agent yet" });

  // One open duel per PAIR. This used to match any open seat the opponent
  // held — including invitations they had never answered from anyone — so
  // one ignored challenge blocked that learner from being challenged at all.
  const { data: mineOpen } = await db.from("battle_participants")
    .select("battle_id, battles!inner(status, battle_type)")
    .eq("user_id", req.user.id).eq("battles.battle_type", "1v1")
    .in("battles.status", ["lobby", "scheduled", "live"]).limit(100);
  const myIds = (mineOpen ?? []).map((r) => r.battle_id);
  if (myIds.length) {
    const { data: shared } = await db.from("battle_participants").select("battle_id")
      .in("battle_id", myIds).eq("user_id", opponent_id).is("declined_at", null).limit(1);
    if (shared?.length) return res.status(409).json({ error: "You already have a battle open with this person — finish or cancel it first." });
  }

  const isScheduled = !!scheduled_for && new Date(scheduled_for) > new Date();
  // A deadline only where there is a start time to be a deadline. See
  // acceptDeadline; an unscheduled one stays open BATTLE_IDLE_HOURS.
  const expiresAt   = isScheduled ? acceptDeadline(scheduled_for) : idleDeadline();

  // A learner who creates a battle plays in it: they need the coins for their own agent's answers.
  {
    const creatorEntry = await entryCheck(req.user.id, { battle_type: "battle", total_questions, min_xp: 0 });
    if (!creatorEntry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: creatorEntry.message.replace("to join", "to start it"), requirements: creatorEntry });
  }
  const { data: battle, error } = await db.from("battles").insert({
    hp_per_miss: cleanHpPerMiss(req.body?.hp_per_miss),
    min_xp: Math.max(0, Math.round(Number(req.body?.min_xp) || 0)),
    course_id: courseId, battle_type: "1v1", title, description: description ?? null,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize, xp_pool: xp_prize,
    status: isScheduled ? "scheduled" : "lobby",
    scheduled_start: scheduled_for ?? null, expires_at: expiresAt,
    created_by: req.user.id,
  }).select().single();

  if (error) throw new Error(error.message);
  // Unscheduled invitations don't wait for ever: after BATTLE_IDLE_HOURS it
  // runs with whoever accepted (if enough did) or expires.
  if (!isScheduled) await queueIdleExpiry(battle.id);

  await db.from("battle_participants").insert([
    { battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id, role: "creator" },
    { battle_id: battle.id, user_id: opponent_id,  agent_id: oppAgent.id, role: "opponent" },
  ]);

  await assignQuestions(battle.id, courseId, topic, subject, difficulty, total_questions, time_limit_seconds);

  const q = await getBattleQueue();
  // No deadline, no expiry job — an unscheduled invitation waits.
  if (expiresAt) {
    await addLater(q, "expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: Math.max(0, new Date(expiresAt).getTime() - Date.now() + EXPIRE_AFTER_START_MS) });
  }
  if (isScheduled) {
    await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id },
      { delay: new Date(scheduled_for).getTime() - Date.now() });
  }

  const { data: me } = await db.from("users").select("full_name, avatar_url").eq("id", req.user.id).single();
  await notifyUser(opponent_id, "battle_challenge",
    `${me?.full_name} challenged you!`,
    `${title} · ${xp_prize} XP · ${isScheduled ? "Starts " + new Date(scheduled_for).toLocaleString("en-GB", { timeZone: "Africa/Lagos" }) : "Open for " + IDLE_HOURS + " hours"}`,
    battle.id
  );

  // ── WebSocket: push challenge card directly to opponent's session ─────────
  const io = req.app.get("io");
  if (io) {
    { const card = await challengeCardFor(battle.id, me); if (card) io.to(`user:${opponent_id}`).emit("new_challenge", card); }
  }

  res.status(201).json({ success: true, battle_id: battle.id, status: isScheduled ? "scheduled" : "lobby", expires_at: expiresAt });
}));

// POST /api/courses/:courseId/battles/open
router.post("/courses/:courseId/battles/open", authenticateToken, asyncHandler(async (req, res) => {
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

  const isScheduled = !!scheduled_for && new Date(scheduled_for) > new Date();
  // A deadline only where there is a start time to be a deadline. See
  // acceptDeadline; an unscheduled one stays open BATTLE_IDLE_HOURS.
  const expiresAt   = isScheduled ? acceptDeadline(scheduled_for) : idleDeadline();

  // A learner who creates a battle plays in it: they need the coins for their own agent's answers.
  {
    const creatorEntry = await entryCheck(req.user.id, { battle_type: "battle", total_questions, min_xp: 0 });
    if (!creatorEntry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: creatorEntry.message.replace("to join", "to start it"), requirements: creatorEntry });
  }
  const { data: battle, error } = await db.from("battles").insert({
    hp_per_miss: cleanHpPerMiss(req.body?.hp_per_miss),
    min_xp: Math.max(0, Math.round(Number(req.body?.min_xp) || 0)),
    course_id: courseId, battle_type: "open", title, description: description ?? null,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize, xp_pool: xp_prize,
    max_participants, total_participants: 1,
    status: isScheduled ? "scheduled" : "lobby",
    scheduled_start: scheduled_for ?? null, expires_at: expiresAt, created_by: req.user.id,
  }).select().single();
  if (error) throw new Error(error.message);
  // Unscheduled invitations don't wait for ever: after BATTLE_IDLE_HOURS it
  // runs with whoever accepted (if enough did) or expires.
  if (!isScheduled) await queueIdleExpiry(battle.id);

  await db.from("battle_participants").insert({
    battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id, role: "creator", joined_at: now(),
  });

  await assignQuestions(battle.id, courseId, topic, subject, difficulty, total_questions, time_limit_seconds);

  const q = await getBattleQueue();
  // No deadline, no expiry job — an unscheduled invitation waits.
  if (expiresAt) {
    await addLater(q, "expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: Math.max(0, new Date(expiresAt).getTime() - Date.now() + EXPIRE_AFTER_START_MS) });
  }
  if (isScheduled) {
    await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id },
      { delay: new Date(scheduled_for).getTime() - Date.now() });
  }

  // Notify all enrolled students
  const { data: students } = await db.from("enrollments").select("user_id")
    .eq("course_id", courseId).eq("status", "active").neq("user_id", req.user.id);
  for (const s of (students ?? [])) {
    await notifyUser(s.user_id, "open_battle", `Open battle: ${title}`,
      `${xp_prize} XP · ${difficulty} · Join now!`, battle.id);
  }

  res.status(201).json({ success: true, battle_id: battle.id, status: isScheduled ? "scheduled" : "lobby", expires_at: expiresAt, max_participants, current_participants: 1 });
}));

// POST /api/courses/:courseId/battles/classroom  (teacher only)
router.post("/courses/:courseId/battles/classroom", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const {
    title, description, topic, subject,
    difficulty = "hard", total_questions = 15,
    time_limit_seconds = 1200, xp_pool = 500,
    expires_in_minutes = 1440, scheduled_for = null,
  } = req.body;

  if (!title) return res.status(400).json({ error: "title is required" });

  const { data: course } = await db.from("courses").select("instructor_id").eq("id", courseId).single();
  if (!course || course.instructor_id !== req.user.id) return res.status(403).json({ error: "You do not own this course" });

  const teacherAgent = await resolveAgent(req.user.id);
  if (!teacherAgent) return res.status(400).json({ error: "Create your agent first" });

  const isScheduled = !!scheduled_for && new Date(scheduled_for) > new Date();
  // A deadline only where there is a start time to be a deadline. See
  // acceptDeadline; an unscheduled one stays open BATTLE_IDLE_HOURS.
  const expiresAt   = isScheduled ? acceptDeadline(scheduled_for) : idleDeadline();

  const { data: battle, error } = await db.from("battles").insert({
    hp_per_miss: cleanHpPerMiss(req.body?.hp_per_miss),
    min_xp: Math.max(0, Math.round(Number(req.body?.min_xp) || 0)),
    course_id: courseId, battle_type: "classroom", title, description: description ?? null,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize: xp_pool, xp_pool,
    status: isScheduled ? "scheduled" : "lobby",
    scheduled_start: scheduled_for ?? null, expires_at: expiresAt, created_by: req.user.id,
  }).select().single();
  if (error) throw new Error(error.message);
  // Unscheduled invitations don't wait for ever: after BATTLE_IDLE_HOURS it
  // runs with whoever accepted (if enough did) or expires.
  if (!isScheduled) await queueIdleExpiry(battle.id);

  await db.from("battle_participants").insert({
    battle_id: battle.id, user_id: req.user.id, agent_id: teacherAgent.id, role: "teacher", joined_at: now(),
  });

  // Auto-register all enrolled students with agents
  const { data: students } = await db.from("enrollments")
    .select("user_id, user_agents!inner(id)")
    .eq("course_id", courseId).eq("status", "active").neq("user_id", req.user.id);

  for (const s of (students ?? [])) {
    await db.from("battle_participants").upsert({
      battle_id: battle.id, user_id: s.user_id, agent_id: s.user_agents.id, role: "participant", joined_at: now(),
    }, { onConflict: "battle_id,user_id" });
    await notifyUser(s.user_id, "classroom_battle", `Class battle: ${title}`,
      `Your agent is competing! ${isScheduled ? "Starts: " + scheduled_for : "Starting soon!"}`, battle.id);
  }

  await db.from("battles").update({ total_participants: (students?.length ?? 0) + 1 }).eq("id", battle.id);
  await assignQuestions(battle.id, courseId, topic, subject, difficulty, total_questions, time_limit_seconds);

  const q = await getBattleQueue();
  // No deadline, no expiry job — an unscheduled invitation waits.
  if (expiresAt) {
    await addLater(q, "expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: Math.max(0, new Date(expiresAt).getTime() - Date.now() + EXPIRE_AFTER_START_MS) });
  }
  const delay = isScheduled ? new Date(scheduled_for).getTime() - Date.now() : 5000;
  await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id }, { delay });

  res.status(201).json({ success: true, battle_id: battle.id, status: isScheduled ? "scheduled" : "starting", participants: (students?.length ?? 0) + 1, expires_at: expiresAt });
}));


// ─── CLASS BATTLES ───────────────────────────────────────────────────────────
// A class battle belongs to a classroom and a subject rather than a course.
// Most school learners aren't "enrolled on a course" at all — they attend JSS1
// and study Mathematics there — so a course-only battle system had nothing to
// offer them. Questions come from the past-questions bank by subject.

/**
 * GET /api/battle/my-classes
 * The learner's classes and the subjects taught in each, for the battle form.
 *
 * public.classrooms (who is in the room) and mgmt.classes (the academic
 * structure) are separate tables with no foreign key between them — they line
 * up by school and name. So resolve the room first, then look up its subjects
 * by that pair, and fall back to the subjects the past-questions bank can
 * actually supply if the school hasn't set its curriculum up yet.
 */
router.get("/my-classes", authenticateToken, asyncHandler(async (req, res) => {
  // Learners get the classes they are IN; teachers and school admins get the
  // ones they run. Same shape either way, so one form serves all three apps —
  // and unioned rather than branched on role, so a head of department who both
  // teaches and administers sees all of theirs.
  const { data: memberships } = await db.from("classroom_students")
    .select("classroom_id, classrooms!inner(id, name, school_id)")
    .eq("user_id", req.user.id).eq("status", "active");

  const byId = new Map();
  for (const m of (memberships ?? [])) if (m.classrooms) byId.set(m.classrooms.id, m.classrooms);

  const { data: school } = await db.from("school_profiles")
    .select("id").eq("admin_user_id", req.user.id).limit(1).maybeSingle();

  let q = db.from("classrooms").select("id, name, school_id");
  q = school ? q.or(`teacher_id.eq.${req.user.id},school_id.eq.${school.id}`)
             : q.eq("teacher_id", req.user.id);
  const { data: taught } = await q;
  for (const r of (taught ?? [])) byId.set(r.id, r);

  const rooms = [...byId.values()];
  if (!rooms.length) return res200(res, []);

  const out = [];
  for (const room of rooms) {
    let subjects = [];
    if (room.school_id) {
      const { data: cls } = await db.schema("mgmt").from("classes")
        .select("id").eq("school_id", room.school_id).ilike("name", room.name).limit(1);
      if (cls?.length) {
        const { data: cs } = await db.schema("mgmt").from("class_subjects")
          .select("subjects:subject_id(name)").eq("class_id", cls[0].id);
        subjects = [...new Set((cs ?? []).map((r) => r.subjects?.name).filter(Boolean))];
      }
    }
    // No curriculum configured — offer what we can actually set questions on
    // rather than an empty dropdown that looks broken.
    if (!subjects.length) subjects = await subjectsWithQuestions();

    const { count } = await db.from("classroom_students")
      .select("id", { count: "exact", head: true })
      .eq("classroom_id", room.id).eq("status", "active");

    out.push({ id: room.id, name: room.name, subjects, student_count: count ?? 0 });
  }
  res200(res, out);
}));

/** Subjects the past-questions bank can actually supply verified MCQs for. */
async function subjectsWithQuestions() {
  const { data } = await db.schema("edu").from("past_questions")
    .select("subject").eq("type", "mcq").eq("verified", true).not("subject", "is", null).limit(2000);
  return [...new Set((data ?? []).map((r) => r.subject))].sort();
}

/** GET /api/battle/classes/:id/roster — classmates who can battle. */
router.get("/classes/:id/roster", authenticateToken, asyncHandler(async (req, res) => {
  if (!(await classroomRole(req.user.id, req.user.role, req.params.id)))
    return res403(res, "You don't have access to this class");

  const { data: rows } = await db.from("classroom_students")
    .select("user_id, users!inner(id, username, full_name, avatar_url, avatar_emoji)")
    .eq("classroom_id", req.params.id).eq("status", "active");

  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: agents } = ids.length
    ? await db.from("user_agents").select("user_id").in("user_id", ids)
    : { data: [] };
  const withAgent = new Set((agents ?? []).map((a) => a.user_id));

  res200(res, (rows ?? [])
    .filter((r) => r.user_id !== req.user.id)
    .map((r) => ({
      id: r.users.id, username: r.users.username, full_name: r.users.full_name,
      avatar: r.users.avatar_url ?? null, emoji: r.users.avatar_emoji ?? null,
      has_agent: withAgent.has(r.user_id),
    })));
}));

async function inClassroom(userId, classroomId) {
  const { data } = await db.from("classroom_students")
    .select("id").eq("user_id", userId).eq("classroom_id", classroomId).eq("status", "active").maybeSingle();
  return !!data;
}

/**
 * canUseClassroom — who may run a battle for a class.
 *
 * Membership is the learner's answer, and it is the wrong question for a
 * teacher: the person most likely to set a class battle is precisely the one
 * who is not IN the class. So three ways in — you're a member, you teach it, or
 * you administer the school that owns it — and the caller gets told which,
 * because a teacher joins the battle as a teacher, not as a competitor.
 */
async function classroomRole(userId, role, classroomId) {
  if (await inClassroom(userId, classroomId)) return "member";
  if (role === "admin") return "teacher";

  const { data: room } = await db.from("classrooms")
    .select("id, teacher_id, school_id").eq("id", classroomId).maybeSingle();
  if (!room) return null;
  if (room.teacher_id === userId) return "teacher";

  if (room.school_id) {
    const { data: school } = await db.from("school_profiles")
      .select("id").eq("admin_user_id", userId).eq("id", room.school_id).maybeSingle();
    if (school) return "teacher";
  }
  return null;
}

/**
 * POST /api/battle/classes/:classroomId/battles/invite
 * Same shape as the course invite — one opponent makes a duel, several make a
 * group battle — but scoped to classmates and a class subject.
 */
// Named so a recurring series can make each occurrence with the same checks (battle/series.js).
/**
 * The questions a battle DRAFT prepared (self-study/drafts.js): a battle made
 * from that draft asks exactly those — the instructor saw them in the preview.
 * Only the instructor's own pending battle draft, and only when the form still
 * has the draft's subject (a changed subject draws fresh ones).
 */
async function draftPreset(req, subject) {
  const id = String(req.body?.draft_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id) || req.series) return null;   // a series' later battles draw their own
  const { data: d } = await db.from("activity_drafts").select("type, status, created_by, payload").eq("id", id).maybeSingle();
  if (!d || d.type !== "battle" || d.status !== "draft" || d.created_by !== req.user.id) return null;
  const qs = d.payload?.details?.questions;
  const same = !subject || !d.payload?.subject || String(subject).trim().toLowerCase() === String(d.payload.subject).trim().toLowerCase();
  return same && Array.isArray(qs) && qs.length ? qs : null;
}

const classInvite = async (req, res) => {
  const { classroomId } = req.params;
  const {
    title, description, subject, topic,
    difficulty = "intermediate", total_questions = 15,
    time_limit_seconds = 900, xp_prize = 200,
    expires_in_minutes = 60, scheduled_for = null,
    usernames = [], user_ids = [], whole_class = false,
    question_source = "auto",          // 'bank' | 'ai' | 'auto'
    mode = "battle",                   // 'battle' | 'review'
  } = req.body;

  if (!title)   return res400(res, "title is required");
  if (!subject) return res400(res, "Pick a subject — a class battle draws its questions from one");
  const myRole = await classroomRole(req.user.id, req.user.role, classroomId);
  if (!myRole) return res403(res, "You don't have access to this class");

  const myAgent = await resolveAgent(req.user.id);
  if (!myAgent) return res400(res, "Create your agent first");

  // ── Targets ──────────────────────────────────────────────────────────────
  const targetIds = new Set((Array.isArray(user_ids) ? user_ids : []).filter(Boolean));
  const notFound  = [];
  for (const raw of (Array.isArray(usernames) ? usernames : [])) {
    const handle = String(raw).trim().replace(/^@/, "");
    if (!handle) continue;
    const { data: found } = await db.from("users")
      .select("id").or(`username.ilike.${handle},email.ilike.${handle}`).limit(1);
    if (found?.length) targetIds.add(found[0].id);
    else notFound.push(handle);
  }
  if (whole_class) {
    const { data: rows } = await db.from("classroom_students")
      .select("user_id").eq("classroom_id", classroomId).eq("status", "active");
    for (const r of (rows ?? [])) targetIds.add(r.user_id);
  }
  targetIds.delete(req.user.id);
  if (notFound.length) return res400(res, `No account found for: ${notFound.join(", ")}`);
  if (!targetIds.size) return res400(res, "Pick at least one classmate to challenge");

  const ids = [...targetIds];
  const [{ data: members }, { data: agents }] = await Promise.all([
    db.from("classroom_students").select("user_id").eq("classroom_id", classroomId).eq("status", "active").in("user_id", ids),
    db.from("user_agents").select("user_id, id").in("user_id", ids),
  ]);
  const memberSet  = new Set((members ?? []).map((m) => m.user_id));
  const agentByUser = new Map((agents ?? []).map((a) => [a.user_id, a.id]));

  const skipped = { not_in_class: [], no_agent: [] };
  const opponents = [];
  for (const id of ids) {
    if (!memberSet.has(id))    { skipped.not_in_class.push(id); continue; }
    if (!agentByUser.has(id))  { skipped.no_agent.push(id);     continue; }
    opponents.push({ user_id: id, agent_id: agentByUser.get(id) });
  }
  if (!opponents.length) return res400(res, "None of those classmates can battle yet — they need to be in this class and have an agent.");

  // ── Create ───────────────────────────────────────────────────────────────
  // One opponent is a duel only between CLASSMATES: a classmate is IN the
  // battle, so the two of them make a pair. A teacher hosts rather than
  // competes, so a teacher picking one learner leaves that learner with nobody
  // to face — and the battle sat in its lobby saying "waiting for players to
  // accept" for ever, even after the one learner had accepted. Say so at the
  // point of creation instead of building something that can never run.
  // A STUDY REVIEW is one learner working through a paper on their own — no
  // opponent, no winner, a mark sheet at the end. It is the one shape the
  // two-competitors rule must not block, and it must not become a duel either.
  const isReview = mode === "review";
  if (isReview && opponents.length !== 1) {
    return res400(res, "A study review is for one learner. Pick exactly one.");
  }
  if (isReview && myRole === "member") {
    return res403(res, "Only a teacher can set a study review.");
  }

  const isDuel = !isReview && myRole === "member" && opponents.length === 1;
  if (!isReview && !isDuel && opponents.length < 2) {
    return res400(res, "A battle needs two learners to compete. Pick at least one more, or send it to the whole class.");
  }

  // A RECURRING battle: save the series, not a battle. Its battles are made an
  // hour before each start, through this same route (battle/series.js).
  if (req.body?.repeat && !req.series) {
    if (isReview) return res400(res, "A study review is set once; it doesn't repeat.");
    try {
      const made = await createSeries({ creatorId: req.user.id, scope: "class", classroomId,
        template: seriesTemplate(req.body), repeat: req.body.repeat, memberIds: opponents.map((o) => o.user_id) });
      return res201(res, { success: true, series_id: made.id, next_at: made.nextAt, invited: opponents.length, repeats: made.rule });
    } catch (e) { if (e.status === 400) return res400(res, e.message); throw e; }
  }
  const isScheduled = !!scheduled_for && new Date(scheduled_for) > new Date();
  // A deadline only where there is a start time to be a deadline. See
  // acceptDeadline; an unscheduled one stays open BATTLE_IDLE_HOURS.
  const expiresAt   = isScheduled ? acceptDeadline(scheduled_for) : idleDeadline();

  // A learner who creates a battle plays in it: they need the coins for their own agent's answers.
  if (myRole !== "teacher" && !isReview) {
    const creatorEntry = await entryCheck(req.user.id, { battle_type: "battle", total_questions, min_xp: 0 });
    if (!creatorEntry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: creatorEntry.message.replace("to join", "to start it"), requirements: creatorEntry });
  }
  const { data: battle, error } = await db.from("battles").insert({
    hp_per_miss: cleanHpPerMiss(req.body?.hp_per_miss),
    min_xp: Math.max(0, Math.round(Number(req.body?.min_xp) || 0)),
    course_id: null, classroom_id: classroomId,
    battle_type: isReview ? "review" : isDuel ? "1v1" : "classroom",
    title, description: description ?? null,
    topic: topic ?? null, subject, difficulty,
    total_questions, time_limit_seconds, xp_prize, xp_pool: xp_prize,
    total_participants: opponents.length + 1,
    status: (isScheduled && (!isDuel || req.series)) ? "scheduled" : "lobby",
    scheduled_start: scheduled_for ?? null, expires_at: expiresAt,
    created_by: req.user.id,
    // An occurrence of a recurring series (absent otherwise, so the insert is unchanged).
    series_id: req.series?.id,
  }).select().single();
  if (error) throw new Error(error.message);
  // Unscheduled invitations don't wait for ever: after BATTLE_IDLE_HOURS it
  // runs with whoever accepted (if enough did) or expires.
  if (!isScheduled) await queueIdleExpiry(battle.id);

  // Questions before anyone is told about it: a battle with none is worse than
  // no battle, so if we can't fill it, undo and say why.
  let fill;
  try {
    const { data: room } = await db.from("classrooms").select("name").eq("id", classroomId).maybeSingle();
    fill = await buildQuestions({
      battleId: battle.id, source: question_source, total: total_questions,
      subject, topic, difficulty, classLabel: room?.name, userId: req.user.id,
      durationSeconds: time_limit_seconds,
      preset: await draftPreset(req, subject),
    });
  } catch (e) {
    await db.from("battles").delete().eq("id", battle.id);
    if (e instanceof InsufficientCoins) {
      return res.status(402).json({ success: false, code: "INSUFFICIENT_COINS",
        error: "Not enough coins to generate questions. Use the question bank instead, or top up.",
        needed: e.needed, balance: e.balance });
    }
    throw e;
  }
  if (fill.placed < 5) {
    await db.from("battles").delete().eq("id", battle.id);
    return res400(res, question_source === "bank"
      ? `Only ${fill.placed} ${subject} questions in the bank. Switch Questions to "Generate with AI" to fill the rest.`
      : `Could not put together enough ${subject} questions (got ${fill.placed}). Try a different subject or topic.`);
  }
  // Keep the stored duration honest. The QUESTIONS carry the real clock, so the
  // battle's length is however many were placed times their per-question
  // budget. It can differ from what was typed in two ways: fewer questions than
  // asked for, or a per-question share clamped into the 8–180s range — a
  // teacher asking for 1 minute over 30 questions gets 8s each, so the battle
  // takes four minutes, and the card must say four rather than one.
  const realLength = fill.placed * fill.secondsPerQuestion;
  if (fill.placed < total_questions || realLength !== time_limit_seconds) {
    await db.from("battles").update({
      total_questions:    fill.placed,
      time_limit_seconds: realLength,
    }).eq("id", battle.id);
  }

  await db.from("battle_participants").insert({
    battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id,
    // A teacher runs the battle; a classmate competes in it.
    role: myRole === "teacher" ? "teacher" : "creator", joined_at: now(),
  });
  // EVERY battle is an INVITATION, whoever set it. Group battles used to enter
  // people with joined_at already set, so the battle simply happened to them —
  // nothing appeared in their Challenges tab and there was nothing to accept.
  // Being picked by a classmate is no more consent than being picked by a
  // teacher, so the seat starts empty either way and the start job waits.
  //
  // Only the creator is in from the start; they are the one who asked for it.
  for (const o of opponents) {
    await db.from("battle_participants").upsert({
      battle_id: battle.id, user_id: o.user_id, agent_id: o.agent_id,
      role: isDuel ? "opponent" : "participant",
      // In a series everyone is in unless they opted out; no accept per occurrence.
      joined_at: req.series ? now() : null,
    }, { onConflict: "battle_id,user_id" });
  }

  const q = await getBattleQueue();
  // No deadline, no expiry job — an unscheduled invitation waits.
  if (expiresAt) {
    await addLater(q, "expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: Math.max(0, new Date(expiresAt).getTime() - Date.now() + EXPIRE_AFTER_START_MS) });
  }
  if (!isDuel || req.series) {
    // Wait for the invitations: until the scheduled time if there is one,
    // otherwise until the invite window closes. It starts sooner than that —
    // the accept route brings it forward the moment everyone has answered, so
    // a class that all accepts within a minute battles within a minute.
    // A scheduled battle starts at its time. An unscheduled one has no clock
    // to start against any more, so it starts when everyone has answered —
    // the accept and decline routes bring it forward — or when the creator
    // presses Start Now. It will not run off a timer nobody set.
    if (isScheduled) {
      await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id },
        { delay: Math.max(0, new Date(scheduled_for).getTime() - Date.now()), jobId: `start-${battle.id}` });
    }
  }

  const { data: me } = await db.from("users").select("full_name, avatar_url").eq("id", req.user.id).single();
  for (const o of opponents) {
    if (req.series) {
      await notifyUser(o.user_id, "battle_series", `${title} is on`,
        `Starts ${new Date(scheduled_for).toLocaleString("en-GB", { timeZone: req.series.tz || "Africa/Lagos" })}. You're in; skip it from your Challenges tab.`, battle.id);
      continue;
    }
    await notifyUser(o.user_id, "battle_challenge",
      isDuel ? `${me?.full_name ?? "A classmate"} challenged you!`
             : `${me?.full_name ?? "Someone"} invited you to a battle: ${title}`,
      `${subject} · ${xp_prize} XP`, battle.id);
    { const card = await challengeCardFor(battle.id, me); if (card) global.io?.to(`user:${o.user_id}`).emit("new_challenge", card); }
  }

  const skippedIds = [...skipped.not_in_class, ...skipped.no_agent];
  const { data: skippedUsers } = skippedIds.length
    ? await db.from("users").select("id, full_name, username").in("id", skippedIds)
    : { data: [] };
  const nameById = new Map((skippedUsers ?? []).map((u) => [u.id, u.full_name || u.username]));

  res201(res, {
    success: true, battle_id: battle.id,
    // Report what was WRITTEN, not a second guess at it. This re-derived the
    // type and so answered "classroom" for a review.
    battle_type: battle.battle_type,
    status: battle.status,
    invited: opponents.length, expires_at: expiresAt,
    questions: fill.placed, fromBank: fill.fromBank, generated: fill.generated, coinsCharged: fill.charged,
    skipped: {
      not_in_class: skipped.not_in_class.map((id) => nameById.get(id) ?? id),
      no_agent:     skipped.no_agent.map((id) => nameById.get(id) ?? id),
    },
  });
};
router.post("/classes/:classroomId/battles/invite", authenticateToken, asyncHandler(classInvite));

// ─── MY BATTLES / MY CHALLENGES ──────────────────────────────────────────────
// Course-independent lists. The learner dashboard and the instructor/school
// Battles pages both need "everything I'm involved in" without knowing a course
// id up front, and both render the same card shape the WebSocket push uses —
// so the mapping lives in battle/card.js, once.


// GET /api/battle/my-battles — every battle I take part in or created
router.get("/my-battles", authenticateToken, asyncHandler(async (req, res) => {
  // ── Which battles are mine, and what is my seat in each? ────────────────
  //
  // Query BATTLES and filter on the embedded seat, not the other way round.
  // Three shapes were tried before this one worked:
  //   · `id.in.(<every battle id>)` — ~15KB of uuids in the query string at 410
  //     battles, and the request 500'd outright
  //   · the same list sliced to 300 — hid whichever battles fell outside the
  //     slice, including the one just created, since seat rows come back in no
  //     particular order
  //   · selecting FROM battle_participants and ordering by battles.created_at —
  //     PostgREST cannot order a result by an embedded table's column, so the
  //     rows came back unordered and the limit cut arbitrary ones
  //
  // Ordering happens on battles, which is the table being limited, so this
  // stays bounded and correct however long a learner's history gets.
  const PAGE = 100;
  const [seated, created] = await Promise.all([
    db.from("battles")
      .select("*, users!battles_created_by_fkey(full_name, avatar_url), battle_participants!inner(role, joined_at, declined_at, user_id)")
      .eq("battle_participants.user_id", req.user.id)
      .order("created_at", { ascending: false }).limit(PAGE),
    db.from("battles").select("*, users!battles_created_by_fkey(full_name, avatar_url)")
      .eq("created_by", req.user.id)
      .order("created_at", { ascending: false }).limit(PAGE),
  ]);
  if (seated.error)  throw new Error(seated.error.message);
  if (created.error) throw new Error(created.error.message);

  // My own seat, not just the fact that I have one: a battle I have been
  // invited to but not answered belongs in Challenges, not Battles › Active,
  // and the two lists had no way to tell those apart.
  const mySeat = new Map();
  const byId   = new Map();
  for (const b of (seated.data ?? [])) {
    const seat = (b.battle_participants ?? []).find((p) => p.user_id === req.user.id);
    if (seat) mySeat.set(b.id, seat);
    delete b.battle_participants;          // the embed is plumbing, not card data
    byId.set(b.id, b);
  }
  for (const b of (created.data ?? [])) byId.set(b.id, b);

  const data = [...byId.values()]
    .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))
    .slice(0, PAGE);

  // A finished battle's card wants to say who won and by what. toCard never
  // carried any of it, so the learner app rendered its result line from three
  // undefined fields: "undefined won · undefined–undefined". Load the finished
  // ones' participants — one query for all of them — and attach the result.
  const finished = (data ?? []).filter((b) => b.status === "completed").map((b) => b.id);
  const resultByBattle = new Map();
  if (finished.length) {
    const { data: rows } = await db.from("battle_participants")
      .select("battle_id, user_id, role, score, hp, correct_answers, is_winner, final_rank, xp_earned, user_agents(agent_name, agent_emoji, agent_color)")
      .in("battle_id", finished).order("final_rank");
    for (const r of (rows ?? [])) {
      if (r.role === "teacher") continue;                 // the host is not a result
      const list = resultByBattle.get(r.battle_id) ?? [];
      list.push(r);
      resultByBattle.set(r.battle_id, list);
    }
  }

  // Who is in each battle, by AGENT — the card reads "Bolt vs Nova" for a
  // 1v1 and "Bolt vs your agent and 23 more" for a group. It used to read
  // "vs <creator's name>", which named a person, and named ME on a battle I
  // had created. One query for every listed battle.
  const lineupOf = new Map();
  const ids = (data ?? []).map((b) => b.id);
  if (ids.length) {
    const { data: seatRows } = await db.from("battle_participants")
      .select("battle_id, user_id, role, joined_at, declined_at, score, user_agents(agent_name, agent_emoji, agent_color, agent_bg)")
      .in("battle_id", ids);
    for (const r of (seatRows ?? [])) {
      if (r.role === "teacher" || r.declined_at) continue;
      const l = lineupOf.get(r.battle_id) ?? [];
      l.push(r);
      lineupOf.set(r.battle_id, l);
    }
  }
  const lineup = (b) => {
    const seats = lineupOf.get(b.id) ?? [];
    const me = seats.find((s) => s.user_id === req.user.id);
    const others = seats.filter((s) => s.user_id !== req.user.id);
    // "Agent 1": the creator's agent when that isn't me, else whoever said yes first.
    const lead = others.find((s) => s.user_id === b.created_by)
      ?? others.filter((s) => s.joined_at).sort((x, y) => new Date(x.joined_at) - new Date(y.joined_at))[0]
      ?? others[0];
    const agent = (s) => s && {
      name:  s.user_agents?.agent_name ?? "Agent",
      emoji: s.user_agents?.agent_emoji ?? null,
      color: s.user_agents?.agent_color ?? null,
      bg:    s.user_agents?.agent_bg ?? null,
      score: s.score ?? 0,
    };
    return {
      myAgent:   me?.user_agents?.agent_name ?? null,
      leadAgent: lead?.user_agents?.agent_name ?? null,
      me:        agent(me),
      lead:      agent(lead),
      iCreated:  b.created_by === req.user.id,
      others:    others.length,               // everyone but me
      total:     seats.length,
    };
  };

  // The daily battle ranks the whole day (every heat of that subject), not the
  // one heat a learner sat in, and leaves knocked-out agents out.
  const dailyPlaceOf = new Map();
  const dailyDone = (data ?? []).filter((b) => b.status === "completed" && String(b.recurring_key || "").startsWith("daily:"));
  if (dailyDone.length) {
    const { dailyRanking } = await import("../agent-network/activities.js");
    const seen = new Map();
    for (const b of dailyDone.slice(0, 14)) {
      const [, day, , ] = String(b.recurring_key).split(":");
      const k = `${day}|${b.subject}`;
      if (!seen.has(k)) seen.set(k, await dailyRanking(req.user.id, b.subject, day).catch(() => null));
      const r = seen.get(k);
      if (r) dailyPlaceOf.set(b.id, r.me ? { rank: r.me.rank, of: r.me.of } : { rank: null, of: r.players });
    }
  }

  res200(res, (data ?? []).map((b) => {
    const seat = mySeat.get(b.id);
    const card = {
      ...toCard(b, { mine: b.created_by === req.user.id, lineup: lineup(b) }),
      // 'accepted' | 'declined' | 'invited' | null (not in it — I created it)
      myState: !seat ? null
             : seat.declined_at ? "declined"
             : seat.joined_at   ? "accepted"
             : "invited",
      myRole: seat?.role ?? null,
    };
    const players = resultByBattle.get(b.id);
    if (!players?.length) return card;

    const asAgent = (p) => p && {
      id:    p.user_id,
      name:  p.user_agents?.agent_name ?? "Agent",
      emoji: p.user_agents?.agent_emoji ?? "🤖",
      color: p.user_agents?.agent_color ?? null,
      score: p.score ?? 0,
      isYou: p.user_id === req.user.id,
    };
    const mine = players.find((p) => p.user_id === req.user.id);

    return {
      ...card,
      agentA: asAgent(players[0]),
      agentB: asAgent(players[1]),
      winner: players.find((p) => p.is_winner)?.user_id ?? null,
      // A review has no winner — what it has is a mark. The card needs to be
      // able to tell the difference rather than announcing a champion.
      review: b.battle_type === "review" && mine
        ? { correct: mine.correct_answers ?? 0, total: b.total_questions ?? 0 }
        : null,
      myScore:    mine?.score ?? null,
      myRank:     mine?.final_rank ?? null,
      // 0 = knocked out: watched the rest as a spectator, unranked.
      myHp:       mine?.hp ?? null,
      myXpEarned: mine?.xp_earned ?? 0,
      ...(dailyPlaceOf.has(b.id) ? { dailyPlace: dailyPlaceOf.get(b.id) } : {}),
    };
  }));
}));

/**
 * GET /api/battle/my-challenges — every invitation waiting on me.
 *
 * This used to read role='opponent' only, i.e. 1v1 duels. A battle a teacher
 * set for the class entered the learner automatically and appeared nowhere they
 * could act on it — the Challenges tab stayed empty while a battle they had
 * never agreed to ran without them. A teacher's battle is now an invitation
 * like any other, so anyone with an unanswered seat belongs in this list.
 */
router.get("/my-challenges", authenticateToken, asyncHandler(async (req, res) => {
  // Filtered on the EMBEDDED seat, not by collecting ids and asking for them.
  //
  // The previous version read every seat this user has ever held, kept the
  // unanswered ones, and passed them back as `id.in.(...)`. A learner with a
  // few hundred battles behind them produced a fifteen-kilobyte URL, the
  // request failed, and — because the result was destructured without checking
  // for an error — the endpoint answered 200 with an empty list. Their
  // Challenges tab was permanently empty and nothing anywhere said why. This is
  // the third time this shape has bitten: /my-battles had exactly the same bug.
  const { data, error } = await db.from("battles")
    .select("*, users!battles_created_by_fkey(full_name, avatar_url, role), battle_participants!inner(user_id, role, joined_at, declined_at)")
    .eq("battle_participants.user_id", req.user.id)
    .in("battle_participants.role", ["opponent", "participant"])
    // Unanswered: neither accepted nor declined.
    .is("battle_participants.joined_at", null)
    .is("battle_participants.declined_at", null)
    .in("status", ["lobby", "scheduled"])
    // `or`, not `.gt` — a NULL expires_at means no deadline, and a plain
    // greater-than drops NULLs, which would have hidden every open invitation
    // the moment they stopped having one.
    .or(`expires_at.is.null,expires_at.gt.${now()}`)
    .order("created_at", { ascending: false })
    .limit(100);

  // Loudly. Answering 200 with [] when the query failed is what made the last
  // one invisible for so long.
  if (error) throw new Error(`my-challenges: ${error.message}`);

  // The scope's name for the card ("Class · JSS1-2", "Course · Biology 101"),
  // and whether a teacher set it (a teacher hosts; the card says so).
  const rows = data ?? [];
  const courseIds = [...new Set(rows.map((b) => b.course_id).filter(Boolean))];
  const classIds  = [...new Set(rows.map((b) => b.classroom_id).filter(Boolean))];
  const [{ data: courses }, { data: classes }] = await Promise.all([
    courseIds.length ? db.from("courses").select("id, title").in("id", courseIds) : { data: [] },
    classIds.length ? db.from("classrooms").select("id, name").in("id", classIds) : { data: [] },
  ]);
  const courseName = new Map((courses ?? []).map((c) => [c.id, c.title]));
  const className  = new Map((classes ?? []).map((c) => [c.id, c.name]));
  // An activity's review battle is platform-made (no creator): the card names the teacher who set it.
  const setBy = [...new Set(rows.filter((b) => !b.created_by && b.review_host === "teacher" && b.requested_by).map((b) => b.requested_by))];
  const { data: setters } = setBy.length ? await db.from("users").select("id, full_name, avatar_url, role").in("id", setBy) : { data: [] };
  const setter = new Map((setters ?? []).map((u) => [u.id, u]));
  for (const b of rows) if (!b.created_by && setter.has(b.requested_by)) b.users = setter.get(b.requested_by);
  // One card per recurring series I'm in or set (its occurrences are in my Battles tab).
  const series = await seriesCards(req.user.id).catch((e) => { console.warn("[my-challenges] series:", e.message); return []; });
  res200(res, [...rows.map((b) => toCard(b, {
    scopeName: b.course_id ? courseName.get(b.course_id) ?? null : b.classroom_id ? className.get(b.classroom_id) ?? null : null,
    hostRole:  b.users?.role === "instructor" || b.users?.role === "teacher" ? "teacher" : (b.users?.role || null),
  })), ...series]);
}));

// ─── RECURRING SERIES (battle/series.js) ─────────────────────────────────────
// Skip one occurrence (the next, or `at`), opt out of the series, or (the
// creator) end it.
const seriesAction = (fn) => asyncHandler(async (req, res) => {
  try {
    res200(res, await fn(req));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ success: false, error: e.message });
    throw e;
  }
});
router.post("/series/:seriesId/skip", authenticateToken, seriesAction((req) => skipOne(req.params.seriesId, req.user.id, req.body?.at || null)));
router.post("/series/:seriesId/opt-out", authenticateToken, seriesAction((req) => optOut(req.params.seriesId, req.user.id)));
router.post("/series/:seriesId/end", authenticateToken, seriesAction((req) => endSeries(req.params.seriesId, req.user.id)));

/**
 * GET /api/battle/battles/:id/participants
 *
 * Who was invited, who accepted, who declined, who hasn't answered — and, once
 * it has run, how they did. The same question the Self Study drawer answers,
 * which a teacher could not ask of a battle at all: the Battles page showed a
 * count and nothing else, so "did my class actually take this?" had no answer.
 *
 * Readable by the creator and by anyone taking part. A learner seeing who else
 * is in their own battle is the roster they already see when it starts.
 */
router.get("/battles/:battleId/participants", authenticateToken, asyncHandler(async (req, res) => {
  const { battleId } = req.params;
  const { data: battle } = await db.from("battles")
    .select("id, title, status, created_by, total_participants").eq("id", battleId).maybeSingle();
  if (!battle) return res.status(404).json({ success: false, error: "Battle not found" });

  const { data: rows } = await db.from("battle_participants")
    .select("user_id, role, joined_at, declined_at, score, correct_answers, wrong_answers, is_winner, final_rank, xp_earned")
    .eq("battle_id", battleId);

  const mine = battle.created_by === req.user.id
    || (rows ?? []).some((r) => r.user_id === req.user.id);
  if (!mine) return res403(res, "Not your battle");

  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: users } = ids.length
    ? await db.from("users").select("id, full_name, username, avatar_url, avatar_emoji").in("id", ids)
    : { data: [] };
  const byId = new Map((users ?? []).map((u) => [u.id, u]));

  const people = (rows ?? []).map((r) => {
    const u = byId.get(r.user_id);
    return {
      userId:    r.user_id,
      fullName:  u?.full_name ?? "Unknown",
      username:  u?.username ?? null,
      avatar:    u?.avatar_url ?? null,
      emoji:     u?.avatar_emoji ?? null,
      role:      r.role,
      // One word for the UI, so it doesn't have to re-derive this from two
      // nullable timestamps and get it subtly different on each page.
      state:     r.declined_at ? "declined" : (r.joined_at ? "accepted" : "invited"),
      joinedAt:  r.joined_at ?? null,
      declinedAt: r.declined_at ?? null,
      score:     r.score ?? 0,
      correct:   r.correct_answers ?? 0,
      wrong:     r.wrong_answers ?? 0,
      isWinner:  !!r.is_winner,
      rank:      r.final_rank ?? null,
      xpEarned:  r.xp_earned ?? 0,
    };
  });

  // The teacher/creator is running it, not competing for a place in it.
  const learners = people.filter((p) => p.role !== "teacher");
  res200(res, {
    battleId, title: battle.title, status: battle.status,
    participants: people.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.score - a.score),
    summary: {
      invited:  learners.length,
      accepted: learners.filter((p) => p.state === "accepted").length,
      declined: learners.filter((p) => p.state === "declined").length,
      pending:  learners.filter((p) => p.state === "invited").length,
    },
  });
}));

// ─── ROSTER + TARGETED INVITE ────────────────────────────────────────────────

/**
 * GET /api/battle/courses/:courseId/roster
 * Everyone who could be challenged in this course, for the "who do you want to
 * battle?" picker: username, name, and whether they have an agent yet (no
 * agent = cannot fight, so the UI can grey them out instead of failing later).
 */
router.get("/courses/:courseId/roster", authenticateToken, asyncHandler(async (req, res) => {
  const { eligible } = await canRunCourseBattles(req.user.id, req.user.role, req.params.courseId);
  if (!eligible) return res403(res, "Not enrolled in this course");

  const { data: rows } = await db.from("enrollments")
    .select("user_id, users!inner(id, username, full_name, avatar_url, avatar_emoji)")
    .eq("course_id", req.params.courseId).eq("status", "active");

  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: agents } = ids.length
    ? await db.from("user_agents").select("user_id").in("user_id", ids)
    : { data: [] };
  const withAgent = new Set((agents ?? []).map((a) => a.user_id));

  res200(res, (rows ?? [])
    .filter((r) => r.user_id !== req.user.id)
    .map((r) => ({
      id:        r.users.id,
      username:  r.users.username,
      full_name: r.users.full_name,
      avatar:    r.users.avatar_url ?? null,
      emoji:     r.users.avatar_emoji ?? null,
      has_agent: withAgent.has(r.user_id),
    })));
}));

/**
 * POST /api/battle/courses/:courseId/battles/invite
 *
 * One creation path for "challenge these people". Targets come from any mix of:
 *   usernames:   ["priya", "amaka@student.akoro.app"]   (username or email)
 *   user_ids:    ["uuid", …]
 *   whole_class: true                                    (every active enrolment)
 *
 * One opponent produces a 1v1 challenge they must accept; two or more produces
 * a classroom-style battle with everyone pre-registered — the same shape the
 * existing /challenge and /classroom routes create, so nothing downstream
 * (worker, results, leaderboard) needs to know this route exists.
 */
const courseInvite = async (req, res) => {
  const { courseId } = req.params;
  const {
    title, description, topic, subject,
    difficulty = "intermediate", total_questions = 15,
    time_limit_seconds = 900, xp_prize = 200,
    expires_in_minutes = 60, scheduled_for = null,
    usernames = [], user_ids = [], whole_class = false, classroom_id = null,
    question_source = "auto",          // 'bank' | 'ai' | 'auto'
  } = req.body;
  // Reviews are set for one learner in a class (the class invite route). Here
  // it would quietly become an ordinary battle — say so instead.
  if (req.body?.mode === "review") return res400(res, "A study review is set from a class, for one learner.");

  if (!title) return res400(res, "title is required");

  const { eligible, isInstructor } = await canRunCourseBattles(req.user.id, req.user.role, courseId);
  if (!eligible) return res403(res, "Not enrolled in this course");

  const myAgent = await resolveAgent(req.user.id);
  if (!myAgent) return res400(res, "Create your agent first");

  // ── Resolve targets ──────────────────────────────────────────────────────
  const targetIds = new Set((Array.isArray(user_ids) ? user_ids : []).filter(Boolean));
  const notFound  = [];

  const handles = (Array.isArray(usernames) ? usernames : [])
    .map((u) => String(u).trim().replace(/^@/, ""))
    .filter(Boolean);

  for (const handle of handles) {
    const { data: found } = await db.from("users")
      .select("id, username, email")
      .or(`username.ilike.${handle},email.ilike.${handle}`)
      .limit(1);
    if (found?.length) targetIds.add(found[0].id);
    else notFound.push(handle);
  }

  // "Everyone" means one of two different groups and the caller says which.
  // A class (JSS1) is not the same set as a course enrolment, and a battle
  // still lives in a course — so class members who aren't enrolled fall out at
  // the eligibility step below and come back in `skipped.not_enrolled` rather
  // than being silently dropped.
  if (classroom_id) {
    const { data: rows } = await db.from("classroom_students")
      .select("user_id").eq("classroom_id", classroom_id).eq("status", "active");
    for (const r of (rows ?? [])) targetIds.add(r.user_id);
  } else if (whole_class) {
    const { data: rows } = await db.from("enrollments")
      .select("user_id").eq("course_id", courseId).eq("status", "active");
    for (const r of (rows ?? [])) targetIds.add(r.user_id);
  }

  targetIds.delete(req.user.id);
  if (notFound.length) return res400(res, `No account found for: ${notFound.join(", ")}`);
  if (!targetIds.size) return res400(res, "Pick at least one learner to challenge");

  // ── Filter to people who can actually fight ──────────────────────────────
  const ids = [...targetIds];
  const [{ data: enrolled }, { data: agents }] = await Promise.all([
    db.from("enrollments").select("user_id").eq("course_id", courseId).eq("status", "active").in("user_id", ids),
    db.from("user_agents").select("user_id, id").in("user_id", ids),
  ]);
  const enrolledSet = new Set((enrolled ?? []).map((e) => e.user_id));
  const agentByUser = new Map((agents ?? []).map((a) => [a.user_id, a.id]));

  const skipped   = { not_enrolled: [], no_agent: [] };
  const opponents = [];
  for (const id of ids) {
    if (!enrolledSet.has(id))   { skipped.not_enrolled.push(id); continue; }
    if (!agentByUser.has(id))   { skipped.no_agent.push(id);     continue; }
    opponents.push({ user_id: id, agent_id: agentByUser.get(id) });
  }
  if (!opponents.length) {
    const why = skipped.not_enrolled.length && !skipped.no_agent.length
      ? "None of them are enrolled in this course, so they can't take its battle."
      : "None of those learners can battle yet — they must be enrolled in this course and have an agent.";
    return res400(res, why);
  }

  // Ids are useless to the UI; send names so it can say who missed out.
  const skippedIds = [...skipped.not_enrolled, ...skipped.no_agent];
  const { data: skippedUsers } = skippedIds.length
    ? await db.from("users").select("id, full_name, username").in("id", skippedIds)
    : { data: [] };
  const nameById = new Map((skippedUsers ?? []).map((u) => [u.id, u.full_name || u.username]));
  const named = {
    not_enrolled: skipped.not_enrolled.map((id) => nameById.get(id) ?? id),
    no_agent:     skipped.no_agent.map((id) => nameById.get(id) ?? id),
  };

  // ── Create ───────────────────────────────────────────────────────────────
  // A learner challenging one person is a duel. An instructor is the host, not
  // a competitor, so one opponent leaves nobody to compete against — the same
  // dead end the class route had.
  const isDuel = !isInstructor && opponents.length === 1;
  if (!isDuel && opponents.length < 2) {
    return res400(res, "A battle needs two learners to compete. Pick at least one more, or send it to the whole course.");
  }

  // A RECURRING battle: save the series, not a battle. Its battles are made an
  // hour before each start, through this same route (battle/series.js).
  if (req.body?.repeat && !req.series) {
    try {
      const made = await createSeries({ creatorId: req.user.id, scope: "course", courseId,
        template: seriesTemplate(req.body), repeat: req.body.repeat, memberIds: opponents.map((o) => o.user_id) });
      return res201(res, { success: true, series_id: made.id, next_at: made.nextAt, invited: opponents.length, repeats: made.rule });
    } catch (e) { if (e.status === 400) return res400(res, e.message); throw e; }
  }
  const isScheduled = !!scheduled_for && new Date(scheduled_for) > new Date();
  // A deadline only where there is a start time to be a deadline. See
  // acceptDeadline; an unscheduled one stays open BATTLE_IDLE_HOURS.
  const expiresAt   = isScheduled ? acceptDeadline(scheduled_for) : idleDeadline();

  // A scheduled DUEL stays in 'lobby': /challenges/:id/accept only accepts from
  // lobby, and it already schedules the start itself once accepted. Marking it
  // 'scheduled' up front would make the invitation unacceptable.
  // A learner who creates a battle plays in it: they need the coins for their own agent's answers.
  if ((isDuel || !isInstructor)) {
    const creatorEntry = await entryCheck(req.user.id, { battle_type: "battle", total_questions, min_xp: 0 });
    if (!creatorEntry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: creatorEntry.message.replace("to join", "to start it"), requirements: creatorEntry });
  }
  const { data: battle, error } = await db.from("battles").insert({
    hp_per_miss: cleanHpPerMiss(req.body?.hp_per_miss),
    min_xp: Math.max(0, Math.round(Number(req.body?.min_xp) || 0)),
    course_id: courseId, battle_type: isDuel ? "1v1" : "classroom",
    title, description: description ?? null,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize, xp_pool: xp_prize,
    total_participants: opponents.length + 1,
    status: (isScheduled && (!isDuel || req.series)) ? "scheduled" : "lobby",
    scheduled_start: scheduled_for ?? null, expires_at: expiresAt,
    created_by: req.user.id,
    // An occurrence of a recurring series (absent otherwise, so the insert is unchanged).
    series_id: req.series?.id,
  }).select().single();
  if (error) throw new Error(error.message);
  // Unscheduled invitations don't wait for ever: after BATTLE_IDLE_HOURS it
  // runs with whoever accepted (if enough did) or expires.
  if (!isScheduled) await queueIdleExpiry(battle.id);

  await db.from("battle_participants").insert({
    battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id,
    role: isDuel ? "creator" : (isInstructor ? "teacher" : "creator"), joined_at: now(),
  });

  // As on the class route: every battle is an invitation the learner answers,
  // not a fixture they are entered into without being asked.
  for (const o of opponents) {
    await db.from("battle_participants").upsert({
      battle_id: battle.id, user_id: o.user_id, agent_id: o.agent_id,
      role: isDuel ? "opponent" : "participant",
      // In a series everyone is in unless they opted out; no accept per occurrence.
      joined_at: req.series ? now() : null,
    }, { onConflict: "battle_id,user_id" });
  }

  // A course battle prefers its own bank and tops up with AI when that bank is
  // thin — which it usually is for a course nobody has written questions for.
  let fill;
  try {
    fill = await buildQuestions({
      battleId: battle.id, source: question_source, total: total_questions,
      courseId, subject: subject || topic || "General", topic, difficulty, userId: req.user.id,
      durationSeconds: time_limit_seconds,
      preset: await draftPreset(req, subject),
    });
  } catch (e) {
    await db.from("battles").delete().eq("id", battle.id);
    if (e instanceof InsufficientCoins) {
      return res.status(402).json({ success: false, code: "INSUFFICIENT_COINS",
        error: "Not enough coins to generate questions. Use the question bank instead, or top up.",
        needed: e.needed, balance: e.balance });
    }
    throw e;
  }
  if (fill.placed < 5) {
    await db.from("battles").delete().eq("id", battle.id);
    return res400(res, question_source === "bank"
      ? `Only ${fill.placed} questions in this course's bank. Switch Questions to "Generate with AI" to fill the rest.`
      : `Could not put together enough questions (got ${fill.placed}). Try a different topic.`);
  }
  // Keep the stored duration honest. The QUESTIONS carry the real clock, so the
  // battle's length is however many were placed times their per-question
  // budget. It can differ from what was typed in two ways: fewer questions than
  // asked for, or a per-question share clamped into the 8–180s range — a
  // teacher asking for 1 minute over 30 questions gets 8s each, so the battle
  // takes four minutes, and the card must say four rather than one.
  const realLength = fill.placed * fill.secondsPerQuestion;
  if (fill.placed < total_questions || realLength !== time_limit_seconds) {
    await db.from("battles").update({
      total_questions:    fill.placed,
      time_limit_seconds: realLength,
    }).eq("id", battle.id);
  }

  const q = await getBattleQueue();
  // No deadline, no expiry job — an unscheduled invitation waits.
  if (expiresAt) {
    await addLater(q, "expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: Math.max(0, new Date(expiresAt).getTime() - Date.now() + EXPIRE_AFTER_START_MS) });
  }
  // A duel waits for its accept; a group battle waits for its invitations —
  // until the scheduled time, or until the invite window closes, whichever
  // applies. The accept route starts it early once everyone has answered.
  if (!isDuel || req.series) {
    // A scheduled battle starts at its time. An unscheduled one has no clock
    // to start against any more, so it starts when everyone has answered —
    // the accept and decline routes bring it forward — or when the creator
    // presses Start Now. It will not run off a timer nobody set.
    if (isScheduled) {
      await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id },
        { delay: Math.max(0, new Date(scheduled_for).getTime() - Date.now()), jobId: `start-${battle.id}` });
    }
  }

  const { data: me } = await db.from("users").select("full_name, avatar_url").eq("id", req.user.id).single();
  const when = isScheduled
    ? `Starts ${new Date(scheduled_for).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}`
    // Not "Starting shortly" any more — a group battle waits on its
    // invitations, so telling a learner it is about to start would be wrong in
    // exactly the case where they still have to accept it.
    : `Open for ${IDLE_HOURS} hours`;

  for (const o of opponents) {
    if (req.series) {
      await notifyUser(o.user_id, "battle_series", `${title} is on`,
        `Starts ${new Date(scheduled_for).toLocaleString("en-GB", { timeZone: req.series.tz || "Africa/Lagos" })}. You're in; skip it from your Challenges tab.`, battle.id);
      continue;
    }
    await notifyUser(o.user_id, "battle_challenge",
      isDuel ? `${me?.full_name ?? "Someone"} challenged you!`
             : `${me?.full_name ?? "Someone"} invited you to a battle: ${title}`,
      `${title} · ${xp_prize} XP · ${when}`, battle.id);

    { const card = await challengeCardFor(battle.id, me); if (card) global.io?.to(`user:${o.user_id}`).emit("new_challenge", card); }
  }

  res201(res, {
    success: true, battle_id: battle.id,
    battle_type: battle.battle_type,
    status: battle.status,
    invited: opponents.length, expires_at: expiresAt, skipped: named,
    questions: fill.placed, fromBank: fill.fromBank, generated: fill.generated, coinsCharged: fill.charged,
  });
};
router.post("/courses/:courseId/battles/invite", authenticateToken, asyncHandler(courseInvite));

// ─── CHALLENGE RESPONSES ──────────────────────────────────────────────────────

router.get("/courses/:courseId/challenges", authenticateToken, asyncHandler(async (req, res) => {
  const { data } = await db.from("battles")
    .select(`*, users!battles_created_by_fkey(full_name, username), user_agents!inner(agent_name, agent_emoji, agent_color, agent_bg)`)
    .eq("course_id", req.params.courseId).eq("battle_type", "1v1").eq("status", "lobby")
    .or(`expires_at.is.null,expires_at.gt.${now()}`);
  res.json({ challenges: data ?? [] });
}));

router.get("/challenges/:challengeId", authenticateToken, asyncHandler(async (req, res) => {
  const { data } = await db.from("battles")
    .select(`*, users!battles_created_by_fkey(full_name), user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("id", req.params.challengeId).single();
  if (!data) return res.status(404).json({ error: "Challenge not found" });
  // null = no deadline, NOT "expired 56 years ago" — which is what
  // new Date(null) would have made of it.
  const expiresIn = data.expires_at
    ? Math.max(0, Math.floor((new Date(data.expires_at) - Date.now()) / 1000))
    : null;
  res.json({ battle: data, expires_in_seconds: expiresIn });
}));

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
async function maybeStartEarly(battle) {
  const { data: all } = await db.from("battle_participants")
    .select("joined_at, declined_at, role").eq("battle_id", battle.id);

  const invited  = (all ?? []).filter((s) => s.role === "participant");
  const answered = invited.every((s) => s.joined_at || s.declined_at);
  const players  = (all ?? []).filter((s) => s.role !== "teacher" && s.joined_at && !s.declined_at).length;

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
    await db.from("battles").update({ status: "cancelled" }).eq("id", battle.id);
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

/** GET /api/battle/battles/:battleId/entry — can I join it? (the challenge sheet asks before Accept) */
router.get("/battles/:battleId/entry", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("id, battle_type, total_questions, min_xp").eq("id", req.params.battleId).maybeSingle();
  if (!battle) return res404(res, "Battle not found");
  res200(res, await entryCheck(req.user.id, battle));
}));

router.post("/challenges/:challengeId/accept", authenticateToken, asyncHandler(async (req, res) => {
  // A teacher's battle sits in 'scheduled' until its start time, so restricting
  // this to 'lobby' would have made exactly the invitations we now send
  // impossible to accept.
  const { data: battle } = await db.from("battles").select("*")
    .eq("id", req.params.challengeId).in("status", ["lobby", "scheduled"]).single();
  if (!battle) return res.status(404).json({ error: "Challenge not found or already resolved" });
  // Too late to accept — for THIS learner. The battle itself is left alone:
  // one late Accept used to mark the whole scheduled group battle expired,
  // and its start job then found nothing to start.
  if (deadlinePassed(battle.expires_at)) {
    return res.status(410).json({ error: "Too late to accept — this battle's accept window has closed." });
  }

  const { data: seat } = await db.from("battle_participants").select("id, role")
    .eq("battle_id", battle.id).eq("user_id", req.user.id)
    .in("role", ["opponent", "participant"]).maybeSingle();
  if (!seat) return res.status(403).json({ error: "You are not the challenged person" });

  // Enough coins for your agent's answers, and the creator's minimum XP (a
  // review has no XP gate). Short of either, you can't take the seat — the
  // challenge sheet already showed what it needs.
  const entry = await entryCheck(req.user.id, battle);
  if (!entry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: entry.message, requirements: entry });

  // ── A group battle: take the seat, don't start the battle ────────────────
  // One learner accepting must not drag twenty others in. The battle keeps its
  // own start time; this only records that this learner is in.
  if (seat.role === "participant") {
    await db.from("battle_participants").update({ joined_at: now(), declined_at: null })
      .eq("battle_id", battle.id).eq("user_id", req.user.id);

    const { invited: seats } = await maybeStartEarly(battle);
    const accepted = seats.filter((s) => s.joined_at && !s.declined_at).length;

    // A review sent as a challenge has no creator to tell (the teacher sees it on the activity).
    if (battle.created_by) {
      const { data: me } = await db.from("users").select("full_name").eq("id", req.user.id).single();
      await notifyUser(battle.created_by, "battle_accepted",
        `${me?.full_name} joined ${battle.title}`,
        `${accepted} of ${seats.length} accepted`, battle.id);
    }
    req.app.get("io")?.to(`user:${req.user.id}`).emit("join_battle_room", { battleId: battle.id });

    return res.json({ success: true, battle_id: battle.id, status: battle.status,
      accepted, invited: seats.length, is_immediate: false });
  }

  const isScheduled = !!battle.scheduled_start && new Date(battle.scheduled_start) > new Date();
  // Only ever to "scheduled" here. The start job flips it to live when it
  // actually starts — it ignores a battle already marked live, so setting
  // "live" here meant every accepted duel sat live forever, never starting.
  if (isScheduled) await db.from("battles").update({ status: "scheduled" }).eq("id", battle.id);
  await db.from("battle_participants").update({ joined_at: now() }).eq("battle_id", battle.id).eq("user_id", req.user.id);

  const q = await getBattleQueue();
  const delay = isScheduled ? new Date(battle.scheduled_start).getTime() - Date.now() : 3000;
  await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id }, { delay: Math.max(delay, 0) });

  const { data: me } = await db.from("users").select("full_name, avatar_url").eq("id", req.user.id).single();
  await notifyUser(battle.created_by, "battle_accepted",
    `${me?.full_name} accepted your challenge!`,
    `${battle.title} · ${isScheduled ? "Scheduled: " + battle.scheduled_start : "Starting now!"}`, battle.id);

  // WebSocket — notify challenger their battle was accepted
  const io = req.app.get("io");
  if (io) {
    io.to(`user:${battle.created_by}`).emit("battle_accepted", {
      battleId:    battle.id,
      title:       battle.title,
      opponent:    me?.full_name ?? "Opponent",
      opponentAvatar: me?.avatar_url ?? null,
      status:      isScheduled ? "scheduled" : "live",
      isImmediate: !isScheduled,
    });
    // Also notify both participants to join the battle room
    io.to(`user:${battle.created_by}`).emit("join_battle_room", { battleId: battle.id });
    io.to(`user:${req.user.id}`).emit("join_battle_room",       { battleId: battle.id });
  }

  res.json({ success: true, battle_id: battle.id, status: isScheduled ? "scheduled" : "live", is_immediate: !isScheduled });
}));

const declineChallenge = async (req, res) => {
  const { data: p } = await db.from("battle_participants")
    .select("battle_id, role, battles!inner(created_by, title, status)")
    .eq("battle_id", req.params.challengeId).eq("user_id", req.user.id)
    .in("role", ["opponent", "participant"]).maybeSingle();
  if (!p || !["lobby", "scheduled"].includes(p.battles?.status)) {
    return res.status(404).json({ error: "Challenge not found" });
  }

  const { data: me } = await db.from("users").select("full_name").eq("id", req.user.id).single();

  // Declining a DUEL ends it — there is no battle without the other person.
  // Declining a CLASS battle is one empty seat, not a veto: cancelling the
  // whole thing would let any one learner call off the teacher's battle.
  if (p.role === "participant") {
    await db.from("battle_participants").update({ declined_at: now(), joined_at: null })
      .eq("battle_id", p.battle_id).eq("user_id", req.user.id);

    // A decline can be the LAST answer, and then there is nothing left to wait
    // for either. Without this the battle sat in its lobby for the full invite
    // window while everyone who said yes waited on someone who had said no.
    const { data: battle } = await db.from("battles")
      // title and created_by too: maybeStartEarly may now close the battle and
      // has to name it in the notification it sends the creator.
      .select("id, scheduled_start, title, created_by, battle_type").eq("id", p.battle_id).maybeSingle();
    const { invited: seats } = await maybeStartEarly(battle);
    const accepted = seats.filter((s) => s.joined_at).length;
    // Nobody left to compete: cancel rather than run an empty battle at the
    // scheduled time and report a winner who was the only entrant.
    if (seats.every((s) => s.declined_at)) {
      await db.from("battles").update({ status: "cancelled" }).eq("id", p.battle_id);
    }
    await notifyUser(p.battles.created_by, "battle_declined",
      `${me?.full_name} declined ${p.battles.title}`,
      `${accepted} of ${seats.length} still in`, p.battle_id);
    global.io?.to(`user:${p.battles.created_by}`).emit("battle_declined", { battleId: p.battle_id, by: me?.full_name ?? null });
    return res.json({ success: true, accepted, invited: seats.length });
  }

  await db.from("battles").update({ status: "cancelled" }).eq("id", req.params.challengeId);
  await notifyUser(p.battles.created_by, "battle_declined", `${me?.full_name} declined your challenge`, p.battles.title, req.params.challengeId);
  // Live, so the creator's card doesn't sit on "Waiting" until a reload.
  global.io?.to(`user:${p.battles.created_by}`).emit("battle_declined", { battleId: req.params.challengeId, by: me?.full_name ?? null, cancelled: true });
  res.json({ success: true });
};
router.post("/challenges/:challengeId/decline", authenticateToken, asyncHandler(declineChallenge));

router.delete("/challenges/:challengeId", authenticateToken, asyncHandler(async (req, res) => {
  // .select(): zero rows changed is not an error to PostgREST, so this always
  // reported success — even for someone else's battle or one already running.
  const { data: rows, error } = await db.from("battles").update({ status: "cancelled" })
    .eq("id", req.params.challengeId).eq("created_by", req.user.id).in("status", ["lobby", "scheduled"]).select("id");
  if (error || !rows?.length) return res.status(404).json({ error: "Challenge not found or cannot be cancelled" });
  res.json({ success: true });
}));

// ─── OPEN BATTLE LOBBY ────────────────────────────────────────────────────────

router.get("/courses/:courseId/battles/open", authenticateToken, asyncHandler(async (req, res) => {
  const { data: rows } = await db.from("battles")
    .select(`*, users!battles_created_by_fkey(full_name, username), user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("course_id", req.params.courseId).eq("battle_type", "open")
    .in("status", ["lobby", "scheduled"])
    .or(`expires_at.is.null,expires_at.gt.${now()}`)
    .order("created_at", { ascending: false });

  const enriched = await Promise.all((rows ?? []).map(async (r) => {
    const { data: joined } = await db.from("battle_participants").select("id").eq("battle_id", r.id).eq("user_id", req.user.id).single();
    const { count } = await db.from("battle_participants").select("id", { count: "exact", head: true }).eq("battle_id", r.id);
    return { ...r, already_joined: !!joined, current_participants: count ?? 0, spots_left: r.max_participants - (count ?? 0) };
  }));

  res.json({ open_battles: enriched });
}));

router.post("/battles/:battleId/join", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("*").eq("id", req.params.battleId).single();
  if (!battle) return res.status(404).json({ error: "Battle not found" });
  if (battle.battle_type !== "open") return res.status(400).json({ error: "Not an open lobby" });
  if (!["lobby", "scheduled"].includes(battle.status)) return res.status(400).json({ error: `Battle is ${battle.status}` });
  if (deadlinePassed(battle.expires_at)) return res.status(410).json({ error: "Lobby has expired" });

  const { eligible } = await isEligible(req.user.id, battle.course_id);
  if (!eligible) return res.status(403).json({ error: "Not enrolled" });

  const myAgent = await resolveAgent(req.user.id);
  if (!myAgent) return res.status(400).json({ error: "Create your agent first" });

  const entry = await entryCheck(req.user.id, battle);
  if (!entry.ok) return res.status(402).json({ code: "ENTRY_REQUIREMENTS", error: entry.message, requirements: entry });

  const { data: alreadyIn } = await db.from("battle_participants").select("id")
    .eq("battle_id", battle.id).eq("user_id", req.user.id).single();
  if (alreadyIn) return res.status(409).json({ error: "Already in this battle" });

  const { count } = await db.from("battle_participants").select("id", { count: "exact", head: true }).eq("battle_id", battle.id);
  if ((count ?? 0) >= battle.max_participants) return res.status(409).json({ error: "Battle is full" });

  await db.from("battle_participants").insert({ battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id, role: "participant", joined_at: now() });
  await db.from("battles").update({ total_participants: (count ?? 0) + 1 }).eq("id", battle.id);

  global.io?.to(`battle:${battle.id}`).emit("battle:participant-joined", {
    battleId: battle.id, userId: req.user.id, agentName: myAgent.agent_name, agentEmoji: myAgent.agent_emoji,
    totalParticipants: (count ?? 0) + 1, maxParticipants: battle.max_participants,
  });

  if ((count ?? 0) + 1 >= battle.max_participants && !battle.scheduled_start) {
    await addLater(await getBattleQueue(), "start-battle", { action: "start-battle", battleId: battle.id }, { delay: 3000 });
  }

  res.json({ success: true, battle_id: battle.id, current_participants: (count ?? 0) + 1 });
}));

// ─── BATTLE LIFECYCLE ─────────────────────────────────────────────────────────

router.get("/courses/:courseId/battles", authenticateToken, asyncHandler(async (req, res) => {
  const { status, type } = req.query;
  let query = db.from("battles")
    .select(`*, users!battles_created_by_fkey(full_name, username), user_agents(agent_name, agent_emoji)`)
    .eq("course_id", req.params.courseId)
    .order("status").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (type)   query = query.eq("battle_type", type);

  const { data: battles } = await query;

  const enriched = await Promise.all((battles ?? []).map(async (b) => {
    const { data: p } = await db.from("battle_participants").select("role").eq("battle_id", b.id).eq("user_id", req.user.id).single();
    return { ...b, my_role: p?.role ?? null };
  }));
  res.json({ battles: enriched });
}));

router.get("/battles/:battleId", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles")
    .select(`*, users!battles_created_by_fkey(full_name), user_agents(agent_name, agent_emoji)`)
    .eq("id", req.params.battleId).single();
  if (!battle) return res.status(404).json({ error: "Battle not found" });

  const { data: participants } = await db.from("battle_participants")
    .select(`*, users(username, full_name), user_agents(agent_name, agent_emoji, agent_color, agent_bg)`)
    .eq("battle_id", req.params.battleId).order("score", { ascending: false });

  const { count: viewerCount } = await db.from("battle_viewers").select("id", { count: "exact", head: true }).eq("battle_id", req.params.battleId);

  res.json({
    battle,
    participants: (participants ?? []).map((p) => ({ ...p, isMe: p.user_id === req.user.id })),
    viewer_count: viewerCount ?? 0,
  });
}));

/**
 * POST /api/battles/:battleId/answer
 *
 * Gone. Every battle — study review included — is answered by the AGENTS, and
 * the learner watches. Their agent answers from what they have actually
 * learned: its odds come from that learner's own per-topic confidence, so a
 * review still measures the learner, read through the agent that represents
 * them rather than typed in by hand.
 *
 * The route stays so an old client gets an explanation rather than a 404, and
 * so it cannot quietly write a second answer alongside the agent's.
 *
 * The knowledge update this handler used to own now lives in the worker's
 * agentAnswer — see modules/battle/worker.js. That matters: agent accuracy is
 * READ from the same table, so if nothing wrote to it the agents would be
 * frozen at whatever they knew today, and no battle would ever teach anyone
 * anything.
 */
router.post("/battles/:battleId/answer", authenticateToken, asyncHandler(async (req, res) => {
  res.status(409).json({
    code:  "AGENT_ANSWERS",
    error: "Your agent answers for you — watch it play.",
  });
}));

router.post("/battles/:battleId/heartbeat", authenticateToken, asyncHandler(async (req, res) => {
  await db.from("battle_participants").update({ is_connected: true, last_heartbeat: now() })
    .eq("battle_id", req.params.battleId).eq("user_id", req.user.id);
  res.json({ ok: true });
}));

router.get("/battles/:battleId/state", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles")
    .select("status, total_questions, battle_type, review_host").eq("id", req.params.battleId).single();
  if (!battle) return res.status(404).json({ error: "Battle not found" });

  const { data: participants } = await db.from("battle_participants")
    // role: so the arena can tell the hosting teacher from the competitors.
    .select(`user_id, role, score, hp, current_streak, is_connected, user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("battle_id", req.params.battleId).order("score", { ascending: false });

  const { count } = await db.from("battle_viewers").select("id", { count: "exact", head: true }).eq("battle_id", req.params.battleId);
  // battle_type too: the arena has to know whether the learner answers (a
  // study review) or watches their agent (everything else), and the card it was
  // opened from does not always carry it — accepting an invitation opens the
  // arena with only an id and a status.
  res.json({
    status: battle.status, battleType: battle.battle_type, reviewHost: battle.review_host ?? null,
    totalQuestions: battle.total_questions ?? 0,
    participants: participants ?? [], viewer_count: count ?? 0,
  });
}));

router.post("/battles/:battleId/start", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("*").eq("id", req.params.battleId).eq("created_by", req.user.id).single();
  if (!battle || !["lobby", "scheduled"].includes(battle.status)) return res.status(404).json({ error: "Battle not found or not authorised" });

  // Count PLAYERS, not seats. Since an unscheduled battle has no deadline to
  // start it, Start Now is the creator's way to run it without waiting for the
  // last learner — so it has to answer the same question the worker asks:
  // whoever accepted and did not decline, excluding the teacher, who hosts it.
  const { data: seats } = await db.from("battle_participants")
    .select("role, joined_at, declined_at").eq("battle_id", battle.id);
  const players = (seats ?? []).filter((p) => p.role !== "teacher" && p.joined_at && !p.declined_at).length;
  // A review is one learner; a 2v2 needs all four; anything else two.
  const need = minPlayersFor(battle);
  if (players < need) {
    const waiting = (seats ?? []).filter((p) => p.role !== "teacher" && !p.joined_at && !p.declined_at).length;
    return res.status(400).json({
      error: waiting
        ? `Only ${players} learner${players === 1 ? " has" : "s have"} accepted so far — ${waiting} still to answer. This needs ${need}.`
        : `This needs at least ${need} learner${need === 1 ? "" : "s"} who have accepted.`,
    });
  }

  await addLater(await getBattleQueue(), "start-battle", { action: "start-battle", battleId: battle.id }, { delay: 1000 });
  res.json({ success: true, battle_id: battle.id });
}));

router.post("/battles/:battleId/end", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("created_by, status").eq("id", req.params.battleId).single();
  if (!battle) return res.status(404).json({ error: "Battle not found" });
  if (req.user.role !== "admin" && battle.created_by !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  // Only a battle that is running can be ended — ending one that never started
  // would rank and pay invitees who never accepted. Cancel that one instead.
  if (battle.status !== "live") return res.status(409).json({ error: `This battle is ${battle.status} — only a live battle can be ended.` });
  await (await getBattleQueue()).add("end-battle", { action: "end-battle", battleId: req.params.battleId }, { delay: 0 });
  res.json({ success: true });
}));

// ─── RESULTS & REVIEW ─────────────────────────────────────────────────────────

router.get("/battles/:battleId/results", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("*").eq("id", req.params.battleId).single();
  if (!battle) return res.status(404).json({ error: "Battle not found" });
  if (battle.status !== "completed") return res.status(400).json({ error: "Battle not completed", status: battle.status });

  const { data: seats } = await db.from("battle_participants")
    .select(`*, users(username, full_name), user_agents(agent_name, agent_emoji, agent_color, agent_bg)`)
    .eq("battle_id", req.params.battleId).order("final_rank");

  // The teacher hosts the battle rather than competing in it, so they are not
  // on the scoreboard. They used to be — with a score of 0 and the tie broken
  // by HP, that ranked them first and named the teacher the winner of their
  // own class battle.
  const participants = (seats ?? []).filter((p) => p.role !== "teacher");

  const scoreboard = (participants ?? []).map((p) => {
    const total = (p.correct_answers ?? 0) + (p.wrong_answers ?? 0);
    return {
      rank: p.final_rank, userId: p.user_id,
      username: p.users?.username, agentName: p.user_agents?.agent_name,
      agentEmoji: p.user_agents?.agent_emoji, agentColor: p.user_agents?.agent_color,
      score: p.score, hp: p.hp, correctAnswers: p.correct_answers, wrongAnswers: p.wrong_answers,
      accuracy: total > 0 ? Math.round((p.correct_answers / total) * 100) : 0,
      maxStreak: p.max_streak, xpEarned: p.xp_earned, isWinner: !!p.is_winner, isMe: p.user_id === req.user.id,
    };
  });

  // ── A REVIEW returns a MARK SHEET, not a scoreboard ──────────────────────
  // Nobody won; the question is what this learner knew. So: every question in
  // order, what they chose, what was right, and the total. A ranking of one is
  // not information, and calling them the winner of a solo review would be
  // actively misleading.
  // An Agent Check (D45) is a mark sheet too: one seat, no winner.
  if (isMarkSheet(battle.battle_type)) {
    // A class review has a seat per learner: each sees their own sheet (anyone else, the first).
    const seat = (participants ?? []).find((p) => p.role !== "teacher" && p.user_id === req.user.id)
      ?? (participants ?? []).find((p) => p.role !== "teacher");
    const learner = scoreboard.find((r) => r.userId === seat?.user_id) ?? scoreboard[0] ?? null;

    const { data: questions } = await db.from("battle_questions")
      .select("*").eq("battle_id", battle.id).order("question_order");

    const { data: answers } = seat
      ? await db.from("battle_answers").select("*").eq("participant_id", seat.id)
      : { data: [] };
    const byQuestion = new Map((answers ?? []).map((a) => [a.question_id, a]));

    const sheet = (questions ?? []).map((q) => {
      const options = JSON.parse(q.options_json);
      const a = byQuestion.get(q.id);
      return {
        order:         q.question_order,
        question:      q.question_text,
        topic:         q.topic ?? null,
        options,
        correctIndex:  q.correct_answer_index,
        correctAnswer: options[q.correct_answer_index],
        // null answer = ran out of time. That is different from a wrong
        // answer on a mark sheet, and a teacher reading it needs to see which.
        chosenIndex:   a?.selected_index ?? null,
        chosenAnswer:  a?.selected_index != null ? options[a.selected_index] : null,
        isCorrect:     a ? !!a.is_correct : false,
        answered:      !!a,
        // Agent Check: the notes didn't cover it and the agent picked anyway —
        // not demonstrated, right or wrong.
        guessed:       battle.battle_type === "check" && a?.answer_basis === "unknown",
        responseMs:    a?.response_time_ms ?? null,
      };
    });

    const total   = sheet.length;
    // A guess is not demonstrated, so it is not counted correct (D45).
    const correct = sheet.filter((r) => r.isCorrect && !r.guessed).length;
    const missed  = sheet.filter((r) => !r.answered).length;
    const guessed = sheet.filter((r) => r.guessed).length;

    // Where they actually went wrong, so the teacher does not have to tally it
    // by hand off the sheet.
    const byTopic = {};
    for (const r of sheet) {
      const k = r.topic || "General";
      byTopic[k] ??= { topic: k, total: 0, correct: 0 };
      byTopic[k].total++;
      if (r.isCorrect && !r.guessed) byTopic[k].correct++;
    }

    return res.json({
      type: battle.battle_type,
      battle: { ...battle, duration_formatted: fmtDuration(battle.duration_seconds ?? 0) },
      learner: learner && {
        userId: learner.userId, username: learner.username,
        fullName: (participants ?? []).find((p) => p.user_id === learner.userId)?.users?.full_name ?? null,
        agentName: learner.agentName, agentEmoji: learner.agentEmoji,
        // What the review actually paid. A completed review had no result panel
        // at all — no winner means the battle panel rendered nothing — so the
        // learner saw a finished review and no idea what they got for it.
        xpEarned: seat?.xp_earned ?? 0,
      },
      score: {
        correct, total,
        wrong:      total - correct - missed - guessed,
        unanswered: missed,
        guessed,
        percent:    total ? Math.round((correct / total) * 100) : 0,
      },
      byTopic: Object.values(byTopic)
        .map((t) => ({ ...t, percent: t.total ? Math.round((t.correct / t.total) * 100) : 0 }))
        .sort((x, y) => x.percent - y.percent),   // weakest first — that is the useful order
      markSheet: sheet,
    });
  }

  // The winner the battle actually named — not just the top row. With every
  // agent knocked out, or a team tie, there is none.
  const winner = battle.battle_type === "team" ? null : scoreboard.find((p) => p.isWinner) ?? null;
  const dur = battle.duration_seconds ?? 0;
  res.json({
    battle: { ...battle, duration_formatted: fmtDuration(dur) },
    winner: winner && { userId: winner.userId, agentName: winner.agentName, agentEmoji: winner.agentEmoji, score: winner.score, xpEarned: winner.xpEarned },
    scoreboard,
    // Sergeant, the platform's judge: the verdict once the battle is over.
    judge: { name: "Sergeant", verdict: battle.judge_verdict ?? null },
  });
}));

/**
 * GET /api/battle/battles/:battleId/questions
 *
 * The answer key was already withheld until you'd answered — but the question
 * TEXT was not, at any status. So anyone in a battle could read all fifteen
 * questions during the lobby, and for a scheduled battle that window can be
 * days. In a timed contest, knowing the questions in advance is most of the
 * game, key or no key. Worse for AI-generated battles, where the person who
 * chose the topic is also the one who could read them.
 *
 * A question is now only returned once it has actually been PUT IN PLAY. The
 * worker logs each question as it broadcasts it, so the furthest logged
 * question_order is exactly "what has been shown" — no new column, and it
 * preserves the client's socket-drop fallback, which looks for the first
 * question with no revealed key and finds it as the last item here.
 */
/**
 * GET /api/battle/battles/:battleId/questions.pdf — a FINISHED battle's
 * questions, options, answers and explanations as one PDF (the Questions
 * tab's "Download as PDF"). Before the end the answers aren't everyone's yet.
 */
router.get("/battles/:battleId/questions.pdf", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("id, title, subject, topic, status, actual_end").eq("id", req.params.battleId).maybeSingle();
  if (!battle) return res.status(404).json({ error: "Battle not found" });
  if (battle.status !== "completed") return res.status(409).json({ code: "NOT_FINISHED", error: "The questions can be downloaded once the battle has finished." });
  const { data: questions } = await db.from("battle_questions")
    .select("question_order, question_text, options_json, correct_answer_index, explanation, topic").eq("battle_id", battle.id).order("question_order");
  const { buildQuestionsPdf } = await import("./questionsPdf.js");
  const bytes = await buildQuestionsPdf({ battle, questions: questions ?? [] });
  const name = `${String(battle.title || "battle").replace(/[^\w .-]/g, "").trim() || "battle"} - questions.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.send(Buffer.from(bytes));
}));

router.get("/battles/:battleId/questions", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("status, total_questions").eq("id", req.params.battleId).single();
  if (!battle) return res.status(404).json({ error: "Battle not found" });

  const finished = ["completed", "expired", "cancelled"].includes(battle.status);

  // Not started: say how many there are, show none of them.
  if (!finished && battle.status !== "live") {
    return res.json({ questions: [], total: battle.total_questions ?? 0, notStarted: true });
  }

  const { data: questions } = await db.from("battle_questions")
    .select("*").eq("battle_id", req.params.battleId).order("question_order");
  const { data: participant } = await db.from("battle_participants")
    .select("id").eq("battle_id", req.params.battleId).eq("user_id", req.user.id).maybeSingle();

  // How far the battle has actually got. Battle-wide, not per-participant, so
  // someone who timed out on a question doesn't get stuck behind it.
  let reached = Infinity;
  if (!finished) {
    const { data: log } = await db.from("battle_log")
      .select("question_order").eq("battle_id", req.params.battleId)
      .not("question_order", "is", null).order("question_order", { ascending: false }).limit(1);
    reached = log?.[0]?.question_order ?? 1;
  }

  const inPlay = (questions ?? []).filter((q) => q.question_order <= reached);

  const result = await Promise.all(inPlay.map(async (q) => {
    const myAnswer = participant
      ? (await db.from("battle_answers")
          .select("selected_index, is_correct, xp_gained")
          .eq("participant_id", participant.id).eq("question_id", q.id).maybeSingle()).data
      : null;
    const revealed = finished || !!myAnswer;
    const options  = JSON.parse(q.options_json);
    return {
      questionOrder: q.question_order, questionText: q.question_text, options,
      topic: q.topic, xpValue: q.xp_value,
      correctAnswerIndex: revealed ? q.correct_answer_index : null,
      correctAnswer:      revealed ? options[q.correct_answer_index] : null,
      myAnswer:           myAnswer?.selected_index ?? null,
      isCorrect:          myAnswer?.is_correct     ?? null,
      xpGained:           myAnswer?.xp_gained      ?? null,
    };
  }));

  // `total` stays the real count so progress reads "3 of 15", not "3 of 3".
  res.json({ questions: result, total: battle.total_questions ?? (questions ?? []).length });
}));

router.get("/battles/:battleId/log", authenticateToken, asyncHandler(async (req, res) => {
  const { since } = req.query;
  let query = db.from("battle_log").select("*").eq("battle_id", req.params.battleId).order("created_at");
  if (since) query = query.gt("created_at", since);
  const { data } = await query;
  res.json({ logs: data ?? [], count: data?.length ?? 0 });
}));

// ─── LEADERBOARDS ─────────────────────────────────────────────────────────────

router.get("/courses/:courseId/leaderboard", authenticateToken, asyncHandler(async (req, res) => {
  const { scope = "classroom" } = req.query;
  const { data: rows } = await db.from("xp_leaderboard")
    .select(`*, users(username, full_name), user_agents(agent_name, agent_emoji, agent_color, agent_bg)`)
    .eq("scope", scope === "classroom" ? "battle_course" : scope)
    .eq("scope_ref_id", req.params.courseId)
    .order("rank").limit(50);

  const myEntry = (rows ?? []).find((r) => r.user_id === req.user.id);
  res.json({ leaderboard: (rows ?? []).map((r) => ({ ...r, isMe: r.user_id === req.user.id })), my_rank: myEntry?.rank ?? null, my_xp: myEntry?.total_xp ?? 0, scope });
}));

router.get("/leaderboard/global", authenticateToken, asyncHandler(async (req, res) => {
  const { data } = await db.from("xp_leaderboard")
    .select(`*, users(username, full_name), user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("scope", "global").order("total_xp", { ascending: false }).limit(100);
  res.json({ leaderboard: (data ?? []).map((r) => ({ ...r, isMe: r.user_id === req.user.id })) });
}));

// ─── QUESTION BANK ────────────────────────────────────────────────────────────

router.get("/courses/:courseId/questions-bank", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { topic, subject, difficulty } = req.query;
  let query = db.from("question_bank").select("*").eq("course_id", req.params.courseId).eq("is_active", true);
  if (topic)      query = query.eq("topic", topic);
  if (subject)    query = query.eq("subject", subject);
  if (difficulty) query = query.eq("difficulty", difficulty);
  const { data } = await query.order("topic").order("created_at", { ascending: false });
  res.json({ questions: (data ?? []).map((q) => ({ ...q, options: JSON.parse(q.options_json) })), total: data?.length ?? 0 });
}));

router.post("/courses/:courseId/questions-bank", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { question_text, options, correct_answer_index, topic, subject, difficulty, xp_value } = req.body;
  if (!question_text || !options?.length || correct_answer_index === undefined) return res.status(400).json({ error: "question_text, options, and correct_answer_index are required" });
  if (!Array.isArray(options) || options.length !== 4) return res.status(400).json({ error: "options must be an array of exactly 4 strings" });

  const { data, error } = await db.from("question_bank").insert({
    course_id: req.params.courseId, subject, topic, question_text,
    options_json: JSON.stringify(options), correct_answer_index,
    difficulty: difficulty ?? "intermediate", xp_value: xp_value ?? 35,
    created_by: req.user.id,
  }).select().single();
  if (error) throw new Error(error.message);
  res.status(201).json({ success: true, question: data });
}));

router.put("/questions-bank/:questionId", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { question_text, options, correct_answer_index, topic, subject, difficulty, xp_value } = req.body;
  const updates = {};
  if (question_text !== undefined)       updates.question_text        = question_text;
  if (options !== undefined)             updates.options_json         = JSON.stringify(options);
  if (correct_answer_index !== undefined) updates.correct_answer_index = correct_answer_index;
  if (topic !== undefined)               updates.topic      = topic;
  if (subject !== undefined)             updates.subject    = subject;
  if (difficulty !== undefined)          updates.difficulty = difficulty;
  if (xp_value !== undefined)            updates.xp_value   = xp_value;

  await db.from("question_bank").update(updates).eq("id", req.params.questionId).eq("created_by", req.user.id);
  res.json({ success: true });
}));

router.delete("/questions-bank/:questionId", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  await db.from("question_bank").update({ is_active: false }).eq("id", req.params.questionId).eq("created_by", req.user.id);
  res.json({ success: true });
}));

// POST /api/courses/:courseId/questions-bank/generate  (AI generation via Anthropic)
router.post("/courses/:courseId/questions-bank/generate", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { topic, subject, difficulty = "intermediate", count = 15 } = req.body;
  if (!topic || !subject) return res.status(400).json({ error: "topic and subject are required" });

  const message = await openai.chat.completions.create({
    model:      OPENAI_MODEL,
    max_tokens: 2000,
    messages:   [
      { role: "system", content: `You are an expert educator. Generate exactly ${count} multiple-choice questions about "${topic}" for ${subject} at ${difficulty} difficulty. Return ONLY valid JSON with no preamble or markdown. Format: { "questions": [{ "question_text": "...", "options": ["A","B","C","D"], "correct_answer_index": 0, "topic": "${topic}", "xp_value": 35 }] }` },
      { role: "user", content: `Generate ${count} ${difficulty} ${subject} questions about ${topic}.` },
    ],
  });

  const raw = (message.choices?.[0]?.message?.content ?? "").replace(/```json|```/g, "").trim();
  const { questions } = JSON.parse(raw);

  let inserted = 0;
  for (const q of questions) {
    if (!q.question_text || !Array.isArray(q.options) || q.correct_answer_index === undefined) continue;
    await db.from("question_bank").insert({
      course_id: req.params.courseId, subject, topic, question_text: q.question_text,
      options_json: JSON.stringify(q.options), correct_answer_index: q.correct_answer_index,
      difficulty, xp_value: q.xp_value ?? 35, created_by: req.user.id, is_ai_generated: true,
    });
    inserted++;
  }

  res.status(201).json({ success: true, generated: inserted, topic, subject, difficulty });
}));

// The routes a recurring series runs in-process (battle/series.js).
export const occurrenceHandlers = { classInvite, courseInvite, declineChallenge };

export default router;

// ─── § RESPONSE HELPERS (used by the endpoints below) ────────────────────────
const res200 = (res, data)      => res.status(200).json({ success: true,  data });
const res201 = (res, data)      => res.status(201).json({ success: true,  data });
const res400 = (res, message)   => res.status(400).json({ success: false, error: message });
const res403 = (res, message)   => res.status(403).json({ success: false, error: message });
const res404 = (res, message)   => res.status(404).json({ success: false, error: message });

// ─── § MISSING ENDPOINTS — added per frontend audit ──────────────────────────

/**
 * PUT /api/battle/battles/:battleId
 * Edit battle title, XP pool, time limit, total questions.
 * Only allowed while battle is in lobby or scheduled state.
 */
router.put("/battles/:battleId", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("id, created_by, status").eq("id", req.params.battleId).single();
  if (!battle) return res404(res, "Battle not found");
  if (req.user.role !== "admin" && battle.created_by !== req.user.id) return res403(res, "Not authorised");
  // Anything that isn't in flight or finished is editable. Restricting this to
  // lobby/scheduled meant a battle that had expired or been cancelled could
  // never be fixed and re-used — you had to build it again from scratch.
  if (["live", "completed"].includes(battle.status)) return res400(res, `Cannot edit a ${battle.status} battle`);

  const allowed = ["title", "description", "topic", "subject", "difficulty", "xp_prize", "xp_pool", "time_limit_seconds", "total_questions", "max_participants", "scheduled_start", "hp_per_miss", "min_xp"];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  if ("hp_per_miss" in updates) updates.hp_per_miss = cleanHpPerMiss(updates.hp_per_miss);
  if ("min_xp" in updates) updates.min_xp = Math.max(0, Math.round(Number(updates.min_xp) || 0));
  // The questions are already written for the count it was made with; a
  // different count would leave the card and the paper disagreeing.
  if ("total_questions" in updates) {
    const { count: written } = await db.from("battle_questions").select("id", { count: "exact", head: true }).eq("battle_id", req.params.battleId);
    if (written && Number(updates.total_questions) !== written) {
      return res400(res, `This battle's ${written} questions are already written — make a new battle to change how many.`);
    }
    delete updates.total_questions;
  }

  if (!Object.keys(updates).length) return res400(res, "No valid fields to update");
  updates.updated_at = new Date().toISOString();

  const { data, error } = await db.from("battles").update(updates).eq("id", req.params.battleId).select().single();
  if (error) throw new Error(error.message);
  res200(res, data);
}));

/**
 * DELETE /api/battle/battles/:battleId
 *
 * Removes a battle for good — participants, questions and logs cascade with it.
 * Only the creator (or an admin) may, and never while it is live: deleting a
 * battle mid-round would strand everyone currently answering. Finished battles
 * CAN be deleted; they are the creator's own history to clear.
 *
 * ?cancel=1 keeps the record and just marks it cancelled, which is what the
 * older /challenges/:id route does.
 */
router.delete("/battles/:battleId", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles")
    .select("id, created_by, status, title").eq("id", req.params.battleId).single();
  if (!battle) return res404(res, "Battle not found");
  if (req.user.role !== "admin" && battle.created_by !== req.user.id) return res403(res, "Not authorised");
  if (battle.status === "live") return res400(res, "Cannot delete a battle that is live — end it first");

  if (req.query.cancel === "1") {
    const { error } = await db.from("battles").update({ status: "cancelled" }).eq("id", battle.id);
    if (error) throw new Error(error.message);
    return res200(res, { id: battle.id, cancelled: true });
  }

  // Tell everyone who was invited, so a battle doesn't just vanish from their
  // list with no explanation.
  const { data: parts } = await db.from("battle_participants")
    .select("user_id").eq("battle_id", battle.id).neq("user_id", battle.created_by);
  for (const p of (parts ?? [])) {
    await notifyUser(p.user_id, "battle_cancelled", `Battle cancelled: ${battle.title}`,
      "The person who created it has removed this battle.", battle.id).catch(() => {});
  }

  const { error } = await db.from("battles").delete().eq("id", battle.id);
  if (error) throw new Error(error.message);
  res200(res, { id: battle.id, deleted: true });
}));

/**
 * GET /api/battle/instructor/stats
 * Aggregated battle stats for the teacher dashboard:
 *   live count, total battles, total XP in play, agent win rate
 */
router.get("/instructor/stats", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const teacherId = req.user.id;

  // Get all courses owned by this teacher
  const { data: courses } = await db.from("courses").select("id").eq("instructor_id", teacherId);
  const courseIds = (courses ?? []).map((c) => c.id);

  if (!courseIds.length) {
    return res200(res, { live_now: 0, total_battles: 0, total_xp_in_play: 0, agent_win_rate: 0 });
  }

  const { data: battles } = await db.from("battles")
    .select("id, status, xp_pool, created_by")
    .in("course_id", courseIds);

  const all       = battles ?? [];
  const liveNow   = all.filter((b) => b.status === "live").length;
  const totalXP   = all.filter((b) => ["lobby","scheduled","live"].includes(b.status))
    .reduce((s, b) => s + (b.xp_pool ?? 0), 0);

  // Agent win rate from xp_leaderboard battle_course scope
  const { data: agentXP } = await db.from("user_agents").select("total_xp").eq("user_id", teacherId).single();

  // Battle win rate
  const { data: participated } = await db.from("battle_participants")
    .select("is_winner, battle_id")
    .eq("user_id", teacherId);

  const played    = (participated ?? []).length;
  const won       = (participated ?? []).filter((p) => p.is_winner).length;
  const winRate   = played > 0 ? Math.round((won / played) * 100) : 0;

  res200(res, {
    live_now:         liveNow,
    total_battles:    all.length,
    total_xp_in_play: totalXP,
    agent_win_rate:   winRate,
    agent_xp:         agentXP?.total_xp ?? 0,
    battles_played:   played,
    battles_won:      won,
  });
}));

/**
 * GET /api/battle/courses/:courseId/battles/session/:sessionId
 * Session-scoped battles — battles tied to a specific live session.
 * The frontend creates a "this session" battle scope.
 * Implemented as a classroom battle filtered by session metadata.
 */
router.get("/courses/:courseId/battles/session/:sessionId", authenticateToken, asyncHandler(async (req, res) => {
  const { data, error } = await db.from("battles")
    .select("*, users!battles_created_by_fkey(full_name)")
    .eq("course_id", req.params.courseId)
    .eq("battle_type", "classroom")
    .contains("provider_response", { session_id: req.params.sessionId });

  if (error) throw new Error(error.message);
  res200(res, data ?? []);
}));

/**
 * POST /api/battle/courses/:courseId/battles/session
 * Create a battle scoped to a specific live session.
 * Frontend "Battle scope: This session" option.
 */
router.post("/courses/:courseId/battles/session", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const {
    session_id, title, topic, subject,
    difficulty = "hard", total_questions = 10,
    time_limit_seconds = 600, xp_pool = 300,
    expires_in_minutes = 120,
  } = req.body;

  if (!session_id || !title) return res400(res, "session_id and title are required");

  const { data: course } = await db.from("courses").select("instructor_id").eq("id", courseId).single();
  if (!course || course.instructor_id !== req.user.id) return res403(res, "Not your course");

  const teacherAgent = await resolveAgent(req.user.id);
  if (!teacherAgent) return res400(res, "Create your agent first");

  // Unscheduled (it starts five seconds from now): the idle deadline, as on the
  // other unscheduled routes. This read an undefined `scheduled_for` and threw.
  const expiresAt = idleDeadline();

  const { data: battle, error } = await db.from("battles").insert({
    hp_per_miss: cleanHpPerMiss(req.body?.hp_per_miss),
    min_xp: Math.max(0, Math.round(Number(req.body?.min_xp) || 0)),
    course_id: courseId, battle_type: "classroom", title,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize: xp_pool, xp_pool,
    status: "lobby", expires_at: expiresAt, created_by: req.user.id,
    provider_response: { session_id, scope: "session" },
  }).select().single();

  if (error) throw new Error(error.message);

  // Auto-register all enrolled students who have agents
  const { data: students } = await db.from("enrollments")
    .select("user_id, user_agents!inner(id)")
    .eq("course_id", courseId).eq("status", "active").neq("user_id", req.user.id);

  for (const s of (students ?? [])) {
    await db.from("battle_participants").upsert({
      battle_id: battle.id, user_id: s.user_id, agent_id: s.user_agents.id, role: "participant", joined_at: new Date().toISOString(),
    }, { onConflict: "battle_id,user_id" });
  }

  await db.from("battles").update({ total_participants: (students?.length ?? 0) + 1 }).eq("id", battle.id);
  await assignQuestions(battle.id, courseId, topic, subject, difficulty, total_questions, time_limit_seconds);

  const q = await getBattleQueue();
  if (expiresAt) {
    await addLater(q, "expire-battle", { action: "expire-battle", battleId: battle.id },
      { delay: Math.max(0, new Date(expiresAt).getTime() - Date.now() + EXPIRE_AFTER_START_MS) });
  }
  await addLater(q, "start-battle", { action: "start-battle", battleId: battle.id }, { delay: 5000 });

  res201(res, { success: true, battle_id: battle.id, session_id, participants: (students?.length ?? 0) + 1 });
}));
