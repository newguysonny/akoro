/**
 * modules/school/service.js — request-level orchestration for the school
 * portal's core resources: profile, staff, classrooms, learners, the school
 * agent, settings bootstrap, audit trail writers/readers.
 *
 * Rules-of-engagement live here (who may act, which 403/404/409 is right);
 * every query lives in store.js; pure normalisers live in rules.js.
 */

import bcrypt from "bcrypt";
import crypto from "crypto";
import { notifyUser } from "../notify.js";
import { invalidateCachedUser } from "../auth/index.js";
import { urlFor } from "../../lib/urls.js";
import * as store from "./store.js";
import { sanitizeAuditBody, pickEntityLabel, slugify, mapSchoolSession, PROFILE_FIELDS, levelFromXp, mapNotifPrefs, VALID_LEVELS, courseTypeToDb, mapSchoolCourse, mapSchoolModule } from "./rules.js";
import { generateSchedule } from "../instructor/schedule.js";

// =============================================================
// SHARED REQUEST HELPERS
// =============================================================

// Resolve the caller's school (first one they administer). 404s if none.
export async function getMySchool(req, res) {
  const { data } = await store.schoolProfileByAdmin(req.user.id);
  if (!data) { res.status(404).json({ error: "No school is linked to this account." }); return null; }
  return data;
}

// Ensure the school has a persisted, unique slug (used by /site/:slug previews
// and <slug>.akoro.app). Backfills schools created before slugs were saved.
export async function ensureSchoolSlug(school) {
  if (school.slug) return school.slug;
  const base = slugify(school.name) || "school";
  let slug = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await store.schoolSlugClash(slug);
    if (!clash || clash.id === school.id) break;
    slug = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  }
  await store.schoolProfileSlug(school.id, slug);
  school.slug = slug;
  return slug;
}

// jsonb-per-category settings row (created lazily on first access).
export async function getPortalSettings(schoolId) {
  const { data } = await store.portalSettingsBySchool(schoolId);
  if (data) return data;
  const { data: created } = await store.portalSettingsCreate(schoolId);
  return created;
}

export async function classroomIds(schoolId) {
  const { data } = await store.classroomIdsBySchool(schoolId);
  return (data || []).map((c) => c.id);
}

const ownClassroom = (row, schoolId) => (row && row.school_id === schoolId ? row : null);

