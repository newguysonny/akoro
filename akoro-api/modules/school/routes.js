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
import { authenticateToken, requireRole } from "../auth/routes.js";

const router = Router();
const SCHOOL_ROLES = ["school", "school_admin", "admin"];

// Resolve the caller's school (first one they administer). 404s if none.
async function getMySchool(req, res) {
  const { data } = await db
    .from("school_profiles")
    .select("id, name, description, logo_url, website, address, phone, is_active, created_at")
    .eq("admin_user_id", req.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) { res.status(404).json({ error: "No school is linked to this account." }); return null; }
  return data;
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
      .select("teacher_id, created_at, users:users!school_teachers_teacher_id_fkey(id, full_name, email, avatar_url, subjects)")
      .eq("school_id", school.id)
      .order("created_at", { ascending: false });

    const rows = (links || []).map((l) => l.users).filter(Boolean);
    const withCounts = await Promise.all(rows.map(async (u) => {
      const { count } = await db.from("courses").select("id", { count: "exact", head: true }).eq("instructor_id", u.id);
      return { id: u.id, full_name: u.full_name, email: u.email, avatar_url: u.avatar_url, subjects: u.subjects || [], course_count: count || 0 };
    }));
    res.json({ success: true, data: withCounts });
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

export default router;
