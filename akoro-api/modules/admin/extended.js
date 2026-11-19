/**
 * modules/admin/extended.js  —  Akoro Admin Extended API
 *
 * Mounted at /api/admin (same prefix as routes.js, registered separately).
 *
 * All routes require role=admin.
 *
 *   ── Dashboard (/dashboard) ────────────────────────────────────────────────
 *   GET  /dashboard/stats            full platform metrics in one call
 *   GET  /dashboard/login-trends     last 30 days of login activity
 *
 *   ── Course Details (/courses) ─────────────────────────────────────────────
 *   GET  /courses/:id                course + instructor + modules + lessons
 *   GET  /courses/categories         distinct subject values
 *   POST /courses/:id/modules        create module for course
 *   POST /courses/:id/modules/:moduleId/lessons  create lesson in module
 *
 *   ── User Details (/users) ─────────────────────────────────────────────────
 *   GET  /users/:id/enrollments      enrollments for a user
 *   POST /users/invite               invite single user (no password)
 *   POST /users/invite-csv           bulk invite users
 *
 *   ── Instructor Payouts (/payouts) ─────────────────────────────────────────
 *   GET   /payouts                   list instructor_earnings with filters
 *   GET   /payouts/summary           per-instructor aggregate summary
 *   PATCH /payouts/:id/mark-paid     mark a payout row as paid
 *
 *   ── Analytics Extended (/analytics) ──────────────────────────────────────
 *   GET  /analytics/engagement       engagement metrics
 *   GET  /analytics/top-instructors  top 10 instructors by earnings
 *
 *   ── Reports (/reports) ────────────────────────────────────────────────────
 *   GET  /reports/revenue-export     payments for period
 *   GET  /reports/enrollments-export enrollments for period
 */

import { Router } from "express";
import bcrypt from "bcrypt";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/index.js";
import { sendWelcomeEmail } from "../auth/index.js";
import { urlFor } from "../../lib/urls.js";

const router   = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const ok     = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const ok201  = (res, data)            => res.status(201).json({ success: true, data });
const err400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const err404 = (res, msg = "Not found") => res.status(404).json({ success: false, message: msg });
const err409 = (res, msg)             => res.status(409).json({ success: false, message: msg });

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns an ISO string for N days ago. */
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

/** Returns 'YYYY-MM-DD' for a Date or ISO string. */
const toDateStr = (d) => new Date(d).toISOString().slice(0, 10);

/** Returns period start ISO string from query param (7d/30d/90d/1y). */
const periodStart = (period) => {
  const map = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
  const days = map[period] ?? 30;
  return daysAgo(days);
};

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD METRICS
// ═══════════════════════════════════════════════════════════════════════════

// GET /dashboard/stats
router.get("/dashboard/stats", adminOnly, asyncHandler(async (req, res) => {
  const since30d = daysAgo(30);
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const todayISO = `${todayStr}T00:00:00.000Z`;

  const [
    { count: total_users,       error: e1 },
    { count: total_instructors, error: e2 },
    { count: total_courses,     error: e3 },
    { count: new_users_30d,     error: e4 },
    { data: reviewData,         error: e5 },
    { data: enrollData,         error: e6 },
    { data: dauData,            error: e7 },
    { data: mauData,            error: e8 },
  ] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).eq("role", "instructor"),
    db.from("courses").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("created_at", since30d),
    db.from("reviews").select("rating"),
    db.from("enrollments").select("progress"),
    db.from("refresh_tokens").select("user_id").gte("created_at", todayISO),
    db.from("refresh_tokens").select("user_id").gte("created_at", since30d),
  ]);

  for (const err of [e1, e2, e3, e4, e5, e6, e7, e8]) {
    if (err) throw err;
  }

  // avg_course_rating
  const avg_course_rating =
    reviewData && reviewData.length > 0
      ? Math.round(
          (reviewData.reduce((sum, r) => sum + (r.rating ?? 0), 0) / reviewData.length) * 10
        ) / 10
      : null;

  // completion stats
  const total_enrollments = enrollData ? enrollData.length : 0;
  const total_completions = enrollData
    ? enrollData.filter((e) => e.progress === 100).length
    : 0;
  const completion_rate =
    total_enrollments > 0
      ? Math.round((total_completions / total_enrollments) * 1000) / 10
      : 0;

  // DAU / MAU — distinct user_ids
  const dau = dauData
    ? new Set(dauData.map((r) => r.user_id)).size
    : 0;
  const mau = mauData
    ? new Set(mauData.map((r) => r.user_id)).size
    : 0;

  ok(res, {
    total_users,
    total_instructors,
    total_courses,
    new_users_30d,
    avg_course_rating,
    total_completions,
    completion_rate,
    dau,
    mau,
  });
}));

