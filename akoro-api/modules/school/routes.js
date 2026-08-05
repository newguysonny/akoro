/**
 * modules/school/routes.js — School partner portal API
 *
 * Mount: app.use("/api/school", standardLimit, schoolModule);
 *
 * A "school" is a row in school_profiles (admin_user_id = the school account).
 * Schools own their instructors (school_teachers) and students (via
 * classrooms → classroom_students). Those same instructors/students can also
 * use the Instructor / Learner apps.
 *
 * Routes (all scoped to the caller's school — never another school):
 *   GET  /api/school                      — my school profile + totals
 *   GET  /api/school/stats                — headline counts
 *   GET  /api/school/instructors          — the school's teachers
 *   POST /api/school/instructors/invite   — create/link a teacher
 *   GET  /api/school/students             — the school's students
 */

import { Router } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import db from "../../db.js";
import { notifyUser } from "../notify.js";
import { authenticateToken, requireRole, issueTokenPair, signHandoff, verifyHandoff } from "../auth/routes.js";
import {
  initializeTransaction,
  verifyTransaction,
  generateReference,
} from "../adaptive-learning/marketplace/paystackService.js";
import multerLib from "multer";
import { renderMiniTemplate, renderThemePage, renderSitePage, renderThemeDocument, buildContext } from "./siteRenderer.js";
import { assembleTemplateFromZip, ensureResponsiveViewport } from "./templateZip.js";
import { ensureBucket, uploadZipToStorage, removeTemplateAssets, uploadPublicFile } from "./templateStorage.js";
import { DEFAULT_TEMPLATES, getDefaultTemplate } from "./defaultTemplates/index.js";
import { llmComplete } from "../../lib/aiModel.js";
import {
  vercelConfigured, addDomainToProject, getProjectDomain,
  verifyProjectDomain, getDomainConfig, removeDomainFromProject, buildDnsRecords,
} from "./vercelDomains.js";
import mgmtRouter from "./mgmt.js";
import publicPortalRouter from "./publicPortal.js";
import { resolveSchoolByHost, getSchoolGateway, SITE_BASE_DOMAIN, SITE_BASE_DOMAINS } from "./tenant.js";
import { strictLimit } from "../../middleware/security.js";

const router = Router();
const SCHOOL_ROLES = ["school", "school_admin", "admin"];

// =============================================================
// AUDIT TRAIL — automatically logs every write (POST/PUT/PATCH/DELETE) made
// under /api/school/*, so new mutation routes are covered without extra
// wiring. Registered first so res.on('finish') fires after the route
// handler (and authenticateToken) has already set req.user.
// =============================================================
const SECRET_KEY_PATTERN = /token|secret|password|key$/i;
function sanitizeAuditBody(body) {
  if (!body || typeof body !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? "[redacted]" : v;
  }
  return out;
}
function pickEntityLabel(body) {
  if (!body || typeof body !== "object") return null;
  return body.name || body.label || body.title || body.domain || null;
}
router.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  res.on("finish", async () => {
    try {
      if (res.statusCode >= 400 || !req.user) return;
      const { data: school } = await db.from("school_profiles")
        .select("id").eq("admin_user_id", req.user.id)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (!school) return;
      const entityType = req.path.split("/").filter(Boolean)[0] || "root";
      await db.schema("edu").from("school_audit_logs").insert({
        school_id: school.id, actor_user_id: req.user.id,
        actor_name: req.user.fullName || req.user.email || null,
        method: req.method, entity_type: entityType, entity_label: pickEntityLabel(req.body),
        path: req.originalUrl, status_code: res.statusCode,
        details: sanitizeAuditBody(req.body), ip_address: req.ip,
      });
    } catch { /* never let audit logging break the request */ }
  });
  next();
});

// Management + Facilities & Services (mgmt schema). Mounted after the audit
// middleware above so every mgmt write is audit-logged too.
router.use("/mgmt", mgmtRouter);

// Resolve the caller's school (first one they administer). 404s if none.
async function getMySchool(req, res) {
  const { data } = await db
    .from("school_profiles")
    .select("id, name, description, logo_url, website, address, phone, is_active, verification_status, created_at, slug, acronym, principal_name, country, state, lga, city, education_levels, ownership_type, curriculum, year_established, gender_type, boarding_type, student_band, favicon_url, principal_signature_url")
    .eq("admin_user_id", req.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) { res.status(404).json({ error: "No school is linked to this account." }); return null; }
  return data;
}

const slugify = (s) => (s || "school").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

// Ensure the school has a persisted, unique slug (used by /site/:slug previews
// and <slug>.akoro.app). Backfills schools created before slugs were saved.
async function ensureSchoolSlug(school) {
  if (school.slug) return school.slug;
  const base = slugify(school.name) || "school";
  let slug = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await db.from("school_profiles").select("id").eq("slug", slug).maybeSingle();
    if (!clash || clash.id === school.id) break;
    slug = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  }
  await db.from("school_profiles").update({ slug }).eq("id", school.id);
  school.slug = slug;
  return slug;
}

// jsonb-per-category settings row (created lazily on first access).
async function getPortalSettings(schoolId) {
  const { data } = await db.schema("edu").from("school_portal_settings").select("*").eq("school_id", schoolId).maybeSingle();
  if (data) return data;
  const { data: created } = await db.schema("edu").from("school_portal_settings").insert({ school_id: schoolId }).select("*").single();
  return created;
}

async function classroomIds(schoolId) {
  const { data } = await db.from("classrooms").select("id").eq("school_id", schoolId);
  return (data || []).map((c) => c.id);
}

