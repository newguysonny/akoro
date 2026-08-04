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
export const awardXP = async ({ userId, courseId = null, classroomId = null, reason, amount, metadata = {}, subject = null }) => {
  try {
    // Subject powers the per-subject leaderboards. Callers that know it pass
    // it; for course XP we can always derive it, so the caller doesn't have to.
    let subj = subject || metadata?.subject || null;
    if (!subj && courseId) {
      const { data: c } = await db.from("courses").select("subject").eq("id", courseId).maybeSingle();
      subj = c?.subject || null;
    }

    await db.from("xp_transactions").insert({
      user_id:      userId,
      course_id:    courseId,
      classroom_id: classroomId,
      reason,
      amount,
      metadata,
      subject:      subj,
    });

    // Update agent XP
    const { error: xpErr } = await db.rpc("increment_agent_xp", { user_id_input: userId, xp_amount: amount });
    if (xpErr) {
      // Fallback if RPC not set up — read-modify-write the XP total.
      const { data: agentRow } = await db.from("user_agents")
        .select("total_xp").eq("user_id", userId).maybeSingle();
      if (agentRow) {
        await db.from("user_agents")
          .update({ total_xp: (agentRow.total_xp ?? 0) + amount })
          .eq("user_id", userId);
      }
    }
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

  // ── Aggregate all XP ──────────────────────────────────────────────────────
  const { data: txns } = await db.from("xp_transactions").select("user_id, course_id, amount");

  const globalMap = {};   // user_id -> total xp (ALL sources, so global is complete)
  const courseMap = {};   // `${user}:${course}` -> { user_id, course_id, total_xp }
  for (const t of (txns ?? [])) {
    globalMap[t.user_id] = (globalMap[t.user_id] ?? 0) + (t.amount ?? 0);
    if (t.course_id) {
      const k = `${t.user_id}:${t.course_id}`;
      courseMap[k] = courseMap[k] ?? { user_id: t.user_id, course_id: t.course_id, total_xp: 0 };
      courseMap[k].total_xp += (t.amount ?? 0);
    }
  }

  // Classroom scope = each active member's total XP credited to their classroom
  // (transactions rarely carry classroom_id, so derive it from membership).
  const { data: members } = await db.from("classroom_students").select("user_id, classroom_id").eq("status", "active");
  const classroomMap = {};
  for (const m of (members ?? [])) {
    const k = `${m.user_id}:${m.classroom_id}`;
    classroomMap[k] = { user_id: m.user_id, classroom_id: m.classroom_id, total_xp: globalMap[m.user_id] ?? 0 };
  }

  // ── Build rows + compute rank within each scope group ─────────────────────
  const globalRows    = Object.entries(globalMap).map(([uid, xp]) => ({ user_id: uid, scope: "global",    course_id: null, classroom_id: null, scope_ref_id: null, total_xp: xp }));
  const courseRows    = Object.values(courseMap).map((r)          => ({ user_id: r.user_id, scope: "course",    course_id: r.course_id, classroom_id: null, scope_ref_id: r.course_id, total_xp: r.total_xp }));
  const classroomRows = Object.values(classroomMap).map((r)       => ({ user_id: r.user_id, scope: "classroom", course_id: null, classroom_id: r.classroom_id, scope_ref_id: r.classroom_id, total_xp: r.total_xp }));

  const assignRanks = (rows, groupOf) => {
    const groups = {};
    for (const r of rows) { const g = groupOf(r); (groups[g] ??= []).push(r); }
    for (const g of Object.values(groups)) {
      g.sort((a, b) => b.total_xp - a.total_xp);
      g.forEach((r, i) => { r.rank = i + 1; r.updated_at = now(); });
    }
  };
  assignRanks(globalRows,    () => "g");
  assignRanks(courseRows,    (r) => r.course_id);
  assignRanks(classroomRows, (r) => r.classroom_id);

  const all = [...globalRows, ...courseRows, ...classroomRows];

  // ── Clean rebuild (avoids the NULL-in-UNIQUE upsert duplicate bug). Only the
  // app-managed scopes are rebuilt; battle_course is left to the battle worker.
  try {
    await db.from("xp_leaderboard").delete().in("scope", ["global", "course", "classroom"]);
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500);
      if (chunk.length) await db.from("xp_leaderboard").insert(chunk);
    }
  } catch (e) { console.warn("[ranking] leaderboard rebuild error:", e.message); }

  console.log(`[ranking] ✅ Leaderboard refreshed  entries=${all.length}`);
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
        users!xp_leaderboard_user_id_fkey ( id, full_name, username, avatar_url )
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
  // Resolve the caller's school from their classroom membership, then hand off
  // to the existing school board. Added for the school-website student chat,
  // where the client knows the tenant but not its id.
  // Per-subject boards for the caller's own classroom. Built from
  // xp_transactions rather than xp_leaderboard: the leaderboard table is
  // refreshed periodically and has no subject rows yet, whereas the ledger
  // carries the subject from the moment it's awarded.
  myClassSubjects: asyncHandler(async (req, res) => {
    const { data: membership } = await db
      .from("classroom_students")
      .select("classroom_id")
      .eq("user_id", req.user.id).eq("status", "active")
      .order("joined_at", { ascending: true }).limit(1).maybeSingle();

    const classroomId = membership?.classroom_id;
    if (!classroomId) return res200(res, { scope: "class_subjects", subjects: [] }, { total: 0 });

    const { data: peers } = await db.from("classroom_students")
      .select("user_id").eq("classroom_id", classroomId).eq("status", "active");
    const ids = [...new Set((peers || []).map((p) => p.user_id).filter(Boolean))];
    if (!ids.length) return res200(res, { scope: "class_subjects", subjects: [] }, { total: 0 });

    const { data: tx } = await db.from("xp_transactions")
      .select("user_id, subject, amount")
      .in("user_id", ids).not("subject", "is", null);

    // subject -> user -> xp
    const bySubject = {};
    for (const t of tx || []) {
      const subj = String(t.subject).trim();
      if (!subj) continue;
      (bySubject[subj] ||= {});
      bySubject[subj][t.user_id] = (bySubject[subj][t.user_id] || 0) + (t.amount || 0);
    }

    const { data: users } = await db.from("users")
      .select("id, full_name, username, avatar_url").in("id", ids);
    const nameOf = Object.fromEntries((users || []).map((u) => [u.id, u]));

    const subjects = Object.entries(bySubject).map(([subject, totals]) => ({
      subject,
      leaders: Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .map(([uid, xp], i) => ({
          rank: i + 1,
          user_id: uid,
          name: nameOf[uid]?.full_name || nameOf[uid]?.username || "Unknown",
          avatar_url: nameOf[uid]?.avatar_url || null,
          total_xp: xp,
          is_me: uid === req.user.id,
        })),
    })).sort((a, b) => a.subject.localeCompare(b.subject));

    return res200(res, { scope: "class_subjects", subjects }, { total: subjects.length });
  }),

  mySchool: asyncHandler(async (req, res, next) => {
    const { data: membership } = await db
      .from("classroom_students")
      .select("classroom_id")
      .eq("user_id", req.user.id)
      .eq("status", "active")
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let schoolId = null;
    if (membership?.classroom_id) {
      const { data: cls } = await db.from("classrooms")
        .select("school_id").eq("id", membership.classroom_id).maybeSingle();
      schoolId = cls?.school_id || null;
    }
    if (!schoolId) return res200(res, { scope: "school", leaders: [] }, { total: 0 });

    req.params.schoolId = schoolId;
    return handlers.school(req, res, next);
  }),

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
        users!xp_leaderboard_user_id_fkey ( id, full_name, username, avatar_url )
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
        users!xp_leaderboard_user_id_fkey ( id, full_name, username, avatar_url )
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
        users!xp_leaderboard_user_id_fkey ( id, full_name, username, avatar_url )
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
        users!xp_leaderboard_user_id_fkey ( id, full_name, username, avatar_url )
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

        total_xp:   r.total_xp,
        is_me:      r.users?.id === req.user.id,
      })),
    }, { total: data?.length ?? 0 });
  }),

  /**
   * GET /api/ranking/courses
   * Top COURSES ranked by total XP earned in them (the Courses board).
   */
  courses: asyncHandler(async (req, res) => {
    const { limit = 50 } = req.query;

    const { data: rows } = await db.from("xp_leaderboard").select("course_id, total_xp").eq("scope", "course");
    const xpByCourse = {};
    for (const r of (rows ?? [])) if (r.course_id) xpByCourse[r.course_id] = (xpByCourse[r.course_id] ?? 0) + (r.total_xp ?? 0);

    const ids = Object.keys(xpByCourse);
    if (!ids.length) return res200(res, { scope: "courses", leaders: [] }, { total: 0 });

    const { data: courses } = await db
      .from("courses")
      .select("id, title, subject, cover_image_url, total_students, course_type")
      .in("id", ids);

    const leaders = (courses ?? [])
      .map((c) => ({ id: c.id, name: c.title, subject: c.subject, avatar: c.cover_image_url, type: c.course_type, total_xp: xpByCourse[c.id] ?? 0, students: c.total_students ?? 0 }))
      .sort((a, b) => b.total_xp - a.total_xp)
      .slice(0, Number(limit))
      .map((c, i) => ({ rank: i + 1, ...c }));

    res200(res, { scope: "courses", leaders }, { total: leaders.length });
  }),

  /**
   * GET /api/ranking/schools
   * Top SCHOOLS ranked by aggregate student XP (the Inter-Schools board).
   */
  schools: asyncHandler(async (req, res) => {
    const { limit = 50 } = req.query;

    const [schoolsR, classroomsR, membersR, globalR] = await Promise.all([
      db.from("school_profiles").select("id, name, logo_url"),
      db.from("classrooms").select("id, school_id"),
      db.from("classroom_students").select("user_id, classroom_id").eq("status", "active"),
      db.from("xp_leaderboard").select("user_id, total_xp").eq("scope", "global"),
    ]);

    const xpByUser  = Object.fromEntries((globalR.data ?? []).map((r) => [r.user_id, r.total_xp ?? 0]));
    const schoolOf  = Object.fromEntries((classroomsR.data ?? []).map((c) => [c.id, c.school_id]));
    const agg = {};   // school_id -> { xp, students:Set }
    for (const m of (membersR.data ?? [])) {
      const sid = schoolOf[m.classroom_id];
      if (!sid) continue;
      (agg[sid] ??= { xp: 0, students: new Set() });
      agg[sid].xp += xpByUser[m.user_id] ?? 0;
      agg[sid].students.add(m.user_id);
    }

    const leaders = (schoolsR.data ?? [])
      .map((s) => ({ id: s.id, name: s.name, avatar: s.logo_url, total_xp: agg[s.id]?.xp ?? 0, students: agg[s.id]?.students.size ?? 0 }))
      .sort((a, b) => b.total_xp - a.total_xp)
      .slice(0, Number(limit))
      .map((s, i) => ({ rank: i + 1, ...s }));

    res200(res, { scope: "schools", leaders }, { total: leaders.length });
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
router.get ("/my-school",               authenticateToken, handlers.mySchool);
router.get ("/my-class-subjects",       authenticateToken, handlers.myClassSubjects);
router.get ("/course/:courseId",        authenticateToken, handlers.course);
router.get ("/classroom/:classroomId",  authenticateToken, handlers.classroom);
router.get ("/school/:schoolId",        authenticateToken, handlers.school);
router.get ("/global",                  handlers.global);
router.get ("/courses",                 handlers.courses);
router.get ("/schools",                 handlers.schools);
router.get ("/me",                      authenticateToken, handlers.me);
router.post("/award",                   authenticateToken, requireRole(["admin"]), handlers.awardManual);
router.post("/refresh",                 authenticateToken, requireRole(["admin"]), handlers.refresh);

export { XP };
export default router;