// GET /dashboard/login-trends
router.get("/dashboard/login-trends", adminOnly, asyncHandler(async (req, res) => {
  const since = daysAgo(30);

  const { data, error } = await db
    .from("refresh_tokens")
    .select("created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  if (error) throw error;

  // Group by date in JS
  const counts = {};
  for (const row of data ?? []) {
    const d = toDateStr(row.created_at);
    counts[d] = (counts[d] ?? 0) + 1;
  }

  // Build ordered array for the last 30 days (fill missing days with 0)
  const result = [];
  for (let i = 29; i >= 0; i--) {
    const d = toDateStr(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
    result.push({ date: d, logins: counts[d] ?? 0 });
  }

  ok(res, result);
}));

// ═══════════════════════════════════════════════════════════════════════════
// COURSE DETAILS
// ═══════════════════════════════════════════════════════════════════════════

// The catalogue is the teacher-agent marketplace (edu.marketplace_listings),
// not the legacy public.courses table. Categories = distinct listing subjects.
const listings = () => db.schema("edu").from("marketplace_listings");

// GET /courses/categories  — must be defined BEFORE /courses/:id
router.get("/courses/categories", adminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await listings()
    .select("subject")
    .not("subject", "is", null);

  if (error) throw error;

  const categories = [...new Set((data ?? []).map((r) => r.subject).filter(Boolean))].sort();
  ok(res, categories);
}));

// GET /courses/:id  — listing detail. The accordion renders modules→lessons, so
// we surface the topics covered as a single "Topics covered" module.
router.get("/courses/:id", adminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: l, error: ce } = await listings()
    .select("id,title,description,subject,topics_covered,preview_topics,price_kobo,is_active,total_students,total_sessions,teacher_id,teacher_name,style_summary,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();

  if (ce) throw ce;
  if (!l) return err404(res, "Course not found");

  const topics = (l.topics_covered && l.topics_covered.length ? l.topics_covered : l.preview_topics) || [];
  const modules = topics.length
    ? [{ id: "topics", title: "Topics covered", lessons: topics.map((t, i) => ({ id: `t${i}`, title: t })) }]
    : [];

  ok(res, {
    id: l.id,
    title: l.title,
    description: l.description,
    subject: l.subject,
    topic: l.subject,
    status: l.is_active ? "published" : "archived",
    is_published: !!l.is_active,
    price: (l.price_kobo ?? 0) / 100,
    enrolled_count: l.total_students ?? 0,
    total_sessions: l.total_sessions ?? 0,
    instructor: { id: l.teacher_id, full_name: l.teacher_name || null },
    instructor_name: l.teacher_name || null,
    style_summary: l.style_summary || null,
    created_at: l.created_at,
    updated_at: l.updated_at,
    modules,
  });
}));

// POST /courses/:id/modules
router.post("/courses/:id/modules", adminOnly, asyncHandler(async (req, res) => {
  const { id: course_id } = req.params;
  const { title, order_index } = req.body;

  if (!title) return err400(res, "title is required");

  const { data, error } = await db
    .from("course_modules")
    .insert({ course_id, title, order_index: order_index ?? 0 })
    .select()
    .maybeSingle();

  if (error) throw error;
  ok201(res, data);
}));

// POST /courses/:id/modules/:moduleId/lessons
router.post("/courses/:id/modules/:moduleId/lessons", adminOnly, asyncHandler(async (req, res) => {
  const { moduleId: module_id } = req.params;
  const { title, lesson_type, duration_seconds, order_index, content_json } = req.body;

  if (!title) return err400(res, "title is required");

  const { data, error } = await db
    .from("lessons")
    .insert({
      module_id,
      title,
      lesson_type:       lesson_type       ?? null,
      duration_seconds:  duration_seconds  ?? null,
      order_index:       order_index       ?? 0,
      content_json:      content_json      ?? null,
    })
    .select()
    .maybeSingle();

  if (error) throw error;
  ok201(res, data);
}));

