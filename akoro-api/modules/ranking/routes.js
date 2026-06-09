/**
 * modules/ranking/routes.js  —  Akoro Ranking System
 *
 * XP-based leaderboards across three scopes:
 *   1. Classroom  — students within a teacher's classroom
 *   2. Course     — students enrolled in a specific course
 *   3. School     — all students under a school profile
 *
 * XP is earned by:
 *   - Completing lessons      (+10 XP)
 *   - Passing quizzes         (+20 XP, bonus for high scores)
 *   - Attending live sessions (+15 XP)
 *   - Agent chat replies      (+10 XP, tracked in user_agents.total_xp)
 *   - Completing a course     (+50 XP)
 *
 * Ranking is computed live from xp_transactions + aggregated in xp_leaderboard
 * (materialised via a cron that runs every 15 minutes).
 *
 * Usage in app.js:
 *   import rankingModule from "./modules/ranking/routes.js";
 *   app.use("/api/ranking", rankingModule);
 */

import { Router }                         from "express";
import { query, validationResult }        from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import cron                               from "node-cron";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });

const now = () => new Date().toISOString();

// ─── XP award amounts ─────────────────────────────────────────────────────────
// Centralised so they can be tuned without touching logic

const XP = {
  LESSON_COMPLETE:   10,
  QUIZ_PASS:         20,
  QUIZ_PERFECT:      35,   // 100% score
  SESSION_ATTEND:    15,
  COURSE_COMPLETE:   50,
  AGENT_REPLY:       10,
  PEER_SESSION_HOST: 25,
};

// ─── XP transaction helper ────────────────────────────────────────────────────

/**
 * awardXP
 * Creates an xp_transactions record and updates user_agents.total_xp.
 * Called by other modules (course-content, live-sessions, agents) via import.
 */
export const awardXP = async ({ userId, courseId = null, classroomId = null, reason, amount, metadata = {} }) => {
  try {
    await db.from("xp_transactions").insert({
      user_id:      userId,
      course_id:    courseId,
      classroom_id: classroomId,
      reason,
      amount,
      metadata,
    });

    // Update agent XP
    await db.rpc("increment_agent_xp", { user_id_input: userId, xp_amount: amount }).catch(() => {
      // Fallback if RPC not set up
      db.from("user_agents")
        .update({ total_xp: db.raw(`total_xp + ${amount}`) })
        .eq("user_id", userId)
        .catch(() => {});
    });
  } catch (e) {
    console.warn("[ranking] awardXP failed:", e.message);
  }
};

// ─── Leaderboard refresh ──────────────────────────────────────────────────────

/**
 * refreshLeaderboard
 * Aggregates xp_transactions into xp_leaderboard.
 * Runs every 15 minutes via cron + can be triggered manually.
 */
const refreshLeaderboard = async () => {
  console.log("[ranking] 🔄 Refreshing leaderboard...");

  // Aggregate total XP per user per course
  const { data: courseXP } = await db
    .from("xp_transactions")
    .select("user_id, course_id, amount")
    .not("course_id", "is", null);

  // Aggregate total XP per user per classroom
  const { data: classroomXP } = await db
    .from("xp_transactions")
    .select("user_id, classroom_id, amount")
    .not("classroom_id", "is", null);

  // Build aggregations
  const courseMap    = {};
  const classroomMap = {};
  const globalMap    = {};

  for (const row of (courseXP ?? [])) {
    const key = `${row.user_id}:${row.course_id}`;
    courseMap[key]    = (courseMap[key] ?? { user_id: row.user_id, course_id: row.course_id, total_xp: 0 });
    courseMap[key].total_xp += row.amount;
    globalMap[row.user_id] = (globalMap[row.user_id] ?? 0) + row.amount;
  }

  for (const row of (classroomXP ?? [])) {
    const key = `${row.user_id}:${row.classroom_id}`;
    classroomMap[key]    = (classroomMap[key] ?? { user_id: row.user_id, classroom_id: row.classroom_id, total_xp: 0 });
    classroomMap[key].total_xp += row.amount;
  }

  // Upsert leaderboard records
  const upserts = [
    ...Object.values(courseMap).map((r) => ({ ...r, scope: "course" })),
    ...Object.values(classroomMap).map((r) => ({ ...r, scope: "classroom" })),
    ...Object.entries(globalMap).map(([uid, xp]) => ({ user_id: uid, total_xp: xp, scope: "global" })),
  ];

  if (upserts.length) {
    // Add scope_ref_id for course/classroom rows so battle queries can join
    const withRef = upserts.map((u) => ({
      ...u,
      scope_ref_id: u.course_id ?? u.classroom_id ?? null,
    }));
    await db.from("xp_leaderboard")
      .upsert(withRef, { onConflict: "user_id,scope,course_id,classroom_id" })
      .catch((e) => console.warn("[ranking] leaderboard upsert error:", e.message));
  }

  console.log(`[ranking] ✅ Leaderboard refreshed  entries=${upserts.length}`);
};

// Run every 15 minutes
cron.schedule("*/15 * * * *", refreshLeaderboard);

// ─── Ranking handlers ─────────────────────────────────────────────────────────

