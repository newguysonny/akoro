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
import multerLib                          from "multer";
import db                                 from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { generateSchedule }               from "./schedule.js";
import { renderDocument }                  from "../school/documentRenderer.js";
import { DEFAULT_DOC_TEMPLATES, getDefaultDoc } from "../school/defaultDocs/index.js";
import { openai, OPENAI_MODEL }            from "../../lib/aiModel.js";
import { parseJsonLoose }                  from "../tasks/tools/_json.js";
import { ensureBucket, uploadPublicFile } from "../school/templateStorage.js";

// In-memory multer for course cover uploads (8 MB cap, images only).
const upload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

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

const notify = async (userId, { type, title, content = null, relatedId = null }) => {
  try {
    const { error } = await db.from("notifications")
      .insert({ user_id: userId, type, title, content, related_id: relatedId });
    if (error) console.warn("[notify] insert failed:", error.message);
  } catch (e) {
    console.warn("[notify] insert threw:", e.message);
  }
};

// Fan-out the same notification to many recipients (e.g. all enrolled students).
const notifyMany = async (userIds, { type, title, content = null, relatedId = null }) => {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (!ids.length) return;
  const rows = ids.map((id) => ({ user_id: id, type, title, content, related_id: relatedId }));
  try {
    const { error } = await db.from("notifications").insert(rows);
    if (error) console.warn("[notify] bulk insert failed:", error.message);
  } catch (e) {
    console.warn("[notify] bulk insert threw:", e.message);
  }
};

// Return the user_ids of all active students enrolled in a course.
const enrolledStudentIds = async (courseId) => {
  const { data } = await db
    .from("enrollments")
    .select("user_id")
    .eq("course_id", courseId)
    .eq("status", "active");
  return (data ?? []).map((r) => r.user_id);
};

// user_agents stores total_xp only; derive a display level (500 XP per level).
const levelFromXp = (xp = 0) => Math.floor((xp ?? 0) / 500) + 1;

const slugify = (s) =>
  (s || "course").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
  + "-" + Math.random().toString(36).slice(2, 8);

// course_type: DB allows 'live' | 'video'. Frontend speaks 'live' | 'on-demand'.
const typeToDb  = (t) => (t === "on-demand" || t === "ondemand" || t === "video" ? "video" : "live");
const typeToApi = (t) => (t === "video" ? "on-demand" : "live");
const VALID_LEVELS = ["beginner", "intermediate", "advanced", "all"];

// Shape a courses row into what the instructor frontend expects.
const mapCourse = (row, enrolledCount = 0) => ({
  ...row,
  type:             typeToApi(row.course_type),
  status:           row.is_published ? "active" : "draft",
  studentsEnrolled: enrolledCount,
  thumbnail:        row.cover_image_url ?? null,
});

const mapSession = (row) => ({
  ...row,
  startTime:     row.scheduled_start,
  enrolledCount: row.current_participants ?? 0,
  courseId:      row.course_id,
  moduleId:      row.module_id ?? null,
  meetingUrl:    row.meeting_url ?? null,
});

const mapModule = (row, sessions = []) => ({
  id:          row.id,
  courseId:    row.course_id,
  title:       row.title,
  description: row.description ?? null,
  orderIndex:  row.order_index ?? 0,
  sessions:    sessions.map(mapSession),
});

const mapBattle = (row) => ({
  ...row,
  topic:            row.topic,
  difficulty:       row.difficulty,
  participantCount: row.total_participants ?? 0,
  maxParticipants:  row.max_participants ?? 0,
  duration:         Math.round((row.time_limit_seconds ?? 0) / 60),
  scheduledAt:      row.scheduled_start,
});

// ─── § STATS ──────────────────────────────────────────────────────────────────