// ═══════════════════════════════════════════════════════════════════════════
// USER DETAILS
// ═══════════════════════════════════════════════════════════════════════════

// GET /users/:id/enrollments
router.get("/users/:id/enrollments", adminOnly, asyncHandler(async (req, res) => {
  const { id: user_id } = req.params;

  // Enrollments with course info
  const { data: enrollments, error: ee } = await db
    .from("enrollments")
    .select(
      "id,course_id,progress,enrolled_at,status," +
      "course:courses(title,subject)"
    )
    .eq("user_id", user_id)
    .order("enrolled_at", { ascending: false });

  if (ee) throw ee;

  // Fetch completed lesson counts per course for this user
  const courseIds = (enrollments ?? []).map((e) => e.course_id);
  let completedMap = {};

  if (courseIds.length > 0) {
    // lesson_progress → join lessons → join course_modules to get course_id
    const { data: lpData, error: lpe } = await db
      .from("lesson_progress")
      .select(
        "completed," +
        "lesson:lessons(module:course_modules(course_id))"
      )
      .eq("user_id", user_id)
      .eq("completed", true);

    if (lpe) throw lpe;

    for (const lp of lpData ?? []) {
      const cid = lp.lesson?.module?.course_id;
      if (cid) completedMap[cid] = (completedMap[cid] ?? 0) + 1;
    }
  }

  const result = (enrollments ?? []).map((e) => ({
    course_id:          e.course_id,
    title:              e.course?.title   ?? null,
    subject:            e.course?.subject ?? null,
    progress:           e.progress,
    enrolled_at:        e.enrolled_at,
    status:             e.status,
    lessons_completed:  completedMap[e.course_id] ?? 0,
  }));

  ok(res, result);
}));

// POST /users/invite  — must come BEFORE /users/:id routes if router is separate
router.post("/users/invite", adminOnly, asyncHandler(async (req, res) => {
  const { email, role, full_name } = req.body;

  if (!email)     return err400(res, "email is required");
  if (!role)      return err400(res, "role is required");
  if (!full_name) return err400(res, "full_name is required");
  if (!["student", "instructor"].includes(role))
    return err400(res, "role must be student or instructor");

  // Check for existing user
  const { data: existing, error: fe } = await db
    .from("users")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  if (fe) throw fe;
  if (existing) return err409(res, "User already exists");

  // users.username and users.password_hash are NOT NULL: derive a unique
  // username like /users/create does, and lock the password to a random
  // secret (invite accounts set their own password later).
  const cleanEmail = email.toLowerCase().trim();
  const base = (cleanEmail.split("@")[0] || "user").replace(/[^a-z0-9_]/g, "_").slice(0, 30) || "user";
  let username = `${base}_${Date.now().toString(36).slice(-4)}`;
  const { data: clash } = await db.from("users").select("id").eq("username", username).maybeSingle();
  if (clash) username = `${username}_${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash(genPassword() + genPassword(), BCRYPT_ROUNDS);

  const { data, error } = await db
    .from("users")
    .insert({
      email:                 cleanEmail,
      username,
      password_hash:         passwordHash,
      full_name,
      role,
      is_active:             true,
      onboarding_completed:  false,
      created_at:            new Date().toISOString(),
    })
    .select("id,email,full_name,role,is_active,onboarding_completed,created_at")
    .maybeSingle();

  if (error) throw error;
  ok201(res, data);
}));

// POST /users/invite-csv
router.post("/users/invite-csv", adminOnly, asyncHandler(async (req, res) => {
  const { rows } = req.body;

  if (!Array.isArray(rows) || rows.length === 0)
    return err400(res, "rows must be a non-empty array");

  const errors  = [];
  const valid   = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.email) {
      errors.push({ index: i, reason: "missing email", row });
      continue;
    }
    if (row.role && !["student", "instructor", "school_admin"].includes(row.role)) {
      errors.push({ index: i, reason: "invalid role", row });
      continue;
    }
    valid.push({
      email:     row.email.toLowerCase().trim(),
      full_name: row.full_name ?? null,
      role:      row.role ?? "student",
    });
  }

  if (valid.length === 0) {
    return ok(res, { invited: 0, skipped: 0, errors });
  }

  // Filter out existing emails in one query
  const emailList = valid.map((r) => r.email);
  const { data: existingUsers, error: ee } = await db
    .from("users")
    .select("email")
    .in("email", emailList);

  if (ee) throw ee;

  const existingEmails = new Set((existingUsers ?? []).map((u) => u.email));
  const toInsert = valid.filter((r) => !existingEmails.has(r.email));
  const skipped  = valid.length - toInsert.length;

  let invited = 0;
  if (toInsert.length > 0) {
    const now = new Date().toISOString();
    // users.username and users.password_hash are NOT NULL: derive a unique
    // username per row and lock each password to a random secret (invite
    // accounts set their own password later).
    const stamp = Date.now().toString(36).slice(-4);
    const rows = await Promise.all(toInsert.map(async (r, i) => {
      const base = (r.email.split("@")[0] || "user").replace(/[^a-z0-9_]/g, "_").slice(0, 30) || "user";
      return {
        email:                r.email,
        username:             `${base}_${stamp}${i}`,
        password_hash:        await bcrypt.hash(genPassword() + genPassword(), BCRYPT_ROUNDS),
        full_name:            r.full_name,
        role:                 r.role,
        is_active:            true,
        onboarding_completed: false,
        created_at:           now,
      };
    }));
    const { data: clashRows } = await db.from("users").select("username").in("username", rows.map((r) => r.username));
    if (clashRows?.length) {
      const taken = new Set(clashRows.map((u) => u.username));
      for (const r of rows) if (taken.has(r.username)) r.username = `${r.username}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const { data: inserted, error: ie } = await db
      .from("users")
      .insert(rows)
      .select("id");

    if (ie) throw ie;
    invited = inserted?.length ?? 0;
  }

  ok(res, { invited, skipped, errors });
}));

