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
import Anthropic                          from "@anthropic-ai/sdk";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";

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
  try {
    const q = await getBattleQueue();
    const counts = await q.getJobCounts("active", "waiting", "delayed", "completed", "failed");
    res.json({ ok: true, redis: "up", queue: counts, socket: !!global.io });
  } catch (err) {
    res.status(200).json({ ok: false, redis: "down", socket: !!global.io, error: err.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const now = () => new Date().toISOString();

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

async function resolveAgent(userId) {
  const { data } = await db.from("user_agents").select("*").eq("user_id", userId).single();
  return data;
}

async function notifyUser(userId, type, title, content, relatedId) {
  await db.from("notifications").insert({ user_id: userId, type, title, content, related_id: relatedId });
  global.io?.to(`user:${userId}`).emit("notification", { type, title, content, relatedId });
}

async function assignQuestions(battleId, courseId, topic, subject, difficulty, total) {
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
      topic: q.topic, xp_value: q.xp_value, time_limit_seconds: 15,
    });
    try { await db.rpc("increment_question_uses", { q_id: q.id }); } catch {}
  }
  return picked.length;
}

// ─── Confidence update (the key feature addition) ─────────────────────────────

/**
 * updateKnowledgeConfidence
 * Called after every battle answer submission.
 *
 * Correct answer  → confidence += 0.05 (capped at 1.0)
 * Wrong answer    → confidence -= 0.05 (floored at 0.0)
 * Topic unknown   → INSERT with confidence = -0.10 (negative = flagged for review)
 *
 * Updates edu.student_knowledge and edu.agent_knowledge in the edu schema.
 * Both tables have a 'confidence' column added in MIGRATIONS_v31.sql.
 */
async function updateKnowledgeConfidence(userId, topic, subject, isCorrect) {
  if (!topic) return;

  try {
    // Get student's agent
    const { data: agent } = await db
      .schema("edu").from("student_agents")
      .select("id").eq("student_id", userId).single();
    if (!agent) return;

    const delta = isCorrect ? 0.05 : -0.05;

    // Try to update existing student_knowledge record
    const { data: existing } = await db
      .schema("edu").from("student_knowledge")
      .select("id, confidence, topic")
      .eq("agent_id", agent.id).eq("topic", topic).single();

    if (existing) {
      // Update confidence — clamp between 0.0 and 1.0
      const newConf = Math.min(1.0, Math.max(0.0, (existing.confidence ?? 0.5) + delta));
      await db.schema("edu").from("student_knowledge").update({
        confidence:      newConf,
        updated_at:      now(),
        next_review_due: isCorrect
          ? new Date(Date.now() + 7  * 86_400_000).toISOString()   // correct → review in 7 days
          : new Date(Date.now() + 1  * 86_400_000).toISOString(),  // wrong   → review in 1 day
      }).eq("id", existing.id);
    } else {
      // Topic not in student's knowledge base — insert with negative confidence
      // Negative score = "encountered but struggled" — triggers review priority
      const initialConf = isCorrect ? 0.40 : -0.10;
      await db.schema("edu").from("student_knowledge").insert({
        agent_id:        agent.id,
        topic,
        subject:         subject ?? null,
        confidence:      initialConf,
        decay_rate:      0.10,
        next_review_due: new Date(Date.now() + (isCorrect ? 7 : 1) * 86_400_000).toISOString(),
        priority:        isCorrect ? "low" : "critical",
      });

      if (!isCorrect) {
        // Log a decay event so the student gets a review notification
        try {
          await db.schema("edu").from("decay_notifications").insert({
            student_id: userId,
            agent_id:   agent.id,
            subject:    subject ?? "General",
            topic,
            confidence: initialConf,
            priority:   "critical",
            message:    `You got a question on "${topic}" wrong in a battle — let's review it!`,
          });
        } catch {}
      }
    }
  } catch (e) {
    // Non-fatal — battle continues even if knowledge update fails
    console.warn("[battle] Knowledge confidence update failed:", e.message);
  }
}

// ─── CREATION ROUTES ─────────────────────────────────────────────────────────

