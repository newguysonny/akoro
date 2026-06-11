/**
 * instructor/routes.js  —  Instructor / Teacher Dashboard router
 *
 * Mount in app.js:
 *   import instructorRouter from "./modules/instructor/index.js";
 *   app.use("/api/instructor", instructorRouter);
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § HELPERS
 *  § STATS
 *  § PROFILE
 *  § COURSES
 *  § LIVE SESSIONS
 *  § STUDENTS
 *  § BATTLES
 *  § STREAMING
 *  § ROUTER
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }                         from "express";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";

// ─── § HELPERS ────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const ok     = (res, data)        => res.json({ success: true, data });
const created = (res, data)       => res.status(201).json({ success: true, data });
const err400 = (res, error)       => res.status(400).json({ error });
const err403 = (res, error)       => res.status(403).json({ error });
const err404 = (res, error)       => res.status(404).json({ error });
const err500 = (res, e)           => res.status(500).json({ error: e.message ?? String(e) });

const now = () => new Date().toISOString();

// ─── § STATS ──────────────────────────────────────────────────────────────────

const getStats = asyncHandler(async (req, res) => {
  try {
    const teacherId = req.user.id;

    // Get teacher's courses
    const { data: courses, error: coursesErr } = await db
      .from("courses")
      .select("id, price, status")
      .eq("instructor_id", teacherId);

    if (coursesErr) throw new Error(coursesErr.message);

    const courseIds    = (courses ?? []).map((c) => c.id);
    const activeCourses = (courses ?? []).filter((c) => c.status === "live").length;

    let totalStudents = 0;
    let totalRevenue  = 0;

    if (courseIds.length > 0) {
      // Total enrolled students
      const { count: studentCount, error: enrollErr } = await db
        .from("enrollments")
        .select("id", { count: "exact", head: true })
        .in("course_id", courseIds)
        .eq("status", "active");

      if (enrollErr) throw new Error(enrollErr.message);
      totalStudents = studentCount ?? 0;

      // Total revenue: count enrollments per course × course price
      const { data: enrollmentsByCourse, error: revErr } = await db
        .from("enrollments")
        .select("course_id")
        .in("course_id", courseIds)
        .eq("status", "active");

      if (revErr) throw new Error(revErr.message);

      const priceMap = Object.fromEntries((courses ?? []).map((c) => [c.id, c.price ?? 0]));
      totalRevenue = (enrollmentsByCourse ?? []).reduce(
        (sum, e) => sum + (priceMap[e.course_id] ?? 0),
        0,
      );
    }

    // Agent XP from user_agents
    const { data: agent } = await db
      .from("user_agents")
      .select("xp, level, streak_days")
      .eq("user_id", teacherId)
      .single();

    ok(res, {
      total_students:  totalStudents,
      total_revenue:   totalRevenue,
      active_courses:  activeCourses,
      total_courses:   courseIds.length,
      agent_xp:        agent?.xp         ?? 0,
      agent_level:     agent?.level      ?? 1,
      streak_days:     agent?.streak_days ?? 0,
    });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § PROFILE ────────────────────────────────────────────────────────────────

const getProfile = asyncHandler(async (req, res) => {
  try {
    const [{ data: user, error: userErr }, { data: agent }, { data: notif }] = await Promise.all([
      db.from("users")
        .select("id, full_name, username, email, phone, bio, avatar_url, role, country, school_name, school_type, subjects, language, display_mode, accent_color, two_factor_enabled, created_at")
        .eq("id", req.user.id).single(),
      db.from("user_agents")
        .select("id, agent_name, agent_emoji, xp, level, streak_days")
        .eq("user_id", req.user.id).maybeSingle(),
      db.from("user_notification_preferences")
        .select("*").eq("user_id", req.user.id).maybeSingle(),
    ]);

    if (userErr || !user) return err404(res, "User not found");

    ok(res, {
      ...user,
      agent: agent ?? null,
      notif: notif ? {
        email:            notif.email_enabled,
        push:             notif.push_enabled,
        sessionReminders: notif.notify_session_reminders,
        announcements:    notif.notify_new_announcements,
        qaReplies:        notif.notify_qa_replies,
      } : null,
    });
  } catch (e) {
    err500(res, e);
  }
});

const PROFILE_FIELDS = [
  "full_name", "username", "phone", "bio", "avatar_url",
  "country", "school_name", "school_type", "subjects",
  "language", "display_mode", "accent_color", "two_factor_enabled",
];

const updateProfile = asyncHandler(async (req, res) => {
  try {
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => PROFILE_FIELDS.includes(k)),
    );

    if (Object.keys(updates).length === 0)
      return err400(res, `No valid fields provided. Allowed: ${PROFILE_FIELDS.join(", ")}`);

    updates.updated_at = now();

    const { data, error } = await db
      .from("users")
      .update(updates)
      .eq("id", req.user.id)
      .select("id, full_name, username, email, phone, bio, avatar_url, role, country, school_name, school_type, subjects, language, display_mode, accent_color, two_factor_enabled")
      .single();

    if (error) {
      // Unique-violation on username → friendly 400
      if (/duplicate key|unique/i.test(error.message)) return err400(res, "That username is already taken");
      throw new Error(error.message);
    }
    ok(res, data);
  } catch (e) {
    err500(res, e);
  }
});

// PATCH /profile/notifications — upsert into the shared
// user_notification_preferences table (same model as the learner app).
const updateNotifications = asyncHandler(async (req, res) => {
  try {
    const { email, push, sessionReminders, announcements, qaReplies } = req.body ?? {};

    const row = { user_id: req.user.id, updated_at: now() };
    if (email            !== undefined) row.email_enabled            = email;
    if (push             !== undefined) row.push_enabled             = push;
    if (sessionReminders !== undefined) row.notify_session_reminders = sessionReminders;
    if (announcements    !== undefined) row.notify_new_announcements = announcements;
    if (qaReplies        !== undefined) row.notify_qa_replies        = qaReplies;

    if (Object.keys(row).length <= 2)
      return err400(res, "No valid notification fields provided");

    const { error } = await db
      .from("user_notification_preferences")
      .upsert(row, { onConflict: "user_id" });

    if (error) throw new Error(error.message);
    ok(res, { saved: true });
  } catch (e) {
    err500(res, e);
  }
});

const updateAgent = asyncHandler(async (req, res) => {
  try {
    const allowed = ["agent_name", "agent_emoji"];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k)),
    );

    if (Object.keys(updates).length === 0)
      return err400(res, "No valid fields provided. Allowed: agent_name, agent_emoji");

    updates.updated_at = now();

    // Upsert — create agent row if it doesn't exist
    const { data, error } = await db
      .from("user_agents")
      .upsert({ user_id: req.user.id, ...updates }, { onConflict: "user_id" })
      .select()
      .single();

    if (error) throw new Error(error.message);
    ok(res, data);
  } catch (e) {
    err500(res, e);
  }
});

// ─── § COURSES ────────────────────────────────────────────────────────────────

const listCourses = asyncHandler(async (req, res) => {
  try {
    const { data: courses, error } = await db
      .from("courses")
      .select("*")
      .eq("instructor_id", req.user.id)
      .neq("status", "archived")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Enrich each course with enrolled student count
    const enriched = await Promise.all((courses ?? []).map(async (course) => {
      const { count } = await db
        .from("enrollments")
        .select("id", { count: "exact", head: true })
        .eq("course_id", course.id)
        .eq("status", "active");
      return { ...course, enrolled_count: count ?? 0 };
    }));

    ok(res, enriched);
  } catch (e) {
    err500(res, e);
  }
});

const createCourse = asyncHandler(async (req, res) => {
  try {
    const {
      title, description, subject, level,
      language      = "English",
      price         = 0,
      course_type   = "ondemand",
      status        = "draft",
      thumbnail_url = null,
    } = req.body;

    if (!title)   return err400(res, "title is required");
    if (!subject) return err400(res, "subject is required");
    if (!level)   return err400(res, "level is required");

    const { data, error } = await db
      .from("courses")
      .insert({
        instructor_id:    req.user.id,
        title,
        description:   description ?? null,
        subject,
        level,
        language,
        price,
        course_type,
        status,
        thumbnail_url,
        created_at:    now(),
        updated_at:    now(),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    created(res, data);
  } catch (e) {
    err500(res, e);
  }
});

const updateCourse = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: existing } = await db
      .from("courses")
      .select("id, instructor_id")
      .eq("id", id)
      .single();

    if (!existing)                        return err404(res, "Course not found");
    if (existing.instructor_id !== req.user.id) return err403(res, "You do not own this course");

    const forbidden = ["id", "instructor_id", "created_at"];
    const updates   = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => !forbidden.includes(k)),
    );
    updates.updated_at = now();

    const { data, error } = await db
      .from("courses")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    ok(res, data);
  } catch (e) {
    err500(res, e);
  }
});

const deleteCourse = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing } = await db
      .from("courses")
      .select("id, instructor_id")
      .eq("id", id)
      .single();

    if (!existing)                        return err404(res, "Course not found");
    if (existing.instructor_id !== req.user.id) return err403(res, "You do not own this course");

    const { error } = await db
      .from("courses")
      .update({ status: "archived", updated_at: now() })
      .eq("id", id);

    if (error) throw new Error(error.message);
    ok(res, { message: "Course archived" });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § LIVE SESSIONS ──────────────────────────────────────────────────────────

const listSessions = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.query;

    // Get teacher's course IDs first
    let courseQuery = db
      .from("courses")
      .select("id")
      .eq("instructor_id", req.user.id);

    if (courseId) courseQuery = courseQuery.eq("id", courseId);
    const { data: courses, error: cErr } = await courseQuery;
    if (cErr) throw new Error(cErr.message);

    const ids = (courses ?? []).map((c) => c.id);
    if (ids.length === 0) return ok(res, []);

    const { data: sessions, error } = await db
      .from("live_sessions")
      .select(`
        id, title, description, session_type,
        scheduled_start, status, platform, meeting_url,
        max_participants, current_participants, recording_url,
        courses ( id, title )
      `)
      .in("course_id", ids)
      .order("scheduled_start", { ascending: false });

    if (error) throw new Error(error.message);
    ok(res, sessions ?? []);
  } catch (e) {
    err500(res, e);
  }
});

const createSession = asyncHandler(async (req, res) => {
  try {
    const {
      course_id, title, description,
      scheduled_start, duration_minutes = 60,
      platform = "zoom", meeting_url = null,
    } = req.body;

    if (!course_id)       return err400(res, "course_id is required");
    if (!title)           return err400(res, "title is required");
    if (!scheduled_start) return err400(res, "scheduled_start is required");

    // Verify ownership
    const { data: course } = await db
      .from("courses")
      .select("id, instructor_id")
      .eq("id", course_id)
      .single();

    if (!course)                        return err404(res, "Course not found");
    if (course.instructor_id !== req.user.id) return err403(res, "You do not own this course");

    const { data, error } = await db
      .from("live_sessions")
      .insert({
        course_id,
        instructor_id:    req.user.id,
        title,
        description:      description ?? null,
        scheduled_start,
        duration_minutes,
        platform,
        meeting_url,
        status:           "scheduled",
        max_participants: 50,
        created_at:       now(),
        updated_at:       now(),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    created(res, data);
  } catch (e) {
    err500(res, e);
  }
});

const updateSession = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Get session and verify course ownership
    const { data: session } = await db
      .from("live_sessions")
      .select("id, course_id, instructor_id")
      .eq("id", id)
      .single();

    if (!session) return err404(res, "Session not found");

    const { data: course } = await db
      .from("courses")
      .select("id, instructor_id")
      .eq("id", session.course_id)
      .single();

    if (!course || course.instructor_id !== req.user.id)
      return err403(res, "You do not own this session's course");

    const forbidden = ["id", "course_id", "instructor_id", "created_at"];
    const updates   = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => !forbidden.includes(k)),
    );
    updates.updated_at = now();

    const { data, error } = await db
      .from("live_sessions")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    ok(res, data);
  } catch (e) {
    err500(res, e);
  }
});

const deleteSession = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const { data: session } = await db
      .from("live_sessions")
      .select("id, course_id")
      .eq("id", id)
      .single();

    if (!session) return err404(res, "Session not found");

    const { data: course } = await db
      .from("courses")
      .select("id, instructor_id")
      .eq("id", session.course_id)
      .single();

    if (!course || course.instructor_id !== req.user.id)
      return err403(res, "You do not own this session's course");

    const { error } = await db.from("live_sessions").delete().eq("id", id);
    if (error) throw new Error(error.message);

    ok(res, { message: "Session deleted" });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § STUDENTS ───────────────────────────────────────────────────────────────

const listStudents = asyncHandler(async (req, res) => {
  try {
    const { courseId, search, status } = req.query;

    // Get teacher's course IDs
    let cq = db.from("courses").select("id").eq("instructor_id", req.user.id);
    if (courseId) cq = cq.eq("id", courseId);
    const { data: courses, error: cErr } = await cq;
    if (cErr) throw new Error(cErr.message);

    const ids = (courses ?? []).map((c) => c.id);
    if (ids.length === 0) return ok(res, []);

    let q = db
      .from("enrollments")
      .select(`
        id, course_id, status, access_level, enrolled_at,
        users ( id, full_name, email, avatar_url, phone ),
        courses ( id, title )
      `)
      .in("course_id", ids);

    if (status) q = q.eq("status", status);

    const { data: enrollments, error } = await q.order("enrolled_at", { ascending: false });
    if (error) throw new Error(error.message);

    let result = enrollments ?? [];

    // In-memory search filter (Supabase JS doesn't support ilike on joined columns cleanly)
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((e) => {
        const name  = (e.users?.full_name ?? "").toLowerCase();
        const email = (e.users?.email     ?? "").toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }

    ok(res, result);
  } catch (e) {
    err500(res, e);
  }
});

const enrolStudent = asyncHandler(async (req, res) => {
  try {
    const {
      email, fullName, phone,
      courseId, accessLevel = "full",
    } = req.body;

    if (!email)    return err400(res, "email is required");
    if (!courseId) return err400(res, "courseId is required");

    // Verify teacher owns course
    const { data: course } = await db
      .from("courses")
      .select("id, instructor_id")
      .eq("id", courseId)
      .single();

    if (!course)                        return err404(res, "Course not found");
    if (course.instructor_id !== req.user.id) return err403(res, "You do not own this course");

    // Find or create user by email
    let { data: user } = await db
      .from("users")
      .select("id, full_name, email")
      .eq("email", email)
      .single();

    if (!user) {
      const { data: newUser, error: createErr } = await db
        .from("users")
        .insert({
          email,
          full_name: fullName ?? email.split("@")[0],
          phone:     phone ?? null,
          role:      "student",
          created_at: now(),
          updated_at: now(),
        })
        .select()
        .single();

      if (createErr) throw new Error(createErr.message);
      user = newUser;
    }

    // Check not already enrolled
    const { data: existing } = await db
      .from("enrollments")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("course_id", courseId)
      .single();

    if (existing) {
      if (existing.status === "active")
        return err400(res, "Student is already enrolled in this course");

      // Re-activate if previously removed
      const { data: reactivated, error: reErr } = await db
        .from("enrollments")
        .update({ status: "active", access_level: accessLevel, enrolled_at: now() })
        .eq("id", existing.id)
        .select()
        .single();

      if (reErr) throw new Error(reErr.message);
      return ok(res, { enrollment: reactivated, user });
    }

    const { data: enrollment, error: enrolErr } = await db
      .from("enrollments")
      .insert({
        user_id:      user.id,
        course_id:    courseId,
        status:       "active",
        access_level: accessLevel,
        enrolled_at:  now(),
        created_at:   now(),
      })
      .select()
      .single();

    if (enrolErr) throw new Error(enrolErr.message);
    created(res, { enrollment, user });
  } catch (e) {
    err500(res, e);
  }
});

const removeStudent = asyncHandler(async (req, res) => {
  try {
    const { enrollmentId } = req.params;

    // Get enrollment and verify teacher owns the course
    const { data: enrollment } = await db
      .from("enrollments")
      .select("id, course_id")
      .eq("id", enrollmentId)
      .single();

    if (!enrollment) return err404(res, "Enrollment not found");

    const { data: course } = await db
      .from("courses")
      .select("id, instructor_id")
      .eq("id", enrollment.course_id)
      .single();

    if (!course || course.instructor_id !== req.user.id)
      return err403(res, "You do not own this enrollment's course");

    const { error } = await db.from("enrollments").delete().eq("id", enrollmentId);
    if (error) throw new Error(error.message);

    ok(res, { message: "Enrollment removed" });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § BATTLES ────────────────────────────────────────────────────────────────

const listBattles = asyncHandler(async (req, res) => {
  try {
    const { status } = req.query;

    let q = db
      .from("battles")
      .select("*")
      .eq("created_by", req.user.id)
      .order("created_at", { ascending: false });

    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    ok(res, data ?? []);
  } catch (e) {
    err500(res, e);
  }
});

const createBattle = asyncHandler(async (req, res) => {
  try {
    const {
      title, courseId, battleType = "quiz",
      xpPool = 100, questionCount = 10,
      timeLimitSeconds = 300, scheduledStart = null,
    } = req.body;

    if (!title) return err400(res, "title is required");

    // Verify teacher owns course (if provided)
    if (courseId) {
      const { data: course } = await db
        .from("courses")
        .select("id, instructor_id")
        .eq("id", courseId)
        .single();

      if (!course)                        return err404(res, "Course not found");
      if (course.instructor_id !== req.user.id) return err403(res, "You do not own this course");
    }

    const { data: battle, error: battleErr } = await db
      .from("battles")
      .insert({
        title,
        course_id:         courseId ?? null,
        battle_type:       battleType,
        xp_pool:           xpPool,
        question_count:    questionCount,
        time_limit_seconds: timeLimitSeconds,
        scheduled_start:   scheduledStart,
        status:            "pending",
        created_by:        req.user.id,
        created_at:        now(),
        updated_at:        now(),
      })
      .select()
      .single();

    if (battleErr) throw new Error(battleErr.message);

    // Add teacher as creator participant
    await db.from("battle_participants").insert({
      battle_id:  battle.id,
      user_id:    req.user.id,
      role:       "creator",
      joined_at:  now(),
    });

    // Emit socket event
    global.io?.to(`user:${req.user.id}`).emit("battle.created", { battleId: battle.id });

    created(res, battle);
  } catch (e) {
    err500(res, e);
  }
});

const updateBattle = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing } = await db
      .from("battles")
      .select("id, created_by")
      .eq("id", id)
      .single();

    if (!existing)                         return err404(res, "Battle not found");
    if (existing.created_by !== req.user.id) return err403(res, "You did not create this battle");

    const forbidden = ["id", "created_by", "created_at"];
    const updates   = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => !forbidden.includes(k)),
    );
    updates.updated_at = now();

    const { data, error } = await db
      .from("battles")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    ok(res, data);
  } catch (e) {
    err500(res, e);
  }
});

const deleteBattle = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing } = await db
      .from("battles")
      .select("id, created_by")
      .eq("id", id)
      .single();

    if (!existing)                         return err404(res, "Battle not found");
    if (existing.created_by !== req.user.id) return err403(res, "You did not create this battle");

    const { error } = await db.from("battles").delete().eq("id", id);
    if (error) throw new Error(error.message);

    ok(res, { message: "Battle deleted" });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § STREAMING ──────────────────────────────────────────────────────────────

const STREAMING_PLATFORMS = ["zoom", "meet", "teams"];

const getStreaming = asyncHandler(async (req, res) => {
  try {
    const { data: settings } = await db
      .from("user_settings")
      .select("settings")
      .eq("user_id", req.user.id)
      .single();

    const stored   = settings?.settings?.streaming_platforms ?? {};
    const platforms = STREAMING_PLATFORMS.map((p) => ({
      platform:     p,
      connected:    !!stored[p]?.connected,
      meeting_url:  stored[p]?.meeting_url  ?? null,
      connected_at: stored[p]?.connected_at ?? null,
    }));

    ok(res, platforms);
  } catch (e) {
    err500(res, e);
  }
});

const connectStreaming = asyncHandler(async (req, res) => {
  try {
    const { platform, accessToken, meetingUrl } = req.body;

    if (!platform)    return err400(res, "platform is required");
    if (!STREAMING_PLATFORMS.includes(platform))
      return err400(res, `platform must be one of: ${STREAMING_PLATFORMS.join(", ")}`);

    // Get current settings
    const { data: existing } = await db
      .from("user_settings")
      .select("settings")
      .eq("user_id", req.user.id)
      .single();

    const currentSettings = existing?.settings ?? {};
    const streamingPlatforms = currentSettings.streaming_platforms ?? {};

    streamingPlatforms[platform] = {
      connected:    true,
      access_token: accessToken ?? null,
      meeting_url:  meetingUrl  ?? null,
      connected_at: now(),
    };

    const newSettings = { ...currentSettings, streaming_platforms: streamingPlatforms };

    const { data, error } = await db
      .from("user_settings")
      .upsert(
        { user_id: req.user.id, settings: newSettings, updated_at: now() },
        { onConflict: "user_id" },
      )
      .select()
      .single();

    if (error) throw new Error(error.message);

    ok(res, {
      platform,
      connected:   true,
      meeting_url: meetingUrl ?? null,
    });
  } catch (e) {
    err500(res, e);
  }
});

const disconnectStreaming = asyncHandler(async (req, res) => {
  try {
    const { platform } = req.params;

    if (!STREAMING_PLATFORMS.includes(platform))
      return err400(res, `platform must be one of: ${STREAMING_PLATFORMS.join(", ")}`);

    const { data: existing } = await db
      .from("user_settings")
      .select("settings")
      .eq("user_id", req.user.id)
      .single();

    if (!existing) return err404(res, "No settings found");

    const currentSettings    = existing.settings ?? {};
    const streamingPlatforms = currentSettings.streaming_platforms ?? {};

    delete streamingPlatforms[platform];
    const newSettings = { ...currentSettings, streaming_platforms: streamingPlatforms };

    const { error } = await db
      .from("user_settings")
      .update({ settings: newSettings, updated_at: now() })
      .eq("user_id", req.user.id);

    if (error) throw new Error(error.message);

    ok(res, { platform, connected: false, message: `${platform} disconnected` });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

// All routes require authentication and instructor/admin role
router.use(authenticateToken);
router.use(requireRole(["instructor", "admin"]));

// Stats
router.get("/stats", getStats);

// Profile
router.get  ("/profile",        getProfile);
router.patch("/profile",               updateProfile);
router.patch("/profile/notifications", updateNotifications);
router.patch("/profile/agent",         updateAgent);

// Courses
router.get   ("/courses",     listCourses);
router.post  ("/courses",     createCourse);
router.patch ("/courses/:id", updateCourse);
router.delete("/courses/:id", deleteCourse);

// Live Sessions
router.get   ("/sessions",     listSessions);
router.post  ("/sessions",     createSession);
router.patch ("/sessions/:id", updateSession);
router.delete("/sessions/:id", deleteSession);

// Students
router.get   ("/students",                   listStudents);
router.post  ("/students",                   enrolStudent);
router.delete("/students/:enrollmentId",     removeStudent);

// Battles
router.get   ("/battles",     listBattles);
router.post  ("/battles",     createBattle);
router.patch ("/battles/:id", updateBattle);
router.delete("/battles/:id", deleteBattle);

// Streaming platforms
router.get   ("/streaming",              getStreaming);
router.post  ("/streaming/connect",      connectStreaming);
router.delete("/streaming/:platform",    disconnectStreaming);

export default router;
