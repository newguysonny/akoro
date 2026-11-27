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
import { sanitizeAuditBody, pickEntityLabel, slugify, mapSchoolSession } from "./rules.js";

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

// ── GET /api/school/sessions ─────────────────────────────────────────────────
// Live sessions across every course owned by the school's teachers — the
// school-scoped counterpart of GET /api/instructor/sessions, which is
// role-gated to instructors and so always 403'd for a school admin (the
// dashboard's "today's sessions" could never load). Window: from 24 h ago
// onward, so today's sessions are included in every timezone; the client
// filters to its own calendar day.
export async function listSessions(req, res) {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: teachers } = await store.teacherIdsBySchool(school.id);
    const teacherIds = (teachers || []).map((t) => t.teacher_id);
    if (!teacherIds.length) return res.json({ success: true, data: [] });
    const { data: courses, error: cErr } = await store.courseIdsByInstructors(teacherIds);
    if (cErr) throw new Error(cErr.message);
    const courseIds = (courses || []).map((c) => c.id);
    if (!courseIds.length) return res.json({ success: true, data: [] });
    const from = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: sessions, error } = await store.sessionsForCourses(courseIds, from);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: (sessions || []).map(mapSchoolSession) });
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