// POST /api/courses/:courseId/battles/challenge
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

  // Prevent duplicate active battles
  const { data: existing } = await db.from("battle_participants")
    .select("battle_id, battles!inner(status)")
    .eq("user_id", opponent_id)
    .in("battles.status", ["lobby", "scheduled", "live"]).limit(1);
  if (existing?.length) return res.status(409).json({ error: "Already have an active battle with this person" });

  const expiresAt   = new Date(Date.now() + expires_in_minutes * 60_000).toISOString();
  const isScheduled = !!scheduled_for && new Date(scheduled_for) > new Date();

  const { data: battle, error } = await db.from("battles").insert({
    course_id: courseId, battle_type: "1v1", title, description: description ?? null,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize, xp_pool: xp_prize,
    status: isScheduled ? "scheduled" : "lobby",
    scheduled_start: scheduled_for ?? null, expires_at: expiresAt,
    created_by: req.user.id,
  }).select().single();

  if (error) throw new Error(error.message);

  await db.from("battle_participants").insert([
    { battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id, role: "creator" },
    { battle_id: battle.id, user_id: opponent_id,  agent_id: oppAgent.id, role: "opponent" },
  ]);

  await assignQuestions(battle.id, courseId, topic, subject, difficulty, total_questions);

  const q = await getBattleQueue();
  await q.add("expire-battle", { action: "expire-battle", battleId: battle.id },
    { delay: new Date(expiresAt).getTime() - Date.now() });
  if (isScheduled) {
    await q.add("start-battle", { action: "start-battle", battleId: battle.id },
      { delay: new Date(scheduled_for).getTime() - Date.now() });
  }

  const { data: me } = await db.from("users").select("full_name, avatar_url").eq("id", req.user.id).single();
  await notifyUser(opponent_id, "battle_challenge",
    `⚔️ ${me?.full_name} challenged you!`,
    `${title} · ${xp_prize} XP · ${isScheduled ? "Scheduled: " + scheduled_for : `Expires in ${expires_in_minutes} min`}`,
    battle.id
  );

  // ── WebSocket: push challenge card directly to opponent's session ─────────
  const io = req.app.get("io");
  if (io) {
    const expiresAt = new Date(Date.now() + expires_in_minutes * 60_000);
    io.to(`user:${opponent_id}`).emit("new_challenge", {
      id:           battle.id,
      challenger:   me?.full_name  ?? "Opponent",
      avatar:       me?.avatar_url ?? `https://i.pravatar.cc/150?u=${req.user.id}`,
      title,
      subject:      req.body.subject ?? "science",
      topic:        req.body.topic   ?? title,
      difficulty,
      battleType:   isScheduled ? "scheduled" : "immediate",
      xpPrize:      `+${xp_prize} XP`,
      timeLimit:    `${Math.round(time_limit_seconds / 60)} min`,
      expiresIn:    `${expires_in_minutes} min`,
      scheduledFor: scheduled_for ?? null,
      courseId,
      status:       isScheduled ? "scheduled" : "lobby",
    });
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

  const expiresAt   = new Date(Date.now() + expires_in_minutes * 60_000).toISOString();
  const isScheduled = !!scheduled_for && new Date(scheduled_for) > new Date();

  const { data: battle, error } = await db.from("battles").insert({
    course_id: courseId, battle_type: "open", title, description: description ?? null,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize, xp_pool: xp_prize,
    max_participants, total_participants: 1,
    status: isScheduled ? "scheduled" : "lobby",
    scheduled_start: scheduled_for ?? null, expires_at: expiresAt, created_by: req.user.id,
  }).select().single();
  if (error) throw new Error(error.message);

  await db.from("battle_participants").insert({
    battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id, role: "creator", joined_at: now(),
  });

  await assignQuestions(battle.id, courseId, topic, subject, difficulty, total_questions);

  const q = await getBattleQueue();
  await q.add("expire-battle", { action: "expire-battle", battleId: battle.id },
    { delay: new Date(expiresAt).getTime() - Date.now() });
  if (isScheduled) {
    await q.add("start-battle", { action: "start-battle", battleId: battle.id },
      { delay: new Date(scheduled_for).getTime() - Date.now() });
  }

  // Notify all enrolled students
  const { data: students } = await db.from("enrollments").select("user_id")
    .eq("course_id", courseId).eq("status", "active").neq("user_id", req.user.id);
  for (const s of (students ?? [])) {
    await notifyUser(s.user_id, "open_battle", `⚔️ Open battle: ${title}`,
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

  const expiresAt   = new Date(Date.now() + expires_in_minutes * 60_000).toISOString();
  const isScheduled = !!scheduled_for && new Date(scheduled_for) > new Date();

  const { data: battle, error } = await db.from("battles").insert({
    course_id: courseId, battle_type: "classroom", title, description: description ?? null,
    topic: topic ?? null, subject: subject ?? null, difficulty,
    total_questions, time_limit_seconds, xp_prize: xp_pool, xp_pool,
    status: isScheduled ? "scheduled" : "lobby",
    scheduled_start: scheduled_for ?? null, expires_at: expiresAt, created_by: req.user.id,
  }).select().single();
  if (error) throw new Error(error.message);

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
    await notifyUser(s.user_id, "classroom_battle", `🏫 Class battle: ${title}`,
      `Your agent is competing! ${isScheduled ? "Starts: " + scheduled_for : "Starting soon!"}`, battle.id);
  }

  await db.from("battles").update({ total_participants: (students?.length ?? 0) + 1 }).eq("id", battle.id);
  await assignQuestions(battle.id, courseId, topic, subject, difficulty, total_questions);

  const q = await getBattleQueue();
  await q.add("expire-battle", { action: "expire-battle", battleId: battle.id },
    { delay: new Date(expiresAt).getTime() - Date.now() });
  const delay = isScheduled ? new Date(scheduled_for).getTime() - Date.now() : 5000;
  await q.add("start-battle", { action: "start-battle", battleId: battle.id }, { delay });

  res.status(201).json({ success: true, battle_id: battle.id, status: isScheduled ? "scheduled" : "starting", participants: (students?.length ?? 0) + 1, expires_at: expiresAt });
}));