// POST /users/create
// Create a real, ready-to-login account (learner / instructor / school / admin).
// Sets a password (auto-generated if none given) and emails the person the
// correct portal sign-in link. Returns the temp password when generated so the
// admin can share it.
const CREATE_ROLES = ["student", "instructor", "school_admin", "admin"];
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? "12", 10);
const FRONTEND_URL            = urlFor("FRONTEND_URL");
const INSTRUCTOR_FRONTEND_URL = urlFor("INSTRUCTOR_FRONTEND_URL");
const ADMIN_FRONTEND_URL      = urlFor("ADMIN_FRONTEND_URL");
const SCHOOL_FRONTEND_URL     = urlFor("SCHOOL_FRONTEND_URL");

const genPassword = () =>
  Array.from({ length: 12 }, () =>
    "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789".charAt(
      Math.floor(Math.random() * 54))).join("");

router.post("/users/create", adminOnly, asyncHandler(async (req, res) => {
  const email     = String(req.body.email || "").toLowerCase().trim();
  const fullName  = String(req.body.full_name || "").trim();
  const role      = req.body.role || "student";
  const provided  = req.body.password ? String(req.body.password) : "";

  if (!email)    return err400(res, "email is required");
  if (!fullName) return err400(res, "full_name is required");
  if (!CREATE_ROLES.includes(role))
    return err400(res, "role must be student, instructor, school_admin or admin");
  if (provided && provided.length < 8)
    return err400(res, "password must be at least 8 characters");

  const { data: existing } = await db.from("users").select("id").eq("email", email).maybeSingle();
  if (existing) return err409(res, "A user with this email already exists");

  // Unique username derived from the email local-part.
  const base = (email.split("@")[0] || "user").replace(/[^a-z0-9_]/g, "_").slice(0, 30) || "user";
  let username = `${base}_${Date.now().toString(36).slice(-4)}`;
  const { data: clash } = await db.from("users").select("id").eq("username", username).maybeSingle();
  if (clash) username = `${username}_${Math.random().toString(36).slice(2, 6)}`;

  const password     = provided || genPassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const { data: user, error } = await db.from("users").insert({
    email, username,
    password_hash:        passwordHash,
    full_name:            fullName,
    role,
    is_active:            true,
    email_verified:       false,
    onboarding_completed: false,
    created_at:           new Date().toISOString(),
  }).select("id,email,full_name,username,role,is_active,created_at").single();

  if (error) throw error;

  const loginUrl = role === "instructor"   ? `${INSTRUCTOR_FRONTEND_URL}/signin`
    : role === "school_admin"              ? `${SCHOOL_FRONTEND_URL}/signin`
    : role === "admin"                     ? `${ADMIN_FRONTEND_URL}/signin`
    : `${FRONTEND_URL}/signin`;
  sendWelcomeEmail({ to: user.email, name: user.full_name || user.username, loginUrl, role }).catch(() => {});

  // Only reveal the password when we generated it — never echo a chosen one.
  ok201(res, { ...user, tempPassword: provided ? undefined : password, loginUrl });
}));

