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
import { generateSchedule }               from "./schedule.js";
import { renderDocument }                  from "../school/documentRenderer.js";
import { DEFAULT_DOC_TEMPLATES, getDefaultDoc } from "../school/defaultDocs/index.js";

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
        id, course_id, status, progress, enrolled_at,
        users ( id, full_name, email, avatar_url, phone ),
        courses ( id, title )
      `)
      .in("course_id", ids);

    if (status) q = q.eq("status", status);

    const { data: enrollments, error } = await q.order("enrolled_at", { ascending: false });
    if (error) throw new Error(error.message);

    let rows = enrollments ?? [];

    // In-memory search filter (Supabase JS doesn't support ilike on joined columns cleanly)
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((e) => {
        const name  = (e.users?.full_name ?? "").toLowerCase();
        const email = (e.users?.email     ?? "").toLowerCase();
        return name.includes(s) || email.includes(s);
      });
    }

    // Shape for the instructor StudentsPage
    ok(res, rows.map((e) => ({
      id:              e.users?.id,
      enrollmentId:    e.id,
      fullName:        e.users?.full_name,
      email:           e.users?.email,
      avatarUrl:       e.users?.avatar_url,
      phone:           e.users?.phone,
      progress:        e.progress ?? 0,
      status:          e.status,
      joinedAt:        e.enrolled_at,
      course:          e.courses?.title,
      courseId:        e.course_id,
      coursesEnrolled: 1,
    })));
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
      .select("id, instructor_id, title")
      .eq("id", courseId)
      .single();

    if (!course)                        return err404(res, "Course not found");
    if (course.instructor_id !== req.user.id) return err403(res, "You do not own this course");

    // Find or create user by email
    let { data: user } = await db
      .from("users")
      .select("id, full_name, email")
      .eq("email", email)
      .maybeSingle();

    if (!user) {
      // users.username and users.password_hash are NOT NULL. Invited students
      // get a derived unique username and a sentinel hash (they sign in via the
      // magic/Google flow and set a password later).
      const base   = (email.split("@")[0] || "student").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30) || "student";
      const uname  = `${base}_${Math.random().toString(36).slice(2, 7)}`;
      const { data: newUser, error: createErr } = await db
        .from("users")
        .insert({
          email,
          username:      uname,
          password_hash: "INVITED",          // placeholder; cannot log in with it
          full_name:     fullName ?? email.split("@")[0],
          phone:         phone ?? null,
          role:          "student",
          created_at:    now(),
          updated_at:    now(),
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
      .maybeSingle();

    if (existing) {
      if (existing.status === "active")
        return err400(res, "Student is already enrolled in this course");

      // Re-activate if previously expired/suspended
      const { data: reactivated, error: reErr } = await db
        .from("enrollments")
        .update({ status: "active", enrolled_at: now() })
        .eq("id", existing.id)
        .select()
        .single();

      if (reErr) throw new Error(reErr.message);

      // Re-add to classroom too (may have been removed)
      const { data: classroom } = await db
        .from("classrooms")
        .select("id")
        .eq("teacher_id", req.user.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (classroom) {
        await db.from("classroom_students")
          .upsert(
            { classroom_id: classroom.id, user_id: user.id, status: "active", joined_at: now() },
            { onConflict: "classroom_id,user_id", ignoreDuplicates: false }
          );
      }

      notify(user.id, {
        type:      "enrolled_in_course",
        title:     `You're enrolled in "${course.title}"`,
        content:   `Your access to this course has been restored`,
        relatedId: courseId,
      });
      return ok(res, { enrollment: reactivated, user, classroomId: classroom?.id ?? null });
    }

    const { data: enrollment, error: enrolErr } = await db
      .from("enrollments")
      .insert({
        user_id:     user.id,
        course_id:   courseId,
        status:      "active",
        progress:    0,
        enrolled_at: now(),
      })
      .select()
      .single();

    if (enrolErr) throw new Error(enrolErr.message);

    // Also add student to the instructor's classroom (if one exists).
    // Uses upsert so re-adding a removed student just re-activates them.
    const { data: classroom } = await db
      .from("classrooms")
      .select("id")
      .eq("teacher_id", req.user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (classroom) {
      await db.from("classroom_students")
        .upsert(
          { classroom_id: classroom.id, user_id: user.id, status: "active", joined_at: now() },
          { onConflict: "classroom_id,user_id", ignoreDuplicates: false }
        );
    }

    notify(req.user.id, {
      type:      "student_enrolled",
      title:     `${user.full_name || user.email} enrolled`,
      content:   `Enrolled in "${course.title}"`,
      relatedId: courseId,
    });
    // Recipient side — tell the student they've been enrolled.
    notify(user.id, {
      type:      "enrolled_in_course",
      title:     `You're enrolled in "${course.title}"`,
      content:   `You've been added to this course`,
      relatedId: courseId,
    });

    created(res, { enrollment, user, classroomId: classroom?.id ?? null });
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

// Streaming platforms
router.get   ("/streaming",              getStreaming);
router.post  ("/streaming/connect",      connectStreaming);
router.delete("/streaming/:platform",    disconnectStreaming);

// Document templates — the shared gallery (lesson plan, report card, worksheet,
// certificate). Instructors can view them as real files and render them filled.
router.get("/documents/templates", (_req, res) => {
  res.json({ success: true, data: DEFAULT_DOC_TEMPLATES.map((t) => ({
    id: t.id, name: t.name, description: t.description, category: t.category,
    page_size: t.page_size, orientation: t.orientation, variables: t.variables,
  })) });
});
router.get("/documents/templates/:id/html", (req, res) => {
  const def = getDefaultDoc(req.params.id);
  if (!def) return res.status(404).type("html").send("<h1>Template not found</h1>");
  const data = req.query.sample === "1" ? (def.sample || {}) : {};
  res.type("html").send(renderDocument({ body: def.body, css: def.css, pageSize: def.page_size, orientation: def.orientation, data }));
});
router.post("/documents/templates/:id/render", (req, res) => {
  const def = getDefaultDoc(req.params.id);
  if (!def) return res.status(404).json({ error: "Template not found" });
  res.json({ success: true, html: renderDocument({ body: def.body, css: def.css, pageSize: def.page_size, orientation: def.orientation, data: req.body.data || {} }) });
});

export default router;