// find-or-create a user with the given role, by email
async function findOrCreateUser(email, fullName, role) {
  const safe = (email || "").toLowerCase().trim();
  const { data: existing } = await store.userByEmailLite(safe);
  if (existing) return existing;
  const tempPassword = crypto.randomBytes(8).toString("base64").slice(0, 10);
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const base = (safe.split("@")[0] || `user${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, "_");
  const { data, error } = await store.userInsert({
    email: safe, username: `${base}_${Math.floor(Math.random() * 9000) + 1000}`,
    password_hash: passwordHash, full_name: fullName || null, role, is_active: true, must_change_password: true,
  });
  if (error) throw new Error(error.message);
  return data;
}

// =============================================================
// AUDIT TRAIL — automatically logs every write (POST/PUT/PATCH/DELETE) made
// under /api/school/*, so new mutation routes are covered without extra
// wiring. Wired first so res.on('finish') fires after the route handler
// (and authenticateToken) has already set req.user.
// =============================================================
export function auditMiddleware(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  res.on("finish", async () => {
    try {
      if (res.statusCode >= 400 || !req.user) return;
      const { data: school } = await store.schoolProfileIdByAdmin(req.user.id);
      if (!school) return;
      const entityType = req.path.split("/").filter(Boolean)[0] || "root";
      await store.auditLogInsert({
        school_id: school.id, actor_user_id: req.user.id,
        actor_name: req.user.fullName || req.user.email || null,
        method: req.method, entity_type: entityType, entity_label: pickEntityLabel(req.body),
        path: req.originalUrl, status_code: res.statusCode,
        details: sanitizeAuditBody(req.body), ip_address: req.ip,
      });
    } catch { /* never let audit logging break the request */ }
  });
  next();
}

// ── GET /api/school ──────────────────────────────────────────────────────────
export async function getSchool(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const cids = await classroomIds(school.id);
    const [{ count: instructors }, { count: students }] = await Promise.all([
      store.teacherCountBySchool(school.id),
      cids.length ? store.classroomStudentCount(cids) : Promise.resolve({ count: 0 }),
    ]);
    res.json({ success: true, data: { ...school, total_classrooms: cids.length, total_instructors: instructors || 0, total_students: students || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/stats ────────────────────────────────────────────────────
export async function getStats(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const cids = await classroomIds(school.id);
    const { data: teachers } = await store.teacherIdsBySchool(school.id);
    const teacherIds = (teachers || []).map((t) => t.teacher_id);
    const [{ count: students }, { count: courses }] = await Promise.all([
      cids.length ? store.classroomStudentCount(cids) : Promise.resolve({ count: 0 }),
      teacherIds.length ? store.courseCountByInstructors(teacherIds) : Promise.resolve({ count: 0 }),
    ]);
    res.json({ success: true, data: { classrooms: cids.length, instructors: teacherIds.length, students: students || 0, courses: courses || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── Course-management scope ──────────────────────────────────────────────────
// The school's course-ownership scope: its teachers plus the admin — the
// admin's own courses are the school's too (the same set listCourses
// reads). The handlers below are the school-scoped counterparts of the
// instructor course/session/module/material handlers, which are
// role-gated to instructors and scope by the caller's own instructor id;
// here ownership means the course belongs to someone in this scope.
async function schoolOwnerIds(req, school) {
  const { data: teachers } = await store.teacherIdsBySchool(school.id);
  return [...new Set([...(teachers || []).map((t) => t.teacher_id), req.user.id])];
}

// Resolve a course inside the school's scope: the course row when the
// school owns it; otherwise the error is sent and null returned.
async function ownSchoolCourse(req, res, courseId) {
  const school = await getMySchool(req, res);
  if (!school) return null;
  const { data: course } = await store.courseOwnerById(courseId);
  if (!course) { res.status(404).json({ error: "Course not found" }); return null; }
  const ownerIds = await schoolOwnerIds(req, school);
  if (!ownerIds.includes(course.instructor_id)) { res.status(403).json({ error: "You do not own this course" }); return null; }
  return course;
}

async function ownSchoolSession(req, res, sessionId) {
  const { data: session } = await store.sessionById(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return null; }
  const course = await ownSchoolCourse(req, res, session.course_id);
  if (!course) return null;
  return { session, course };
}

// The instructor fan-out, on the school store: one bulk insert into the
// shared notifications table. Best-effort — never fails the request.
const notifyManyUsers = async (userIds, { type, title, content = null, relatedId = null }) => {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (!ids.length) return;
  const rows = ids.map((id) => ({ user_id: id, type, title, content, related_id: relatedId }));
  try {
    const { error } = await store.insertNotifications(rows);
    if (error) console.warn("[school notify] bulk insert failed:", error.message);
  } catch (e) { console.warn("[school notify] bulk insert threw:", e.message); }
};

const enrolledIds = async (courseId) => {
  const { data } = await store.enrolledUserIdsByCourse(courseId);
  return (data ?? []).map((r) => r.user_id);
};

// ── GET /api/school/sessions ─────────────────────────────────────────────────
// Two reads share this route. Without a query: the dashboard read — live
// sessions across the school's courses from 24 h ago onward (the client
// filters to its own calendar day). With ?courseId=: the course-
// management read — every session of that one course, newest first,
// ownership-checked like the writes below. Both replace reads of
// GET /api/instructor/sessions, which 403s for a school admin.
export async function listSessions(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const ownerIds = await schoolOwnerIds(req, school);
    if (req.query.courseId) {
      const { data: course } = await store.courseOwnerById(req.query.courseId);
      if (!course) return res.status(404).json({ error: "Course not found" });
      if (!ownerIds.includes(course.instructor_id)) return res.status(403).json({ error: "You do not own this course" });
      const { data: sessions, error } = await store.sessionsByCourseAll(req.query.courseId);
      if (error) throw new Error(error.message);
      return res.json({ success: true, data: (sessions || []).map(mapSchoolSession) });
    }
    const { data: courses, error: cErr } = await store.courseIdsByInstructors(ownerIds);
    if (cErr) throw new Error(cErr.message);
    const courseIds = (courses || []).map((c) => c.id);
    if (!courseIds.length) return res.json({ success: true, data: [] });
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: sessions, error } = await store.sessionsForCourses(courseIds, from);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: (sessions || []).map(mapSchoolSession) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/profile ──────────────────────────────────────────────────
// The signed-in school admin's own account profile — the school-scoped
// counterpart of GET /api/instructor/profile, which is role-gated to
// instructors and so always 403'd here (the Profile page fell back to
// cached data and every save failed). Same shape: the user row, the
// caller's agent (the school's agent is the admin's user_agents row),
// notification preferences, plus a stats block computed across the whole
// school's courses — where the instructor stats are per-teacher — for the
// profile page's figures.
export async function getProfile(req, res) {
  try {
    const [{ data: user, error: userErr }, { data: agent }, { data: notif }] = await Promise.all([
      store.profileByUser(req.user.id),
      store.agentByUser(req.user.id),
      store.notifPrefsByUser(req.user.id),
    ]);
    if (userErr) throw new Error(userErr.message);
    if (!user) return res.status(404).json({ error: "User not found" });

    const stats = {
      total_students: 0, total_revenue: 0, active_courses: 0, total_courses: 0,
      agent_xp: agent?.total_xp ?? 0, agent_level: levelFromXp(agent?.total_xp), streak_days: 0,
    };
    const { data: school } = await store.schoolProfileByAdmin(req.user.id);
    if (school) {
      const teacherIds = await schoolOwnerIds(req, school);
      if (teacherIds.length) {
        const { data: courses } = await store.coursesByInstructors(teacherIds);
        const list = courses || [];
        stats.total_courses = list.length;
        stats.active_courses = list.filter((c) => c.is_published).length;
        const courseIds = list.map((c) => c.id);
        if (courseIds.length) {
          const { data: enrollments } = await store.activeEnrollmentsByCourses(courseIds);
          const rows = enrollments || [];
          stats.total_students = rows.length;
          const priceMap = Object.fromEntries(list.map((c) => [c.id, c.price ?? 0]));
          stats.total_revenue = rows.reduce((sum, e) => sum + (e.payment_id ? (priceMap[e.course_id] ?? 0) : 0), 0);
        }
      }
    }

    res.json({ success: true, data: {
      ...user,
      agent: agent ? { ...agent, xp: agent.total_xp ?? 0, level: levelFromXp(agent.total_xp), streak_days: 0 } : null,
      notif: mapNotifPrefs(notif),
      stats,
    }});
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PATCH /api/school/profile ────────────────────────────────────────────────
// Field-for-field the instructor profile update: same allow-list, same
// friendly username-taken error the client checks for.
export async function updateProfile(req, res) {
  try {
    const updates = Object.fromEntries(
      Object.entries(req.body || {}).filter(([k]) => PROFILE_FIELDS.includes(k)),
    );
    if (Object.keys(updates).length === 0)
      return res.status(400).json({ error: `No valid fields provided. Allowed: ${PROFILE_FIELDS.join(", ")}` });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await store.updateUserProfile(req.user.id, updates);
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return res.status(400).json({ error: "That username is already taken" });
      throw new Error(error.message);
    }
    notifyUser({ userId: req.user.id, type: "profile_updated", title: "Profile updated", content: "Your profile details were saved" });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PATCH /api/school/profile/notifications ──────────────────────────────────
// Upsert into the shared user_notification_preferences table (same model
// as the instructor and learner apps).
export async function updateNotifications(req, res) {
  try {
    const { email, push, sessionReminders, announcements, qaReplies } = req.body ?? {};
    const row = { user_id: req.user.id, updated_at: new Date().toISOString() };
    if (email            !== undefined) row.email_enabled            = email;
    if (push             !== undefined) row.push_enabled             = push;
    if (sessionReminders !== undefined) row.notify_session_reminders = sessionReminders;
    if (announcements    !== undefined) row.notify_new_announcements = announcements;
    if (qaReplies        !== undefined) row.notify_qa_replies        = qaReplies;
    if (Object.keys(row).length <= 2)
      return res.status(400).json({ error: "No valid notification fields provided" });
    const { error } = await store.upsertNotifPrefs(row);
    if (error) throw new Error(error.message);
    notifyUser({ userId: req.user.id, type: "settings_updated", title: "Notification preferences updated", content: "Your notification settings were saved" });
    res.json({ success: true, data: { saved: true } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/courses ─────────────────────────────────────────────────
// School-scoped counterpart of the instructor create: the course is
// owned by the admin creating it (instructor_id = the caller), which the
// school's course scope includes, so it lists with the teachers' courses.
export async function createCourse(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const {
      title, description, subject = null, category = null,
      level, type, course_type, status,
      language      = "English",
      price         = 0,
      discountPrice, discount_price,
      isFree, is_free,
      thumbnail, thumbnail_url,
    } = req.body || {};
    if (!title) return res.status(400).json({ error: "title is required" });

    const lvl       = VALID_LEVELS.includes(level) ? level : "all";
    const dbType    = courseTypeToDb(type ?? course_type);
    const published = status === "active" || status === "live" || status === "published";
    const priceVal  = Math.round(Number(price) || 0);
    const discount  = discountPrice ?? discount_price;
    const free      = isFree ?? is_free ?? (priceVal === 0);
    const nowIso    = new Date().toISOString();
    // Instructor slugs carry a random suffix so duplicate titles never collide.
    const slug      = `${slugify(title) || "course"}-${crypto.randomBytes(3).toString("hex")}`;

    const { data, error } = await store.insertCourse({
      instructor_id:   req.user.id,
      title,
      slug,
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
      published_at:    published ? nowIso : null,
      created_at:      nowIso,
      updated_at:      nowIso,
    });
    if (error) throw new Error(error.message);
    notifyUser({ userId: req.user.id, type: "course_created", title: `Course "${title}" created`, content: `${dbType === "video" ? "on-demand" : "live"} · ${lvl}`, relatedId: data.id });
    res.status(201).json({ success: true, data: mapSchoolCourse(data, 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PATCH /api/school/courses/:id ────────────────────────────────────────────
export async function updateCourse(req, res) {
  try {
    const course = await ownSchoolCourse(req, res, req.params.id);
    if (!course) return;
    const b = req.body || {};
    const updates = {};
    if (b.title       !== undefined) updates.title           = b.title;
    if (b.description !== undefined) updates.description     = b.description;
    if (b.subject     !== undefined) updates.subject         = b.subject;
    if (b.language    !== undefined) updates.language        = b.language;
    if (b.price       !== undefined) updates.price           = Math.round(Number(b.price) || 0);
    if (b.level       !== undefined) updates.level           = VALID_LEVELS.includes(b.level) ? b.level : "all";
    if (b.type !== undefined || b.course_type !== undefined) updates.course_type = courseTypeToDb(b.type ?? b.course_type);
    if (b.thumbnail !== undefined || b.thumbnail_url !== undefined) updates.cover_image_url = b.thumbnail ?? b.thumbnail_url;
    if (b.status !== undefined) {
      const pub = b.status === "active" || b.status === "live" || b.status === "published";
      updates.is_published = pub;
      updates.published_at = pub ? new Date().toISOString() : null;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updatable fields provided" });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await store.updateCourseRow(req.params.id, updates);
    if (error) throw new Error(error.message);
    notifyUser({ userId: req.user.id, type: "course_updated", title: `Course "${data.title}" updated`, content: "Changes saved", relatedId: data.id });
    res.json({ success: true, data: mapSchoolCourse(data, 0) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── DELETE /api/school/courses/:id ───────────────────────────────────────────
// No 'archived' state in schema — hard delete (cascades sessions/enrollments),
// exactly as the instructor delete behaves.
export async function deleteCourse(req, res) {
  try {
    const course = await ownSchoolCourse(req, res, req.params.id);
    if (!course) return;
    const { error } = await store.deleteCourseRow(req.params.id);
    if (error) throw new Error(error.message);
    notifyUser({ userId: req.user.id, type: "course_deleted", title: "Course deleted", content: "The course and its sessions were removed" });
    res.json({ success: true, data: { message: "Course deleted" } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/sessions ────────────────────────────────────────────────
// The session belongs to the course's teacher (instructor_id = the
// course's owner), so it also appears in that teacher's own app.
export async function createSession(req, res) {
  try {
    const b = req.body || {};
    const courseId       = b.courseId ?? b.course_id;
    const title          = b.title;
    const scheduledStart = b.startTime ?? b.scheduled_start;
    const durationMin    = Number(b.duration ?? b.duration_minutes ?? 60);
    const platform       = b.platform ?? "zoom";
    const meetingUrl     = b.meetingLink ?? b.meeting_url ?? null;
    if (!courseId)       return res.status(400).json({ error: "courseId is required" });
    if (!title)          return res.status(400).json({ error: "title is required" });
    if (!scheduledStart) return res.status(400).json({ error: "startTime is required" });

    const course = await ownSchoolCourse(req, res, courseId);
    if (!course) return;

    const scheduledEnd = new Date(new Date(scheduledStart).getTime() + durationMin * 60000).toISOString();
    const nowIso = new Date().toISOString();
    const { data, error } = await store.insertSession({
      course_id:        courseId,
      instructor_id:    course.instructor_id,
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
      created_at:       nowIso,
      updated_at:       nowIso,
    });
    if (error) throw new Error(error.message);
    notifyUser({ userId: req.user.id, type: "session_reminder", title: `Session "${title}" scheduled`, content: `Starts ${new Date(scheduledStart).toLocaleString()}`, relatedId: data.id });
    notifyManyUsers(await enrolledIds(courseId), {
      type:      "session_scheduled",
      title:     `New session: "${title}"`,
      content:   `Starts ${new Date(scheduledStart).toLocaleString()}`,
      relatedId: data.id,
    });
    res.status(201).json({ success: true, data: mapSchoolSession(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PATCH /api/school/sessions/:id ───────────────────────────────────────────
export async function updateSession(req, res) {
  try {
    const found = await ownSchoolSession(req, res, req.params.id);
    if (!found) return;
    const b = req.body || {};
    const updates = {};
    if (b.title       !== undefined) updates.title           = b.title;
    if (b.description !== undefined) updates.description     = b.description;
    if (b.platform    !== undefined) updates.platform        = b.platform;
    if (b.status      !== undefined) updates.status          = b.status;
    if (b.startTime !== undefined || b.scheduled_start !== undefined) updates.scheduled_start = b.startTime ?? b.scheduled_start;
    if (b.meetingLink !== undefined || b.meeting_url !== undefined) updates.meeting_url = b.meetingLink ?? b.meeting_url;
    if (b.moduleId !== undefined || b.module_id !== undefined) updates.module_id = b.moduleId ?? b.module_id;
    if (b.orderIndex !== undefined || b.order_index !== undefined) updates.order_index = Number(b.orderIndex ?? b.order_index);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updatable fields provided" });
    updates.updated_at = new Date().toISOString();
    const { data, error } = await store.updateSessionRow(req.params.id, updates);
    if (error) throw new Error(error.message);
    notifyUser({ userId: req.user.id, type: "session_updated", title: `Session "${data.title}" updated`, content: "Changes saved", relatedId: data.id });
    // Students are only notified when the time changes (avoid noise).
    if (updates.scheduled_start) {
      notifyManyUsers(await enrolledIds(found.session.course_id), {
        type:      "session_rescheduled",
        title:     `Session "${data.title}" rescheduled`,
        content:   `Now starts ${new Date(updates.scheduled_start).toLocaleString()}`,
        relatedId: data.id,
      });
    }
    res.json({ success: true, data: mapSchoolSession(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── DELETE /api/school/sessions/:id ──────────────────────────────────────────
export async function deleteSession(req, res) {
  try {
    const found = await ownSchoolSession(req, res, req.params.id);
    if (!found) return;
    const { error } = await store.deleteSessionRow(req.params.id);
    if (error) throw new Error(error.message);
    notifyUser({ userId: req.user.id, type: "session_deleted", title: "Session deleted", content: "A live session was removed" });
    res.json({ success: true, data: { message: "Session deleted" } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/courses/:courseId/modules ────────────────────────────────
// Modules + their sessions, the curriculum view the Courses page renders.
export async function listModules(req, res) {
  try {
    const course = await ownSchoolCourse(req, res, req.params.courseId);
    if (!course) return;
    const { data: modules, error } = await store.modulesByCourse(req.params.courseId);
    if (error) throw new Error(error.message);
    const ids = (modules ?? []).map((m) => m.id);
    let byModule = {};
    if (ids.length) {
      const { data: sessions } = await store.sessionsByModuleIds(ids);
      for (const s of sessions ?? []) (byModule[s.module_id] ??= []).push(s);
    }
    res.json({ success: true, data: (modules ?? []).map((m) => mapSchoolModule(m, byModule[m.id] ?? [])) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/courses/:courseId/modules ───────────────────────────────
export async function createModule(req, res) {
  try {
    const course = await ownSchoolCourse(req, res, req.params.courseId);
    if (!course) return;
    const { title, description, orderIndex } = req.body || {};
    if (!title) return res.status(400).json({ error: "title is required" });
    const { data, error } = await store.insertModule({ course_id: req.params.courseId, title, description: description ?? null, order_index: Number(orderIndex ?? 0) });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: mapSchoolModule(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── PATCH /api/school/modules/:id ────────────────────────────────────────────
export async function updateModule(req, res) {
  try {
    const { data: mod } = await store.moduleById(req.params.id);
    if (!mod) return res.status(404).json({ error: "Module not found" });
    const course = await ownSchoolCourse(req, res, mod.course_id);
    if (!course) return;
    const b = req.body || {}, updates = {};
    if (b.title !== undefined)       updates.title = b.title;
    if (b.description !== undefined) updates.description = b.description;
    if (b.orderIndex !== undefined)  updates.order_index = Number(b.orderIndex);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: "No updatable fields provided" });
    const { data, error } = await store.updateModuleRow(req.params.id, updates);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: mapSchoolModule(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── DELETE /api/school/modules/:id ───────────────────────────────────────────
// Sessions keep existing; their module_id is nulled by the schema.
export async function deleteModule(req, res) {
  try {
    const { data: mod } = await store.moduleById(req.params.id);
    if (!mod) return res.status(404).json({ error: "Module not found" });
    const course = await ownSchoolCourse(req, res, mod.course_id);
    if (!course) return;
    const { error } = await store.deleteModuleRow(req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { message: "Module deleted" } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/courses/:courseId/schedule/preview ──────────────────────
// Expand a recurrence spec into a module→sessions tree (no writes). The
// generator is the instructor module's pure schedule expander, shared.
export async function previewSchedule(req, res) {
  try {
    const course = await ownSchoolCourse(req, res, req.params.courseId);
    if (!course) return;
    const tree = generateSchedule(req.body || {});
    res.json({ success: true, data: tree });
  } catch (e) { res.status(400).json({ error: e.message }); }
}

// ── POST /api/school/courses/:courseId/schedule/commit ───────────────────────
// Persist an edited module→sessions tree (+ optional per-session
// materials) and save the reusable schedule_config on the course.
export async function commitSchedule(req, res) {
  try {
    const course = await ownSchoolCourse(req, res, req.params.courseId);
    if (!course) return;
    const courseId = req.params.courseId;
    const { modules = [], scheduleConfig } = req.body || {};
    if (!Array.isArray(modules) || modules.length === 0) return res.status(400).json({ error: "modules array is required" });
    if (scheduleConfig) await store.updateCourseConfig(courseId, scheduleConfig);

    const nowIso = new Date().toISOString();
    const createdModules = [];
    for (const [mi, m] of modules.entries()) {
      const { data: modRow, error: mErr } = await store.insertModule({
        course_id: courseId, title: m.title || `Week ${mi + 1}`, description: m.description ?? null, order_index: Number(m.orderIndex ?? mi),
      });
      if (mErr) throw new Error(mErr.message);

      const createdSessions = [];
      for (const [si, s] of (m.sessions ?? []).entries()) {
        if (!s.scheduled_start && !s.startTime) continue;
        const startIso = s.scheduled_start ?? s.startTime;
        const durationMin = Number(s.duration_min ?? s.duration ?? 60);
        const endIso = s.scheduled_end ?? new Date(new Date(startIso).getTime() + durationMin * 60000).toISOString();
        const { data: sess, error: sErr } = await store.insertSession({
          course_id:       courseId,
          instructor_id:   course.instructor_id,
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
          created_at:      nowIso,
          updated_at:      nowIso,
        });
        if (sErr) throw new Error(sErr.message);

        const mats = (s.materials ?? []).filter((x) => x && (x.title || x.url || x.body));
        for (const [xi, x] of mats.entries()) {
          await store.insertMaterial({
            session_id:  sess.id,
            title:       x.title || x.url || "Material",
            kind:        ["file", "link", "note"].includes(x.kind) ? x.kind : "file",
            url:         x.url ?? null,
            body:        x.body ?? null,
            file_type:   x.fileType ?? x.file_type ?? null,
            order_index: xi,
          });
        }
        createdSessions.push(sess);
      }
      createdModules.push(mapSchoolModule(modRow, createdSessions));
    }
    res.status(201).json({ success: true, data: { modules: createdModules } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/courses/:courseId/curriculum ────────────────────────────
// Persist an on-demand course's sections → video lessons tree. Sections
// map to course_modules; lessons map to the lessons table.
export async function commitCurriculum(req, res) {
  try {
    const course = await ownSchoolCourse(req, res, req.params.courseId);
    if (!course) return;
    const courseId = req.params.courseId;
    const { sections = [] } = req.body || {};
    if (!Array.isArray(sections) || sections.length === 0) return res.status(400).json({ error: "sections array is required" });

    const createdSections = [];
    for (const [si, s] of sections.entries()) {
      const { data: modRow, error: mErr } = await store.insertModule({
        course_id:   courseId,
        title:       s.title || `Section ${si + 1}`,
        description: s.description ?? null,
        order_index: Number(s.orderIndex ?? si),
      });
      if (mErr) throw new Error(mErr.message);

      const createdLessons = [];
      for (const [li, l] of (s.lessons ?? []).entries()) {
        const durationSec = l.durationSeconds != null
          ? Number(l.durationSeconds)
          : Math.round((Number(l.duration) || 0) * 60);  // wizard sends minutes
        const { data: lesson, error: lErr } = await store.insertLesson({
          module_id:        modRow.id,
          title:            l.title || `Lesson ${li + 1}`,
          description:      l.description ?? null,
          video_url:        l.videoUrl ?? l.video_url ?? null,
          thumbnail_url:    l.thumbnailUrl ?? l.thumbnail_url ?? null,
          duration_seconds: durationSec || null,
          order_index:      Number(l.orderIndex ?? li),
          is_preview:       !!(l.preview ?? l.is_preview),
          lesson_type:      ["video", "quiz", "assignment", "reading"].includes(l.lessonType) ? l.lessonType : "video",
        });
        if (lErr) throw new Error(lErr.message);
        createdLessons.push(lesson);
      }
      createdSections.push({ ...modRow, lessons: createdLessons });
    }
    res.status(201).json({ success: true, data: { sections: createdSections } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/sessions/:id/materials ───────────────────────────────────
export async function listMaterials(req, res) {
  try {
    const found = await ownSchoolSession(req, res, req.params.id);
    if (!found) return;
    const { data, error } = await store.materialsBySession(req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: data ?? [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/sessions/:id/materials ──────────────────────────────────
export async function addMaterial(req, res) {
  try {
    const found = await ownSchoolSession(req, res, req.params.id);
    if (!found) return;
    const b = req.body || {};
    if (!b.title && !b.url && !b.body) return res.status(400).json({ error: "title, url, or body is required" });
    const { data, error } = await store.insertMaterial({
      session_id:  req.params.id,
      title:       b.title || b.url || "Material",
      kind:        ["file", "link", "note"].includes(b.kind) ? b.kind : "file",
      url:         b.url ?? null,
      body:        b.body ?? null,
      file_type:   b.fileType ?? b.file_type ?? null,
      order_index: Number(b.orderIndex ?? b.order_index ?? 0),
    });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── DELETE /api/school/materials/:id ─────────────────────────────────────────
export async function deleteMaterial(req, res) {
  try {
    const { data: mat } = await store.materialById(req.params.id);
    if (!mat) return res.status(404).json({ error: "Material not found" });
    const found = await ownSchoolSession(req, res, mat.session_id);
    if (!found) return;
    const { error } = await store.deleteMaterialRow(req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { message: "Material deleted" } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/instructors ──────────────────────────────────────────────
export async function listInstructors(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: links } = await store.teacherLinksApproved(school.id);

    const rows = (links || []).map((l) => l.users).filter(Boolean);
    const withCounts = await Promise.all(rows.map(async (u) => {
      const { count } = await store.courseCountByInstructors([u.id]);
      return { id: u.id, full_name: u.full_name, email: u.email, avatar_url: u.avatar_url, subjects: u.subjects || [], course_count: count || 0 };
    }));
    res.json({ success: true, data: withCounts });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/teacher-requests — pending teachers who asked to join ─────
export async function listTeacherRequests(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await store.teacherLinksPending(school.id);
    res.json({ success: true, data: (data || []).map((r) => ({ teacher_id: r.teacher_id, requested_at: r.requested_at, full_name: r.users?.full_name, email: r.users?.email, avatar_url: r.users?.avatar_url, subjects: r.users?.subjects || [] })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/teacher-requests/:teacherId  { decision } ────────────────
export async function decideTeacherRequest(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const decision = req.body?.decision;
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "decision must be approve or reject" });
    const status = decision === "approve" ? "approved" : "rejected";
    // Gate on an actual PENDING request from this teacher for THIS school, and
    // check it matched — otherwise a school could "approve" an arbitrary
    // teacher id and absorb that teacher's unowned classrooms (BOLA).
    const { data: updated, error } = await store.teacherRequestDecide(school.id, req.params.teacherId, { status, decided_at: new Date(), decided_by: req.user.id });
    if (error) throw new Error(error.message);
    if (!updated) return res.status(404).json({ error: "No pending request from this teacher." });
    if (status === "approved") await store.classroomsAdoptUnassigned(school.id, req.params.teacherId);

    // Notify the teacher of the decision.
    const { data: teacher } = await store.userNameEmailById(req.params.teacherId);
    const approved = status === "approved";
    notifyUser({
      userId: req.params.teacherId,
      type: "school_membership",
      title: approved ? `You've joined ${school.name}` : `Request to join ${school.name} declined`,
      content: approved ? `${school.name} approved your request to join.` : `${school.name} declined your request to join.`,
      email: teacher?.email ? {
        to: teacher.email, name: teacher.full_name,
        subject: approved ? `Approved: you've joined ${school.name}` : `Update on your request to join ${school.name}`,
        heading: approved ? "Request approved 🎉" : "Request update",
        body: approved
          ? `Good news — <strong>${school.name}</strong> approved your request to join. Your classes and students are now linked to the school.`
          : `<strong>${school.name}</strong> declined your request to join. You can request another school anytime from your dashboard.`,
        ctaUrl: process.env.INSTRUCTOR_FRONTEND_URL || undefined, ctaLabel: "Open dashboard →",
      } : null,
    });
    res.json({ success: true, status });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/instructors/invite ──────────────────────────────────────