const getStats = asyncHandler(async (req, res) => {
  try {
    const teacherId = req.user.id;

    // Get teacher's courses
    const { data: courses, error: coursesErr } = await db
      .from("courses")
      .select("id, price, is_published")
      .eq("instructor_id", teacherId);

    if (coursesErr) throw new Error(coursesErr.message);

    const courseIds    = (courses ?? []).map((c) => c.id);
    const activeCourses = (courses ?? []).filter((c) => c.is_published).length;

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

      // Total revenue: only count enrollments backed by an actual payment.
      // Manually-added / invited / free enrollments have payment_id = NULL and
      // must not inflate revenue.
      const { data: paidEnrollments, error: revErr } = await db
        .from("enrollments")
        .select("course_id")
        .in("course_id", courseIds)
        .eq("status", "active")
        .not("payment_id", "is", null);

      if (revErr) throw new Error(revErr.message);

      const priceMap = Object.fromEntries((courses ?? []).map((c) => [c.id, c.price ?? 0]));
      totalRevenue = (paidEnrollments ?? []).reduce(
        (sum, e) => sum + (priceMap[e.course_id] ?? 0),
        0,
      );
    }

    // Agent XP from user_agents (only total_xp is stored)
    const { data: agent } = await db
      .from("user_agents")
      .select("total_xp")
      .eq("user_id", teacherId)
      .maybeSingle();

    ok(res, {
      total_students:  totalStudents,
      total_revenue:   totalRevenue,
      active_courses:  activeCourses,
      total_courses:   courseIds.length,
      agent_xp:        agent?.total_xp ?? 0,
      agent_level:     levelFromXp(agent?.total_xp),
      streak_days:     0,
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
        .select("id, agent_name, agent_emoji, agent_color, agent_bg, total_xp")
        .eq("user_id", req.user.id).maybeSingle(),
      db.from("user_notification_preferences")
        .select("*").eq("user_id", req.user.id).maybeSingle(),
    ]);

    if (userErr || !user) return err404(res, "User not found");

    ok(res, {
      ...user,
      agent: agent ? {
        ...agent,
        xp:          agent.total_xp ?? 0,
        level:       levelFromXp(agent.total_xp),
        streak_days: 0,
      } : null,
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
    notify(req.user.id, { type: "profile_updated", title: "Profile updated", content: "Your profile details were saved" });
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
    notify(req.user.id, { type: "settings_updated", title: "Notification preferences updated", content: "Your notification settings were saved" });
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
    notify(req.user.id, { type: "settings_updated", title: "AI agent updated", content: `Agent is now ${data.agent_emoji ?? ""} ${data.agent_name ?? ""}`.trim() });
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
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Enrich each course with enrolled student count
    const enriched = await Promise.all((courses ?? []).map(async (course) => {
      const { count } = await db
        .from("enrollments")
        .select("id", { count: "exact", head: true })
        .eq("course_id", course.id)
        .eq("status", "active");
      return mapCourse(course, count ?? 0);
    }));

    ok(res, enriched);
  } catch (e) {
    err500(res, e);
  }
});

const createCourse = asyncHandler(async (req, res) => {
  try {
    const {
      title, description, subject = null, category = null,
      level, type, course_type, status,
      language      = "English",
      price         = 0,
      discountPrice, discount_price,
      isFree, is_free,
      thumbnail, thumbnail_url,
      maxStudents,  // not a courses column — ignored
    } = req.body;

    if (!title) return err400(res, "title is required");

    const lvl       = VALID_LEVELS.includes(level) ? level : "all";
    const dbType    = typeToDb(type ?? course_type);
    const published = status === "active" || status === "live" || status === "published";
    const priceVal  = Math.round(Number(price) || 0);
    const discount  = discountPrice ?? discount_price;
    const free      = isFree ?? is_free ?? (priceVal === 0);

    const { data, error } = await db
      .from("courses")
      .insert({
        instructor_id:   req.user.id,
        title,
        slug:            slugify(title),
        description:     description ?? null,
        subject:         subject ?? category,
        level:           lvl,
        language,
        price:           priceVal,
        discount_price:  discount != null && discount !== "" ? Math.round(Number(discount)) : null,
        is_free:         !!free,
        course_type:     dbType,
        cover_image_url: thumbnail ?? thumbnail_url ?? null,
        is_published:    published,
        published_at:    published ? now() : null,
        created_at:      now(),
        updated_at:      now(),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    notify(req.user.id, {
      type:      "course_created",
      title:     `Course "${title}" created`,
      content:   `${typeToApi(dbType)} · ${lvl}`,
      relatedId: data.id,
    });
    created(res, mapCourse(data, 0));
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

    // Map frontend vocabulary → real columns, whitelisted.
    const b = req.body;
    const updates = {};
    if (b.title       !== undefined) updates.title           = b.title;
    if (b.description !== undefined) updates.description     = b.description;
    if (b.subject     !== undefined) updates.subject         = b.subject;
    if (b.language    !== undefined) updates.language        = b.language;
    if (b.price       !== undefined) updates.price           = Math.round(Number(b.price) || 0);
    if (b.level       !== undefined) updates.level           = VALID_LEVELS.includes(b.level) ? b.level : "all";
    if (b.type !== undefined || b.course_type !== undefined) updates.course_type = typeToDb(b.type ?? b.course_type);
    if (b.thumbnail !== undefined || b.thumbnail_url !== undefined) updates.cover_image_url = b.thumbnail ?? b.thumbnail_url;
    if (b.status !== undefined) {
      const pub = b.status === "active" || b.status === "live" || b.status === "published";
      updates.is_published = pub;
      updates.published_at = pub ? now() : null;
    }
    if (Object.keys(updates).length === 0) return err400(res, "No updatable fields provided");
    updates.updated_at = now();

    const { data, error } = await db
      .from("courses")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    notify(req.user.id, {
      type:      "course_updated",
      title:     `Course "${data.title}" updated`,
      content:   `Changes saved`,
      relatedId: data.id,
    });
    ok(res, mapCourse(data, 0));
  } catch (e) {
    err500(res, e);
  }
});

const deleteCourse = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing } = await db
      .from("courses")
      .select("id, instructor_id, title")
      .eq("id", id)
      .single();

    if (!existing)                        return err404(res, "Course not found");
    if (existing.instructor_id !== req.user.id) return err403(res, "You do not own this course");

    // No 'archived' state in schema — hard delete (cascades sessions/enrollments).
    const { error } = await db.from("courses").delete().eq("id", id);
    if (error) throw new Error(error.message);
    notify(req.user.id, {
      type:    "course_deleted",
      title:   `Course "${existing.title}" deleted`,
      content: `The course and its sessions were removed`,
    });
    ok(res, { message: "Course deleted" });
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
        id, title, description, session_type, module_id, order_index,
        scheduled_start, scheduled_end, status, platform, meeting_url,
        max_participants, current_participants, recording_url, course_id,
        courses ( id, title )
      `)
      .in("course_id", ids)
      .order("scheduled_start", { ascending: false });

    if (error) throw new Error(error.message);
    ok(res, (sessions ?? []).map(mapSession));
  } catch (e) {
    err500(res, e);
  }
});

const createSession = asyncHandler(async (req, res) => {
  try {
    const b = req.body;
    const courseId       = b.courseId ?? b.course_id;
    const title          = b.title;
    const scheduledStart = b.startTime ?? b.scheduled_start;
    const durationMin    = Number(b.duration ?? b.duration_minutes ?? 60);
    const platform       = b.platform ?? "zoom";
    const meetingUrl     = b.meetingLink ?? b.meeting_url ?? null;

    if (!courseId)       return err400(res, "courseId is required");
    if (!title)          return err400(res, "title is required");
    if (!scheduledStart) return err400(res, "startTime is required");

    // Verify ownership
    const { data: course } = await db
      .from("courses")
      .select("id, instructor_id")
      .eq("id", courseId)
      .single();

    if (!course)                        return err404(res, "Course not found");
    if (course.instructor_id !== req.user.id) return err403(res, "You do not own this course");

    const scheduledEnd = new Date(new Date(scheduledStart).getTime() + durationMin * 60000).toISOString();

    const { data, error } = await db
      .from("live_sessions")
      .insert({
        course_id:        courseId,
        instructor_id:    req.user.id,
        module_id:        b.moduleId ?? b.module_id ?? null,
        order_index:      Number(b.orderIndex ?? b.order_index ?? 0),
        title,
        description:      b.description ?? null,
        scheduled_start:  scheduledStart,
        scheduled_end:    scheduledEnd,
        platform,
        meeting_url:      meetingUrl,
        status:           "scheduled",
        max_participants: 50,
        created_at:       now(),
        updated_at:       now(),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    notify(req.user.id, {
      type:      "session_reminder",
      title:     `Session "${title}" scheduled`,
      content:   `Starts ${new Date(scheduledStart).toLocaleString()}`,
      relatedId: data.id,
    });
    // Recipient side — notify every enrolled student of the new session.
    notifyMany(await enrolledStudentIds(courseId), {
      type:      "session_scheduled",
      title:     `New session: "${title}"`,
      content:   `Starts ${new Date(scheduledStart).toLocaleString()}`,
      relatedId: data.id,
    });
    created(res, mapSession(data));
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

    const b = req.body;
    const updates = {};
    if (b.title       !== undefined) updates.title           = b.title;
    if (b.description !== undefined) updates.description     = b.description;
    if (b.platform    !== undefined) updates.platform        = b.platform;
    if (b.status      !== undefined) updates.status          = b.status;
    if (b.startTime !== undefined || b.scheduled_start !== undefined) updates.scheduled_start = b.startTime ?? b.scheduled_start;
    if (b.meetingLink !== undefined || b.meeting_url !== undefined) updates.meeting_url = b.meetingLink ?? b.meeting_url;
    if (b.moduleId !== undefined || b.module_id !== undefined) updates.module_id = b.moduleId ?? b.module_id;
    if (b.orderIndex !== undefined || b.order_index !== undefined) updates.order_index = Number(b.orderIndex ?? b.order_index);
    if (Object.keys(updates).length === 0) return err400(res, "No updatable fields provided");
    updates.updated_at = now();

    const { data, error } = await db
      .from("live_sessions")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    notify(req.user.id, { type: "session_updated", title: `Session "${data.title}" updated`, content: "Changes saved", relatedId: data.id });
    // Recipient side — only notify students when the time changes (avoid noise).
    if (updates.scheduled_start) {
      notifyMany(await enrolledStudentIds(session.course_id), {
        type:      "session_rescheduled",
        title:     `Session "${data.title}" rescheduled`,
        content:   `Now starts ${new Date(updates.scheduled_start).toLocaleString()}`,
        relatedId: data.id,
      });
    }
    ok(res, mapSession(data));
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

    notify(req.user.id, { type: "session_deleted", title: "Session deleted", content: "A live session was removed" });
    ok(res, { message: "Session deleted" });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § MODULES & SCHEDULE ─────────────────────────────────────────────────────

// Ownership guard — returns the course row or null.
const ownCourse = async (courseId, userId) => {
  const { data } = await db
    .from("courses")
    .select("id, instructor_id")
    .eq("id", courseId)
    .maybeSingle();
  return data && data.instructor_id === userId ? data : null;
};

// GET /api/instructor/courses/:courseId/modules — modules + their sessions.
const listModules = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await ownCourse(courseId, req.user.id))) return err403(res, "You do not own this course");

    const { data: modules, error } = await db
      .from("course_modules")
      .select("*")
      .eq("course_id", courseId)
      .order("order_index", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (modules ?? []).map((m) => m.id);
    let byModule = {};
    if (ids.length) {
      const { data: sessions } = await db
        .from("live_sessions")
        .select("*")
        .in("module_id", ids)
        .order("scheduled_start", { ascending: true });
      for (const s of sessions ?? []) (byModule[s.module_id] ??= []).push(s);
    }

    ok(res, (modules ?? []).map((m) => mapModule(m, byModule[m.id] ?? [])));
  } catch (e) { err500(res, e); }
});

// POST /api/instructor/courses/:courseId/modules — create a single module.
const createModule = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await ownCourse(courseId, req.user.id))) return err403(res, "You do not own this course");
    const { title, description, orderIndex } = req.body;
    if (!title) return err400(res, "title is required");

    const { data, error } = await db
      .from("course_modules")
      .insert({ course_id: courseId, title, description: description ?? null, order_index: Number(orderIndex ?? 0) })
      .select()
      .single();
    if (error) throw new Error(error.message);
    created(res, mapModule(data));
  } catch (e) { err500(res, e); }
});

// PATCH /api/instructor/modules/:id — rename / reorder a module.
const updateModule = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { data: mod } = await db.from("course_modules").select("id, course_id").eq("id", id).maybeSingle();
    if (!mod) return err404(res, "Module not found");
    if (!(await ownCourse(mod.course_id, req.user.id))) return err403(res, "You do not own this module's course");

    const b = req.body, updates = {};
    if (b.title !== undefined)       updates.title = b.title;
    if (b.description !== undefined) updates.description = b.description;
    if (b.orderIndex !== undefined)  updates.order_index = Number(b.orderIndex);
    if (Object.keys(updates).length === 0) return err400(res, "No updatable fields provided");

    const { data, error } = await db.from("course_modules").update(updates).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    ok(res, mapModule(data));
  } catch (e) { err500(res, e); }
});

// DELETE /api/instructor/modules/:id — delete a module (sessions keep, module_id nulled).
const deleteModule = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    const { data: mod } = await db.from("course_modules").select("id, course_id").eq("id", id).maybeSingle();
    if (!mod) return err404(res, "Module not found");
    if (!(await ownCourse(mod.course_id, req.user.id))) return err403(res, "You do not own this module's course");

    const { error } = await db.from("course_modules").delete().eq("id", id);
    if (error) throw new Error(error.message);
    ok(res, { message: "Module deleted" });
  } catch (e) { err500(res, e); }
});

// POST /api/instructor/courses/:courseId/schedule/preview
// Expand a recurrence spec into a module→sessions tree (no writes).
const previewSchedule = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await ownCourse(courseId, req.user.id))) return err403(res, "You do not own this course");
    const tree = generateSchedule(req.body || {});
    ok(res, tree);
  } catch (e) {
    // generator throws plain validation errors — surface as 400.
    return err400(res, e.message);
  }
});

// POST /api/instructor/courses/:courseId/schedule/commit
// Persist an edited module→sessions tree (+ optional per-session materials)
// and save the reusable schedule_config on the course.
const commitSchedule = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await ownCourse(courseId, req.user.id))) return err403(res, "You do not own this course");

    const { modules = [], scheduleConfig } = req.body || {};
    if (!Array.isArray(modules) || modules.length === 0) return err400(res, "modules array is required");

    if (scheduleConfig) {
      await db.from("courses").update({ schedule_config: scheduleConfig, updated_at: now() }).eq("id", courseId);
    }

    const createdModules = [];
    for (const [mi, m] of modules.entries()) {
      const { data: modRow, error: mErr } = await db
        .from("course_modules")
        .insert({ course_id: courseId, title: m.title || `Week ${mi + 1}`, description: m.description ?? null, order_index: Number(m.orderIndex ?? mi) })
        .select()
        .single();
      if (mErr) throw new Error(mErr.message);

      const createdSessions = [];
      for (const [si, s] of (m.sessions ?? []).entries()) {
        if (!s.scheduled_start && !s.startTime) continue;
        const startIso = s.scheduled_start ?? s.startTime;
        const durationMin = Number(s.duration_min ?? s.duration ?? 60);
        const endIso = s.scheduled_end ?? new Date(new Date(startIso).getTime() + durationMin * 60000).toISOString();

        const { data: sess, error: sErr } = await db
          .from("live_sessions")
          .insert({
            course_id:       courseId,
            instructor_id:   req.user.id,
            module_id:       modRow.id,
            order_index:     Number(s.order_index ?? si),
            title:           s.title || `Session ${si + 1}`,
            description:     s.description ?? null,
            topic:           s.topic ?? s.title ?? null,
            scheduled_start: startIso,
            scheduled_end:   endIso,
            platform:        s.platform ?? "zoom",
            status:          "scheduled",
            max_participants: 50,
            created_at:      now(),
            updated_at:      now(),
          })
          .select()
          .single();
        if (sErr) throw new Error(sErr.message);

        // Optional materials for this session.
        const mats = (s.materials ?? []).filter((x) => x && (x.title || x.url || x.body));
        if (mats.length) {
          await db.from("session_materials").insert(
            mats.map((x, xi) => ({
              session_id:  sess.id,
              title:       x.title || x.url || "Material",
              kind:        ["file", "link", "note"].includes(x.kind) ? x.kind : "file",
              url:         x.url ?? null,
              body:        x.body ?? null,
              file_type:   x.fileType ?? x.file_type ?? null,
              order_index: xi,
            }))
          );
        }
        createdSessions.push(sess);
      }
      createdModules.push(mapModule(modRow, createdSessions));
    }

    created(res, { modules: createdModules });
  } catch (e) { err500(res, e); }
});

// POST /api/instructor/courses/:courseId/curriculum
// Persist an on-demand course's sections → video lessons tree.
// Sections map to course_modules; lessons map to the lessons table.
const commitCurriculum = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!(await ownCourse(courseId, req.user.id))) return err403(res, "You do not own this course");

    const { sections = [] } = req.body || {};
    if (!Array.isArray(sections) || sections.length === 0) return err400(res, "sections array is required");

    const createdSections = [];
    for (const [si, s] of sections.entries()) {
      const { data: modRow, error: mErr } = await db
        .from("course_modules")
        .insert({
          course_id:   courseId,
          title:       s.title || `Section ${si + 1}`,
          description: s.description ?? null,
          order_index: Number(s.orderIndex ?? si),
        })
        .select()
        .single();
      if (mErr) throw new Error(mErr.message);

      const createdLessons = [];
      for (const [li, l] of (s.lessons ?? []).entries()) {
        const durationSec = l.durationSeconds != null
          ? Number(l.durationSeconds)
          : Math.round((Number(l.duration) || 0) * 60);  // wizard sends minutes

        const { data: lesson, error: lErr } = await db
          .from("lessons")
          .insert({
            module_id:        modRow.id,
            title:            l.title || `Lesson ${li + 1}`,
            description:      l.description ?? null,
            video_url:        l.videoUrl ?? l.video_url ?? null,
            thumbnail_url:    l.thumbnailUrl ?? l.thumbnail_url ?? null,
            duration_seconds: durationSec || null,
            order_index:      Number(l.orderIndex ?? li),
            is_preview:       !!(l.preview ?? l.is_preview),
            lesson_type:      ["video", "quiz", "assignment", "reading"].includes(l.lessonType) ? l.lessonType : "video",
          })
          .select()
          .single();
        if (lErr) throw new Error(lErr.message);
        createdLessons.push(lesson);
      }
      createdSections.push({ ...modRow, lessons: createdLessons });
    }

    created(res, { sections: createdSections });
  } catch (e) { err500(res, e); }
});

// ─── § SESSION MATERIALS ──────────────────────────────────────────────────────

const sessionOwned = async (sessionId, userId) => {
  const { data: s } = await db.from("live_sessions").select("id, course_id").eq("id", sessionId).maybeSingle();
  if (!s) return null;
  return (await ownCourse(s.course_id, userId)) ? s : null;
};

// GET /api/instructor/sessions/:id/materials
const listMaterials = asyncHandler(async (req, res) => {
  try {
    if (!(await sessionOwned(req.params.id, req.user.id))) return err403(res, "You do not own this session");
    const { data, error } = await db
      .from("session_materials")
      .select("*")
      .eq("session_id", req.params.id)
      .order("order_index", { ascending: true });
    if (error) throw new Error(error.message);
    ok(res, data ?? []);
  } catch (e) { err500(res, e); }
});

// POST /api/instructor/sessions/:id/materials
const addMaterial = asyncHandler(async (req, res) => {
  try {
    if (!(await sessionOwned(req.params.id, req.user.id))) return err403(res, "You do not own this session");
    const b = req.body;
    if (!b.title && !b.url && !b.body) return err400(res, "title, url, or body is required");

    const { data, error } = await db
      .from("session_materials")
      .insert({
        session_id:  req.params.id,
        title:       b.title || b.url || "Material",
        kind:        ["file", "link", "note"].includes(b.kind) ? b.kind : "file",
        url:         b.url ?? null,
        body:        b.body ?? null,
        file_type:   b.fileType ?? b.file_type ?? null,
        order_index: Number(b.orderIndex ?? b.order_index ?? 0),
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    created(res, data);
  } catch (e) { err500(res, e); }
});

// DELETE /api/instructor/materials/:id
const deleteMaterial = asyncHandler(async (req, res) => {
  try {
    const { data: mat } = await db.from("session_materials").select("id, session_id").eq("id", req.params.id).maybeSingle();
    if (!mat) return err404(res, "Material not found");
    if (!(await sessionOwned(mat.session_id, req.user.id))) return err403(res, "You do not own this material");
    const { error } = await db.from("session_materials").delete().eq("id", req.params.id);
    if (error) throw new Error(error.message);
    ok(res, { message: "Material deleted" });
  } catch (e) { err500(res, e); }
});

// ─── § STUDENTS ───────────────────────────────────────────────────────────────

/**
 * listStudents — everyone this teacher teaches.
 *
 * It listed course ENROLMENTS only, and never looked at classroom_students. So
 * a teacher with thirty-eight learners across four classes and no course
 * enrolments saw an empty page — and "2 enrolled learners" when two happened to
 * be on a course. Since a learner is now put in a CLASS first and enrolled on a
 * course only if one is chosen, that made My Students the one place the new
 * arrivals never appeared.
 *
 * Both sources now, merged by learner: a class member who is also enrolled
 * shows once, carrying their class and their courses.
 */
const listStudents = asyncHandler(async (req, res) => {
  try {
    const { courseId, classroomId, search, status } = req.query;

    // ── Course enrolments ────────────────────────────────────────────────
    let cq = db.from("courses").select("id").eq("instructor_id", req.user.id);
    if (courseId) cq = cq.eq("id", courseId);
    const { data: courses, error: cErr } = await cq;
    if (cErr) throw new Error(cErr.message);
    const courseIds = (courses ?? []).map((c) => c.id);

    let enrollments = [];
    if (courseIds.length) {
      let q = db.from("enrollments")
        .select(`id, course_id, status, progress, enrolled_at,
                 users ( id, full_name, email, avatar_url, phone ),
                 courses ( id, title )`)
        .in("course_id", courseIds);
      if (status) q = q.eq("status", status);
      const { data, error } = await q.order("enrolled_at", { ascending: false });
      if (error) throw new Error(error.message);
      enrollments = data ?? [];
    }

    // ── Class members ────────────────────────────────────────────────────
    // Classes this teacher runs, plus every class in a school they administer —
    // the same reach the rest of the platform grants.
    const { data: school } = await db.from("school_profiles")
      .select("id").eq("admin_user_id", req.user.id).limit(1).maybeSingle();

    let rq = db.from("classrooms").select("id, name");
    rq = school ? rq.or(`teacher_id.eq.${req.user.id},school_id.eq.${school.id}`)
                : rq.eq("teacher_id", req.user.id);
    if (classroomId) rq = rq.eq("id", classroomId);
    const { data: rooms } = await rq;

    let members = [];
    const roomIds = (rooms ?? []).map((r) => r.id);
    if (roomIds.length) {
      const { data } = await db.from("classroom_students")
        .select(`id, classroom_id, status, joined_at,
                 users!inner ( id, full_name, email, avatar_url, phone, role )`)
        .in("classroom_id", roomIds).eq("status", "active");
      // A classroom row exists for the teacher too, and for demo/service
      // accounts parked in a room. This is a list of LEARNERS.
      members = (data ?? []).filter((m) =>
        m.users?.id !== req.user.id && (m.users?.role ?? "student") === "student");
    }
    const roomName = new Map((rooms ?? []).map((r) => [r.id, r.name]));

    // ── Merge, learner by learner ────────────────────────────────────────
    const byUser = new Map();
    const seed = (u) => {
      if (!u?.id) return null;
      if (!byUser.has(u.id)) byUser.set(u.id, {
        id: u.id, fullName: u.full_name, email: u.email,
        avatarUrl: u.avatar_url, phone: u.phone,
        progress: 0, status: "active", joinedAt: null,
        classes: [], className: null, classroomId: null,
        course: null, courseId: null, courses: [], coursesEnrolled: 0,
        enrollmentId: null,
      });
      return byUser.get(u.id);
    };

    for (const m of members) {
      const row = seed(m.users);
      if (!row) continue;
      // A learner can be in several rooms. Overwriting left whichever came last,
      // so JSS1 turned into "Riverside High · Class A" for no reason the teacher
      // could see. Keep them all; className stays as the first for callers that
      // only render one.
      const name = roomName.get(m.classroom_id) ?? null;
      if (name && !row.classes.some((c) => c.id === m.classroom_id)) {
        row.classes.push({ id: m.classroom_id, name });
      }
      row.className   = row.className   ?? name;
      row.classroomId = row.classroomId ?? m.classroom_id;
      row.joinedAt    = row.joinedAt    ?? m.joined_at;
    }

    for (const e of enrollments) {
      const row = seed(e.users);
      if (!row) continue;
      row.enrollmentId = row.enrollmentId ?? e.id;
      row.progress     = Math.max(row.progress, e.progress ?? 0);
      row.joinedAt     = row.joinedAt ?? e.enrolled_at;
      if (e.courses?.title) row.courses.push({ id: e.course_id, title: e.courses.title });
      row.course   = row.course   ?? e.courses?.title ?? null;
      row.courseId = row.courseId ?? e.course_id;
      row.coursesEnrolled = row.courses.length;
      if (e.status && e.status !== "active") row.status = e.status;
    }

    let rows = [...byUser.values()];

    // Filtering by course means "enrolled on it", so class-only learners drop
    // out — which is what the caller asked for.
    if (courseId)    rows = rows.filter((r) => r.courses.some((c) => c.id === courseId));
    if (classroomId) rows = rows.filter((r) => r.classes.some((c) => c.id === classroomId));
    if (status)   rows = rows.filter((r) => r.status === status);

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) =>
        (r.fullName ?? "").toLowerCase().includes(s) || (r.email ?? "").toLowerCase().includes(s));
    }

    rows.sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
    ok(res, rows);
  } catch (e) {
    err500(res, e);
  }
});

/**
 * addStudent — put a learner in a CLASS, and enrol them on a course only if one
 * was chosen.
 *
 * It used to be the other way round, and got the class wrong twice over:
 *   • courseId was required, so a school teacher who just wanted a learner in
 *     JSS1 had to invent a course to hang them off.
 *   • the classroom was never chosen, it was GUESSED — the teacher's oldest
 *     classroom by created_at. A teacher of both JSS1 and JSS3 put everyone in
 *     whichever room existed first. And school classrooms carry the school's own
 *     teacher_id, so for most school staff the lookup matched nothing at all and
 *     the learner was silently added to no class whatsoever. That is the
 *     reported symptom: enrolled on the course, absent from the class.
 *
 * Now the class is named explicitly and checked, the course is optional, and the
 * response says what actually happened rather than implying it.
 */
const enrolStudent = asyncHandler(async (req, res) => {
  try {
    const {
      email, fullName, phone,
      courseId = null, classroomId = null, accessLevel = "full",
    } = req.body;

    if (!email) return err400(res, "email is required");
    if (!courseId && !classroomId)
      return err400(res, "Choose a class, a course, or both — a student has to be added to something");

    // ── Course, when one was chosen ──────────────────────────────────────
    let course = null;
    if (courseId) {
      const { data } = await db.from("courses").select("id, instructor_id, title").eq("id", courseId).single();
      if (!data) return err404(res, "Course not found");
      if (data.instructor_id !== req.user.id) return err403(res, "You do not own this course");
      course = data;
    }

    // ── Class, when one was chosen ───────────────────────────────────────
    // Checked, not guessed: you may add to a class you teach, or to any class in
    // a school you administer.
    let classroom = null;
    if (classroomId) {
      const { data: room } = await db.from("classrooms")
        .select("id, name, teacher_id, school_id").eq("id", classroomId).maybeSingle();
      if (!room) return err404(res, "Class not found");

      let allowed = room.teacher_id === req.user.id || req.user.role === "admin";
      if (!allowed && room.school_id) {
        const { data: school } = await db.from("school_profiles")
          .select("id").eq("admin_user_id", req.user.id).eq("id", room.school_id).maybeSingle();
        allowed = !!school;
      }
      if (!allowed) return err403(res, "You do not teach this class");
      classroom = room;
    }

    // ── Find or create the learner ───────────────────────────────────────
    let { data: user } = await db.from("users")
      .select("id, full_name, email").eq("email", email).maybeSingle();

    if (!user) {
      // users.username and users.password_hash are NOT NULL. Invited students
      // get a derived unique username and a sentinel hash (they sign in via the
      // magic/Google flow and set a password later).
      const base  = (email.split("@")[0] || "student").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30) || "student";
      const uname = `${base}_${Math.random().toString(36).slice(2, 7)}`;
      const { data: newUser, error: createErr } = await db.from("users").insert({
        email, username: uname, password_hash: "INVITED",
        full_name: fullName ?? email.split("@")[0],
        phone: phone ?? null, role: "student",
        created_at: now(), updated_at: now(),
      }).select().single();
      if (createErr) throw new Error(createErr.message);
      user = newUser;
    }

    // ── Class membership ─────────────────────────────────────────────────
    let addedToClass = false;
    if (classroom) {
      const { error: cErr } = await db.from("classroom_students").upsert(
        { classroom_id: classroom.id, user_id: user.id, status: "active", joined_at: now() },
        { onConflict: "classroom_id,user_id", ignoreDuplicates: false });
      if (cErr) throw new Error(cErr.message);
      addedToClass = true;
    }

    // ── Enrolment, only when a course was chosen ─────────────────────────
    let enrollment = null;
    let alreadyEnrolled = false;
    if (course) {
      const { data: existing } = await db.from("enrollments")
        .select("id, status").eq("user_id", user.id).eq("course_id", course.id).maybeSingle();

      if (existing?.status === "active") {
        // No longer fatal: the class part may still have been the point of the
        // request, so report it rather than throwing the whole thing away.
        alreadyEnrolled = true;
      } else if (existing) {
        const { data: reactivated, error: reErr } = await db.from("enrollments")
          .update({ status: "active", enrolled_at: now() }).eq("id", existing.id).select().single();
        if (reErr) throw new Error(reErr.message);
        enrollment = reactivated;
      } else {
        const { data: fresh, error: enrolErr } = await db.from("enrollments").insert({
          user_id: user.id, course_id: course.id, status: "active", progress: 0, enrolled_at: now(),
        }).select().single();
        if (enrolErr) throw new Error(enrolErr.message);
        enrollment = fresh;
      }

      if (enrollment) {
        notify(req.user.id, {
          type: "student_enrolled",
          title: `${user.full_name || user.email} enrolled`,
          content: `Enrolled in "${course.title}"`,
          relatedId: course.id,
        });
        notify(user.id, {
          type: "enrolled_in_course",
          title: `You're enrolled in "${course.title}"`,
          content: "You've been added to this course",
          relatedId: course.id,
        });
      }
    }

    if (classroom && !course) {
      notify(user.id, {
        type: "added_to_class",
        title: `You've been added to ${classroom.name}`,
        content: "Your teacher added you to this class.",
        relatedId: classroom.id,
      });
    }

    if (alreadyEnrolled && !addedToClass)
      return err400(res, "Student is already enrolled in this course");

    created(res, {
      user, enrollment,
      classroomId:   classroom?.id ?? null,
      className:     classroom?.name ?? null,
      addedToClass,
      enrolled:      !!enrollment,
      alreadyEnrolled,
    });
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

    notify(req.user.id, { type: "student_removed", title: "Student removed", content: "A student was removed from a course" });
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

    ok(res, (data ?? []).map(mapBattle));
  } catch (e) {
    err500(res, e);
  }
});