// ── GET /api/school ──────────────────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const cids = await classroomIds(school.id);
    const [{ count: instructors }, { count: students }] = await Promise.all([
      db.from("school_teachers").select("teacher_id", { count: "exact", head: true }).eq("school_id", school.id),
      cids.length
        ? db.from("classroom_students").select("id", { count: "exact", head: true }).in("classroom_id", cids)
        : Promise.resolve({ count: 0 }),
    ]);
    res.json({ success: true, data: { ...school, total_classrooms: cids.length, total_instructors: instructors || 0, total_students: students || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/school/stats ────────────────────────────────────────────────────
router.get("/stats", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const cids = await classroomIds(school.id);
    const { data: teachers } = await db.from("school_teachers").select("teacher_id").eq("school_id", school.id);
    const teacherIds = (teachers || []).map((t) => t.teacher_id);
    const [{ count: students }, { count: courses }] = await Promise.all([
      cids.length ? db.from("classroom_students").select("id", { count: "exact", head: true }).in("classroom_id", cids) : Promise.resolve({ count: 0 }),
      teacherIds.length ? db.from("courses").select("id", { count: "exact", head: true }).in("instructor_id", teacherIds) : Promise.resolve({ count: 0 }),
    ]);
    res.json({ success: true, data: { classrooms: cids.length, instructors: teacherIds.length, students: students || 0, courses: courses || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/school/instructors ──────────────────────────────────────────────
router.get("/instructors", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: links } = await db
      .from("school_teachers")
      .select("teacher_id, created_at, status, users:users!school_teachers_teacher_id_fkey(id, full_name, email, avatar_url, subjects)")
      .eq("school_id", school.id)
      .eq("status", "approved")
      .order("created_at", { ascending: false });

    const rows = (links || []).map((l) => l.users).filter(Boolean);
    const withCounts = await Promise.all(rows.map(async (u) => {
      const { count } = await db.from("courses").select("id", { count: "exact", head: true }).eq("instructor_id", u.id);
      return { id: u.id, full_name: u.full_name, email: u.email, avatar_url: u.avatar_url, subjects: u.subjects || [], course_count: count || 0 };
    }));
    res.json({ success: true, data: withCounts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/school/teacher-requests — pending teachers who asked to join ─────
router.get("/teacher-requests", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await db.from("school_teachers")
      .select("teacher_id, requested_at, status, users:users!school_teachers_teacher_id_fkey(id, full_name, email, avatar_url, subjects)")
      .eq("school_id", school.id).eq("status", "pending").order("requested_at", { ascending: true });
    res.json({ success: true, data: (data || []).map((r) => ({ teacher_id: r.teacher_id, requested_at: r.requested_at, full_name: r.users?.full_name, email: r.users?.email, avatar_url: r.users?.avatar_url, subjects: r.users?.subjects || [] })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/teacher-requests/:teacherId  { decision } ────────────────
router.post("/teacher-requests/:teacherId", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const decision = req.body?.decision;
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "decision must be approve or reject" });
    const status = decision === "approve" ? "approved" : "rejected";
    // Gate on an actual PENDING request from this teacher for THIS school, and
    // check it matched — otherwise a school could "approve" an arbitrary
    // teacher id and absorb that teacher's unowned classrooms (BOLA).
    const { data: updated, error } = await db.from("school_teachers")
      .update({ status, decided_at: new Date(), decided_by: req.user.id })
      .eq("school_id", school.id).eq("teacher_id", req.params.teacherId).eq("status", "pending")
      .select("teacher_id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) return res.status(404).json({ error: "No pending request from this teacher." });
    if (status === "approved") await db.from("classrooms").update({ school_id: school.id }).eq("teacher_id", req.params.teacherId).is("school_id", null);

    // Notify the teacher of the decision.
    const { data: teacher } = await db.from("users").select("full_name, email").eq("id", req.params.teacherId).maybeSingle();
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
});

// ── POST /api/school/instructors/invite ──────────────────────────────────────
// Body: { email, full_name? }. Creates the teacher account if new, upgrades to
// instructor, and links it to the school.
router.post("/instructors/invite", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const email = (req.body.email || "").toLowerCase().trim();
    const fullName = (req.body.full_name || "").trim();
    if (!email) return res.status(400).json({ error: "email is required" });

    const { data: existing } = await db.from("users").select("id, full_name, email").eq("email", email).maybeSingle();

    let teacher;
    if (existing) {
      await db.from("users").update({ role: "instructor" }).eq("id", existing.id);
      teacher = existing;
    } else {
      const tempPassword = crypto.randomBytes(8).toString("base64").slice(0, 10);
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const usernameBase = (email.split("@")[0] || `teacher${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, "_");
      const { data: u, error } = await db.from("users").insert({
        email, username: `${usernameBase}_${Math.floor(Math.random() * 9000) + 1000}`,
        password_hash: passwordHash, full_name: fullName || null,
        role: "instructor", is_active: true, must_change_password: true,
      }).select("id, full_name, email").single();
      if (error) throw new Error(error.message);
      teacher = u;
    }

    await db.from("school_teachers").upsert({ school_id: school.id, teacher_id: teacher.id }, { onConflict: "school_id,teacher_id" });

    res.status(201).json({ success: true, data: { id: teacher.id, full_name: teacher.full_name || fullName, email: teacher.email } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/school/courses ──────────────────────────────────────────────────
// All courses across the school's instructors (+ the admin's own), shaped like
// the instructor course list so the Courses page renders unchanged.
router.get("/courses", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: teachers } = await db.from("school_teachers").select("teacher_id").eq("school_id", school.id);
    const ids = [...new Set([...(teachers || []).map((t) => t.teacher_id), req.user.id])];

    const { data: courses } = await db
      .from("courses")
      .select("id, slug, title, description, subject, level, is_published, is_free, price, course_type, cover_image_url, total_students, rating, total_hours, created_at, instructor:users!instructor_id(full_name)")
      .in("instructor_id", ids)
      .order("created_at", { ascending: false });

    const shaped = await Promise.all((courses || []).map(async (c) => {
      const { count } = await db.from("enrollments").select("id", { count: "exact", head: true }).eq("course_id", c.id).eq("status", "active");
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
});

// ── GET /api/school/students ─────────────────────────────────────────────────
router.get("/students", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const cids = await classroomIds(school.id);
    if (!cids.length) return res.json({ success: true, data: [] });

    const { data: rows } = await db
      .from("classroom_students")
      .select("user_id, status, classroom_id, users:users!classroom_students_user_id_fkey(id, full_name, email, avatar_url)")
      .in("classroom_id", cids);

    // Dedupe by user (a student can be in multiple classrooms)
    const seen = new Map();
    (rows || []).forEach((r) => {
      const u = r.users; if (!u || seen.has(u.id)) return;
      seen.set(u.id, { id: u.id, full_name: u.full_name, email: u.email, avatar_url: u.avatar_url, status: r.status });
    });
    res.json({ success: true, data: [...seen.values()] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// CLASSROOMS — create classes, add students, assign a teacher.
// =============================================================

async function ownClassroom(schoolId, classroomId) {
  const { data } = await db.from("classrooms").select("id, school_id, name").eq("id", classroomId).maybeSingle();
  return data && data.school_id === schoolId ? data : null;
}

// find-or-create a user with the given role, by email
async function findOrCreateUser(email, fullName, role) {
  const safe = (email || "").toLowerCase().trim();
  const { data: existing } = await db.from("users").select("id, full_name, email").eq("email", safe).maybeSingle();
  if (existing) return existing;
  const tempPassword = crypto.randomBytes(8).toString("base64").slice(0, 10);
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const base = (safe.split("@")[0] || `user${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, "_");
  const { data, error } = await db.from("users").insert({
    email: safe, username: `${base}_${Math.floor(Math.random() * 9000) + 1000}`,
    password_hash: passwordHash, full_name: fullName || null, role, is_active: true, must_change_password: true,
  }).select("id, full_name, email").single();
  if (error) throw new Error(error.message);
  return data;
}

// ── GET /api/school/classrooms ───────────────────────────────────────────────
router.get("/classrooms", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: rooms } = await db
      .from("classrooms")
      .select("id, name, description, teacher_id, teacher:users!classrooms_teacher_id_fkey(full_name), classroom_students(id)")
      .eq("school_id", school.id)
      .order("created_at", { ascending: false });
    const shaped = (rooms || []).map((c) => ({
      id: c.id, name: c.name, description: c.description,
      teacher_id: c.teacher_id, teacher_name: c.teacher?.full_name || null,
      student_count: c.classroom_students?.length || 0,
    }));
    res.json({ success: true, data: shaped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/classrooms ──────────────────────────────────────────────
router.post("/classrooms", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { name, description, teacher_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Class name is required" });
    const { data, error } = await db.from("classrooms").insert({
      school_id: school.id, teacher_id: teacher_id || null, name: name.trim(),
      description: description?.trim() || null, student_limit: 9999, is_upgraded: true,
    }).select("id, name, description, teacher_id").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: { ...data, student_count: 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/classrooms/:id/teacher ──────────────────────────────────
router.post("/classrooms/:id/teacher", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const room = await ownClassroom(school.id, req.params.id);
    if (!room) return res.status(404).json({ error: "Classroom not found" });
    const { teacher_id } = req.body;
    if (!teacher_id) return res.status(400).json({ error: "teacher_id required" });
    // Teacher must belong to this school
    const { data: link } = await db.from("school_teachers").select("teacher_id").eq("school_id", school.id).eq("teacher_id", teacher_id).maybeSingle();
    if (!link) return res.status(400).json({ error: "That teacher is not in your school" });
    await db.from("classrooms").update({ teacher_id }).eq("id", req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/classrooms/:id/students ─────────────────────────────────
// Body: { user_id } to add an existing student, or { email, full_name } to create+add.
router.post("/classrooms/:id/students", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const room = await ownClassroom(school.id, req.params.id);
    if (!room) return res.status(404).json({ error: "Classroom not found" });

    let userId = req.body.user_id;
    if (!userId) {
      if (!req.body.email?.trim()) return res.status(400).json({ error: "user_id or email required" });
      const u = await findOrCreateUser(req.body.email, req.body.full_name, "student");
      userId = u.id;
    }
    const { data: already } = await db.from("classroom_students").select("id").eq("classroom_id", room.id).eq("user_id", userId).maybeSingle();
    if (already) return res.status(409).json({ error: "Student already in this class" });
    await db.from("classroom_students").insert({ classroom_id: room.id, user_id: userId, status: "active" });
    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/students/enrol ──────────────────────────────────────────
// Manual Entry / Send Invite: create a learner account (if new), add them to a
// school classroom, and mirror into the SIS roster. Body:
//   { fullName, email, sendEmail? }  — sendEmail=true emails credentials
//   (the "invite" flow); otherwise the temp password is returned to show once.
router.post("/students/enrol", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const email = (req.body.email || "").toLowerCase().trim();
    const fullName = (req.body.fullName || "").trim();
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Find or create the learner account (capture temp password for new ones).
    let tempPassword = null, isNew = false;
    let { data: user } = await db.from("users").select("id, full_name, email").eq("email", email).maybeSingle();
    if (!user) {
      tempPassword = crypto.randomBytes(8).toString("base64").slice(0, 10);
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const base = (email.split("@")[0] || `user${Date.now()}`).replace(/[^a-zA-Z0-9_]/g, "_");
      const { data: created, error } = await db.from("users").insert({
        email, username: `${base}_${Math.floor(Math.random() * 9000) + 1000}`,
        password_hash: passwordHash, full_name: fullName || null, role: "student", is_active: true, must_change_password: true,
      }).select("id, full_name, email").single();
      if (error) { if (error.code === "23505") return res.status(409).json({ error: "That email is already registered" }); throw new Error(error.message); }
      user = created; isNew = true;
    }

    // Ensure a school classroom (school-owned; the admin is the placeholder teacher).
    let { data: room } = await db.from("classrooms").select("id").eq("school_id", school.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (!room) {
      const { data: r } = await db.from("classrooms").insert({ teacher_id: req.user.id, school_id: school.id, name: `${school.name} — General` }).select("id").single();
      room = r;
    }
    const { data: already } = await db.from("classroom_students").select("id").eq("classroom_id", room.id).eq("user_id", user.id).maybeSingle();
    if (!already) await db.from("classroom_students").insert({ classroom_id: room.id, user_id: user.id, status: "active" });

    // Mirror into the SIS roster (mgmt.students).
    const M = db.schema("mgmt");
    const { data: sis } = await M.from("students").select("id").eq("school_id", school.id).eq("user_id", user.id).maybeSingle();
    if (!sis) {
      const parts = (user.full_name || fullName || email.split("@")[0]).trim().split(/\s+/);
      const first = parts.shift() || "Student"; const last = parts.join(" ") || first;
      await M.from("students").insert({
        school_id: school.id, user_id: user.id, created_by: req.user.id,
        admission_no: `S-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`,
        first_name: first, last_name: last, status: "active",
      }).select("id").maybeSingle();
    }

    // Email credentials on the invite path.
    const wantEmail = req.body.sendEmail === true || req.body.sendEmail === "true";
    if (wantEmail && isNew && tempPassword) {
      const loginUrl = process.env.FRONTEND_URL || "https://akoro.name.ng";
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
});

// =============================================================
// SCHOOL AGENT — the school's dedicated AI agent (one per school).
// Reuses the user_agents record of the school-admin account, so the whole
// chat / training / tools pipeline works, but it's presented and defaulted
// as the SCHOOL's agent (named after the school).
// =============================================================
const AGENT_SELECT = "id, agent_name, agent_emoji, agent_color, agent_bg, total_xp, personality, teacher_agent_id, guide_name, guide_emoji, guide_render_style, is_active";

// ── GET /api/school/agent ────────────────────────────────────────────────────
router.get("/agent", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;

    let { data: agent } = await db.from("user_agents").select(AGENT_SELECT).eq("user_id", req.user.id).maybeSingle();
    if (!agent) {
      const { data: created, error } = await db.from("user_agents").insert({
        user_id:      req.user.id,
        agent_name:   `${school.name} Agent`,
        agent_emoji:  "🏫",
        agent_color:  "#E8884A",
        agent_bg:     "#FEF0E6",
        teacher_agent_id: "nana-sargeant",
        guide_name:   "NaNa Esumai",
        guide_emoji:  "🧠",
        is_active:    true,
      }).select(AGENT_SELECT).single();
      if (error) throw new Error(error.message);
      agent = created;
    }
    res.json({ success: true, data: { agent, school: { id: school.id, name: school.name } } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/school/agent ──────────────────────────────────────────────────
router.patch("/agent", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const allowed = ["agent_name", "agent_emoji", "agent_color", "agent_bg", "personality"];
    const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (!Object.keys(patch).length) return res.status(400).json({ error: "No valid fields (agent_name, agent_emoji, agent_color, agent_bg, personality)" });
    patch.updated_at = new Date();

    const { data, error } = await db.from("user_agents").update(patch).eq("user_id", req.user.id).select(AGENT_SELECT).single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// SETTINGS & BILLING — School Profile, System & Formats, Attendance,
// Privacy & Security, Integrations, Personalisation, Notification prefs.
// =============================================================

// ── GET /api/school/settings ─────────────────────────────────────────────────
router.get("/settings", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getPortalSettings(school.id);
    res.json({
      success: true,
      data: {
        profile: {
          name: school.name, acronym: school.acronym, email: req.user.email,
          phone: school.phone, principal: school.principal_name, country: school.country,
          state: school.state, lga: school.lga, city: school.city,
          educationLevels: school.education_levels || [], ownershipType: school.ownership_type, curriculum: school.curriculum,
          yearEstablished: school.year_established, genderType: school.gender_type, boardingType: school.boarding_type, studentBand: school.student_band,
          address: school.address, logoUrl: school.logo_url, faviconUrl: school.favicon_url,
          signatureUrl: school.principal_signature_url,
        },
        systemFormats:     settings?.system_formats ?? {},
        attendance:        settings?.attendance ?? {},
        security:          settings?.security ?? {},
        // Mask the biometric API key on load — the full key is only returned
        // once, at generation time (regenerate-key), not on every settings read.
        integrations:      (() => { const i = { ...(settings?.integrations ?? {}) }; if (i.biometricApiKey) i.biometricApiKey = `${String(i.biometricApiKey).slice(0, 10)}…${String(i.biometricApiKey).slice(-4)}`; return i; })(),
        personalisation:   settings?.personalisation ?? {},
        notificationPrefs: settings?.notification_prefs ?? {},
        modules:           settings?.modules ?? {},
        // Which optional modules this school has actually bought. The sidebar
        // needs both: `modules` is the school's own on/off switch, this is
        // entitlement. A module shows only when it is owned AND not switched
        // off, so turning one off never silently loses the purchase.
        moduleAccess:      await ownedModuleKeys(req.user.id),
        backupSchedule:    settings?.backup_schedule ?? { autoBackup: true, frequency: 'daily', retentionDays: 30 },
        content:           settings?.content ?? {},
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * The optional modules a school owns, as { moduleKey: true }.
 *
 * Optional modules are sold through the same catalog as agent tools
 * (edu.platform_tools, kind='management', key 'module-<moduleKey>'), so
 * ownership is the same instructor_tool_access row a tool purchase writes —
 * there is no second entitlement system to keep in step.
 */
async function ownedModuleKeys(userId) {
  try {
    const { data: rows } = await db.schema("edu").from("instructor_tool_access")
      .select("tool_id, access_granted, platform_tools!inner(key, kind)")
      .eq("instructor_id", userId).eq("access_granted", true)
      .eq("platform_tools.kind", "management");
    const out = {};
    for (const r of rows || []) {
      const key = r.platform_tools?.key || "";
      if (key.startsWith("module-")) out[key.slice(7)] = true;
    }
    return out;
  } catch (e) {
    console.warn("[school] module entitlements failed:", e.message);
    return {};
  }
}

// ── PUT /api/school/settings/profile ─────────────────────────────────────────
router.put("/settings/profile", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { name, acronym, phone, principal, country, state, lga, city, educationLevels, ownershipType, curriculum,
            yearEstablished, genderType, boardingType, studentBand, address, logoUrl, faviconUrl, signatureUrl } = req.body;
    const patch = {};
    if (name !== undefined)       patch.name = name;
    if (acronym !== undefined)    patch.acronym = acronym;
    if (phone !== undefined)      patch.phone = phone;
    if (principal !== undefined)  patch.principal_name = principal;
    if (country !== undefined)    patch.country = country;
    if (state !== undefined)      patch.state = state;
    if (lga !== undefined)        patch.lga = lga;
    if (city !== undefined)       patch.city = city;
    if (educationLevels !== undefined) patch.education_levels = educationLevels;
    if (ownershipType !== undefined)   patch.ownership_type = ownershipType;
    if (curriculum !== undefined)      patch.curriculum = curriculum;
    if (yearEstablished !== undefined) patch.year_established = yearEstablished === '' ? null : yearEstablished;
    if (genderType !== undefined)      patch.gender_type = genderType;
    if (boardingType !== undefined)    patch.boarding_type = boardingType;
    if (studentBand !== undefined)     patch.student_band = studentBand;
    if (address !== undefined)    patch.address = address;
    if (logoUrl !== undefined)    patch.logo_url = logoUrl;
    if (faviconUrl !== undefined) patch.favicon_url = faviconUrl;
    if (signatureUrl !== undefined) patch.principal_signature_url = signatureUrl;
    const { error } = await db.from("school_profiles").update(patch).eq("id", school.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/settings/profile/upload ─────────────────────────────────
// Upload a branding image (logo / favicon / principal signature) → storage →
// set the matching school_profiles column. multipart field: "file", body: kind.
const brandingUpload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } }).single("file");
const BRANDING_COLUMN = { logo: "logo_url", favicon: "favicon_url", signature: "principal_signature_url" };
router.post("/settings/profile/upload", authenticateToken, requireRole(SCHOOL_ROLES), (req, res) => {
  brandingUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message });
      const school = await getMySchool(req, res);
      if (!school) return;
      const col = BRANDING_COLUMN[req.body?.kind];
      if (!col) return res.status(400).json({ error: "kind must be logo, favicon or signature" });
      const f = req.file;
      if (!f) return res.status(400).json({ error: "Choose an image" });
      // Raster images only — SVG/HTML would be stored XSS on the public site.
      if (!/^image\/(png|jpe?g|webp|gif|x-icon|vnd\.microsoft\.icon)$/i.test(f.mimetype || "")) return res.status(400).json({ error: "Upload a PNG, JPG, WEBP, GIF or ICO image." });

      await ensureBucket();
      const safe = (f.originalname || "img").replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = `schools/${school.id}/branding/${req.body.kind}-${Date.now()}-${safe}`;
      const url = await uploadPublicFile(dest, f.buffer, f.mimetype || "application/octet-stream");
      const { error } = await db.from("school_profiles").update({ [col]: url, updated_at: new Date().toISOString() }).eq("id", school.id);
      if (error) throw new Error(error.message);
      res.status(201).json({ success: true, data: { kind: req.body.kind, url } });
    } catch (e) { console.error("[settings/profile/upload]", e.message); res.status(500).json({ error: "Upload failed. Try again." }); }
  });
});

// ── PUT /api/school/settings/:category ───────────────────────────────────────
// category ∈ system-formats | attendance | security | integrations | personalisation | notification-prefs
const SETTINGS_CATEGORY_COLUMN = {
  "system-formats":      "system_formats",
  "attendance":           "attendance",
  "security":             "security",
  "integrations":         "integrations",
  "personalisation":      "personalisation",
  "notification-prefs":   "notification_prefs",
  "modules":              "modules",
  "backup":               "backup_schedule",
  "content":              "content",
};
router.put("/settings/:category", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const column = SETTINGS_CATEGORY_COLUMN[req.params.category];
    if (!column) return res.status(404).json({ error: "Unknown settings category" });
    const school = await getMySchool(req, res);
    if (!school) return;
    await getPortalSettings(school.id); // ensure row exists
    const { data, error } = await db.schema("edu").from("school_portal_settings")
      .update({ [column]: req.body || {}, updated_at: new Date() })
      .eq("school_id", school.id)
      .select(column)
      .single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data: data[column] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/content/generate ────────────────────────────────────────
// Content hub generators: blog posts, social posts and student activities.
// Grounds each in the school's saved content preferences (brand voice, etc.).
const CONTENT_GEN_SYSTEM = {
  social: `You write short, engaging SOCIAL MEDIA posts for a school. Return 3 distinct caption options, each 2–4 lines with a few relevant hashtags and an emoji or two. Friendly and shareable. Tailor tone to the target platform.`,
  activity: `You are an experienced teacher. Design a student ACTIVITY / lesson idea in Markdown: a title, objective, materials, step-by-step instructions, a differentiation tip, and an assessment idea. Age-appropriate and practical.`,
};
// Blog sub-types — each is an SEO-friendly Markdown post with its own angle.
const BLOG_SYSTEM = {
  newsletter:  `You write a warm weekly school NEWSLETTER in Markdown: a friendly headline, 3–4 short sections (highlights, upcoming events, a note from the school) and a closing. Community-facing, SEO-friendly and positive.`,
  event_recap: `You write an upbeat EVENT RECAP blog post in Markdown for a school website: a catchy SEO title, 2–3 short paragraphs celebrating what happened, a pull-quote, and a closing line. Warm and shareable.`,
  achievement: `You write an ACHIEVEMENT HIGHLIGHT blog post in Markdown celebrating a school's success (results, awards, sports, competitions): an SEO title, an intro, the highlights with specifics, a congratulatory quote, and a proud closing.`,
  announcement:`You write a clear school ANNOUNCEMENT blog post in Markdown: an SEO title, the key information up front (what/when/where/who), any action parents need to take, and a friendly closing.`,
  general:     `You are a school's content writer. Produce a complete BLOG POST in Markdown: an SEO-friendly title, a short intro, 3–5 sections with headers, and a warm closing. Community-facing, positive and informative.`,
};
const BLOG_TYPES = Object.keys(BLOG_SYSTEM);

router.post("/content/generate", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const kind = ["blog", "social", "activity"].includes(req.body?.kind) ? req.body.kind : "blog";
    const topic = String(req.body?.topic || "").trim();
    if (!topic) return res.status(400).json({ error: "Tell me what it's about" });

    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getPortalSettings(school.id);
    const prefs = settings?.content ?? {};

    const tone     = String(req.body?.tone || prefs.tone || "warm and professional").trim();
    const platform = String(req.body?.platform || "").trim();
    const audience = String(req.body?.audience || "").trim();
    const extra    = String(req.body?.extra || "").trim();
    const blogType = BLOG_TYPES.includes(req.body?.blogType) ? req.body.blogType : "general";
    const subtype  = kind === "blog" ? blogType : (platform || null);

    const system = kind === "blog" ? BLOG_SYSTEM[blogType] : CONTENT_GEN_SYSTEM[kind];
    const brief = [
      `School: ${school.name || "our school"}.`,
      prefs.voice ? `Brand voice: ${prefs.voice}.` : "",
      `Tone: ${tone}.`,
      platform ? `Target platform: ${platform}.` : "",
      audience ? `Audience: ${audience}.` : "",
      `Topic: ${topic}.`,
      extra ? `Extra instructions: ${extra}.` : "",
      kind === "social" && prefs.hashtags ? `Include these hashtags where natural: ${prefs.hashtags}.` : "",
    ].filter(Boolean).join("\n");

    const content = await llmComplete(brief, {
      system,
      maxTokens: kind === "social" ? 700 : 1600,
      temperature: 0.7,
    });

    // Save it so the generator can show a "past creations" row.
    const CREATION_COLS = "id, kind, subtype, topic, content, created_at, posted_at, posted_channels, media_url, media_type";
    let creation = null;
    const { data: saved } = await db.schema("edu").from("content_creations")
      .insert({ school_id: school.id, created_by: req.user.id, kind, subtype, topic, content })
      .select(CREATION_COLS).maybeSingle();
    creation = saved || null;

    res.json({ success: true, data: { kind, subtype, topic, content, creation } });
  } catch (e) { console.error("[content/generate]", e); res.status(500).json({ error: "Could not generate that. Try again." }); }
});

const CREATION_COLS = "id, kind, subtype, topic, content, created_at, posted_at, posted_channels, media_url, media_type";

// GET /api/school/content/creations?kind=blog|social|activity — recent outputs.
router.get("/content/creations", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    let q = db.schema("edu").from("content_creations")
      .select(CREATION_COLS)
      .eq("school_id", school.id).order("created_at", { ascending: false }).limit(30);
    if (["blog", "social", "activity"].includes(req.query.kind)) q = q.eq("kind", req.query.kind);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/school/content/creations/:id — one creation (for the detail page).
router.get("/content/creations/:id", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data, error } = await db.schema("edu").from("content_creations")
      .select(CREATION_COLS).eq("id", req.params.id).eq("school_id", school.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Best-effort publish to a connected channel using the caller's stored social
// credentials and (optionally) an attached media URL.
//  - Facebook: photo post if an image is attached, else a text feed post.
//  - Instagram: real 2-step publish (needs an image + IG business account id).
//  - X: text tweet (media on X needs OAuth1 upload — not attached here).
//  - TikTok: video publish is a multi-step upload flow — recorded for manual finish.
async function publishToChannel(platform, creds, text, media) {
  if (!creds?.connected) return { ok: false, reason: "not_connected" };
  const token = creds.access_token;
  const isImage = media?.url && media.type === "image";
  try {
    if (platform === "facebook") {
      if (!token || !creds.account_id) return { ok: false, reason: "missing_page_token" };
      if (isImage) {
        const r = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(creds.account_id)}/photos`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: media.url, caption: text, access_token: token }),
        });
        const j = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, id: j.post_id || j.id } : { ok: false, reason: j.error?.message || "post_failed" };
      }
      const r = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(creds.account_id)}/feed`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, access_token: token }),
      });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, id: j.id } : { ok: false, reason: j.error?.message || "post_failed" };
    }

    if (platform === "instagram") {
      if (!token || !creds.account_id) return { ok: false, reason: "missing_ig_account" };
      if (!isImage) return { ok: false, reason: "needs_image" };
      // 1) create a media container, 2) publish it.
      const c = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(creds.account_id)}/media`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: media.url, caption: text, access_token: token }),
      });
      const cj = await c.json().catch(() => ({}));
      if (!c.ok || !cj.id) return { ok: false, reason: cj.error?.message || "container_failed" };
      const p = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(creds.account_id)}/media_publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: cj.id, access_token: token }),
      });
      const pj = await p.json().catch(() => ({}));
      return p.ok ? { ok: true, id: pj.id } : { ok: false, reason: pj.error?.message || "publish_failed" };
    }

    if (platform === "twitter") {
      if (!token) return { ok: false, reason: "missing_token" };
      const r = await fetch("https://api.twitter.com/2/tweets", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 280) }),
      });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, id: j.data?.id, note: media?.url ? "media not attached on X" : undefined } : { ok: false, reason: j.detail || j.title || "post_failed" };
    }

    if (platform === "tiktok") {
      if (media?.type !== "video") return { ok: false, reason: "needs_video" };
      return { ok: true, manual: true, note: "TikTok video publish must be finished in the TikTok app" };
    }

    return { ok: false, reason: "unsupported" };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// POST /api/school/content/creations/:id/post  { channels: [...] }
router.post("/content/creations/:id/post", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: creation } = await db.schema("edu").from("content_creations")
      .select(CREATION_COLS).eq("id", req.params.id).eq("school_id", school.id).maybeSingle();
    if (!creation) return res.status(404).json({ error: "Not found" });

    const channels = Array.isArray(req.body?.channels) ? req.body.channels.filter((c) => ["facebook", "instagram", "twitter", "tiktok"].includes(c)) : [];
    if (!channels.length) return res.status(400).json({ error: "Pick at least one channel to post to." });

    const { data: us } = await db.from("user_settings").select("settings").eq("user_id", req.user.id).maybeSingle();
    const social = us?.settings?.social_platforms ?? {};

    const media = creation.media_url ? { url: creation.media_url, type: creation.media_type || "image" } : null;
    const results = {};
    const posted = new Set(creation.posted_channels || []);
    for (const ch of channels) {
      const r = await publishToChannel(ch, social[ch], creation.content || "", media);
      results[ch] = r;
      if (r.ok) posted.add(ch);
    }

    const postedArr = [...posted];
    const { data: updated } = await db.schema("edu").from("content_creations")
      .update({ posted_channels: postedArr, posted_at: postedArr.length ? new Date().toISOString() : creation.posted_at })
      .eq("id", creation.id).select(CREATION_COLS).maybeSingle();

    res.json({ success: true, data: { creation: updated || creation, results } });
  } catch (e) { console.error("[content/post]", e); res.status(500).json({ error: "Could not post. Try again." }); }
});

// POST /api/school/content/creations/:id/media — attach an image/video (used
// when posting, required for Instagram/TikTok). multipart field: "file".
const contentMediaUpload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } }).single("file");
router.post("/content/creations/:id/media", authenticateToken, requireRole(SCHOOL_ROLES), (req, res) => {
  contentMediaUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message });
      const school = await getMySchool(req, res);
      if (!school) return;
      const { data: creation } = await db.schema("edu").from("content_creations")
        .select("id").eq("id", req.params.id).eq("school_id", school.id).maybeSingle();
      if (!creation) return res.status(404).json({ error: "Not found" });

      const f = req.file;
      if (!f) return res.status(400).json({ error: "Choose an image or video" });
      const mime = f.mimetype || "";
      // Raster images / video only — reject SVG/HTML (stored-XSS risk).
      const mediaType = /^video\//.test(mime) ? "video" : /^image\/(png|jpe?g|webp|gif)$/i.test(mime) ? "image" : null;
      if (!mediaType) return res.status(400).json({ error: "Upload a PNG/JPG/WEBP/GIF image or a video." });

      await ensureBucket();
      const safe = (f.originalname || "media").replace(/[^a-zA-Z0-9._-]/g, "_");
      const dest = `content/${school.id}/${creation.id}-${Date.now()}-${safe}`;
      const url = await uploadPublicFile(dest, f.buffer, mime || "application/octet-stream");

      const { data, error } = await db.schema("edu").from("content_creations")
        .update({ media_url: url, media_type: mediaType }).eq("id", creation.id).select(CREATION_COLS).maybeSingle();
      if (error) throw error;
      res.status(201).json({ success: true, data });
    } catch (e) { console.error("[content/media]", e.message); res.status(500).json({ error: "Could not upload media. Try again." }); }
  });
});

// DELETE /api/school/content/creations/:id/media — remove the attachment.
router.delete("/content/creations/:id/media", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data, error } = await db.schema("edu").from("content_creations")
      .update({ media_url: null, media_type: null }).eq("id", req.params.id).eq("school_id", school.id).select(CREATION_COLS).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/school/content/creations/:id
router.delete("/content/creations/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await db.schema("edu").from("content_creations").delete()
      .eq("id", req.params.id).eq("school_id", school.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/settings/integrations/regenerate-key ───────────────────
router.post("/settings/integrations/regenerate-key", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getPortalSettings(school.id);
    const key = `sk_live_${crypto.randomBytes(20).toString("hex")}`;
    const integrations = { ...(settings?.integrations || {}), biometricApiKey: key };
    const { error } = await db.schema("edu").from("school_portal_settings")
      .update({ integrations, updated_at: new Date() }).eq("school_id", school.id);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { biometricApiKey: key } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// NOTIFICATION CENTER — per-alert channel toggles.
// =============================================================

// ── GET /api/school/notifications/alerts ─────────────────────────────────────
router.get("/notifications/alerts", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getPortalSettings(school.id);
    res.json({ success: true, data: settings?.notification_alerts ?? {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/school/notifications/alerts/:alertId ────────────────────────────
// Body: { push?, email?, sms?, whatsapp? } — merged into the alert's overrides.
router.put("/notifications/alerts/:alertId", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getPortalSettings(school.id);
    const alerts = { ...(settings?.notification_alerts || {}) };
    alerts[req.params.alertId] = { ...(alerts[req.params.alertId] || {}), ...req.body };
    const { error } = await db.schema("edu").from("school_portal_settings")
      .update({ notification_alerts: alerts, updated_at: new Date() }).eq("school_id", school.id);
    if (error) throw new Error(error.message);
    res.json({ success: true, data: alerts[req.params.alertId] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// TELEGRAM BOT MONITORING
// =============================================================

// ── GET /api/school/telegram ──────────────────────────────────────────────────
router.get("/telegram", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await db.schema("edu").from("school_telegram_config").select("*").eq("school_id", school.id).maybeSingle();
    res.json({ success: true, data: data
      ? { botToken: data.bot_token ? `${data.bot_token.slice(0, 8)}…` : "", hasToken: !!data.bot_token, chatId: data.chat_id || "", botUsername: data.bot_username, active: data.active }
      : { botToken: "", hasToken: false, chatId: "", botUsername: null, active: false } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/telegram/validate ────────────────────────────────────────
// Body: { botToken }. Calls Telegram's getMe to confirm the token is real.
router.post("/telegram/validate", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const { botToken } = req.body;
    if (!botToken) return res.status(400).json({ error: "botToken required" });
    const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const json = await r.json();
    if (!json.ok) return res.status(400).json({ success: false, error: json.description || "Invalid bot token" });
    res.json({ success: true, data: { username: json.result.username, name: json.result.first_name } });
  } catch (e) { res.status(502).json({ success: false, error: "Could not reach Telegram. Check the token and try again." }); }
});

// ── PUT /api/school/telegram ───────────────────────────────────────────────────
// Body: { botToken?, chatId?, active? }
router.put("/telegram", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const patch = { school_id: school.id, updated_at: new Date() };
    if (req.body.chatId !== undefined) patch.chat_id = req.body.chatId;
    if (req.body.active !== undefined) patch.active = !!req.body.active;
    if (req.body.botToken) {
      patch.bot_token = req.body.botToken;
      try {
        const r = await fetch(`https://api.telegram.org/bot${req.body.botToken}/getMe`);
        const json = await r.json();
        if (json.ok) patch.bot_username = json.result.username;
      } catch { /* token saved even if we can't reach Telegram right now */ }
    }
    const { error } = await db.schema("edu").from("school_telegram_config").upsert(patch, { onConflict: "school_id" });
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/telegram/test ────────────────────────────────────────────
router.post("/telegram/test", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await db.schema("edu").from("school_telegram_config").select("bot_token, chat_id").eq("school_id", school.id).maybeSingle();
    if (!data?.bot_token || !data?.chat_id) return res.status(400).json({ error: "Save a Bot Token and Chat ID first." });
    const r = await fetch(`https://api.telegram.org/bot${data.bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: data.chat_id, text: `✅ Akoro test message — ${school.name} is connected to Telegram monitoring.` }),
    });
    const json = await r.json();
    if (!json.ok) return res.status(400).json({ success: false, error: json.description || "Telegram rejected the message" });
    res.json({ success: true, message: "Test message sent!" });
  } catch (e) { res.status(502).json({ success: false, error: "Could not reach Telegram." }); }
});

// =============================================================
// DOMAIN — the free *.akoro.app subdomain + custom domains with DNS verify.
// =============================================================

// ── GET /api/school/domains ────────────────────────────────────────────────────
router.get("/domains", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await db.schema("edu").from("school_domains").select("*").eq("school_id", school.id).order("created_at", { ascending: true });
    res.json({
      success: true,
      data: {
        defaultDomain: `${school.slug || slugify(school.name)}.${SITE_BASE_DOMAIN}`,
        vercelManaged: vercelConfigured(),
        customDomains: (data || []).map((d) => ({
          id: d.id, domain: d.domain, verified: d.verified,
          cnameTarget: d.cname_target, vercelAdded: d.vercel_added, dnsRecords: d.dns_records || [],
        })),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/domains ───────────────────────────────────────────────────
// Registers the domain and, when Vercel credentials are configured, attaches
// it to the Vercel project so verification + SSL are handled by Vercel.
router.post("/domains", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const domain = (req.body.domain || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!domain || !domain.includes(".")) return res.status(400).json({ error: "Enter a valid domain, e.g. www.yourschool.com" });
    if (SITE_BASE_DOMAINS.some((b) => domain === b || domain.endsWith(`.${b}`))) {
      return res.status(400).json({ error: `${SITE_BASE_DOMAIN} subdomains are assigned automatically — add your own domain here.` });
    }
    const { data, error } = await db.schema("edu").from("school_domains")
      .insert({ school_id: school.id, domain, cname_target: "cname.vercel-dns.com" }).select("*").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "That domain is already registered" });
      throw new Error(error.message);
    }

    // Programmatic Vercel attach → returns the exact DNS records to configure.
    let dnsRecords = data.dns_records || [];
    let vercelAdded = false;
    if (vercelConfigured()) {
      try {
        await addDomainToProject(domain);
        const pd = await getProjectDomain(domain);
        dnsRecords = buildDnsRecords(domain, pd);
        vercelAdded = true;
        await db.schema("edu").from("school_domains")
          .update({ vercel_added: true, dns_records: dnsRecords }).eq("id", data.id);
      } catch (e) { console.error("[vercel add domain]", e.message); }
    }

    res.status(201).json({ success: true, data: {
      id: data.id, domain: data.domain, verified: data.verified,
      cnameTarget: data.cname_target, vercelAdded, dnsRecords,
    } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/domains/:id/verify ────────────────────────────────────────
// Vercel-managed: verifies TXT ownership + DNS routing through Vercel (SSL is
// issued automatically once both pass). Fallback: local CNAME resolution.
router.post("/domains/:id/verify", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: row } = await db.schema("edu").from("school_domains").select("*").eq("id", req.params.id).eq("school_id", school.id).maybeSingle();
    if (!row) return res.status(404).json({ error: "Domain not found" });

    let verified = false;
    let message;
    let dnsRecords = row.dns_records || [];

    if (vercelConfigured()) {
      // (Re)attach in case the earlier add failed, then run Vercel's checks.
      if (!row.vercel_added) {
        try { await addDomainToProject(row.domain); } catch (e) { console.error("[vercel re-add]", e.message); }
      }
      try { await verifyProjectDomain(row.domain); } catch { /* pending challenges just stay pending */ }
      const [pd, cfg] = await Promise.all([
        getProjectDomain(row.domain).catch(() => null),
        getDomainConfig(row.domain).catch(() => null),
      ]);
      const ownershipOk = !!pd?.verified;
      const routingOk = cfg ? !cfg.misconfigured : false;
      verified = ownershipOk && routingOk;
      dnsRecords = pd ? buildDnsRecords(row.domain, pd) : dnsRecords;
      message = verified
        ? "Domain verified — Vercel is issuing the SSL certificate."
        : !ownershipOk
          ? "Ownership not confirmed yet — add the TXT record shown, then verify again."
          : "Ownership confirmed, but DNS isn't pointing at Vercel yet — add the CNAME/A record shown.";
      await db.schema("edu").from("school_domains").update({
        vercel_added: true, dns_records: dnsRecords,
        ...(verified ? { verified: true, verified_at: new Date() } : {}),
      }).eq("id", row.id);
    } else {
      // Fallback: plain CNAME resolution (no automatic SSL).
      try {
        const { resolveCname } = await import("node:dns/promises");
        const records = await resolveCname(row.domain);
        verified = records.some((r) => r.toLowerCase().includes(row.cname_target.toLowerCase()));
      } catch { verified = false; }
      message = verified ? "Domain verified!" : "CNAME record not found yet — DNS can take a few hours to propagate.";
      if (verified) {
        await db.schema("edu").from("school_domains").update({ verified: true, verified_at: new Date() }).eq("id", row.id);
      }
    }

    res.json({ success: true, verified, message, dnsRecords });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/school/domains/:id ─────────────────────────────────────────────
router.delete("/domains/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: row } = await db.schema("edu").from("school_domains").select("domain, vercel_added").eq("id", req.params.id).eq("school_id", school.id).maybeSingle();
    if (row?.vercel_added && vercelConfigured()) {
      try { await removeDomainFromProject(row.domain); } catch (e) { console.error("[vercel remove domain]", e.message); }
    }
    const { error } = await db.schema("edu").from("school_domains").delete().eq("id", req.params.id).eq("school_id", school.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// SOCIAL MEDIA AUTOPOST — connected Facebook/Instagram pages.
// =============================================================

// ── GET /api/school/social-accounts ────────────────────────────────────────────
router.get("/social-accounts", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await db.schema("edu").from("school_social_accounts").select("*").eq("school_id", school.id).order("connected_at", { ascending: false });
    res.json({ success: true, data: (data || []).map((a) => ({ id: a.id, provider: a.provider, pageName: a.page_name, pageId: a.page_id, active: a.active, connectedAt: a.connected_at, expiresAt: a.expires_at })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/school/social-accounts/:id ──────────────────────────────────────
// Body: { active } — used by the Disconnect / Switch Active Page actions.
router.patch("/social-accounts/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await db.schema("edu").from("school_social_accounts")
      .update({ active: !!req.body.active }).eq("id", req.params.id).eq("school_id", school.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// SCHOOL WEBSITE — public landing page config + saved HTML templates.
// =============================================================

async function getWebsiteConfig(schoolId) {
  const { data } = await db.schema("edu").from("school_website").select("*").eq("school_id", schoolId).maybeSingle();
  if (data) return data;
  const { data: created } = await db.schema("edu").from("school_website").insert({ school_id: schoolId }).select("*").single();
  return created;
}
const shapeWebsite = (w) => ({
  enabled: w.enabled, mode: w.mode, themeId: w.theme_id, syncSchoolInfo: !!w.sync_school_info, aiChatEnabled: !!w.ai_chat_enabled, templateColors: w.template_colors || {},
  heroTitle: w.hero_title, heroSubtitle: w.hero_subtitle, heroImageUrl: w.hero_image_url,
  aboutText: w.about_text, metaTitle: w.meta_title, metaKeywords: w.meta_keywords,
  metaDescription: w.meta_description, ogImageUrl: w.og_image_url,
  headerScripts: w.header_scripts, footerScripts: w.footer_scripts,
  primaryColor: w.primary_color, secondaryColor: w.secondary_color, accentColor: w.accent_color,
  bgMode: w.bg_mode, socialLinks: w.social_links || {}, sections: w.sections || [], customCss: w.custom_css,
});

// =============================================================
// PUBLIC SITE — multi-tenant rendering. One codebase serves every school:
// tenants are resolved either by slug (/site/:slug) or by hostname
// (<slug>.akoro.app wildcard subdomains and verified custom domains).
// =============================================================
// Hostname → school lives in tenant.js (shared with the public portal).
const SCHOOL_SELECT = "id, name, slug, logo_url, address, phone, acronym, principal_name";

// Public portal — /apply, /pay, /results served on each tenant's own domain.
router.use("/public", publicPortalRouter);

// Resolve the school's Website Builder menus into { primary, footer, social },
// each an ordered list of { label, href, target }. Page items resolve to the
// published page's /slug; unresolved links fall back to "#".
async function buildSiteMenus(schoolId) {
  const empty = { primary: [], footer: [], social: [] };
  const { data: menuRows } = await db.schema("mgmt").from("site_menus")
    .select("id, location").eq("school_id", schoolId).not("location", "is", null);
  if (!menuRows?.length) return empty;
  const byLoc = {};
  for (const m of menuRows) byLoc[m.location] = m.id;
  const { data: items } = await db.schema("mgmt").from("site_menu_items")
    .select("menu_id, label, url, page_id, target, sort_order")
    .in("menu_id", menuRows.map((m) => m.id)).order("sort_order", { ascending: true });
  const pageIds = [...new Set((items || []).map((i) => i.page_id).filter(Boolean))];
  const slugOf = {};
  if (pageIds.length) {
    const { data: pgs } = await db.schema("mgmt").from("site_pages")
      .select("id, slug, status, deleted_at").in("id", pageIds);
    for (const p of pgs || []) slugOf[p.id] = (p.status === "published" && !p.deleted_at && p.slug) ? `/${p.slug}` : null;
  }
  const byMenu = {};
  for (const it of items || []) {
    const href = it.page_id ? (slugOf[it.page_id] || "#") : (it.url || "#");
    (byMenu[it.menu_id] ||= []).push({ label: it.label, href, target: it.target });
  }
  return {
    primary: byMenu[byLoc.primary] || [],
    footer: byMenu[byLoc.footer] || [],
    social: byMenu[byLoc.social] || [],
  };
}

// A page whose content is a whole HTML document is served as-is (its own
// header/footer/styles) rather than wrapped in the builder chrome.
const isFullDocument = (c) => /^\s*(<!doctype html|<html[\s>])/i.test(c || "");

// The active template's editable brand colours: CSS custom properties found in
// the home document's :root block whose values look like colours.
function parseTemplateColorVars(doc) {
  const out = [];
  const root = String(doc || "").match(/:root\s*{([^}]*)}/);
  if (!root) return out;
  for (const m of root[1].matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+)/g)) {
    const value = m[2].trim();
    if (/^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(value)) out.push({ name: m[1], value });
  }
  return out;
}

// Per-school overrides for those variables, injected after the template's own
// styles so they win — this is how each school brands a shared template.
function templateColorStyle(colors) {
  const entries = Object.entries(colors || {}).filter(([k, v]) => /^--[a-zA-Z0-9_-]+$/.test(k) && /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/.test(String(v).trim()));
  if (!entries.length) return "";
  return `<style data-akoro-brand>:root{${entries.map(([k, v]) => `${k}:${String(v).trim()}`).join(";")}}</style>`;
}


// ── AI chat widget (Sync AI Bot) ─────────────────────────────────────────────
// Injected on every rendered site page when website.ai_chat_enabled: a
// floating bubble (bottom-right) that opens a gated login modal
// (student / teacher / admin). Successful login redirects to the school
// portal's AI Chat. Self-contained ES5 — no dependencies, works inside any
// template. Auto-opens on the /ai-chat page.
const SCHOOL_PORTAL_URL = (process.env.SCHOOL_FRONTEND_URL || "https://akoro-school.akoro.name.ng").replace(/\/$/, "");
function aiChatWidgetHtml(apiOrigin) {
  const api = String(apiOrigin || "").replace(/\/$/, "");
  return `
<div id="ak-ai-root"></div>
<script>(function(){
  var API=${JSON.stringify(api)}, PORTAL=${JSON.stringify(SCHOOL_PORTAL_URL)};
  var root=document.getElementById('ak-ai-root'); if(!root) return;
  var css='#ak-ai-btn{position:fixed;right:22px;bottom:22px;z-index:2147483000;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer;background:transparent;padding:0;font-size:40px;line-height:1;display:flex;align-items:center;justify-content:center;transition:transform .15s}#ak-ai-btn:hover{transform:scale(1.06)}#ak-ai-ovl{position:fixed;inset:0;z-index:2147483001;background:rgba(10,10,14,.55);display:none;align-items:center;justify-content:center;padding:18px}#ak-ai-ovl.open{display:flex}#ak-ai-card{width:100%;max-width:380px;background:#fff;border-radius:18px;padding:26px 24px;font-family:Inter,system-ui,sans-serif;box-shadow:0 24px 60px rgba(0,0,0,.35)}#ak-ai-card h3{margin:0 0 4px;font-size:18px;font-weight:800;color:#1A1A2E}#ak-ai-card p{margin:0 0 14px;font-size:12.5px;color:#6B6B80;line-height:1.55}.ak-ai-roles{display:flex;gap:6px;margin-bottom:14px}.ak-ai-roles button{flex:1;padding:8px 4px;border-radius:9px;border:1.5px solid #E5E5EA;background:#fff;font-size:12px;font-weight:700;color:#6B6B80;cursor:pointer;font-family:inherit}.ak-ai-roles button.on{border-color:#E07A2C;background:#FDF3EB;color:#B45A16}.ak-ai-in{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1.5px solid #E5E5EA;font-size:13.5px;margin-bottom:10px;font-family:inherit;outline:none}.ak-ai-in:focus{border-color:#E07A2C}#ak-ai-err{display:none;font-size:12px;color:#DC3545;margin:-2px 0 10px}#ak-ai-go{width:100%;padding:12px;border-radius:11px;border:none;background:linear-gradient(135deg,#E07A2C,#D4651E);color:#fff;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit}#ak-ai-x{float:right;border:none;background:none;font-size:18px;color:#9A9AA5;cursor:pointer;margin:-6px -6px 0 0}';
  var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  root.innerHTML='<button id="ak-ai-btn" aria-label="AI Chat" title="AI Chat">🤖</button><div id="ak-ai-ovl"><div id="ak-ai-card"><button id="ak-ai-x" aria-label="Close">×</button><h3>AI Study Assistant</h3><p>Sign in to chat with your school’s AI assistant.</p><div class="ak-ai-roles"><button data-r="student" class="on">Student</button><button data-r="parent">Parent</button><button data-r="teacher">Teacher</button><button data-r="admin">Admin</button></div><input class="ak-ai-in" id="ak-ai-em" type="email" placeholder="Email" autocomplete="email"/><input class="ak-ai-in" id="ak-ai-pw" type="password" placeholder="Password" autocomplete="current-password"/><div id="ak-ai-err"></div><button id="ak-ai-go">Sign in → AI Chat</button><div class="ak-ai-guest">Just have questions? <a id="ak-ai-guest-link" href="#">Ask as a guest →</a></div></div></div>';
  var ovl=document.getElementById('ak-ai-ovl');
  function open(){ovl.classList.add('open');}
  function close(){ovl.classList.remove('open');}
  document.getElementById('ak-ai-btn').addEventListener('click',open);
  document.getElementById('ak-ai-x').addEventListener('click',close);
  ovl.addEventListener('click',function(e){if(e.target===ovl)close();});
  var roleBtns=root.querySelectorAll('.ak-ai-roles button');
  for(var i=0;i<roleBtns.length;i++){roleBtns[i].addEventListener('click',function(){for(var j=0;j<roleBtns.length;j++)roleBtns[j].classList.remove('on');this.classList.add('on');});}
  function selectedRole(){for(var k=0;k<roleBtns.length;k++){if(roleBtns[k].classList.contains('on'))return roleBtns[k].getAttribute('data-r');}return 'student';}
  document.getElementById('ak-ai-go').addEventListener('click',function(){
    var em=document.getElementById('ak-ai-em').value.trim(), pw=document.getElementById('ak-ai-pw').value;
    var err=document.getElementById('ak-ai-err'); err.style.display='none';
    if(!em){err.textContent='Enter your email address.';err.style.display='block';return;}
    if(!pw){err.textContent='Enter your password.';err.style.display='block';return;}
    var btn=this; btn.disabled=true; btn.textContent='Signing in…';
    fetch(API+'/api/school/site/ai-login',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({host:location.hostname,email:em,password:pw,role:selectedRole()})})
      .then(function(r){return r.json().catch(function(){return {};});})
      .then(function(d){
        if(d&&d.success){
          var first=((d.name||'').split(' ')[0])||'there';
          document.getElementById('ak-ai-card').innerHTML='<div style="text-align:center;padding:18px 6px"><div style="font-size:42px;margin-bottom:10px">✅</div><h3>Welcome, '+first+'!</h3><p style="margin-top:6px">Signed in as '+(d.role||'member')+' · opening your AI assistant…</p></div>';
          setTimeout(function(){window.location.href=d.redirect;},1000);
        } else {
          err.textContent=(d&&d.message)||'Sign-in failed. Please check your details.';err.style.display='block';btn.disabled=false;btn.textContent='Sign in → AI Chat';
        }
      })
      .catch(function(){err.textContent='Could not reach the server. Please try again.';err.style.display='block';btn.disabled=false;btn.textContent='Sign in → AI Chat';});
  });
  var gl=document.getElementById('ak-ai-guest-link');
  if(gl){gl.addEventListener('click',function(e){e.preventDefault();window.location.href='${SCHOOL_PORTAL_URL}/ai-guest?host='+encodeURIComponent(location.hostname);});}
  if(/^\\/ai-chat\\/?$/.test(window.location.pathname)) open();
})();</script>`;
}

// Content of the auto-created "AI Chat" site page (slug: ai-chat). The
// floating widget is injected at render time like every page and auto-opens
// here, so this page just provides the framing.
const AI_CHAT_PAGE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Chat</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Inter,system-ui,sans-serif;background:#0F0F1E;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.wrap{max-width:560px;text-align:center}.badge{display:inline-block;padding:6px 16px;border-radius:999px;background:rgba(224,122,44,.16);color:#E8945A;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:18px}h1{font-size:34px;font-weight:900;margin-bottom:12px}p{font-size:15px;color:#B9B9C6;line-height:1.7}a.home{display:inline-block;margin-top:26px;color:#E8945A;font-weight:700;text-decoration:none;font-size:13.5px}</style>
</head><body><div class="wrap">
<span class="badge">AI Study Assistant</span>
<h1>Chat with your school's AI</h1>
<p>Students, teachers and admins can sign in to ask questions, get study help and explore lessons with the school's AI assistant. Use the chat bubble to sign in.</p>
<a class="home" href="/">← Back to home</a>
</div></body></html>`;

// Create or trash the "AI Chat" site page when the Sync AI Bot toggle flips.
async function syncAiChatPage(schoolId, enabled) {
  const M = db.schema("mgmt");
  const { data: pg } = await M.from("site_pages").select("id").eq("school_id", schoolId).eq("slug", "ai-chat").maybeSingle();
  if (enabled) {
    const body = { title: "AI Chat", content: AI_CHAT_PAGE_HTML, blocks: [], status: "published", sort_order: 999, deleted_at: null };
    if (pg) await M.from("site_pages").update(body).eq("id", pg.id);
    else await M.from("site_pages").insert({ ...body, school_id: schoolId, slug: "ai-chat" });
  } else if (pg) {
    await M.from("site_pages").update({ deleted_at: new Date() }).eq("id", pg.id);
  }
}

// Assemble the full render context (variables, section data, menus, portal
// links) exactly as the live site uses — shared by the public renderer and the
// authenticated live-preview endpoint so previews are pixel-identical.
async function buildSiteCtx(school, website) {
  // Sync toggle (Website Settings): when on, the website's identity always
  // follows School Settings — freshest profile fields win over the copies
  // stored in the website config, so School Settings edits show up on the
  // site immediately. Mutates `school`/`website` in place because the same
  // objects flow on into the theme renderer (w.hero_title / w.meta_title).
  let contactEmail = null;
  if (website.sync_school_info) {
    const { data: full } = await db.from("school_profiles")
      .select("name, acronym, logo_url, address, phone, principal_name, city, state, lga, country, admin_user_id")
      .eq("id", school.id).maybeSingle();
    if (full) {
      const { admin_user_id, ...profile } = full;
      Object.assign(school, profile);
      website.hero_title = full.name;
      website.meta_title = full.name;
      if (admin_user_id) {
        const { data: admin } = await db.from("users").select("email").eq("id", admin_user_id).maybeSingle();
        contactEmail = admin?.email || null;
      }
    }
  }

  const { data: teacherLinks } = await db.from("school_teachers")
    .select("users:users!school_teachers_teacher_id_fkey(id, full_name)").eq("school_id", school.id);
  const teacherIds = (teacherLinks || []).map((t) => t.users?.id).filter(Boolean);
  const { data: courseRows } = teacherIds.length
    ? await db.from("courses").select("title, subject, level, price, is_free").in("instructor_id", teacherIds).eq("is_published", true).limit(24)
    : { data: [] };
  const { data: classRows } = await db.from("classrooms").select("name").eq("school_id", school.id);

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: adm }, gateway, { data: noticeRows }, { data: eventRows }] = await Promise.all([
    db.schema("edu").from("school_admission_settings").select("enabled").eq("school_id", school.id).maybeSingle(),
    getSchoolGateway(school.id),
    db.schema("mgmt").from("notices").select("title, body, publish_on, expires_on, pinned")
      .eq("school_id", school.id).or(`expires_on.is.null,expires_on.gte.${today}`)
      .order("pinned", { ascending: false }).order("publish_on", { ascending: false }).limit(6),
    db.schema("mgmt").from("school_events").select("title, description, event_type, starts_on")
      .eq("school_id", school.id).gte("starts_on", today).order("starts_on", { ascending: true }).limit(6),
  ]);

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";
  return buildContext(school, website, {
    email: contactEmail,
    year: new Date().getFullYear(),
    teachers: (teacherLinks || []).map((t) => ({ name: t.users?.full_name })).filter((t) => t.name),
    courses: (courseRows || []).map((c) => ({ title: c.title, subject: c.subject, level: c.level, price: c.is_free ? "Free" : `₦${Number(c.price || 0).toLocaleString("en-NG")}` })),
    classes: (classRows || []).map((c) => ({ name: c.name })),
    notices: (noticeRows || []).filter((n) => !n.publish_on || n.publish_on <= today)
      .map((n) => ({ title: n.title, body: n.body || "", date: fmtDate(n.publish_on), pinned: !!n.pinned })),
    events: (eventRows || []).map((e) => ({ title: e.title, description: e.description || "", type: e.event_type || "", date: fmtDate(e.starts_on) })),
    menus: await buildSiteMenus(school.id),
    portal: { apply: !!adm?.enabled, pay: !!gateway.ok, results: true },
  });
}


// Public origin of THIS API (scheme + host), for absolute URLs inside
// injected widgets. Derived from the request, so it needs no extra env.
const apiOriginOf = (req) => `${(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0]}://${req.get("host")}`;

async function renderSchoolSiteHtml(school, { preview = false, path = "/", apiOrigin = "" } = {}) {
  const website = await getWebsiteConfig(school.id);
  // Public visitors only see a published site; preview mode (admin "Preview
  // Website" button) renders it even while unpublished, with a notice banner.
  if (!website.enabled && !preview) return { status: 404, html: "<h1>This school website is not published yet.</h1>" };

  // Maintenance Mode (Settings → Privacy & Security) shows a banner on the site.
  const portalSettings = await getPortalSettings(school.id).catch(() => null);
  const maintenance = !!portalSettings?.security?.maintenanceMode;

  const addBanner = (raw) => {
    // Full documents skip the theme chrome, so Appearance's tracking scripts
    // and custom CSS are injected here — they apply to template pages too.
    let html = raw;
    if (isFullDocument(html)) {
      const headBits = [
        templateColorStyle(website.template_colors),
        website.custom_css ? `<style>${website.custom_css}</style>` : "",
        website.header_scripts || "",
      ].filter(Boolean).join("\n");
      if (headBits) html = html.includes("</head>") ? html.replace("</head>", `${headBits}\n</head>`) : `${headBits}\n${html}`;
      if (website.footer_scripts) html = html.includes("</body>") ? html.replace("</body>", `${website.footer_scripts}\n</body>`) : html + website.footer_scripts;
    }
    // Sync AI Bot: floating gated-chat widget on every page.
    if (website.ai_chat_enabled) {
      const w = aiChatWidgetHtml(apiOrigin);
      html = html.includes("</body>") ? html.replace("</body>", `${w}\n</body>`) : html + w;
    }
    // Maintenance banner on the live public site.
    if (maintenance) {
      const mb = `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#B45309;color:#fff;font:600 13px/1.4 system-ui,-apple-system,sans-serif;padding:9px 16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)">🛠️ This website is undergoing scheduled maintenance — some information may be temporarily unavailable.</div>`;
      html = html.includes("</body>") ? html.replace("</body>", `${mb}</body>`) : html + mb;
    }
    if (!(preview && !website.enabled)) return html;
    const banner = `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1A1A2E;color:#fff;font:600 13px/1.4 system-ui,-apple-system,sans-serif;padding:9px 16px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)">👁️ Preview mode — this website is not published yet. Turn it on in Website Settings to go live.</div>`;
    return html.includes("</body>") ? html.replace("</body>", `${banner}</body>`) : html + banner;
  };

  const ctx = await buildSiteCtx(school, website);

  // Page routing: a non-root path is a published-page slug (e.g. /about-us).
  const slug = String(path || "/").split("?")[0].replace(/^\/+|\/+$/g, "");
  if (slug) {
    const { data: page } = await db.schema("mgmt").from("site_pages")
      .select("title, content, status, deleted_at, slug").eq("school_id", school.id).eq("slug", slug).maybeSingle();
    if (page && page.status === "published" && !page.deleted_at) {
      // Full self-contained documents (e.g. gallery templates) render raw;
      // block/fragment pages get wrapped in the builder chrome.
      const html = isFullDocument(page.content) ? page.content : renderSitePage(website, ctx, page, { hideTitle: slug === "home" });
      return { status: 200, html: addBanner(html) };
    }
    return { status: 404, html: renderThemeDocument(website, ctx, `<section class="page"><div class="wrap" style="text-align:center"><h1 style="font-size:34px;color:var(--primary)">Page not found</h1><p style="margin-top:10px"><a href="/" style="color:var(--primary);font-weight:700">← Back to home</a></p></div></section>`) };
  }

  // Landing page.
  let html;
  if (website.mode === "template") {
    const { data: tpl } = await db.schema("edu").from("school_website_templates")
      .select("html").eq("school_id", school.id).eq("is_active", true).maybeSingle();
    html = tpl?.html
      ? renderMiniTemplate(tpl.html, ctx)
      : renderThemePage(website, ctx); // fall back to theme if no active template
  } else {
    // Builder mode: a published "home" page (e.g. imported from a template)
    // overrides the theme sections as the landing — fully editable in Pages.
    const { data: home } = await db.schema("mgmt").from("site_pages")
      .select("title, content, status, deleted_at").eq("school_id", school.id).eq("slug", "home").maybeSingle();
    html = (home && home.status === "published" && !home.deleted_at)
      ? (isFullDocument(home.content) ? home.content : renderSitePage(website, ctx, home, { hideTitle: true }))
      : renderThemePage(website, ctx);
  }
  return { status: 200, html: addBanner(html) };
}

// ── POST /api/school/website/preview-page  (AUTH — pixel-perfect draft preview) ─
// Renders draft page content through the REAL site renderer (same chrome,
// menus, theme, colours, custom CSS as production) so the editor's live
// preview matches the published page exactly. Body: { title, content, slug }.
router.post("/website/preview-page", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const website = await getWebsiteConfig(school.id);
    const ctx = await buildSiteCtx(school, website);
    const page = { title: req.body.title || "Untitled", content: req.body.content || "", slug: req.body.slug || "" };
    res.json({ success: true, html: renderSitePage(website, ctx, page, { hideTitle: page.slug === "home" }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/website/preview-site  (AUTH — pixel-perfect appearance) ──
// Renders the LANDING page with DRAFT appearance settings (colours, hero,
// sections, SEO, scripts, social, custom CSS) merged over the saved config —
// so the Appearance editor previews changes live before saving. Body: the same
// camelCase fields as PUT /website.
router.post("/website/preview-site", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const draft = { ...(await getWebsiteConfig(school.id)) };
    for (const [k, col] of Object.entries(WEBSITE_FIELD_MAP)) if (req.body[k] !== undefined) draft[col] = req.body[k];
    const ctx = await buildSiteCtx(school, draft);
    let html;
    if (draft.mode === "template") {
      const { data: tpl } = await db.schema("edu").from("school_website_templates")
        .select("html").eq("school_id", school.id).eq("is_active", true).maybeSingle();
      html = tpl?.html ? renderMiniTemplate(tpl.html, ctx) : renderThemePage(draft, ctx);
    } else {
      // Mirror the LIVE renderer: a published "home" page (e.g. an activated
      // template's landing) overrides the theme sections — so the Appearance
      // preview shows what visitors actually see, not the stale theme page.
      const { data: home } = await db.schema("mgmt").from("site_pages")
        .select("title, content, status, deleted_at").eq("school_id", school.id).eq("slug", "home").maybeSingle();
      if (home && home.status === "published" && !home.deleted_at) {
        if (isFullDocument(home.content)) {
          html = home.content;
          const brand = templateColorStyle(draft.template_colors);
          if (brand) html = html.includes("</head>") ? html.replace("</head>", `${brand}\n</head>`) : brand + html;
        } else {
          html = renderSitePage(draft, ctx, home, { hideTitle: true });
        }
      } else {
        html = renderThemePage(draft, ctx);
      }
    }
    res.json({ success: true, html });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Branded 404 for hostnames that resolve to no school (unknown wildcard
// subdomains, unverified custom domains). A real page, not a bare string,
// so stray/typo'd subdomains never look broken or fall into the main app.
// The "Go to Akoro" link reuses the main-site URL Railway already defines.
const MAIN_SITE_URL = process.env.MAIN_SITE_URL || process.env.FRONTEND_URL || "https://akoro.name.ng";
const schoolNotFoundHtml = (host) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>School not found — Akoro</title><meta name="robots" content="noindex">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#F7F7F9;color:#1A1A2E;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{max-width:460px;text-align:center;background:#fff;border:1px solid #E5E5EA;border-radius:20px;padding:48px 36px;box-shadow:0 10px 40px rgba(0,0,0,.06)}
  .code{font-size:52px;font-weight:900;color:#E07A2C;letter-spacing:-2px}
  h1{font-size:20px;font-weight:800;margin:10px 0 8px}
  p{font-size:14px;color:#6B6B80;line-height:1.65}
  .host{display:inline-block;margin:14px 0 4px;padding:6px 14px;border-radius:999px;background:#F1F1F4;font-size:12.5px;font-weight:700;color:#44444F;word-break:break-all}
  a.btn{display:inline-block;margin-top:22px;padding:12px 26px;border-radius:999px;background:linear-gradient(135deg,#E07A2C,#D4651E);color:#fff;font-size:13.5px;font-weight:800;text-decoration:none}
</style></head><body>
<div class="card">
  <div class="code">404</div>
  <h1>No school website here</h1>
  <span class="host">${String(host || "").replace(/[<>&"]/g, "")}</span>
  <p>This address isn't connected to any school on Akoro. The school may not have published its website yet, or the address may be misspelt.</p>
  <a class="btn" href="${MAIN_SITE_URL}">Go to Akoro</a>
</div></body></html>`;

// ── GET /api/school/site/by-host  (PUBLIC — tenant from hostname) ────────────
// The frontend forwards its hostname (?host=…); direct hits fall back to the
// request's own forwarded host. Must be registered BEFORE /site/:slug.
router.get("/site/by-host", async (req, res) => {
  try {
    const host = req.query.host || req.headers["x-forwarded-host"] || req.hostname;
    const school = await resolveSchoolByHost(host);
    if (!school) return res.status(404).type("html").send(schoolNotFoundHtml(host));
    const preview = req.query.preview === "1" || req.query.preview === "true";
    const { status, html } = await renderSchoolSiteHtml(school, { preview, path: req.query.path || "/", apiOrigin: apiOriginOf(req) });
    res.status(status).type("html").send(html);
  } catch (e) {
    console.error("[site render by-host]", e);
    res.status(500).type("html").send("<h1>Something went wrong rendering this page.</h1>");
  }
});

// ── POST /api/school/site/ai-login  (PUBLIC — gated AI-chat sign-in) ─────────
// The website's floating AI bot signs a visitor in ONLY if they belong to the
// school whose site they're on. Returns clear, role-aware messages so the
// widget can tell the visitor exactly what went wrong. On success it issues
// the shared session cookie and every role opens the SAME school AI chat
// (the school portal's /chat).
const roleLabel = { admin: "an admin", teacher: "a teacher", student: "a student", parent: "a parent" };
router.post("/site/ai-login", strictLimit, async (req, res) => {
  try {
    const { host, email, password, role: wantRole } = req.body || {};
    const school = await resolveSchoolByHost(host);
    if (!school) return res.status(404).json({ success: false, code: "no_school", message: "This website isn't connected to a school yet." });

    const { data: user } = await db.from("users").select("*").eq("email", String(email || "").toLowerCase().trim()).maybeSingle();
    // Single generic message for both unknown-email and wrong-password so this
    // public endpoint can't be used to enumerate which emails have accounts.
    const badCreds = () => res.status(401).json({ success: false, code: "bad_credentials", message: "Incorrect email or password." });
    if (!user) { await bcrypt.compare(String(password || ""), "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidin"); return badCreds(); }

    const ok = await bcrypt.compare(String(password || ""), user.password_hash || "");
    if (!ok) return badCreds();

    if (user.deleted_at) return res.status(403).json({ success: false, code: "inactive", message: "This account has been deleted." });
    if (!user.is_active)  return res.status(403).json({ success: false, code: "inactive", message: "This account is deactivated. Sign in on the portal to reactivate it." });

    // Membership in THIS school decides the actual role.
    let actualRole = null;
    if (user.id === school.admin_user_id) actualRole = "admin";
    if (!actualRole) {
      const { data: t } = await db.from("school_teachers").select("teacher_id").eq("school_id", school.id).eq("teacher_id", user.id).maybeSingle();
      if (t) actualRole = "teacher";
    }
    if (!actualRole) {
      const cids = await classroomIds(school.id);
      if (cids.length) {
        const { data: cs } = await db.from("classroom_students").select("id").eq("user_id", user.id).in("classroom_id", cids).limit(1).maybeSingle();
        if (cs) actualRole = "student";
      }
    }
    // Parent: their email is a guardian on a student in this school. Verify the
    // match EXACTLY (ilike can over-match on _/% metacharacters in an email).
    if (!actualRole) {
      const target = String(user.email || email || "").toLowerCase().trim();
      const { data: kids } = await db.schema("mgmt").from("students").select("id, guardian_email")
        .eq("school_id", school.id).eq("status", "active").ilike("guardian_email", target).limit(10);
      if ((kids || []).some((k) => String(k.guardian_email || "").toLowerCase().trim() === target && target)) actualRole = "parent";
    }
    if (!actualRole) {
      return res.status(403).json({ success: false, code: "not_member", message: `This account isn't a student, teacher, admin or parent at ${school.name}. Only members of the school can use its AI assistant.` });
    }

    // If they picked a tab that doesn't match their membership, say so.
    if (wantRole && wantRole !== actualRole) {
      return res.status(403).json({ success: false, code: "role_mismatch", message: `That email is registered as ${roleLabel[actualRole]} at ${school.name}, not ${roleLabel[wantRole] || "that role"}. Switch the tab and try again.` });
    }

    // Two-factor accounts can't complete the short widget flow.
    if (user.two_factor_enabled && user.two_factor_secret) {
      return res.status(403).json({ success: false, code: "twofa", message: "This account uses two-factor authentication. Please sign in on the portal instead." });
    }

    // Redirect to the AI chat, carrying a short-lived hand-off token that the
    // destination exchanges for a session on its own origin (survives cross-site
    // cookie blocking).
    //
    // Chat host: defaults to the portal (SCHOOL_PORTAL_URL). When the chat is
    // served UNDER the school's own website domain (a dedicated /ai-chat build
    // proxied by the tenant deployment), set SCHOOL_CHAT_SAME_DOMAIN=true and the
    // redirect stays on the school's domain instead of the platform app.
    const handoff = signHandoff(user.id);
    const cleanHost = String(host || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const chatBase = (process.env.SCHOOL_CHAT_SAME_DOMAIN === "true" && cleanHost)
      ? `https://${cleanHost}`
      : SCHOOL_PORTAL_URL;
    res.json({ success: true, role: actualRole, name: user.full_name || user.email, redirect: `${chatBase}/ai-chat?ai=${encodeURIComponent(handoff)}` });
  } catch (e) {
    console.error("[ai-login]", e);
    res.status(500).json({ success: false, code: "error", message: "Something went wrong. Please try again." });
  }
});

// ── POST /api/school/site/ai-login/exchange  (PUBLIC — hand-off → session) ──
// Called by the school portal from its OWN origin with the hand-off token from
// the AI-chat login redirect. Verifies it and issues the real session cookie.
router.post("/site/ai-login/exchange", async (req, res) => {
  try {
    const userId = verifyHandoff(String(req.body?.token || ""));
    if (!userId) return res.status(401).json({ success: false, message: "This sign-in link expired. Please sign in again." });
    const { data: user } = await db.from("users").select("*").eq("id", userId).maybeSingle();
    if (!user || user.deleted_at || !user.is_active) return res.status(403).json({ success: false, message: "Account unavailable." });
    // Issue the SCHOOL-portal session cookie (akoro_access_school) — the school
    // app reads with X-Akoro-Portal: school. Without the portal arg this
    // defaulted to the student cookie, so the app never found its session and
    // bounced to /signin.
    await issueTokenPair(res, user, "site");
    res.json({ success: true });
  } catch (e) {
    console.error("[ai-login exchange]", e);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ── GET /api/school/site/:slug  (PUBLIC — the rendered landing page) ─────────
// No auth: this is the school's public website. Serves theme OR template mode.
router.get("/site/:slug", async (req, res) => {
  try {
    const slug = (req.params.slug || "").toLowerCase();
    const { data: school } = await db.from("school_profiles")
      .select(SCHOOL_SELECT).eq("slug", slug).maybeSingle();
    if (!school) return res.status(404).type("html").send(schoolNotFoundHtml(`${slug} (site link)`));
    const preview = req.query.preview === "1" || req.query.preview === "true";
    const { status, html } = await renderSchoolSiteHtml(school, { preview, path: req.query.path || "/", apiOrigin: apiOriginOf(req) });
    res.status(status).type("html").send(html);
  } catch (e) {
    console.error("[site render]", e);
    res.status(500).type("html").send("<h1>Something went wrong rendering this page.</h1>");
  }
});

// ── GET /api/school/website ────────────────────────────────────────────────────
router.get("/website", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const website = await getWebsiteConfig(school.id);
    const slug = await ensureSchoolSlug(school); // persist a real slug so previews resolve
    // Public site URL is the wildcard subdomain of the base domain, e.g.
    // https://<slug>.akoro.name.ng — not the API host. A verified custom
    // domain, if any, takes precedence as the primary URL.
    const { data: dom } = await db.schema("edu").from("school_domains")
      .select("domain").eq("school_id", school.id).eq("verified", true)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    const defaultDomain = `${slug}.${SITE_BASE_DOMAIN}`;
    const siteUrl = `https://${dom?.domain || defaultDomain}`;
    // Template detection for the Appearance page: when a published
    // full-document "home" page drives the landing, the theme-only controls
    // (hero, about, sections, colours) don't affect the site.
    const { data: home } = await db.schema("mgmt").from("site_pages")
      .select("content, status, deleted_at").eq("school_id", school.id).eq("slug", "home").maybeSingle();
    const homeIsDocument = !!(home && home.status === "published" && !home.deleted_at && isFullDocument(home.content));
    const templateColorVars = homeIsDocument ? parseTemplateColorVars(home.content) : [];
    res.json({ success: true, data: { ...shapeWebsite(website), slug, defaultDomain, customDomain: dom?.domain || null, siteUrl, homeIsDocument, templateColorVars } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// camelCase (API) → snake_case (DB column) map for the website config.
const WEBSITE_FIELD_MAP = {
  enabled: "enabled", mode: "mode", themeId: "theme_id", syncSchoolInfo: "sync_school_info", aiChatEnabled: "ai_chat_enabled", templateColors: "template_colors",
  heroTitle: "hero_title", heroSubtitle: "hero_subtitle", heroImageUrl: "hero_image_url",
  aboutText: "about_text", metaTitle: "meta_title", metaKeywords: "meta_keywords",
  metaDescription: "meta_description", ogImageUrl: "og_image_url",
  headerScripts: "header_scripts", footerScripts: "footer_scripts",
  primaryColor: "primary_color", secondaryColor: "secondary_color", accentColor: "accent_color",
  bgMode: "bg_mode", socialLinks: "social_links", sections: "sections", customCss: "custom_css",
};

// ── PUT /api/school/website ─────────────────────────────────────────────────────
router.put("/website", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    await getWebsiteConfig(school.id); // ensure row exists
    const b = req.body || {};
    const patch = { updated_at: new Date() };
    for (const [k, col] of Object.entries(WEBSITE_FIELD_MAP)) if (b[k] !== undefined) patch[col] = b[k];
    const { data, error } = await db.schema("edu").from("school_website").update(patch).eq("school_id", school.id).select("*").single();
    if (error) throw new Error(error.message);
    // Sync AI Bot toggle: add the "AI Chat" page to the site when turned on,
    // move it to Trash when turned off.
    if (b.aiChatEnabled !== undefined) await syncAiChatPage(school.id, !!b.aiChatEnabled);
    res.json({ success: true, data: shapeWebsite(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/school/website/templates ───────────────────────────────────────────
router.get("/website/templates", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await db.schema("edu").from("school_website_templates").select("id, name, description, is_active, updated_at, import_payload").eq("school_id", school.id).order("updated_at", { ascending: false });
    const own = (data || []).map((t) => ({ id: t.id, name: t.name, description: t.description, active: t.is_active, updatedAt: t.updated_at, importable: !!t.import_payload }));
    // Shared gallery: admin-managed platform templates + the built-in defaults.
    const ownNames = new Set(own.map((t) => t.name));
    const { data: plat } = await db.schema("edu").from("platform_website_templates")
      .select("id, name, description, is_default, import_payload").eq("is_published", true)
      .order("is_default", { ascending: false }).order("sort_order");
    const platform = (plat || [])
      .filter((t) => !ownNames.has(t.name))
      .map((t) => ({ id: `platform:${t.id}`, name: t.name, description: t.description, active: false, updatedAt: null, importable: !!(t.import_payload && (t.import_payload.pages?.length || t.import_payload.menu?.length)), isDefault: true, recommended: t.is_default }));
    const platNames = new Set((plat || []).map((t) => t.name));
    const defaults = DEFAULT_TEMPLATES
      .filter((t) => !ownNames.has(t.name) && !platNames.has(t.name)) // hide once installed or overridden
      .map((t) => ({ id: `default:${t.id}`, name: t.name, description: t.description, active: false, updatedAt: null, importable: !!(t.importPayload && (t.importPayload.pages?.length || t.importPayload.menu?.length)), isDefault: true }));
    res.json({ success: true, data: [...own, ...platform, ...defaults] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Clone a default template into the school's own templates (idempotent by name)
// and return the school-owned id. Non-default ids pass through unchanged.
async function ensureSchoolTemplate(school, id) {
  let def = null;
  if (String(id).startsWith("default:")) {
    def = getDefaultTemplate(String(id).slice("default:".length));
  } else if (String(id).startsWith("platform:")) {
    const { data } = await db.schema("edu").from("platform_website_templates")
      .select("name, description, html, import_payload").eq("id", String(id).slice("platform:".length)).maybeSingle();
    if (data) def = { name: data.name, description: data.description, html: data.html, importPayload: data.import_payload || null };
  } else {
    return id; // already a school-owned template id
  }
  if (!def) return null;
  const { data: existing } = await db.schema("edu").from("school_website_templates")
    .select("id").eq("school_id", school.id).eq("name", def.name).maybeSingle();
  if (existing) return existing.id;
  const { data: row, error } = await db.schema("edu").from("school_website_templates")
    .insert({ school_id: school.id, name: def.name, description: def.description, html: def.html, import_payload: def.importPayload || null, is_active: false })
    .select("id").single();
  if (error) throw new Error(error.message);
  return row.id;
}

// ── GET /api/school/website/templates/:id ───────────────────────────────────────
router.get("/website/templates/:id", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    if (String(req.params.id).startsWith("default:")) {
      const def = getDefaultTemplate(String(req.params.id).slice("default:".length));
      if (!def) return res.status(404).json({ error: "Template not found" });
      return res.json({ success: true, data: { id: req.params.id, name: def.name, description: def.description, html: def.html, active: false, isDefault: true } });
    }
    if (String(req.params.id).startsWith("platform:")) {
      const { data: p } = await db.schema("edu").from("platform_website_templates")
        .select("name, description, html").eq("id", String(req.params.id).slice("platform:".length)).maybeSingle();
      if (!p) return res.status(404).json({ error: "Template not found" });
      return res.json({ success: true, data: { id: req.params.id, name: p.name, description: p.description, html: p.html, active: false, isDefault: true } });
    }
    const { data } = await db.schema("edu").from("school_website_templates").select("*").eq("id", req.params.id).eq("school_id", school.id).maybeSingle();
    if (!data) return res.status(404).json({ error: "Template not found" });
    res.json({ success: true, data: { id: data.id, name: data.name, description: data.description, html: data.html, active: data.is_active, updatedAt: data.updated_at } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/website/templates ──────────────────────────────────────────
// Body: { name, description?, html? }
router.post("/website/templates", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { name, description = "", html = "" } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const { data, error } = await db.schema("edu").from("school_website_templates")
      .insert({ school_id: school.id, name: name.trim(), description, html: ensureResponsiveViewport(html) }).select("*").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: { id: data.id, name: data.name, description: data.description, html: data.html, active: data.is_active, updatedAt: data.updated_at } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/website/templates/upload  (.zip or .html) ──────────────────
// Multipart field "file". A .zip is unpacked into one self-contained HTML
// (CSS/JS/images inlined); a .html/.htm is stored as-is.
const templateUpload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }).single("file");
router.post("/website/templates/upload", authenticateToken, requireRole(SCHOOL_ROLES), (req, res) => {
  templateUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message });
      const school = await getMySchool(req, res);
      if (!school) return;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const original = req.file.originalname || "template";
      const isZip = /\.zip$/i.test(original) || req.file.mimetype === "application/zip";
      const name = (req.body.name?.trim()) || original.replace(/\.(zip|html?|txt)$/i, "") || "Uploaded template";
      const description = req.body.description || "Uploaded template";

      // Plain HTML — store as-is.
      if (!isZip) {
        const html = req.file.buffer.toString("utf-8");
        if (!/<[a-z!]/i.test(html)) return res.status(400).json({ error: "No HTML content found in the upload." });
        const { data, error } = await db.schema("edu").from("school_website_templates")
          .insert({ school_id: school.id, name, description, html }).select("*").single();
        if (error) throw new Error(error.message);
        return res.status(201).json({ success: true, data: { id: data.id, name: data.name, active: data.is_active } });
      }

      // Zip — host assets in Storage (real files), fall back to inlining if
      // Storage is unavailable. Insert first so we have an id for the folder.
      const { data: created, error: insErr } = await db.schema("edu").from("school_website_templates")
        .insert({ school_id: school.id, name, description, html: "" }).select("id").single();
      if (insErr) throw new Error(insErr.message);

      let html, importPayload = null, hosting = "storage";
      try {
        await ensureBucket();
        ({ html, importPayload } = await uploadZipToStorage(req.file.buffer, { schoolId: school.id, templateId: created.id }));
      } catch (storageErr) {
        console.warn("[template upload] storage failed, inlining:", storageErr.message);
        try { ({ html } = assembleTemplateFromZip(req.file.buffer)); hosting = "inline"; }
        catch (zipErr) {
          await db.schema("edu").from("school_website_templates").delete().eq("id", created.id);
          return res.status(400).json({ error: `Could not read the zip: ${zipErr.message}` });
        }
      }
      await db.schema("edu").from("school_website_templates").update({ html: ensureResponsiveViewport(html), import_payload: importPayload }).eq("id", created.id);
      res.status(201).json({ success: true, data: { id: created.id, name, active: false, importable: !!importPayload }, hosting });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// ── PUT /api/school/website/templates/:id ───────────────────────────────────────
// Body: { name?, description?, html? }
router.put("/website/templates/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const patch = { updated_at: new Date() };
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.description !== undefined) patch.description = req.body.description;
    if (req.body.html !== undefined) patch.html = ensureResponsiveViewport(req.body.html);
    const { data, error } = await db.schema("edu").from("school_website_templates")
      .update(patch).eq("id", req.params.id).eq("school_id", school.id).select("*").single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { id: data.id, name: data.name, description: data.description, html: data.html, active: data.is_active, updatedAt: data.updated_at } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/website/templates/:id/activate ─────────────────────────────
router.post("/website/templates/:id/activate", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const templateId = await ensureSchoolTemplate(school, req.params.id); // clone if it's a default
    if (!templateId) return res.status(404).json({ error: "Template not found" });
    const { data: tpl } = await db.schema("edu").from("school_website_templates").select("id").eq("id", templateId).eq("school_id", school.id).maybeSingle();
    if (!tpl) return res.status(404).json({ error: "Template not found" });
    await db.schema("edu").from("school_website_templates").update({ is_active: false }).eq("school_id", school.id);
    await db.schema("edu").from("school_website_templates").update({ is_active: true }).eq("id", templateId);
    await db.schema("edu").from("school_website").update({ mode: "template", updated_at: new Date() }).eq("school_id", school.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/website/templates/:id/import  (template → builder) ─────────
// Creates real builder content from the template's stashed import payload:
//   • a published "home" page from the zip's index.html (rendered as landing)
//   • one published site_page per extra .html (existing slugs kept)
//   • a Primary menu built from the template's nav (any current primary menu
//     is unassigned, not deleted)
// The site switches to builder ('theme') mode: home + pages render through
// the builder chrome, so EVERYTHING — content, links, appearance — is edited
// in Pages / Menus / Appearance. Idempotent: existing slugs are skipped.
router.post("/website/templates/:id/import", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const templateId = await ensureSchoolTemplate(school, req.params.id); // clone if it's a default
    if (!templateId) return res.status(404).json({ error: "Template not found" });
    const { data: tpl } = await db.schema("edu").from("school_website_templates")
      .select("id, name, import_payload").eq("id", templateId).eq("school_id", school.id).maybeSingle();
    if (!tpl) return res.status(404).json({ error: "Template not found" });
    const payload = tpl.import_payload;
    if (!payload || (!payload.pages?.length && !payload.menu?.length)) {
      return res.status(400).json({ error: "This template has no importable pages or menu (single-page upload)." });
    }

    // 1) Pages — upsert by slug. Existing pages are OVERWRITTEN with the
    // template's full-fidelity documents (and un-trashed / re-published), so
    // re-importing heals pages broken by older stripped imports. blocks is
    // cleared so the page opens in the visual editor, not the block editor.
    const M = db.schema("mgmt");
    const { data: existing } = await M.from("site_pages").select("id, slug").eq("school_id", school.id);
    const idBySlug = Object.fromEntries((existing || []).map((p) => [p.slug, p.id]));
    let pagesCreated = 0, pagesUpdated = 0;
    for (const [i, p] of (payload.pages || []).entries()) {
      if (!p.slug) continue;
      const body = { title: p.title || p.slug, content: p.content || "", blocks: [], status: "published", sort_order: i, deleted_at: null };
      if (idBySlug[p.slug]) {
        const { error } = await M.from("site_pages").update(body).eq("id", idBySlug[p.slug]);
        if (error) throw new Error(error.message);
        pagesUpdated++;
      } else {
        const { data: row, error } = await M.from("site_pages").insert({ ...body, school_id: school.id, slug: p.slug }).select("id, slug").single();
        if (error) throw new Error(error.message);
        idBySlug[row.slug] = row.id;
        pagesCreated++;
      }
    }

    // 1b) Activating a template REPLACES the site: every page that isn't part
    // of the new template is moved to Trash (soft delete — recoverable from
    // Pages → Trash), so stale pages from a previous template never linger in
    // the Pages list or stay reachable on the live site.
    let pagesRemoved = 0;
    const keepSlugs = new Set((payload.pages || []).map((p) => p.slug).filter(Boolean));
    const stale = (existing || []).filter((p) => !keepSlugs.has(p.slug));
    if (stale.length) {
      const { error: trashErr } = await M.from("site_pages")
        .update({ deleted_at: new Date() })
        .in("id", stale.map((p) => p.id));
      if (trashErr) throw new Error(trashErr.message);
      pagesRemoved = stale.length;
    }

    // 2) Menus — the new template's menu replaces ALL existing menus (old
    // template menus, unassigned leftovers), so the Menus builder shows only
    // the active template's navigation.
    let menuItems = 0;
    if (payload.menu?.length) {
      const menuName = `${tpl.name} Menu`;
      const { data: oldMenus } = await M.from("site_menus").select("id").eq("school_id", school.id);
      for (const m of oldMenus || []) {
        await M.from("site_menu_items").delete().eq("menu_id", m.id);
        await M.from("site_menus").delete().eq("id", m.id);
      }
      const { data: menu, error: menuErr } = await M.from("site_menus")
        .insert({ school_id: school.id, name: menuName, location: "primary" }).select("id").single();
      if (menuErr) throw new Error(menuErr.message);
      const rows = payload.menu.map((it, i) => ({
        school_id: school.id, menu_id: menu.id, label: it.label,
        page_id: it.slug ? (idBySlug[it.slug] || null) : null,
        url: it.url || (it.slug && !idBySlug[it.slug] ? "#" : null),
        parent_label: it.parent || null,
        target: "_self", sort_order: i,
      })).filter((r) => r.page_id || r.url);
      if (rows.length) {
        const { error } = await M.from("site_menu_items").insert(rows);
        if (error) throw new Error(error.message);
        menuItems = rows.length;
      }
    }

    // 3) Mark this template as the source and switch to builder mode — the
    // imported "home" page is a full document, served raw as the landing.
    await db.schema("edu").from("school_website_templates").update({ is_active: false }).eq("school_id", school.id);
    await db.schema("edu").from("school_website_templates").update({ is_active: true }).eq("id", tpl.id);
    await db.schema("edu").from("school_website").update({ mode: "theme", updated_at: new Date() }).eq("school_id", school.id);

    res.json({ success: true, pagesCreated, pagesUpdated, pagesRemoved, menuItems });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/school/website/templates/:id ─────────────────────────────────────
router.delete("/website/templates/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await db.schema("edu").from("school_website_templates").delete().eq("id", req.params.id).eq("school_id", school.id);
    if (error) throw new Error(error.message);
    await removeTemplateAssets(school.id, req.params.id); // best-effort storage cleanup
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// BACKUP MANAGEMENT — snapshot metadata (label/type/status/size) + schedule.
// The backup_schedule itself is read/written via the generic
// GET/PUT /api/school/settings(/backup) routes above.
// =============================================================

// ── GET /api/school/backups ───────────────────────────────────────────────────
router.get("/backups", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await db.schema("edu").from("school_backups")
      .select("id, label, type, status, size_bytes, record_count, created_at")
      .eq("school_id", school.id)
      .order("created_at", { ascending: false })
      .limit(50);
    res.json({ success: true, data: (data || []).map((b) => ({
      id: b.id, label: b.label, type: b.type, status: b.status,
      sizeBytes: b.size_bytes, recordCount: b.record_count, createdAt: b.created_at,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/backups ──────────────────────────────────────────────────
// Body: { label? }. Snapshots the school's current record counts as a stand-in
// for a real DB export (wire to actual storage/export tooling later).
router.post("/backups", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const cids = await classroomIds(school.id);
    const [{ count: students }, { count: teachers }, { count: classrooms }] = await Promise.all([
      cids.length ? db.from("classroom_students").select("id", { count: "exact", head: true }).in("classroom_id", cids) : Promise.resolve({ count: 0 }),
      db.from("school_teachers").select("teacher_id", { count: "exact", head: true }).eq("school_id", school.id),
      Promise.resolve({ count: cids.length }),
    ]);
    const recordCount = (students || 0) + (teachers || 0) + (classrooms || 0);
    // Rough size estimate — ~2KB/record — until a real export pipeline exists.
    const sizeBytes = Math.max(recordCount, 1) * 2048;

    const { data, error } = await db.schema("edu").from("school_backups").insert({
      school_id: school.id,
      label: req.body.label?.trim() || `Manual Backup — ${new Date().toISOString().slice(0, 10)}`,
      type: "manual", status: "completed", size_bytes: sizeBytes, record_count: recordCount,
    }).select("id, label, type, status, size_bytes, record_count, created_at").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: {
      id: data.id, label: data.label, type: data.type, status: data.status,
      sizeBytes: data.size_bytes, recordCount: data.record_count, createdAt: data.created_at,
    } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/school/backups/:id ────────────────────────────────────────────
router.delete("/backups/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await db.schema("edu").from("school_backups").delete().eq("id", req.params.id).eq("school_id", school.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// ROLES & PERMISSIONS
// =============================================================

const DEFAULT_ADMIN_PERMISSIONS = { "*": { view: true, create: true, edit: true, delete: true } };

async function ensureAdminRole(schoolId) {
  const { data: existing } = await db.schema("edu").from("school_roles").select("id").eq("school_id", schoolId).eq("is_system", true).maybeSingle();
  if (existing) return;
  await db.schema("edu").from("school_roles").insert({
    school_id: schoolId, name: "Administrator", description: "Full access to every module.",
    is_system: true, permissions: DEFAULT_ADMIN_PERMISSIONS, member_count: 1,
  });
}

// ── GET /api/school/roles ─────────────────────────────────────────────────────
router.get("/roles", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    await ensureAdminRole(school.id);
    const { data } = await db.schema("edu").from("school_roles")
      .select("id, name, description, is_system, permissions, member_count, updated_at")
      .eq("school_id", school.id)
      .order("is_system", { ascending: false })
      .order("created_at", { ascending: true });
    res.json({ success: true, data: (data || []).map((r) => ({
      id: r.id, name: r.name, description: r.description, isSystem: r.is_system,
      permissions: r.permissions || {}, memberCount: r.member_count, updatedAt: r.updated_at,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/roles ────────────────────────────────────────────────────
// Body: { name, description?, permissions? }
router.post("/roles", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { name, description = "", permissions = {} } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const { data, error } = await db.schema("edu").from("school_roles").insert({
      school_id: school.id, name: name.trim(), description, permissions,
    }).select("id, name, description, is_system, permissions, member_count, updated_at").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "A role with that name already exists" });
      throw new Error(error.message);
    }
    res.status(201).json({ success: true, data: {
      id: data.id, name: data.name, description: data.description, isSystem: data.is_system,
      permissions: data.permissions || {}, memberCount: data.member_count, updatedAt: data.updated_at,
    } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/school/roles/:id ──────────────────────────────────────────────────
// Body: { name?, description?, permissions? }
router.put("/roles/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: existing } = await db.schema("edu").from("school_roles")
      .select("is_system").eq("id", req.params.id).eq("school_id", school.id).maybeSingle();
    if (!existing) return res.status(404).json({ error: "Role not found" });

    const patch = { updated_at: new Date() };
    if (req.body.description !== undefined) patch.description = req.body.description;
    // The system Administrator role keeps its name and full-access permissions.
    if (!existing.is_system) {
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.permissions !== undefined) patch.permissions = req.body.permissions;
    }
    const { data, error } = await db.schema("edu").from("school_roles")
      .update(patch).eq("id", req.params.id).eq("school_id", school.id)
      .select("id, name, description, is_system, permissions, member_count, updated_at").single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data: {
      id: data.id, name: data.name, description: data.description, isSystem: data.is_system,
      permissions: data.permissions || {}, memberCount: data.member_count, updatedAt: data.updated_at,
    } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/school/roles/:id ──────────────────────────────────────────────
router.delete("/roles/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: role } = await db.schema("edu").from("school_roles").select("is_system").eq("id", req.params.id).eq("school_id", school.id).maybeSingle();
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.is_system) return res.status(400).json({ error: "The Administrator role can't be deleted" });
    const { error } = await db.schema("edu").from("school_roles").delete().eq("id", req.params.id).eq("school_id", school.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// PAYMENT GATEWAY SETTINGS — online fee collection. Secrets are stored but
// never returned raw; GET responses mask them and only report whether a
// value is set (hasLiveKeySecret, etc).
// =============================================================

const mask = (v) => (v ? "•".repeat(Math.min(20, Math.max(8, v.length))) : "");

function shapePaymentGateway(row) {
  if (!row) return {
    enabled: false, provider: "", mode: "sandbox",
    liveKeyId: "", liveKeySecret: "", hasLiveKeySecret: false,
    sandboxKeyId: "", sandboxKeySecret: "", hasSandboxKeySecret: false,
    webhookSecret: "", hasWebhookSecret: false,
    surchargeType: "percentage", surchargeAmount: 0,
  };
  return {
    enabled: row.enabled, provider: row.provider || "", mode: row.mode,
    liveKeyId: row.live_key_id || "", liveKeySecret: mask(row.live_key_secret), hasLiveKeySecret: !!row.live_key_secret,
    sandboxKeyId: row.sandbox_key_id || "", sandboxKeySecret: mask(row.sandbox_key_secret), hasSandboxKeySecret: !!row.sandbox_key_secret,
    webhookSecret: mask(row.webhook_secret), hasWebhookSecret: !!row.webhook_secret,
    surchargeType: row.surcharge_type, surchargeAmount: row.surcharge_amount,
  };
}

// ── GET /api/school/payment-gateway ───────────────────────────────────────────
router.get("/payment-gateway", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await db.schema("edu").from("school_payment_gateway").select("*").eq("school_id", school.id).maybeSingle();
    res.json({ success: true, data: shapePaymentGateway(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/school/payment-gateway ───────────────────────────────────────────
// Secret fields (liveKeySecret, sandboxKeySecret, webhookSecret) are only
// overwritten when a non-empty value is sent — leave blank to keep saved.
router.put("/payment-gateway", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const b = req.body || {};
    const patch = { school_id: school.id, updated_at: new Date() };
    if (b.enabled !== undefined) patch.enabled = !!b.enabled;
    if (b.provider !== undefined) patch.provider = b.provider;
    if (b.mode !== undefined) patch.mode = b.mode;
    if (b.liveKeyId !== undefined) patch.live_key_id = b.liveKeyId;
    if (b.sandboxKeyId !== undefined) patch.sandbox_key_id = b.sandboxKeyId;
    if (b.liveKeySecret)    patch.live_key_secret = b.liveKeySecret;
    if (b.sandboxKeySecret) patch.sandbox_key_secret = b.sandboxKeySecret;
    if (b.webhookSecret)    patch.webhook_secret = b.webhookSecret;
    if (b.surchargeType !== undefined) patch.surcharge_type = b.surchargeType;
    if (b.surchargeAmount !== undefined) patch.surcharge_amount = b.surchargeAmount;

    const { data, error } = await db.schema("edu").from("school_payment_gateway")
      .upsert(patch, { onConflict: "school_id" }).select("*").single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data: shapePaymentGateway(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// ADMISSION FORM CONFIGURATION
// =============================================================

async function getAdmissionSettings(schoolId) {
  const { data } = await db.schema("edu").from("school_admission_settings").select("*").eq("school_id", schoolId).maybeSingle();
  if (data) return data;
  const { data: created } = await db.schema("edu").from("school_admission_settings").insert({ school_id: schoolId }).select("*").single();
  return created;
}

// ── GET /api/school/admission ─────────────────────────────────────────────────
router.get("/admission", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const settings = await getAdmissionSettings(school.id);
    const { data: fields } = await db.schema("edu").from("school_admission_fields")
      .select("id, label, field_type, options, required, sort_order")
      .eq("school_id", school.id)
      .order("sort_order", { ascending: true });
    res.json({
      success: true,
      data: {
        settings: {
          enabled: settings.enabled, slug: settings.slug || school.slug || "",
          feeAmount: settings.fee_amount, qrCodeUrl: settings.qr_code_url,
        },
        fields: (fields || []).map((f) => ({
          id: f.id, label: f.label, type: f.field_type, options: f.options || [],
          required: f.required, sortOrder: f.sort_order,
        })),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/school/admission/settings ────────────────────────────────────────
// Body: { enabled?, slug?, feeAmount?, qrCodeUrl? }
router.put("/admission/settings", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    await getAdmissionSettings(school.id); // ensure row exists
    const b = req.body || {};
    const patch = { updated_at: new Date() };
    if (b.enabled !== undefined) patch.enabled = !!b.enabled;
    if (b.slug !== undefined) patch.slug = b.slug?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") || null;
    if (b.feeAmount !== undefined) patch.fee_amount = b.feeAmount;
    if (b.qrCodeUrl !== undefined) patch.qr_code_url = b.qrCodeUrl;

    const { data, error } = await db.schema("edu").from("school_admission_settings")
      .update(patch).eq("school_id", school.id).select("*").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "That URL slug is already taken" });
      throw new Error(error.message);
    }
    res.json({ success: true, data: { enabled: data.enabled, slug: data.slug, feeAmount: data.fee_amount, qrCodeUrl: data.qr_code_url } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/admission/fields ─────────────────────────────────────────
// Body: { label, type?, options?, required?, sortOrder? }
router.post("/admission/fields", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { label, type = "text", options = [], required = false, sortOrder = 0 } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: "label is required" });
    const { data, error } = await db.schema("edu").from("school_admission_fields").insert({
      school_id: school.id, label: label.trim(), field_type: type, options, required, sort_order: sortOrder,
    }).select("id, label, field_type, options, required, sort_order").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: { id: data.id, label: data.label, type: data.field_type, options: data.options || [], required: data.required, sortOrder: data.sort_order } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/school/admission/fields/:id ──────────────────────────────────────
router.put("/admission/fields/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const patch = {};
    if (req.body.label !== undefined) patch.label = req.body.label;
    if (req.body.type !== undefined) patch.field_type = req.body.type;
    if (req.body.options !== undefined) patch.options = req.body.options;
    if (req.body.required !== undefined) patch.required = req.body.required;
    if (req.body.sortOrder !== undefined) patch.sort_order = req.body.sortOrder;
    const { data, error } = await db.schema("edu").from("school_admission_fields")
      .update(patch).eq("id", req.params.id).eq("school_id", school.id)
      .select("id, label, field_type, options, required, sort_order").single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data: { id: data.id, label: data.label, type: data.field_type, options: data.options || [], required: data.required, sortOrder: data.sort_order } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/school/admission/fields/:id ───────────────────────────────────
router.delete("/admission/fields/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await db.schema("edu").from("school_admission_fields").delete().eq("id", req.params.id).eq("school_id", school.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// SUBSCRIPTION — Manage Subscription + Payment History.
// Plans are a platform-owned catalog (edu.subscription_plans, prices in
// kobo). Checkout mirrors the instructor tools Paystack flow.
// =============================================================

const SCHOOL_FRONTEND_URL = process.env.SCHOOL_FRONTEND_URL || "https://school.akoro.app";
const toNaira = (kobo) => Math.round((kobo || 0) / 100);

async function getMySubscription(schoolId) {
  const { data } = await db.schema("edu").from("school_subscriptions").select("*").eq("school_id", schoolId).maybeSingle();
  if (data) return data;
  const { data: created } = await db.schema("edu").from("school_subscriptions").insert({ school_id: schoolId }).select("*").single();
  return created;
}

// ── GET /api/school/subscription ──────────────────────────────────────────────
router.get("/subscription", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const [{ data: plans }, sub] = await Promise.all([
      db.schema("edu").from("subscription_plans").select("key, name, description, max_students, price_monthly_kobo, price_yearly_kobo").eq("is_active", true).order("sort_order", { ascending: true }),
      getMySubscription(school.id),
    ]);
    const plan = (plans || []).find((p) => p.key === sub.plan_key);
    res.json({
      success: true,
      data: {
        plans: (plans || []).map((p) => ({
          key: p.key, name: p.name, description: p.description, maxStudents: p.max_students,
          priceMonthly: toNaira(p.price_monthly_kobo), priceYearly: toNaira(p.price_yearly_kobo),
        })),
        current: {
          planKey: sub.plan_key, name: plan?.name || sub.plan_key, description: plan?.description || "",
          maxStudents: plan?.max_students || 0, status: sub.status, billingCycle: sub.billing_cycle,
          startsAt: sub.starts_at, endsAt: sub.ends_at,
        },
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/subscription/checkout ─────────────────────────────────────
// Body: { planKey, cycle: 'monthly' | 'yearly' }
router.post("/subscription/checkout", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { planKey, cycle = "yearly" } = req.body;
    if (!["monthly", "yearly"].includes(cycle)) return res.status(400).json({ error: "cycle must be 'monthly' or 'yearly'" });

    const { data: plan } = await db.schema("edu").from("subscription_plans").select("*").eq("key", planKey).eq("is_active", true).maybeSingle();
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const amountKobo = cycle === "monthly" ? plan.price_monthly_kobo : plan.price_yearly_kobo;
    const orderId = `order_${crypto.randomBytes(8).toString("hex")}`;

    // Free plan (e.g. Trial) — activate immediately, no payment needed.
    if (!amountKobo) {
      await db.schema("edu").from("school_subscriptions").upsert({
        school_id: school.id, plan_key: plan.key, status: "active", billing_cycle: cycle,
        starts_at: new Date(), ends_at: new Date(Date.now() + (cycle === "monthly" ? 30 : 365) * 86400000),
        updated_at: new Date(),
      }, { onConflict: "school_id" });
      await db.schema("edu").from("school_subscription_payments").insert({
        school_id: school.id, order_id: orderId, plan_key: plan.key, billing_cycle: cycle,
        amount_kobo: 0, method: "Free", status: "paid", paid_at: new Date(),
      });
      return res.json({ success: true, free: true, message: `${plan.name} activated.` });
    }

    const email = req.body.email || req.user.email || (await getUserEmail(req.user.id));
    if (!email) return res.status(400).json({ error: "email required for payment" });

    const reference = generateReference("SUB");
    await db.schema("edu").from("school_subscription_payments").insert({
      school_id: school.id, order_id: orderId, plan_key: plan.key, billing_cycle: cycle,
      amount_kobo: amountKobo, method: "Paystack", paystack_ref: reference, status: "pending",
    });

    const paystack = await initializeTransaction({
      email,
      amount_kobo: amountKobo,
      reference,
      callback_url: `${SCHOOL_FRONTEND_URL}/settings-subscription?sub_ref=${reference}`,
      metadata: { school_id: school.id, plan_key: plan.key, billing_cycle: cycle, kind: "school_subscription" },
    });

    res.json({ success: true, authorization_url: paystack.authorization_url, reference, orderId });
  } catch (e) {
    console.error("[subscription/checkout]", e);
    res.status(500).json({ error: e.message });
  }
});

async function getUserEmail(userId) {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return data?.user?.email || null;
  } catch { return null; }
}

// ── GET /api/school/subscription/verify/:reference ─────────────────────────────
router.get("/subscription/verify/:reference", authenticateToken, async (req, res) => {
  try {
    // Scope to the caller's own school — no verifying another school's payment.
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: payment } = await db.schema("edu").from("school_subscription_payments").select("*").eq("paystack_ref", req.params.reference).eq("school_id", school.id).maybeSingle();
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    if (payment.status === "paid") return res.json({ success: true, activated: true, alreadyProcessed: true });

    const tx = await verifyTransaction(req.params.reference);
    if (tx.status === "success") {
      await db.schema("edu").from("school_subscription_payments")
        .update({ status: "paid", paid_at: new Date(), transaction_id: String(tx.id || "") }).eq("id", payment.id);
      const days = payment.billing_cycle === "monthly" ? 30 : 365;
      await db.schema("edu").from("school_subscriptions").upsert({
        school_id: payment.school_id, plan_key: payment.plan_key, status: "active",
        billing_cycle: payment.billing_cycle, starts_at: new Date(),
        ends_at: new Date(Date.now() + days * 86400000), updated_at: new Date(),
      }, { onConflict: "school_id" });
      return res.json({ success: true, activated: true, message: "Payment verified — subscription activated!" });
    }

    await db.schema("edu").from("school_subscription_payments").update({ status: "failed" }).eq("id", payment.id);
    res.json({ success: false, activated: false, status: tx.status, message: "Payment not successful" });
  } catch (e) {
    console.error("[subscription/verify]", e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/school/subscription/payments ───────────────────────────────────────
router.get("/subscription/payments", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: plans } = await db.schema("edu").from("subscription_plans").select("key, name");
    const planName = Object.fromEntries((plans || []).map((p) => [p.key, p.name]));

    const { data } = await db.schema("edu").from("school_subscription_payments")
      .select("id, order_id, plan_key, amount_kobo, method, transaction_id, proof_url, status, created_at, paid_at")
      .eq("school_id", school.id)
      .order("created_at", { ascending: false });

    res.json({ success: true, data: (data || []).map((p) => ({
      id: p.id, orderId: p.order_id, plan: planName[p.plan_key] || p.plan_key,
      amount: toNaira(p.amount_kobo), method: p.method, transactionId: p.transaction_id,
      proofUrl: p.proof_url, status: p.status, createdAt: p.created_at, paidAt: p.paid_at,
    })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =============================================================
// AUDIT TRAIL — read the log written by the middleware above.
// =============================================================

// ── GET /api/school/audit-logs?entityType=&method=&limit=&offset= ────────────
router.get("/audit-logs", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const offset = Number(req.query.offset) || 0;

    let q = db.schema("edu").from("school_audit_logs")
      .select("id, actor_name, method, entity_type, entity_label, path, status_code, details, created_at", { count: "exact" })
      .eq("school_id", school.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (req.query.entityType) q = q.eq("entity_type", req.query.entityType);
    if (req.query.method) q = q.eq("method", req.query.method.toUpperCase());

    const { data, count, error } = await q;
    if (error) throw new Error(error.message);

    const { data: entityRows } = await db.schema("edu").from("school_audit_logs")
      .select("entity_type").eq("school_id", school.id);
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
});

export default router;