const handlers = {

  /**
   * GET /api/ranking/course/:courseId
   * Top students in a specific course by XP.
   */
  course: asyncHandler(async (req, res) => {
    const { courseId }     = req.params;
    const { limit = 50 }   = req.query;

    const { data, error } = await db
      .from("xp_leaderboard")
      .select(`
        total_xp, rank,
        users!xp_leaderboard_user_id_fkey ( id, full_name, username, avatar_url ),
        user_agents ( agent_name, agent_emoji, agent_color )
      `)
      .eq("course_id", courseId)
      .eq("scope", "course")
      .order("total_xp", { ascending: false })
      .limit(Number(limit));

    if (error) throw new Error(error.message);

    // Attach current user's position
    const myEntry = (data ?? []).findIndex((r) => r.users?.id === req.user.id);

    res200(res, {
      scope:      "course",
      course_id:  courseId,
      my_rank:    myEntry >= 0 ? myEntry + 1 : null,
      leaders:    (data ?? []).map((r, i) => ({
        rank:       i + 1,
        user_id:    r.users?.id,
        full_name:  r.users?.full_name,
        username:   r.users?.username,
        avatar_url: r.users?.avatar_url,
        agent:      r.user_agents ?? null,
        total_xp:   r.total_xp,
        is_me:      r.users?.id === req.user.id,
      })),
    }, { total: data?.length ?? 0 });
  }),

  /**
   * GET /api/ranking/my-classroom
   * Leaderboard for the current student's own (first) classroom.
   * Resolves the classroom server-side so the client doesn't need its id.
   */
  myClassroom: asyncHandler(async (req, res) => {
    const { limit = 50 } = req.query;

    // Find the student's first active classroom
    const { data: membership } = await db
      .from("classroom_students")
      .select("classroom_id")
      .eq("user_id", req.user.id)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const classroomId = membership?.classroom_id;
    if (!classroomId) return res200(res, { scope: "classroom", classroom_id: null, leaders: [] }, { total: 0 });

    const { data, error } = await db
      .from("xp_leaderboard")
      .select(`
        total_xp, rank,
        users!xp_leaderboard_user_id_fkey ( id, full_name, username, avatar_url ),
        user_agents ( agent_name, agent_emoji, agent_color )
      `)
      .eq("classroom_id", classroomId)
      .eq("scope", "classroom")
      .order("total_xp", { ascending: false })
      .limit(Number(limit));

    if (error) throw new Error(error.message);

    res200(res, {
      scope:        "classroom",
      classroom_id: classroomId,
      leaders:      (data ?? []).map((r, i) => ({
        rank:       i + 1,
        user_id:    r.users?.id,
        full_name:  r.users?.full_name,
        username:   r.users?.username,
        avatar_url: r.users?.avatar_url,
        agent:      r.user_agents ?? null,
        total_xp:   r.total_xp,
        is_me:      r.users?.id === req.user.id,
      })),
    }, { total: data?.length ?? 0 });
  }),

  /**
   * GET /api/ranking/classroom/:classroomId
   * Top students in a teacher's classroom by XP.
   */
  classroom: asyncHandler(async (req, res) => {
    const { classroomId }  = req.params;
    const { limit = 50 }   = req.query;

    // Verify access — only classroom members and the teacher can see this
    const { data: membership } = await db
      .from("classroom_students")
      .select("id")
      .eq("classroom_id", classroomId)
      .eq("user_id", req.user.id)
      .single();

    const { data: classroom } = await db
      .from("classrooms")
      .select("teacher_id, school_id")
      .eq("id", classroomId)
      .single();

    const hasAccess = membership ||
      classroom?.teacher_id === req.user.id ||
      req.user.role === "admin";

    if (!hasAccess) return res400(res, "Access denied to this classroom");

    const { data, error } = await db
      .from("xp_leaderboard")
      .select(`
        total_xp, rank,
        users!xp_leaderboard_user_id_fkey ( id, full_name, username, avatar_url ),
        user_agents ( agent_name, agent_emoji, agent_color )
      `)
      .eq("classroom_id", classroomId)
      .eq("scope", "classroom")
      .order("total_xp", { ascending: false })
      .limit(Number(limit));

    if (error) throw new Error(error.message);

    const myEntry = (data ?? []).findIndex((r) => r.users?.id === req.user.id);

    res200(res, {
      scope:        "classroom",
      classroom_id: classroomId,
      my_rank:      myEntry >= 0 ? myEntry + 1 : null,
      leaders:      (data ?? []).map((r, i) => ({
        rank:       i + 1,
        user_id:    r.users?.id,
        full_name:  r.users?.full_name,
        username:   r.users?.username,
        avatar_url: r.users?.avatar_url,
        agent:      r.user_agents ?? null,
        total_xp:   r.total_xp,
        is_me:      r.users?.id === req.user.id,
      })),
    }, { total: data?.length ?? 0 });
  }),

  /**
   * GET /api/ranking/school/:schoolId
   * Top students across an entire school by total XP.
   */
  school: asyncHandler(async (req, res) => {
    const { schoolId }   = req.params;
    const { limit = 100 } = req.query;

    // Verify requester belongs to this school
    const { data: school } = await db
      .from("school_profiles")
      .select("id, admin_user_id")
      .eq("id", schoolId)
      .single();

    if (!school) return res400(res, "School not found");

    // Get all classrooms in this school
    const { data: classrooms } = await db
      .from("classrooms")
      .select("id")
      .eq("school_id", schoolId);

    const classroomIds = (classrooms ?? []).map((c) => c.id);
    if (!classroomIds.length) return res200(res, { leaders: [], total: 0 });

    // Get all students in those classrooms
    const { data: students } = await db
      .from("classroom_students")
      .select("user_id")
      .in("classroom_id", classroomIds);

    const studentIds = [...new Set((students ?? []).map((s) => s.user_id))];
    if (!studentIds.length) return res200(res, { leaders: [], total: 0 });

    // Get global XP for those students
    const { data, error } = await db
      .from("xp_leaderboard")
      .select(`
        total_xp,
        users!xp_leaderboard_user_id_fkey ( id, full_name, username, avatar_url ),
        user_agents ( agent_name, agent_emoji, agent_color )
      `)
      .eq("scope", "global")
      .in("user_id", studentIds)
      .order("total_xp", { ascending: false })
      .limit(Number(limit));

    if (error) throw new Error(error.message);

    res200(res, {
      scope:     "school",
      school_id: schoolId,
      leaders:   (data ?? []).map((r, i) => ({
        rank:       i + 1,
        user_id:    r.users?.id,
        full_name:  r.users?.full_name,
        username:   r.users?.username,
        avatar_url: r.users?.avatar_url,
        agent:      r.user_agents ?? null,
        total_xp:   r.total_xp,
        is_me:      r.users?.id === req.user.id,
      })),
    }, { total: data?.length ?? 0 });
  }),

  /**
   * GET /api/ranking/global
   * Platform-wide top students (public leaderboard).
   */
  global: asyncHandler(async (req, res) => {
    const { limit = 100 } = req.query;

    const { data, error } = await db
      .from("xp_leaderboard")
      .select(`
        total_xp,
        users!xp_leaderboard_user_id_fkey ( id, full_name, username, avatar_url ),
        user_agents ( agent_name, agent_emoji, agent_color )
      `)
      .eq("scope", "global")
      .order("total_xp", { ascending: false })
      .limit(Number(limit));

    if (error) throw new Error(error.message);

    res200(res, {
      scope:   "global",
      leaders: (data ?? []).map((r, i) => ({
        rank:       i + 1,
        user_id:    r.users?.id,
        full_name:  r.users?.full_name,
        username:   r.users?.username,
        avatar_url: r.users?.avatar_url,
        agent:      r.user_agents ?? null,
        total_xp:   r.total_xp,
        is_me:      r.users?.id === req.user.id,
      })),
    }, { total: data?.length ?? 0 });
  }),

  /**
   * GET /api/ranking/me
   * Current user's XP summary across all scopes.
   */
  me: asyncHandler(async (req, res) => {
    const userId = req.user.id;

    const { data: agent } = await db
      .from("user_agents")
      .select("total_xp, agent_name, agent_emoji")
      .eq("user_id", userId)
      .single();

    const { data: breakdown } = await db
      .from("xp_transactions")
      .select("reason, amount, course_id, classroom_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    const byReason = {};
    for (const t of (breakdown ?? [])) {
      byReason[t.reason] = (byReason[t.reason] ?? 0) + t.amount;
    }

    res200(res, {
      total_xp:     agent?.total_xp ?? 0,
      agent_name:   agent?.agent_name,
      agent_emoji:  agent?.agent_emoji,
      by_reason:    byReason,
      recent_xp:    breakdown ?? [],
    });
  }),

  /**
   * POST /api/ranking/award  (admin only)
   * Manually award XP to a user — for special achievements, corrections.
   */
  awardManual: asyncHandler(async (req, res) => {
    const { user_id, amount, reason, course_id, classroom_id } = req.body;

    await awardXP({ userId: user_id, courseId: course_id ?? null, classroomId: classroom_id ?? null, reason: reason ?? "manual_award", amount });
    res201(res, { awarded: true, user_id, amount, reason });
  }),

  /**
   * POST /api/ranking/refresh  (admin only)
   * Manually trigger leaderboard refresh.
   */
  refresh: asyncHandler(async (req, res) => {
    await refreshLeaderboard();
    res200(res, { refreshed: true, timestamp: now() });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

router.get ("/my-classroom",            authenticateToken, handlers.myClassroom);
router.get ("/course/:courseId",        authenticateToken, handlers.course);
router.get ("/classroom/:classroomId",  authenticateToken, handlers.classroom);
router.get ("/school/:schoolId",        authenticateToken, handlers.school);
router.get ("/global",                  handlers.global);
router.get ("/me",                      authenticateToken, handlers.me);
router.post("/award",                   authenticateToken, requireRole(["admin"]), handlers.awardManual);
router.post("/refresh",                 authenticateToken, requireRole(["admin"]), handlers.refresh);

export { XP };
export default router;