const VALID_BATTLE_TYPES  = ["1v1", "open", "classroom"];
const VALID_BATTLE_STATUS = ["lobby", "scheduled", "live", "completed", "expired", "cancelled"];

const createBattle = asyncHandler(async (req, res) => {
  try {
    const b = req.body;
    const title  = b.title;
    if (!title) return err400(res, "title is required");

    // battles.course_id is NOT NULL — resolve a course to attach the battle to.
    let courseId = b.courseId;
    if (courseId) {
      const { data: course } = await db
        .from("courses").select("id, instructor_id").eq("id", courseId).maybeSingle();
      if (!course)                              return err404(res, "Course not found");
      if (course.instructor_id !== req.user.id) return err403(res, "You do not own this course");
    } else {
      // Default to the teacher's most recent course.
      const { data: first } = await db
        .from("courses").select("id").eq("instructor_id", req.user.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!first) return err400(res, "Create a course before launching a battle");
      courseId = first.id;
    }

    const battleType = VALID_BATTLE_TYPES.includes(b.battleType) ? b.battleType : "open";
    const durationMin = Number(b.duration ?? 15);
    const scheduledStart = b.scheduledAt || null;
    // status: schema has no 'draft' — unscheduled battles sit in 'lobby'.
    let battleStatus = b.status === "scheduled" || scheduledStart ? "scheduled" : "lobby";
    if (VALID_BATTLE_STATUS.includes(b.status)) battleStatus = b.status;
    // expires_at is NOT NULL.
    const expiresAt = scheduledStart
      ? new Date(new Date(scheduledStart).getTime() + 24 * 3600000).toISOString()
      : new Date(Date.now() + 7 * 24 * 3600000).toISOString();

    const { data: battle, error: battleErr } = await db
      .from("battles")
      .insert({
        course_id:          courseId,
        battle_type:        battleType,
        title,
        description:        b.description ?? null,
        topic:              b.topic ?? null,
        difficulty:         b.difficulty ?? "intermediate",
        total_questions:    Number(b.questionCount ?? 15),
        time_limit_seconds: durationMin * 60,
        max_participants:   Number(b.maxParticipants ?? 10),
        scheduled_start:    scheduledStart,
        expires_at:         expiresAt,
        status:             battleStatus,
        created_by:         req.user.id,
        created_at:         now(),
        updated_at:         now(),
      })
      .select()
      .single();

    if (battleErr) throw new Error(battleErr.message);

    // battle_participants.agent_id is NOT NULL — only add the creator as a
    // participant if they have an active agent.
    const { data: agent } = await db
      .from("user_agents").select("id").eq("user_id", req.user.id).eq("is_active", true).maybeSingle();
    if (agent) {
      await db.from("battle_participants").insert({
        battle_id: battle.id,
        user_id:   req.user.id,
        agent_id:  agent.id,
        role:      "creator",
        joined_at: now(),
      });
    }

    global.io?.to(`user:${req.user.id}`).emit("battle.created", { battleId: battle.id });

    notify(req.user.id, { type: "battle_created", title: `Battle "${title}" created`, content: `${battleType} battle`, relatedId: battle.id });
    // Recipient side — invite enrolled students to the battle.
    notifyMany(await enrolledStudentIds(courseId), {
      type:      "battle_invite",
      title:     `New battle: "${title}"`,
      content:   `A ${battleType} battle is open — join in!`,
      relatedId: battle.id,
    });
    created(res, mapBattle(battle));
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

    const b = req.body;
    const updates = {};
    if (b.title       !== undefined) updates.title       = b.title;
    if (b.description !== undefined) updates.description = b.description;
    if (b.topic       !== undefined) updates.topic       = b.topic;
    if (b.difficulty  !== undefined) updates.difficulty  = b.difficulty;
    if (b.maxParticipants !== undefined) updates.max_participants   = Number(b.maxParticipants);
    if (b.duration        !== undefined) updates.time_limit_seconds = Number(b.duration) * 60;
    if (b.scheduledAt     !== undefined) updates.scheduled_start    = b.scheduledAt || null;
    if (b.status !== undefined && VALID_BATTLE_STATUS.includes(b.status)) updates.status = b.status;
    if (Object.keys(updates).length === 0) return err400(res, "No updatable fields provided");
    updates.updated_at = now();

    const { data, error } = await db
      .from("battles")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    notify(req.user.id, { type: "battle_updated", title: `Battle "${data.title}" updated`, content: "Changes saved", relatedId: data.id });
    ok(res, mapBattle(data));
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

    notify(req.user.id, { type: "battle_deleted", title: "Battle deleted", content: "A battle was removed" });
    ok(res, { message: "Battle deleted" });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § STREAMING ──────────────────────────────────────────────────────────────

const STREAMING_PLATFORMS = ["zoom", "meet", "teams", "youtube"];

const getStreaming = asyncHandler(async (req, res) => {
  try {
    const { data: settings } = await db
      .from("user_settings")
      .select("settings")
      .eq("user_id", req.user.id)
      .maybeSingle();

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
    const { platform, accessToken, meetingUrl, hostEmail, refreshToken } = req.body;

    if (!platform)    return err400(res, "platform is required");
    if (!STREAMING_PLATFORMS.includes(platform))
      return err400(res, `platform must be one of: ${STREAMING_PLATFORMS.join(", ")}`);

    // Get current settings
    const { data: existing } = await db
      .from("user_settings")
      .select("settings")
      .eq("user_id", req.user.id)
      .maybeSingle();

    const currentSettings = existing?.settings ?? {};
    const streamingPlatforms = currentSettings.streaming_platforms ?? {};

    streamingPlatforms[platform] = {
      ...(streamingPlatforms[platform] ?? {}),   // preserve existing creds on re-connect
      connected:     true,
      access_token:  accessToken  ?? streamingPlatforms[platform]?.access_token  ?? null,
      refresh_token: refreshToken ?? streamingPlatforms[platform]?.refresh_token ?? null,
      host_email:    hostEmail    ?? streamingPlatforms[platform]?.host_email    ?? null,
      meeting_url:   meetingUrl   ?? streamingPlatforms[platform]?.meeting_url   ?? null,
      connected_at:  now(),
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

    notify(req.user.id, { type: "streaming_connected", title: `${platform} connected`, content: "Streaming platform connected" });
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
      .maybeSingle();

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

    notify(req.user.id, { type: "streaming_disconnected", title: `${platform} disconnected`, content: "Streaming platform disconnected" });
    ok(res, { platform, connected: false, message: `${platform} disconnected` });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § SOCIAL PLATFORMS ───────────────────────────────────────────────────────
// Stored credentials for the school's social accounts (used later for posting /
// content auto-generation). Kept in user_settings.settings.social_platforms,
// mirroring streaming_platforms. Tokens/secrets are NEVER returned to the client.

const SOCIAL_PLATFORMS = ["facebook", "instagram", "twitter", "tiktok"];

const getSocial = asyncHandler(async (req, res) => {
  try {
    const { data: settings } = await db
      .from("user_settings")
      .select("settings")
      .eq("user_id", req.user.id)
      .maybeSingle();

    const stored = settings?.settings?.social_platforms ?? {};
    const platforms = SOCIAL_PLATFORMS.map((p) => {
      const s = stored[p] ?? {};
      return {
        platform:        p,
        connected:       !!s.connected,
        profile_url:     s.profile_url ?? null,
        account_id:      s.account_id ?? null,
        has_credentials: !!(s.access_token || s.api_key),
        connected_at:    s.connected_at ?? null,
      };
    });

    ok(res, platforms);
  } catch (e) { err500(res, e); }
});

const connectSocial = asyncHandler(async (req, res) => {
  try {
    const { platform, profileUrl, accessToken, apiKey, apiSecret, accountId } = req.body;

    if (!platform) return err400(res, "platform is required");
    if (!SOCIAL_PLATFORMS.includes(platform))
      return err400(res, `platform must be one of: ${SOCIAL_PLATFORMS.join(", ")}`);

    const { data: existing } = await db
      .from("user_settings")
      .select("settings")
      .eq("user_id", req.user.id)
      .maybeSingle();

    const currentSettings = existing?.settings ?? {};
    const socialPlatforms = currentSettings.social_platforms ?? {};
    const prev = socialPlatforms[platform] ?? {};

    socialPlatforms[platform] = {
      ...prev,   // preserve existing creds on re-connect (only overwrite provided fields)
      connected:     true,
      profile_url:   profileUrl  ?? prev.profile_url  ?? null,
      access_token:  accessToken ?? prev.access_token ?? null,
      api_key:       apiKey      ?? prev.api_key       ?? null,
      api_secret:    apiSecret   ?? prev.api_secret    ?? null,
      account_id:    accountId   ?? prev.account_id    ?? null,
      connected_at:  now(),
    };

    const newSettings = { ...currentSettings, social_platforms: socialPlatforms };

    const { error } = await db
      .from("user_settings")
      .upsert({ user_id: req.user.id, settings: newSettings, updated_at: now() }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    notify(req.user.id, { type: "social_connected", title: `${platform} connected`, content: "Social account connected" });
    ok(res, { platform, connected: true, profile_url: profileUrl ?? null });
  } catch (e) { err500(res, e); }
});

const disconnectSocial = asyncHandler(async (req, res) => {
  try {
    const { platform } = req.params;
    if (!SOCIAL_PLATFORMS.includes(platform))
      return err400(res, `platform must be one of: ${SOCIAL_PLATFORMS.join(", ")}`);

    const { data: existing } = await db
      .from("user_settings")
      .select("settings")
      .eq("user_id", req.user.id)
      .maybeSingle();
    if (!existing) return err404(res, "No settings found");

    const currentSettings = existing.settings ?? {};
    const socialPlatforms = currentSettings.social_platforms ?? {};
    delete socialPlatforms[platform];

    const { error } = await db
      .from("user_settings")
      .update({ settings: { ...currentSettings, social_platforms: socialPlatforms }, updated_at: now() })
      .eq("user_id", req.user.id);
    if (error) throw new Error(error.message);

    notify(req.user.id, { type: "social_disconnected", title: `${platform} disconnected`, content: "Social account disconnected" });
    ok(res, { platform, connected: false, message: `${platform} disconnected` });
  } catch (e) { err500(res, e); }
});

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

// All routes require authentication and instructor/admin role
router.use(authenticateToken);

// Streaming + social credential storage is shared with the SCHOOL portal, so it
// must accept school roles too. Registered BEFORE the instructor/admin gate
// below (these only read/write the caller's own user_settings — safe).
const CRED_ROLES = ["instructor", "admin", "school", "school_admin", "teacher"];
router.get   ("/streaming",           requireRole(CRED_ROLES), getStreaming);
router.post  ("/streaming/connect",   requireRole(CRED_ROLES), connectStreaming);
router.delete("/streaming/:platform", requireRole(CRED_ROLES), disconnectStreaming);
router.get   ("/social",              requireRole(CRED_ROLES), getSocial);
router.post  ("/social/connect",      requireRole(CRED_ROLES), connectSocial);
router.delete("/social/:platform",    requireRole(CRED_ROLES), disconnectSocial);

router.use(requireRole(["instructor", "admin"]));

// Stats
router.get("/stats", getStats);

// Profile
router.get  ("/profile",        getProfile);
router.patch("/profile",               updateProfile);
router.patch("/profile/notifications", updateNotifications);
router.patch("/profile/agent",         updateAgent);

// Courses
/**
 * GET /api/instructor/classrooms
 *
 * The classes this user can assign work to. "Class" and "course" are different
 * groupings and the UI now asks which one you mean: a course is who enrolled in
 * a subject, a class is JSS1 — the same learners only by coincidence.
 *
 * Serves both portals. An instructor gets the classes they teach; a school
 * admin gets every class in their school, because that is the set they think
 * in. The two are unioned rather than branched on role, so a head of
 * department who both teaches and administers sees all of theirs.
 */
const listClassrooms = asyncHandler(async (req, res) => {
  try {
    const { data: school } = await db.from("school_profiles")
      .select("id").eq("admin_user_id", req.user.id).limit(1).maybeSingle();

    let q = db.from("classrooms")
      .select("id, name, description, school_id, teacher_id, classroom_students(id)")
      .order("name");
    q = school
      ? q.or(`teacher_id.eq.${req.user.id},school_id.eq.${school.id}`)
      : q.eq("teacher_id", req.user.id);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    ok(res, (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? null,
      student_count: c.classroom_students?.length ?? 0,
    })));
  } catch (e) {
    err500(res, e);
  }
});

/**
 * GET /api/instructor/classrooms/:id/students
 * Who is actually in a class, for the picker and for the "N will get this"
 * count. has_agent matters for battles — no agent, no fight.
 */
const listClassroomStudents = asyncHandler(async (req, res) => {
  try {
    const { data: rows } = await db.from("classroom_students")
      .select("user_id, users!inner(id, username, full_name, avatar_url, avatar_emoji)")
      .eq("classroom_id", req.params.id).eq("status", "active");

    const ids = (rows ?? []).map((r) => r.user_id);
    const { data: agents } = ids.length
      ? await db.from("user_agents").select("user_id").in("user_id", ids)
      : { data: [] };
    const withAgent = new Set((agents ?? []).map((a) => a.user_id));

    ok(res, (rows ?? []).map((r) => ({
      id:        r.users.id,
      username:  r.users.username,
      full_name: r.users.full_name,
      avatar:    r.users.avatar_url ?? null,
      emoji:     r.users.avatar_emoji ?? null,
      has_agent: withAgent.has(r.user_id),
    })));
  } catch (e) {
    err500(res, e);
  }
});


router.get   ("/classrooms", listClassrooms);
router.get   ("/classrooms/:id/students", listClassroomStudents);
router.get   ("/courses",     listCourses);
router.post  ("/courses",     createCourse);
router.patch ("/courses/:id", updateCourse);
router.delete("/courses/:id", deleteCourse);

// POST /api/instructor/courses/upload — upload a course cover, returns { url }.
router.post("/courses/upload", upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file provided" });
  if (!/^image\//.test(req.file.mimetype || "")) return res.status(400).json({ success: false, message: "Only image files are allowed" });
  await ensureBucket().catch(() => {});
  const ext  = (req.file.originalname?.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `course-covers/${req.user.id}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  const url  = await uploadPublicFile(path, req.file.buffer, req.file.mimetype);
  res.status(201).json({ success: true, url });
}));

// Live Sessions
router.get   ("/sessions",     listSessions);
router.post  ("/sessions",     createSession);
router.patch ("/sessions/:id", updateSession);
router.delete("/sessions/:id", deleteSession);

// Modules + recurrence schedule
router.get   ("/courses/:courseId/modules",          listModules);
router.post  ("/courses/:courseId/modules",          createModule);
router.patch ("/modules/:id",                        updateModule);
router.delete("/modules/:id",                        deleteModule);
router.post  ("/courses/:courseId/schedule/preview", previewSchedule);
router.post  ("/courses/:courseId/schedule/commit",  commitSchedule);
router.post  ("/courses/:courseId/curriculum",       commitCurriculum);

// Session materials
router.get   ("/sessions/:id/materials", listMaterials);
router.post  ("/sessions/:id/materials", addMaterial);
router.delete("/materials/:id",          deleteMaterial);

// Students
router.get   ("/students",                   listStudents);
router.post  ("/students",                   enrolStudent);
router.delete("/students/:enrollmentId",     removeStudent);

// Battles
router.get   ("/battles",     listBattles);
router.post  ("/battles",     createBattle);
router.patch ("/battles/:id", updateBattle);
router.delete("/battles/:id", deleteBattle);

// ── Document templates ──────────────────────────────────────────────────────
// Instructors' own document/form templates + the shared default gallery
// (lesson plan, report card, worksheet, certificate). Create, view as a real
// file, and generate filled documents.
const DOC = () => db.from("instructor_document_templates");
const DOC_FIELDS = ["name", "description", "category", "page_size", "orientation", "body", "css", "variables"];

async function ensureInstrDocTemplate(userId, id) {
  if (!String(id).startsWith("default:")) return id;
  const def = getDefaultDoc(String(id).slice("default:".length));
  if (!def) return null;
  const { data: existing } = await DOC().select("id").eq("user_id", userId).eq("name", def.name).maybeSingle();
  if (existing) return existing.id;
  const { data: row, error } = await DOC().insert({
    user_id: userId, name: def.name, description: def.description, category: def.category,
    page_size: def.page_size, orientation: def.orientation, body: def.body, css: def.css || null, variables: def.variables || [],
  }).select("id").single();
  if (error) throw new Error(error.message);
  return row.id;
}
const loadDoc = async (userId, id) => {
  if (String(id).startsWith("default:")) return getDefaultDoc(String(id).slice("default:".length));
  const { data } = await DOC().select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data;
};

router.get("/documents/templates", async (req, res) => {
  try {
    let q = DOC().select("*").eq("user_id", req.user.id).order("created_at", { ascending: false });
    if (req.query.category) q = q.eq("category", req.query.category);
    const { data } = await q;
    const own = (data || []).map((t) => ({ ...t, isDefault: false }));
    const names = new Set(own.map((t) => t.name));
    const defaults = DEFAULT_DOC_TEMPLATES
      .filter((t) => !names.has(t.name) && (!req.query.category || t.category === req.query.category))
      .map((t) => ({ id: `default:${t.id}`, name: t.name, description: t.description, category: t.category, page_size: t.page_size, orientation: t.orientation, variables: t.variables, isDefault: true }));
    res.json({ success: true, data: [...own, ...defaults] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/documents/templates", async (req, res) => {
  try {
    if (!req.body.name?.trim()) return res.status(400).json({ error: "name is required" });
    const row = { user_id: req.user.id };
    for (const f of DOC_FIELDS) if (req.body[f] !== undefined) row[f] = req.body[f];
    const { data, error } = await DOC().insert(row).select("*").single();
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "You already have a template with that name" : error.message });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// AI-create a document template from an uploaded sample's OCR text.
router.post("/documents/templates/from-sample", async (req, res) => {
  try {
    const { name, category = "form", sourceText } = req.body;
    if (!name?.trim())       return res.status(400).json({ error: "name is required" });
    if (!sourceText?.trim()) return res.status(400).json({ error: "sourceText is required (upload a sample first)" });

    const prompt =
      `A teacher uploaded a sample of an existing printable document (extracted text below). ` +
      `Recreate it as a reusable, print-friendly HTML template that mirrors its headings, sections, order and layout. ` +
      `Replace every value that would change between documents (names, dates, scores, IDs, addresses, amounts) with a {{snake_case_placeholder}} token. ` +
      `Use self-contained inline styles only.\n\n` +
      `Return JSON only:\n{\n  "description": "<one short line>",\n  "body": "<HTML using inline styles and {{placeholders}}>",\n  "variables": [{ "key": "<snake_case>", "label": "<Human label>" }]\n}\n\n` +
      `SAMPLE:\n"""${String(sourceText).slice(0, 8000)}"""`;

    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL, max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = parseJsonLoose(resp.choices?.[0]?.message?.content ?? "");
    const body = String(parsed.body || "").trim();
    if (!body) return res.status(422).json({ error: "Could not build a template from that sample" });

    const row = {
      user_id:     req.user.id,
      name:        name.trim(),
      description: parsed.description || null,
      category,
      page_size:   "A4",
      orientation: "portrait",
      body,
      css:         null,
      variables:   Array.isArray(parsed.variables) ? parsed.variables : [],
    };
    const { data, error } = await DOC().insert(row).select("*").single();
    if (error) return res.status(error.code === "23505" ? 409 : 500).json({ error: error.code === "23505" ? "You already have a template with that name" : error.message });
    res.status(201).json({ success: true, data });
  } catch (e) {
    console.error("[documents/from-sample]", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/documents/templates/:id", async (req, res) => {
  try {
    const patch = { updated_at: new Date() };
    for (const f of DOC_FIELDS) if (req.body[f] !== undefined) patch[f] = req.body[f];
    const { data, error } = await DOC().update(patch).eq("id", req.params.id).eq("user_id", req.user.id).select("*").single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/documents/templates/:id", async (req, res) => {
  try {
    const { error } = await DOC().delete().eq("id", req.params.id).eq("user_id", req.user.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/documents/templates/:id/html", async (req, res) => {
  try {
    const tpl = await loadDoc(req.user.id, req.params.id);
    if (!tpl) return res.status(404).type("html").send("<h1>Template not found</h1>");
    const data = req.query.sample === "1" ? (tpl.sample || {}) : {};
    res.type("html").send(renderDocument({ body: tpl.body, css: tpl.css, pageSize: tpl.page_size, orientation: tpl.orientation, data }));
  } catch (e) { res.status(500).type("html").send("<h1>Something went wrong</h1>"); }
});

router.post("/documents/templates/:id/render", async (req, res) => {
  try {
    const tpl = await loadDoc(req.user.id, req.params.id);
    if (!tpl) return res.status(404).json({ error: "Template not found" });
    const values = req.body.data || {};
    const html = renderDocument({ body: tpl.body, css: tpl.css, pageSize: tpl.page_size, orientation: tpl.orientation, data: values });
    let record = null;
    if (req.body.save) {
      const templateId = await ensureInstrDocTemplate(req.user.id, req.params.id);
      const serial = `DOC-${Date.now().toString(36).toUpperCase()}`;
      const { data: rec } = await db.from("instructor_document_records").insert({
        user_id: req.user.id, template_id: templateId || null, title: req.body.title || tpl.name, serial_no: serial, data: values,
      }).select("*").single();
      record = rec;
    }
    res.json({ success: true, html, record });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/documents/preview", (req, res) => {
  const { body = "", css = "", page_size = "A4", orientation = "portrait", data = {} } = req.body || {};
  res.json({ success: true, html: renderDocument({ body, css, pageSize: page_size, orientation, data }) });
});

export default router;