// ═══════════════════════════════════════════════════════════════════════════
// INSTRUCTOR PAYOUTS
// ═══════════════════════════════════════════════════════════════════════════

// GET /payouts/summary  — must be defined BEFORE /payouts/:id
router.get("/payouts/summary", adminOnly, asyncHandler(async (req, res) => {
  // Fetch all earnings
  const { data: earnings, error: ee } = await db
    .from("instructor_earnings")
    .select("instructor_id,net_amount,status");

  if (ee) throw ee;

  // Group by instructor_id
  const groupMap = {};
  for (const row of earnings ?? []) {
    const iid = row.instructor_id;
    if (!groupMap[iid]) {
      groupMap[iid] = { instructor_id: iid, total_earned: 0, pending_amount: 0, paid_amount: 0, course_count: 0 };
    }
    const amt = Number(row.net_amount) || 0;
    groupMap[iid].total_earned += amt;
    if (row.status === "pending" || row.status === "on_hold") groupMap[iid].pending_amount += amt;
    if (row.status === "paid")                               groupMap[iid].paid_amount   += amt;
    groupMap[iid].course_count += 1;
  }

  const instructorIds = Object.keys(groupMap);
  if (instructorIds.length === 0) return ok(res, []);

  // Fetch user names
  const { data: users, error: ue } = await db
    .from("users")
    .select("id,full_name,email")
    .in("id", instructorIds);

  if (ue) throw ue;

  const userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u]));

  const result = Object.values(groupMap)
    .map((g) => ({
      ...g,
      full_name: userMap[g.instructor_id]?.full_name ?? null,
      email:     userMap[g.instructor_id]?.email     ?? null,
      total_earned:   Math.round(g.total_earned   * 100) / 100,
      pending_amount: Math.round(g.pending_amount * 100) / 100,
      paid_amount:    Math.round(g.paid_amount    * 100) / 100,
    }))
    .sort((a, b) => b.total_earned - a.total_earned);

  ok(res, result);
}));

// GET /payouts
router.get("/payouts", adminOnly, asyncHandler(async (req, res) => {
  const { status, instructor_id, limit = 50, offset = 0 } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;

  let q = db
    .from("instructor_earnings")
    .select(
      "id,instructor_id,course_id,net_amount,status,payout_id,created_at," +
      "instructor:users!instructor_id(full_name,email)," +
      "course:courses(title)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(off, off + lim - 1);

  if (status)        q = q.eq("status", status);
  if (instructor_id) q = q.eq("instructor_id", instructor_id);

  const { data, count, error } = await q;
  if (error) throw error;
  ok(res, data, { total: count, limit: lim, offset: off });
}));

// PATCH /payouts/:id/mark-paid
router.patch("/payouts/:id/mark-paid", adminOnly, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { payout_id } = req.body;

  const { data, error } = await db
    .from("instructor_earnings")
    .update({ status: "paid", payout_id: payout_id ?? null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) return err404(res, "Payout not found");
  ok(res, data);
}));

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS EXTENDED
// ═══════════════════════════════════════════════════════════════════════════