// Body: { email, full_name? }. Creates the teacher account if new, upgrades to
// instructor, and links it to the school.
export async function inviteInstructor(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const email = (req.body.email || "").toLowerCase().trim();
    const fullName = (req.body.full_name || "").trim();
    if (!email) return res.status(400).json({ error: "email is required" });

    const { data: existing } = await store.userByEmailLite(email);

    let teacher;
    if (existing) {
      await store.userRoleUpdate(existing.id, "instructor");
      invalidateCachedUser(existing.id);   // security field — never serve it stale
      teacher = existing;
    } else {
      const tempPassword = crypto.randomBytes(8).toString("base64").slice(0, 10);
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const usernameBase = (email.split("@")[0] || `teacher${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, "_");
      const { data: u, error } = await store.userInsert({
        email, username: `${usernameBase}_${Math.floor(Math.random() * 9000) + 1000}`,
        password_hash: passwordHash, full_name: fullName || null,
        role: "instructor", is_active: true, must_change_password: true,
      });
      if (error) throw new Error(error.message);
      teacher = u;
    }

    await store.teacherLinkUpsert(school.id, teacher.id);

    res.status(201).json({ success: true, data: { id: teacher.id, full_name: teacher.full_name || fullName, email: teacher.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/courses ──────────────────────────────────────────────────
// All courses across the school's instructors (+ the admin's own), shaped like
// the instructor course list so the Courses page renders unchanged.
export async function listCourses(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: teachers } = await store.teacherIdsBySchool(school.id);
    const ids = [...new Set([...(teachers || []).map((t) => t.teacher_id), req.user.id])];

    const { data: courses } = await store.coursesByInstructors(ids);

    const shaped = await Promise.all((courses || []).map(async (c) => {
      const { count } = await store.enrollmentCount(c.id);
      return {
        ...c,
        type:             c.course_type === "video" ? "on-demand" : "live",
        status:           c.is_published ? "active" : "draft",
        studentsEnrolled: count || 0,
        thumbnail:        c.cover_image_url || null,
        instructor_name:  c.instructor?.full_name || null,
      };
    }));
    res.json({ success: true, data: shaped });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/students ─────────────────────────────────────────────────
export async function listStudents(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const cids = await classroomIds(school.id);
    if (!cids.length) return res.json({ success: true, data: [] });

    const { data: rows } = await store.classroomStudentsByCids(cids);

    // Dedupe by user (a student can be in multiple classrooms)
    const seen = new Map();
    (rows || []).forEach((r) => {
      const u = r.users; if (!u || seen.has(u.id)) return;
      seen.set(u.id, { id: u.id, full_name: u.full_name, email: u.email, avatar_url: u.avatar_url, status: r.status });
    });
    res.json({ success: true, data: [...seen.values()] });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/classrooms ───────────────────────────────────────────────
export async function listClassrooms(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: rooms } = await store.classroomsWithStudents(school.id);
    const shaped = (rooms || []).map((c) => ({
      id: c.id, name: c.name, description: c.description,
      teacher_id: c.teacher_id, teacher_name: c.teacher?.full_name || null,
      student_count: c.classroom_students?.length || 0,
    }));
    res.json({ success: true, data: shaped });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/classrooms ──────────────────────────────────────────────
export async function createClassroom(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { name, description, teacher_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Class name is required" });
    const { data, error } = await store.classroomInsert({
      school_id: school.id, teacher_id: teacher_id || null, name: name.trim(),
      description: description?.trim() || null, student_limit: 9999, is_upgraded: true,
    });
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: { ...data, student_count: 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/classrooms/:id/teacher ──────────────────────────────────
export async function assignClassroomTeacher(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: row } = await store.classroomById(req.params.id);
    const room = ownClassroom(row, school.id);
    if (!room) return res.status(404).json({ error: "Classroom not found" });
    const { teacher_id } = req.body;
    if (!teacher_id) return res.status(400).json({ error: "teacher_id required" });
    // Teacher must belong to this school
    const { data: link } = await store.teacherLink(school.id, teacher_id);
    if (!link) return res.status(400).json({ error: "That teacher is not in your school" });
    await store.classroomTeacherUpdate(req.params.id, teacher_id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/classrooms/:id/students ─────────────────────────────────
// Body: { user_id } to add an existing student, or { email, full_name } to create+add.
export async function addClassroomStudent(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: row } = await store.classroomById(req.params.id);
    const room = ownClassroom(row, school.id);
    if (!room) return res.status(404).json({ error: "Classroom not found" });

    let userId = req.body.user_id;
    if (!userId) {
      if (!req.body.email?.trim()) return res.status(400).json({ error: "user_id or email required" });
      const u = await findOrCreateUser(req.body.email, req.body.full_name, "student");
      userId = u.id;
    }
    const { data: already } = await store.classroomStudentLink(room.id, userId);
    if (already) return res.status(409).json({ error: "Student already in this class" });
    await store.classroomStudentInsert({ classroom_id: room.id, user_id: userId, status: "active" });
    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── POST /api/school/students/enrol ──────────────────────────────────────────
// Manual Entry / Send Invite: create a learner account (if new), add them to a
// school classroom, and mirror into the SIS roster. Body:
//   { fullName, email, sendEmail? }  — sendEmail=true emails credentials
//   (the "invite" flow); otherwise the temp password is returned to show once.
export async function enrolStudent(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const email = (req.body.email || "").toLowerCase().trim();
    const fullName = (req.body.fullName || "").trim();
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Find or create the learner account (capture temp password for new ones).
    let tempPassword = null, isNew = false;
    let { data: user } = await store.userByEmailLite(email);
    if (!user) {
      tempPassword = crypto.randomBytes(8).toString("base64").slice(0, 10);
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const base = (email.split("@")[0] || `user${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, "_");
      const { data: created, error } = await store.userInsert({
        email, username: `${base}_${Math.floor(Math.random() * 9000) + 1000}`,
        password_hash: passwordHash, full_name: fullName || null, role: "student", is_active: true, must_change_password: true,
      });
      if (error) { if (error.code === "23505") return res.status(409).json({ error: "That email is already registered" }); throw new Error(error.message); }
      user = created; isNew = true;
    }

    // Ensure a school classroom (school-owned; the admin is the placeholder teacher).
    let { data: room } = await store.classroomFirstForSchool(school.id);
    if (!room) {
      const { data: r } = await store.classroomCreateGeneral({ teacher_id: req.user.id, school_id: school.id, name: `${school.name} — General` });
      room = r;
    }
    const { data: already } = await store.classroomStudentLink(room.id, user.id);
    if (!already) await store.classroomStudentInsert({ classroom_id: room.id, user_id: user.id, status: "active" });

    // Mirror into the SIS roster (mgmt.students).
    const { data: sis } = await store.sisStudentByUser(school.id, user.id);
    if (!sis) {
      const parts = (user.full_name || fullName || email.split("@")[0]).trim().split(/\s+/);
      const first = parts.shift() || "Student"; const last = parts.join(" ") || first;
      await store.sisStudentInsert({
        school_id: school.id, user_id: user.id, created_by: req.user.id,
        admission_no: `S-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`,
        first_name: first, last_name: last, status: "active",
      });
    }

    // Email credentials on the invite path.
    const wantEmail = req.body.sendEmail === true || req.body.sendEmail === "true";
    if (wantEmail && isNew && tempPassword) {
      const loginUrl = urlFor("FRONTEND_URL");
      notifyUser({
        userId: user.id, type: "account_created",
        title: `Welcome to ${school.name}`,
        content: `An account was created for you at ${school.name}.`,
        email: {
          to: user.email, name: user.full_name || fullName,
          subject: `You've been added to ${school.name} on Akoro`,
          heading: "Your account is ready 🎓",
          body: `<strong>${school.name}</strong> added you to Akoro. Sign in with <strong>${user.email}</strong> and the temporary password <strong>${tempPassword}</strong>, then change it.`,
          ctaUrl: loginUrl, ctaLabel: "Sign in →",
        },
      });
    }

    res.status(201).json({
      success: true,
      student: { id: user.id, full_name: user.full_name || fullName, email: user.email },
      account_created: isNew,
      temp_password: (isNew && !wantEmail) ? tempPassword : undefined,
      message: isNew ? (wantEmail ? "Invite sent with login details" : "Account created") : "Student added",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

// ── GET /api/school/audit-logs?entityType=&method=&limit=&offset= ────────────
export async function listAuditLogs(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Number(req.query.offset) || 0;

    const q = store.auditLogs(school.id, {
      limit,
      offset,
      entityType: req.query.entityType,
      method: req.query.method ? req.query.method.toUpperCase() : null,
    });

    const { data, count, error } = await q;
    if (error) throw new Error(error.message);

    const { data: entityRows } = await store.auditLogEntityTypes(school.id);
    const entityTypes = [...new Set((entityRows || []).map((r) => r.entity_type))].sort();

    res.json({
      success: true,
      data: (data || []).map((r) => ({
        id: r.id, actorName: r.actor_name, method: r.method, entityType: r.entity_type,
        entityLabel: r.entity_label, path: r.path, statusCode: r.status_code,
        details: r.details, createdAt: r.created_at,
      })),
      total: count || 0,
      entityTypes,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