// ─── CHALLENGE RESPONSES ──────────────────────────────────────────────────────

router.get("/courses/:courseId/challenges", authenticateToken, asyncHandler(async (req, res) => {
  const { data } = await db.from("battles")
    .select(`*, users!battles_created_by_fkey(full_name, username), user_agents!inner(agent_name, agent_emoji, agent_color, agent_bg)`)
    .eq("course_id", req.params.courseId).eq("battle_type", "1v1").eq("status", "lobby")
    .gt("expires_at", now());
  res.json({ challenges: data ?? [] });
}));

router.get("/challenges/:challengeId", authenticateToken, asyncHandler(async (req, res) => {
  const { data } = await db.from("battles")
    .select(`*, users!battles_created_by_fkey(full_name), user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("id", req.params.challengeId).single();
  if (!data) return res.status(404).json({ error: "Challenge not found" });
  const expiresIn = Math.max(0, Math.floor((new Date(data.expires_at) - Date.now()) / 1000));
  res.json({ battle: data, expires_in_seconds: expiresIn });
}));

router.post("/challenges/:challengeId/accept", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("*").eq("id", req.params.challengeId).eq("status", "lobby").single();
  if (!battle) return res.status(404).json({ error: "Challenge not found or already resolved" });
  if (new Date(battle.expires_at) < new Date()) {
    await db.from("battles").update({ status: "expired" }).eq("id", battle.id);
    return res.status(410).json({ error: "Challenge has expired" });
  }

  const { data: isOpponent } = await db.from("battle_participants").select("id")
    .eq("battle_id", battle.id).eq("user_id", req.user.id).eq("role", "opponent").single();
  if (!isOpponent) return res.status(403).json({ error: "You are not the challenged person" });

  const isScheduled = !!battle.scheduled_start && new Date(battle.scheduled_start) > new Date();
  await db.from("battles").update({ status: isScheduled ? "scheduled" : "live" }).eq("id", battle.id);
  await db.from("battle_participants").update({ joined_at: now() }).eq("battle_id", battle.id).eq("user_id", req.user.id);

  const q = await getBattleQueue();
  const delay = isScheduled ? new Date(battle.scheduled_start).getTime() - Date.now() : 3000;
  await q.add("start-battle", { action: "start-battle", battleId: battle.id }, { delay: Math.max(delay, 0) });

  const { data: me } = await db.from("users").select("full_name, avatar_url").eq("id", req.user.id).single();
  await notifyUser(battle.created_by, "battle_accepted",
    `✅ ${me?.full_name} accepted your challenge!`,
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

router.post("/challenges/:challengeId/decline", authenticateToken, asyncHandler(async (req, res) => {
  const { data: p } = await db.from("battle_participants")
    .select("battle_id, battles!inner(created_by, title, status)")
    .eq("battle_id", req.params.challengeId).eq("user_id", req.user.id).eq("role", "opponent").single();
  if (!p || p.battles?.status !== "lobby") return res.status(404).json({ error: "Challenge not found" });

  await db.from("battles").update({ status: "cancelled" }).eq("id", req.params.challengeId);
  const { data: me } = await db.from("users").select("full_name").eq("id", req.user.id).single();
  await notifyUser(p.battles.created_by, "battle_declined", `❌ ${me?.full_name} declined your challenge`, p.battles.title, req.params.challengeId);
  res.json({ success: true });
}));

router.delete("/challenges/:challengeId", authenticateToken, asyncHandler(async (req, res) => {
  const { error } = await db.from("battles").update({ status: "cancelled" })
    .eq("id", req.params.challengeId).eq("created_by", req.user.id).in("status", ["lobby", "scheduled"]);
  if (error) return res.status(404).json({ error: "Challenge not found or cannot be cancelled" });
  res.json({ success: true });
}));

// ─── OPEN BATTLE LOBBY ────────────────────────────────────────────────────────

router.get("/courses/:courseId/battles/open", authenticateToken, asyncHandler(async (req, res) => {
  const { data: rows } = await db.from("battles")
    .select(`*, users!battles_created_by_fkey(full_name, username), user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("course_id", req.params.courseId).eq("battle_type", "open")
    .in("status", ["lobby", "scheduled"]).gt("expires_at", now()).order("created_at", { ascending: false });

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
  if (new Date(battle.expires_at) < new Date()) return res.status(410).json({ error: "Lobby has expired" });

  const { eligible } = await isEligible(req.user.id, battle.course_id);
  if (!eligible) return res.status(403).json({ error: "Not enrolled" });

  const myAgent = await resolveAgent(req.user.id);
  if (!myAgent) return res.status(400).json({ error: "Create your agent first" });

  const { data: alreadyIn } = await db.from("battle_participants").select("id")
    .eq("battle_id", battle.id).eq("user_id", req.user.id).single();
  if (alreadyIn) return res.status(409).json({ error: "Already in this battle" });

  const { count } = await db.from("battle_participants").select("id", { count: "exact", head: true }).eq("battle_id", battle.id);
  if ((count ?? 0) >= battle.max_participants) return res.status(409).json({ error: "Battle is full" });

  await db.from("battle_participants").insert({ battle_id: battle.id, user_id: req.user.id, agent_id: myAgent.id, role: "participant", joined_at: now() });
  await db.from("battles").update({ total_participants: (count ?? 0) + 1 }).eq("id", battle.id);

  global.io?.to(`battle:${battle.id}`).emit("battle:participant-joined", {
    userId: req.user.id, agentName: myAgent.agent_name, agentEmoji: myAgent.agent_emoji,
    totalParticipants: (count ?? 0) + 1, maxParticipants: battle.max_participants,
  });

  if ((count ?? 0) + 1 >= battle.max_participants && !battle.scheduled_start) {
    await (await getBattleQueue()).add("start-battle", { action: "start-battle", battleId: battle.id }, { delay: 3000 });
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

// POST /api/battles/:battleId/answer  ← CORE CONFIDENCE UPDATE
router.post("/battles/:battleId/answer", authenticateToken, asyncHandler(async (req, res) => {
  const { battleId }  = req.params;
  const { question_order, selected_index, response_time_ms } = req.body;

  if (selected_index === undefined || !question_order) return res.status(400).json({ error: "question_order and selected_index are required" });

  const { data: battle } = await db.from("battles").select("status").eq("id", battleId).single();
  if (!battle || battle.status !== "live") return res.status(400).json({ error: "Battle is not live" });

  const { data: participant } = await db.from("battle_participants").select("*").eq("battle_id", battleId).eq("user_id", req.user.id).single();
  if (!participant) return res.status(403).json({ error: "Not in this battle" });

  const { data: question } = await db.from("battle_questions").select("*").eq("battle_id", battleId).eq("question_order", question_order).single();
  if (!question) return res.status(404).json({ error: "Question not found" });

  const { data: already } = await db.from("battle_answers").select("id").eq("participant_id", participant.id).eq("question_id", question.id).single();
  if (already) return res.status(409).json({ error: "Already answered" });

  const isCorrect  = selected_index === question.correct_answer_index;
  const newStreak  = isCorrect ? (participant.current_streak ?? 0) + 1 : 0;
  const streakBonus = isCorrect ? Math.floor(newStreak * 5) : 0;
  const xpGained   = isCorrect ? question.xp_value + streakBonus : 0;

  await db.from("battle_answers").insert({
    battle_id: battleId, participant_id: participant.id, question_id: question.id,
    selected_index, is_correct: isCorrect, response_time_ms: response_time_ms ?? null,
    xp_gained: xpGained, streak_at_time: newStreak,
  });

  await db.from("battle_participants").update({
    current_streak:  newStreak,
    max_streak:      Math.max(participant.max_streak ?? 0, newStreak),
    correct_answers: (participant.correct_answers ?? 0) + (isCorrect ? 1 : 0),
    wrong_answers:   (participant.wrong_answers ?? 0)   + (isCorrect ? 0 : 1),
  }).eq("id", participant.id);

  // ── Update knowledge confidence ─────────────────────────────────────────
  // This is the key feature: battle answers update the student's knowledge base
  await updateKnowledgeConfidence(req.user.id, question.topic, question.subject, isCorrect);

  // Broadcast updated scoreboard
  const { data: stateRows } = await db.from("battle_participants")
    .select(`user_id, score, hp, current_streak, is_connected, user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("battle_id", battleId).order("score", { ascending: false });

  const { count: answeredCnt } = await db.from("battle_answers").select("id", { count: "exact", head: true }).eq("battle_id", battleId).eq("question_id", question.id);
  const { count: connectedCnt } = await db.from("battle_participants").select("id", { count: "exact", head: true }).eq("battle_id", battleId).eq("is_connected", true);

  global.io?.to(`battle:${battleId}`).emit("battle:state", {
    questionOrder: question_order, answeredCount: answeredCnt,
    participants: (stateRows ?? []).map((p) => ({
      userId: p.user_id, agentName: p.user_agents?.agent_name, agentEmoji: p.user_agents?.agent_emoji,
      score: p.score, hp: p.hp, streak: p.current_streak, isConnected: p.is_connected,
    })),
  });

  // Early reveal if all connected answered
  if ((answeredCnt ?? 0) >= (connectedCnt ?? 1)) {
    await (await getBattleQueue()).add("reveal-question", { action: "reveal-question", battleId, questionOrder: question_order }, { delay: 800 });
  }

  res.json({ success: true, is_correct: isCorrect, xp_gained: xpGained, streak: newStreak });
}));

router.post("/battles/:battleId/heartbeat", authenticateToken, asyncHandler(async (req, res) => {
  await db.from("battle_participants").update({ is_connected: true, last_heartbeat: now() })
    .eq("battle_id", req.params.battleId).eq("user_id", req.user.id);
  res.json({ ok: true });
}));

router.get("/battles/:battleId/state", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("status, total_questions").eq("id", req.params.battleId).single();
  if (!battle) return res.status(404).json({ error: "Battle not found" });

  const { data: participants } = await db.from("battle_participants")
    .select(`user_id, score, hp, current_streak, is_connected, user_agents(agent_name, agent_emoji, agent_color)`)
    .eq("battle_id", req.params.battleId).order("score", { ascending: false });

  const { count } = await db.from("battle_viewers").select("id", { count: "exact", head: true }).eq("battle_id", req.params.battleId);
  res.json({ status: battle.status, participants: participants ?? [], viewer_count: count ?? 0 });
}));

router.post("/battles/:battleId/start", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("*").eq("id", req.params.battleId).eq("created_by", req.user.id).single();
  if (!battle || !["lobby", "scheduled"].includes(battle.status)) return res.status(404).json({ error: "Battle not found or not authorised" });

  const { count } = await db.from("battle_participants").select("id", { count: "exact", head: true }).eq("battle_id", battle.id);
  if ((count ?? 0) < 2) return res.status(400).json({ error: "Need at least 2 participants" });

  await (await getBattleQueue()).add("start-battle", { action: "start-battle", battleId: battle.id }, { delay: 1000 });
  res.json({ success: true, battle_id: battle.id });
}));

router.post("/battles/:battleId/end", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("created_by").eq("id", req.params.battleId).single();
  if (!battle) return res.status(404).json({ error: "Battle not found" });
  if (req.user.role !== "admin" && battle.created_by !== req.user.id) return res.status(403).json({ error: "Not authorised" });
  await (await getBattleQueue()).add("end-battle", { action: "end-battle", battleId: req.params.battleId }, { delay: 0 });
  res.json({ success: true });
}));

// ─── RESULTS & REVIEW ─────────────────────────────────────────────────────────

router.get("/battles/:battleId/results", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("*").eq("id", req.params.battleId).single();
  if (!battle) return res.status(404).json({ error: "Battle not found" });
  if (battle.status !== "completed") return res.status(400).json({ error: "Battle not completed", status: battle.status });

  const { data: participants } = await db.from("battle_participants")
    .select(`*, users(username, full_name), user_agents(agent_name, agent_emoji, agent_color, agent_bg)`)
    .eq("battle_id", req.params.battleId).order("final_rank");

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

  const winner = scoreboard[0];
  const dur = battle.duration_seconds ?? 0;
  res.json({
    battle: { ...battle, duration_formatted: `${String(Math.floor(dur / 60)).padStart(2, "0")}:${String(dur % 60).padStart(2, "0")}` },
    winner: { userId: winner?.userId, agentName: winner?.agentName, score: winner?.score, xpEarned: winner?.xpEarned },
    scoreboard,
  });
}));

router.get("/battles/:battleId/questions", authenticateToken, asyncHandler(async (req, res) => {
  const { data: battle } = await db.from("battles").select("status").eq("id", req.params.battleId).single();
  if (!battle) return res.status(404).json({ error: "Battle not found" });

  const { data: questions } = await db.from("battle_questions").select("*").eq("battle_id", req.params.battleId).order("question_order");
  const { data: participant } = await db.from("battle_participants").select("id").eq("battle_id", req.params.battleId).eq("user_id", req.user.id).single();

  const result = await Promise.all((questions ?? []).map(async (q) => {
    const myAnswer = participant
      ? (await db.from("battle_answers").select("selected_index, is_correct, xp_gained").eq("participant_id", participant.id).eq("question_id", q.id).single()).data
      : null;
    const revealed = battle.status === "completed" || !!myAnswer;
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

  res.json({ questions: result, total: result.length });
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

  const client  = new Anthropic();
  const message = await client.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 2000,
    system:     `You are an expert educator. Generate exactly ${count} multiple-choice questions about "${topic}" for ${subject} at ${difficulty} difficulty. Return ONLY valid JSON with no preamble or markdown. Format: { "questions": [{ "question_text": "...", "options": ["A","B","C","D"], "correct_answer_index": 0, "topic": "${topic}", "xp_value": 35 }] }`,
    messages:   [{ role: "user", content: `Generate ${count} ${difficulty} ${subject} questions about ${topic}.` }],
  });

  const raw = message.content[0].text.replace(/```json|```/g, "").trim();
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

export { updateKnowledgeConfidence };
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
  if (!["lobby", "scheduled"].includes(battle.status)) return res400(res, `Cannot edit a ${battle.status} battle`);

  const allowed = ["title", "description", "topic", "subject", "difficulty", "xp_prize", "xp_pool", "time_limit_seconds", "total_questions", "max_participants", "scheduled_start"];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  if (!Object.keys(updates).length) return res400(res, "No valid fields to update");
  updates.updated_at = new Date().toISOString();

  const { data, error } = await db.from("battles").update(updates).eq("id", req.params.battleId).select().single();
  if (error) throw new Error(error.message);
  res200(res, data);
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

  const expiresAt = new Date(Date.now() + expires_in_minutes * 60_000).toISOString();

  const { data: battle, error } = await db.from("battles").insert({
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
  await assignQuestions(battle.id, courseId, topic, subject, difficulty, total_questions);

  const q = await getBattleQueue();
  await q.add("expire-battle", { action: "expire-battle", battleId: battle.id }, { delay: new Date(expiresAt).getTime() - Date.now() });
  await q.add("start-battle", { action: "start-battle", battleId: battle.id }, { delay: 5000 });

  res201(res, { success: true, battle_id: battle.id, session_id, participants: (students?.length ?? 0) + 1 });
}));