// GET /analytics/engagement
router.get("/analytics/engagement", adminOnly, asyncHandler(async (req, res) => {
  const [
    { data: enrollData,  error: e1 },
    { data: lpData,      error: e2 },
  ] = await Promise.all([
    db.from("enrollments").select("progress"),
    db.from("lesson_progress").select("completed,last_position_seconds,lesson_id").eq("completed", true),
  ]);

  if (e1) throw e1;
  if (e2) throw e2;

  // avg_completion_rate
  const avg_completion_rate =
    enrollData && enrollData.length > 0
      ? Math.round(
          (enrollData.reduce((s, r) => s + (r.progress ?? 0), 0) / enrollData.length) * 10
        ) / 10
      : 0;

  // avg_watch_time_minutes and lessons_completed from lesson_progress
  const allLp = lpData ?? [];
  const lessons_completed = allLp.length;
  const avg_watch_time_minutes =
    allLp.length > 0
      ? Math.round(
          (allLp.reduce((s, r) => s + (r.last_position_seconds ?? 0), 0) / allLp.length / 60) * 10
        ) / 10
      : 0;

  // top_lessons: top 5 by completion count
  const lessonCounts = {};
  for (const lp of allLp) {
    lessonCounts[lp.lesson_id] = (lessonCounts[lp.lesson_id] ?? 0) + 1;
  }

  const topLessonIds = Object.entries(lessonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  let top_lessons = [];
  if (topLessonIds.length > 0) {
    const { data: lessonRows, error: le } = await db
      .from("lessons")
      .select("id,title")
      .in("id", topLessonIds);

    if (le) throw le;

    const lessonTitleMap = Object.fromEntries((lessonRows ?? []).map((l) => [l.id, l.title]));
    top_lessons = topLessonIds.map((id) => ({
      lesson_id:   id,
      title:       lessonTitleMap[id] ?? null,
      completions: lessonCounts[id],
    }));
  }

  ok(res, { avg_completion_rate, avg_watch_time_minutes, lessons_completed, top_lessons });
}));

// GET /analytics/top-instructors
router.get("/analytics/top-instructors", adminOnly, asyncHandler(async (req, res) => {
  const { data: earnings, error: ee } = await db
    .from("instructor_earnings")
    .select("instructor_id,net_amount");

  if (ee) throw ee;

  // Aggregate by instructor_id
  const totals = {};
  for (const row of earnings ?? []) {
    const iid = row.instructor_id;
    totals[iid] = (totals[iid] ?? 0) + (Number(row.net_amount) || 0);
  }

  const topIds = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  if (topIds.length === 0) return ok(res, []);

  const { data: users, error: ue } = await db
    .from("users")
    .select("id,full_name,email")
    .in("id", topIds);

  if (ue) throw ue;

  const userMap = Object.fromEntries((users ?? []).map((u) => [u.id, u]));

  const result = topIds.map((id) => ({
    instructor_id: id,
    full_name:     userMap[id]?.full_name ?? null,
    email:         userMap[id]?.email     ?? null,
    total_earned:  Math.round(totals[id] * 100) / 100,
  }));

  ok(res, result);
}));

// ═══════════════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════════════

// GET /reports/revenue-export
router.get("/reports/revenue-export", adminOnly, asyncHandler(async (req, res) => {
  const { period = "30d" } = req.query;
  const since = periodStart(period);

  const { data, error } = await db
    .from("payments")
    .select(
      "id,amount,currency,status,created_at,payment_method," +
      "user:users!user_id(email,full_name)," +
      "course:courses!course_id(title,subject)"
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const result = (data ?? []).map((p) => ({
    id:             p.id,
    amount:         p.amount,
    currency:       p.currency,
    status:         p.status,
    payment_method: p.payment_method,
    created_at:     p.created_at,
    user_email:     p.user?.email     ?? null,
    user_name:      p.user?.full_name ?? null,
    course_title:   p.course?.title   ?? null,
    course_subject: p.course?.subject ?? null,
  }));

  ok(res, result, { period, since });
}));

// GET /reports/enrollments-export
router.get("/reports/enrollments-export", adminOnly, asyncHandler(async (req, res) => {
  const { period = "30d" } = req.query;
  const since = periodStart(period);

  const { data, error } = await db
    .from("enrollments")
    .select(
      "id,course_id,progress,enrolled_at,status," +
      "user:users!user_id(email,full_name)," +
      "course:courses!course_id(title,subject)"
    )
    .gte("enrolled_at", since)
    .order("enrolled_at", { ascending: false });

  if (error) throw error;

  const result = (data ?? []).map((e) => ({
    id:             e.id,
    course_id:      e.course_id,
    progress:       e.progress,
    enrolled_at:    e.enrolled_at,
    status:         e.status,
    user_email:     e.user?.email     ?? null,
    user_name:      e.user?.full_name ?? null,
    course_title:   e.course?.title   ?? null,
    course_subject: e.course?.subject ?? null,
  }));

  ok(res, result, { period, since });
}));

export default router;
