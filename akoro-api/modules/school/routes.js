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
    .select("id, name, description, logo_url, website, address, phone, is_active, created_at, slug, acronym, principal_name, country, favicon_url, principal_signature_url")
    .eq("admin_user_id", req.user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) { res.status(404).json({ error: "No school is linked to this account." }); return null; }
  return data;
}

const slugify = (s) => (s || "school").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

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
          address: school.address, logoUrl: school.logo_url, faviconUrl: school.favicon_url,
          signatureUrl: school.principal_signature_url,
        },
        systemFormats:     settings?.system_formats ?? {},
        attendance:        settings?.attendance ?? {},
        security:          settings?.security ?? {},
        integrations:      settings?.integrations ?? {},
        personalisation:   settings?.personalisation ?? {},
        notificationPrefs: settings?.notification_prefs ?? {},
        modules:           settings?.modules ?? {},
        backupSchedule:    settings?.backup_schedule ?? { autoBackup: true, frequency: 'daily', retentionDays: 30 },
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/school/settings/profile ─────────────────────────────────────────
router.put("/settings/profile", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { name, acronym, phone, principal, country, address, logoUrl, faviconUrl, signatureUrl } = req.body;
    const patch = {};
    if (name !== undefined)       patch.name = name;
    if (acronym !== undefined)    patch.acronym = acronym;
    if (phone !== undefined)      patch.phone = phone;
    if (principal !== undefined)  patch.principal_name = principal;
    if (country !== undefined)    patch.country = country;
    if (address !== undefined)    patch.address = address;
    if (logoUrl !== undefined)    patch.logo_url = logoUrl;
    if (faviconUrl !== undefined) patch.favicon_url = faviconUrl;
    if (signatureUrl !== undefined) patch.principal_signature_url = signatureUrl;
    const { error } = await db.from("school_profiles").update(patch).eq("id", school.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
        defaultDomain: `${school.slug || slugify(school.name)}.akoro.app`,
        customDomains: (data || []).map((d) => ({ id: d.id, domain: d.domain, verified: d.verified, cnameTarget: d.cname_target })),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/domains ───────────────────────────────────────────────────
router.post("/domains", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const domain = (req.body.domain || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!domain || !domain.includes(".")) return res.status(400).json({ error: "Enter a valid domain, e.g. www.yourschool.com" });
    const { data, error } = await db.schema("edu").from("school_domains")
      .insert({ school_id: school.id, domain }).select("*").single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "That domain is already registered" });
      throw new Error(error.message);
    }
    res.status(201).json({ success: true, data: { id: data.id, domain: data.domain, verified: data.verified, cnameTarget: data.cname_target } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/school/domains/:id/verify ────────────────────────────────────────
// Real DNS check — resolves the domain's CNAME and confirms it points at us.
router.post("/domains/:id/verify", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data: row } = await db.schema("edu").from("school_domains").select("*").eq("id", req.params.id).eq("school_id", school.id).maybeSingle();
    if (!row) return res.status(404).json({ error: "Domain not found" });

    let verified = false;
    try {
      const { resolveCname } = await import("node:dns/promises");
      const records = await resolveCname(row.domain);
      verified = records.some((r) => r.toLowerCase().includes(row.cname_target.toLowerCase()));
    } catch { verified = false; }

    if (verified) {
      await db.schema("edu").from("school_domains").update({ verified: true, verified_at: new Date() }).eq("id", row.id);
    }
    res.json({ success: true, verified, message: verified ? "Domain verified!" : "CNAME record not found yet — DNS can take a few hours to propagate." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/school/domains/:id ─────────────────────────────────────────────
router.delete("/domains/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
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
  enabled: w.enabled, mode: w.mode, themeId: w.theme_id,
  heroTitle: w.hero_title, heroSubtitle: w.hero_subtitle, heroImageUrl: w.hero_image_url,
  aboutText: w.about_text, metaTitle: w.meta_title, metaKeywords: w.meta_keywords,
  metaDescription: w.meta_description, ogImageUrl: w.og_image_url,
  headerScripts: w.header_scripts, footerScripts: w.footer_scripts,
  primaryColor: w.primary_color, secondaryColor: w.secondary_color, accentColor: w.accent_color,
  bgMode: w.bg_mode, socialLinks: w.social_links || {}, sections: w.sections || [], customCss: w.custom_css,
});

// ── GET /api/school/website ────────────────────────────────────────────────────
router.get("/website", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const website = await getWebsiteConfig(school.id);
    res.json({ success: true, data: shapeWebsite(website) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/school/website ─────────────────────────────────────────────────────
router.put("/website", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    await getWebsiteConfig(school.id); // ensure row exists
    const b = req.body || {};
    const patch = { updated_at: new Date() };
    const map = {
      enabled: "enabled", mode: "mode", themeId: "theme_id",
      heroTitle: "hero_title", heroSubtitle: "hero_subtitle", heroImageUrl: "hero_image_url",
      aboutText: "about_text", metaTitle: "meta_title", metaKeywords: "meta_keywords",
      metaDescription: "meta_description", ogImageUrl: "og_image_url",
      headerScripts: "header_scripts", footerScripts: "footer_scripts",
      primaryColor: "primary_color", secondaryColor: "secondary_color", accentColor: "accent_color",
      bgMode: "bg_mode", socialLinks: "social_links", sections: "sections", customCss: "custom_css",
    };
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) patch[col] = b[k];
    const { data, error } = await db.schema("edu").from("school_website").update(patch).eq("school_id", school.id).select("*").single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data: shapeWebsite(data) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/school/website/templates ───────────────────────────────────────────
router.get("/website/templates", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { data } = await db.schema("edu").from("school_website_templates").select("id, name, description, is_active, updated_at").eq("school_id", school.id).order("updated_at", { ascending: false });
    res.json({ success: true, data: (data || []).map((t) => ({ id: t.id, name: t.name, description: t.description, active: t.is_active, updatedAt: t.updated_at })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/school/website/templates/:id ───────────────────────────────────────
router.get("/website/templates/:id", authenticateToken, async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
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
      .insert({ school_id: school.id, name: name.trim(), description, html }).select("*").single();
    if (error) throw new Error(error.message);
    res.status(201).json({ success: true, data: { id: data.id, name: data.name, description: data.description, html: data.html, active: data.is_active, updatedAt: data.updated_at } });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    if (req.body.html !== undefined) patch.html = req.body.html;
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
    const { data: tpl } = await db.schema("edu").from("school_website_templates").select("id").eq("id", req.params.id).eq("school_id", school.id).maybeSingle();
    if (!tpl) return res.status(404).json({ error: "Template not found" });
    await db.schema("edu").from("school_website_templates").update({ is_active: false }).eq("school_id", school.id);
    await db.schema("edu").from("school_website_templates").update({ is_active: true }).eq("id", req.params.id);
    await db.schema("edu").from("school_website").update({ mode: "template", updated_at: new Date() }).eq("school_id", school.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/school/website/templates/:id ─────────────────────────────────────
router.delete("/website/templates/:id", authenticateToken, requireRole(SCHOOL_ROLES), async (req, res) => {
  try {
    const school = await getMySchool(req, res);
    if (!school) return;
    const { error } = await db.schema("edu").from("school_website_templates").delete().eq("id", req.params.id).eq("school_id", school.id);
    if (error) throw new Error(error.message);
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
    const patch = { updated_at: new Date() };
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.description !== undefined) patch.description = req.body.description;
    if (req.body.permissions !== undefined) patch.permissions = req.body.permissions;
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

export default router;
