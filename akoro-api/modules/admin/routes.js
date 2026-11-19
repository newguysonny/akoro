/**
 * modules/admin/routes.js  —  Akoro Admin API
 *
 * All routes require role=admin.
 *
 *   GET    /api/admin/stats                         platform overview counts
 *
 *   GET    /api/admin/users                         list users (?search=&role=&limit=&offset=)
 *   GET    /api/admin/users/:id                     get user
 *   PATCH  /api/admin/users/:id                     update user fields
 *   DELETE /api/admin/users/:id                     delete user
 *
 *   GET    /api/admin/instructors                   list instructors (?search=&status=&limit=&offset=)
 *   PATCH  /api/admin/instructors/:id/verify        set is_verified=true
 *   PATCH  /api/admin/instructors/:id/suspend       set is_active=false
 *
 *   GET    /api/admin/schools                        list schools (?search=&status=&limit=&offset=)
 *   PATCH  /api/admin/schools/:id/verify             set verification_status=verified
 *   PATCH  /api/admin/schools/:id/reject             set verification_status=rejected
 *
 *   GET    /api/admin/courses                       list courses (?search=&limit=&offset=)
 *   PATCH  /api/admin/courses/:id                   update course fields
 *   DELETE /api/admin/courses/:id                   delete course
 */

import { Router }                         from "express";
import { body, query, validationResult }  from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken, requireRole, invalidateCachedUser } from "../auth/index.js";
import { notify }                         from "../notifications/index.js";
import { usageSnapshot }                  from "../../lib/usageMeter.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const ok     = (res, data, meta = {}) => res.json({ success: true, data, ...meta });
const ok201  = (res, data)            => res.status(201).json({ success: true, data });
const err400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const err404 = (res, msg = "Not found") => res.status(404).json({ success: false, message: msg });

const validate = (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) { err400(res, errs.array()[0].msg); return false; }
  return true;
};

// ── Stats ────────────────────────────────────────────────────────────────────

// GET /api/admin/usage — where the DB "command" quota is going, per route.
router.get("/usage", adminOnly, asyncHandler(async (req, res) => {
  ok(res, usageSnapshot({ topN: Math.min(Number(req.query.top) || 12, 50) }));
}));

router.get("/stats", adminOnly, asyncHandler(async (req, res) => {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
  const monthStart = new Date(Date.UTC(y, m, 1)).toISOString();
  const todayStart = new Date(Date.UTC(y, m, d)).toISOString();
  const yesterdayStart = new Date(Date.UTC(y, m, d - 1)).toISOString();
  const weekAgo = new Date(Date.UTC(y, m, d - 7)).toISOString();
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const prevMonthStart = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const prevMonthSame = new Date(Date.UTC(y, m - 1, d + 1)).toISOString();

  const safe = async (promise, fallback = null) => {
    try { const r = await promise; return r?.error ? fallback : (r?.data ?? fallback); } catch { return fallback; }
  };
  const countSafe = async (promise) => {
    try { const r = await promise; return r?.error ? null : (r?.count ?? 0); } catch { return null; }
  };
  const sum = (rows, key = "amount_paid") => (rows || []).reduce((n, r) => n + Number(r?.[key] || 0), 0);

  const [
    totalUsers, totalInstructors, totalCourses, totalStudents, newUsers,
    revenueRows, prevRevenueRows, aiRows, aiYesterdayRows,
    onlineRows, visitRows, totalVisits, approvals,
    paid, pending, refunded, failed,
    featureRows,
  ] = await Promise.all([
    countSafe(db.from("users").select("*", { count: "exact", head: true })),
    countSafe(db.from("users").select("*", { count: "exact", head: true }).eq("role", "instructor")),
    countSafe(db.from("courses").select("*", { count: "exact", head: true })),
    countSafe(db.from("users").select("*", { count: "exact", head: true }).eq("role", "student")),
    countSafe(db.from("users").select("*", { count: "exact", head: true }).gte("created_at", weekAgo)),
    safe(db.from("payments").select("amount_paid").eq("status", "success").gte("created_at", monthStart), []),
    safe(db.from("payments").select("amount_paid").eq("status", "success").gte("created_at", prevMonthStart).lt("created_at", prevMonthSame), []),
    safe(db.schema("edu").from("ai_call_log").select("cost_usd").gte("created_at", todayStart), []),
    safe(db.schema("edu").from("ai_call_log").select("cost_usd").gte("created_at", yesterdayStart).lt("created_at", todayStart), []),
    safe(db.from("refresh_tokens").select("user_id").gte("created_at", fifteenMinAgo), []),
    safe(db.from("refresh_tokens").select("user_id").gte("created_at", todayStart), []),
    countSafe(db.from("refresh_tokens").select("*", { count: "exact", head: true })),
    countSafe(db.schema("edu").from("builder_courses").select("*", { count: "exact", head: true }).eq("status", "review")),
    countSafe(db.from("payments").select("*", { count: "exact", head: true }).eq("status", "success")),
    countSafe(db.from("payments").select("*", { count: "exact", head: true }).eq("status", "pending")),
    countSafe(db.from("payments").select("*", { count: "exact", head: true }).eq("status", "refunded")),
    countSafe(db.from("payments").select("*", { count: "exact", head: true }).eq("status", "failed")),
    safe(db.schema("edu").rpc("ai_spend_by_feature", { p_hours: 24 * 30 }), []),
  ]);

  const revenueMtd = sum(revenueRows) / 100;               // kobo → naira
  const revenuePrev = sum(prevRevenueRows) / 100;
  const aiToday = sum(aiRows, "cost_usd");
  const aiYesterday = sum(aiYesterdayRows, "cost_usd");
  const online = new Set((onlineRows || []).map((r) => r.user_id)).size;
  const visitsToday = new Set((visitRows || []).map((r) => r.user_id)).size;
  const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

  // Most-used features over the last 30 days (by AI call volume — the platform's
  // per-feature telemetry). Bounded: the RPC caps at 50 rows, we keep the top 5.
  const topFeatures = (featureRows || [])
    .map((r) => ({ feature: r.feature || "unattributed", count: Number(r.calls) || 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  ok(res, {
    totalUsers, totalInstructors, totalCourses, totalStudents, newUsers,
    new_users_7d: newUsers,
    revenue_mtd: revenueMtd,
    revenue_prev_mtd: revenuePrev,
    revenue_currency: "NGN",
    revenue_change_pct: pct(revenueMtd, revenuePrev),
    ai_spend_today_usd: Math.round(aiToday * 10000) / 10000,
    ai_spend_yesterday_usd: Math.round(aiYesterday * 10000) / 10000,
    ai_spend_change_pct: pct(aiToday, aiYesterday),
    course_approvals: approvals,
    active_users_online: online,
    visits_today: visitsToday,
    total_visits: totalVisits,
    payments_by_status: { success: paid, pending, refunded, failed },
    top_features: topFeatures,
  });
}));

// ── Users ────────────────────────────────────────────────────────────────────

const USER_COLS = "id,email,username,full_name,role,is_active,avatar_url,created_at";

router.get("/users", adminOnly, asyncHandler(async (req, res) => {
  const { search = "", role = "", limit = 50, offset = 0 } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;

  let q = db.from("users").select(USER_COLS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(off, off + lim - 1);

  if (role) q = q.eq("role", role);
  if (search) { const s = String(search).replace(/[,()%*:\\]/g, " "); q = q.or(`email.ilike.%${s}%,full_name.ilike.%${s}%,username.ilike.%${s}%`); }

  const { data, count, error } = await q;
  if (error) throw error;
  ok(res, data, { total: count, limit: lim, offset: off });
}));

router.get("/users/:id", adminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await db.from("users").select(USER_COLS).eq("id", req.params.id).maybeSingle();
  if (error) throw error;
  if (!data) return err404(res, "User not found");
  ok(res, data);
}));

router.patch("/users/:id",
  ...adminOnly,
  body("is_active").optional().isBoolean(),
  body("role").optional().isIn(["student", "instructor", "admin"]),
  body("full_name").optional().isString().trim(),
  asyncHandler(async (req, res) => {
    if (!validate(req, res)) return;
    const allowed = ["is_active", "role", "full_name", "avatar_url"];
    const patch = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    if (!Object.keys(patch).length) return err400(res, "No valid fields to update");

    const { data, error } = await db.from("users")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select(USER_COLS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return err404(res, "User not found");
    ok(res, data);
  })
);

router.delete("/users/:id", adminOnly, asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id)
    return err400(res, "Cannot delete your own account");

  const { error } = await db.from("users").delete().eq("id", req.params.id);
  if (error) throw error;
  ok(res, { deleted: true });
}));

router.post("/users/:id/force-logout", adminOnly, asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id)
    return err400(res, "Cannot force-logout yourself");

  const now = new Date().toISOString();

  // 1. Stamp force_logout_at — authenticateToken rejects tokens issued before this
  await db.from("users")
    .update({ force_logout_at: now, updated_at: now })
    .eq("id", req.params.id);
  invalidateCachedUser(req.params.id);   // security field — never serve it stale

  // 2. Delete all refresh tokens so the user cannot obtain new access tokens
  await db.from("refresh_tokens").delete().eq("user_id", req.params.id);

  ok(res, { forced: true, at: now });
}));

// ── Instructors ──────────────────────────────────────────────────────────────

const INSTRUCTOR_COLS = "id,email,username,full_name,avatar_url,is_active,created_at,school_name,bio";

router.get("/instructors", adminOnly, asyncHandler(async (req, res) => {
  const { search = "", status = "", limit = 50, offset = 0 } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;

  let q = db.from("users").select(INSTRUCTOR_COLS, { count: "exact" })
    .eq("role", "instructor")
    .order("created_at", { ascending: false })
    .range(off, off + lim - 1);

  if (status === "active")    q = q.eq("is_active", true);
  if (status === "suspended") q = q.eq("is_active", false);
  if (search) { const s = String(search).replace(/[,()%*:\\]/g, " "); q = q.or(`email.ilike.%${s}%,full_name.ilike.%${s}%,username.ilike.%${s}%`); }

  const { data, count, error } = await q;
  if (error) throw error;
  ok(res, data, { total: count, limit: lim, offset: off });
}));

router.patch("/instructors/:id/verify", adminOnly, asyncHandler(async (req, res) => {
  const { data, error } = await db.from("users")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("role", "instructor")
    .select(INSTRUCTOR_COLS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return err404(res, "Instructor not found");
  invalidateCachedUser(req.params.id);   // security field — never serve it stale
  ok(res, data);
}));

router.patch("/instructors/:id/suspend", adminOnly, asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) return err400(res, "Cannot suspend yourself");
  const { data, error } = await db.from("users")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("role", "instructor")
    .select(INSTRUCTOR_COLS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return err404(res, "Instructor not found");
  invalidateCachedUser(req.params.id);   // security field — never serve it stale
  ok(res, data);
}));

// ── Schools ──────────────────────────────────────────────────────────────────
// Verify schools that sign up before they go live (mirrors instructor verify).

const SCHOOL_BASE_COLS =
  "id,name,logo_url,website,address,phone,is_active,verification_status,verified_at,created_at,admin_user_id";
const SCHOOL_COLS =
  SCHOOL_BASE_COLS + ",admin:users!school_profiles_admin_user_id_fkey(id,full_name,email)";

// Attach the admin user object by a separate lookup — used when the embedded
// join can't be resolved by PostgREST (stale relationship cache), so the list
// still renders instead of failing wholesale.
async function stitchUsers(rows, fkKey, asKey) {
  const ids = [...new Set(rows.map((r) => r[fkKey]).filter(Boolean))];
  if (!ids.length) return rows.map((r) => ({ ...r, [asKey]: null }));
  const { data: users } = await db.from("users").select("id,full_name,email").in("id", ids);
  const byId = Object.fromEntries((users || []).map((u) => [u.id, u]));
  return rows.map((r) => ({ ...r, [asKey]: byId[r[fkKey]] || null }));
}

router.get("/schools", adminOnly, asyncHandler(async (req, res) => {
  const { search = "", status = "", limit = 50, offset = 0 } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;

  const build = (cols) => {
    let q = db.from("school_profiles").select(cols, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(off, off + lim - 1);
    if (["pending", "pilot", "verified", "rejected"].includes(status)) q = q.eq("verification_status", status);
    if (search) { const s = String(search).replace(/[,()%*:\\]/g, " "); q = q.or(`name.ilike.%${s}%,website.ilike.%${s}%,address.ilike.%${s}%`); }
    return q;
  };

  let { data, count, error } = await build(SCHOOL_COLS);
  if (error) {
    // Embedded join failed — fall back to a plain select + manual stitch.
    ({ data, count, error } = await build(SCHOOL_BASE_COLS));
    if (error) throw error;
    data = await stitchUsers(data || [], "admin_user_id", "admin");
  }
  ok(res, data, { total: count, limit: lim, offset: off });
}));

const setSchoolStatus = (status) => asyncHandler(async (req, res) => {
  const { data, error } = await db.from("school_profiles")
    .update({
      verification_status: status,
      verified_at:         status === "verified" ? new Date().toISOString() : null,
      updated_at:          new Date().toISOString(),
    })
    .eq("id", req.params.id)
    .select(SCHOOL_COLS)
    .maybeSingle();
  if (error) throw error;
  if (!data) return err404(res, "School not found");

  // Notify the school admin of the verification decision.
  if (data.admin?.id) {
    if (status === "verified") notify.schoolVerified({ userId: data.admin.id, schoolName: data.name });
    else if (status === "rejected") notify.schoolRejected({ userId: data.admin.id, schoolName: data.name });
  }
  ok(res, data);
});

router.patch("/schools/:id/verify", adminOnly, setSchoolStatus("verified"));
router.patch("/schools/:id/reject", adminOnly, setSchoolStatus("rejected"));

// ── Courses ──────────────────────────────────────────────────────────────────
// The platform's catalogue is the teacher-agent marketplace (edu.marketplace_
// listings), NOT the legacy public.courses table (which the app never writes
// to). Admin "Courses" therefore reads/moderates marketplace listings, mapped
// to the shape the admin UI expects (instructor / enrolled / price / status).

const listings = () => db.schema("edu").from("marketplace_listings");
const LISTING_COLS =
  "id,title,description,subject,topics_covered,price_kobo,is_active,total_students,total_sessions,teacher_id,teacher_name,created_at,updated_at";

// Map a marketplace listing → the admin course row shape.
const mapListing = (l) => ({
  id: l.id,
  title: l.title,
  description: l.description,
  subject: l.subject,
  topic: l.subject,
  instructor_id: l.teacher_id,
  instructor_name: l.teacher_name || null,
  instructor: { id: l.teacher_id, full_name: l.teacher_name || null },
  enrolled_count: l.total_students ?? 0,
  total_sessions: l.total_sessions ?? 0,
  price: (l.price_kobo ?? 0) / 100,
  status: l.is_active ? "published" : "archived",
  is_published: !!l.is_active,
  created_at: l.created_at,
  updated_at: l.updated_at,
});

router.get("/courses", adminOnly, asyncHandler(async (req, res) => {
  const { search = "", status = "", limit = 50, offset = 0 } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;

  let q = listings().select(LISTING_COLS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(off, off + lim - 1);
  if (status === "published") q = q.eq("is_active", true);
  else if (status === "archived" || status === "draft") q = q.eq("is_active", false);
  if (search) { const s = String(search).replace(/[,()%*:\\]/g, " "); q = q.or(`title.ilike.%${s}%,subject.ilike.%${s}%,description.ilike.%${s}%`); }

  const { data, count, error } = await q;
  if (error) throw error;
  ok(res, (data || []).map(mapListing), { total: count, limit: lim, offset: off });
}));

router.patch("/courses/:id",
  ...adminOnly,
  body("status").optional().isString(),
  body("is_published").optional().isBoolean(),
  asyncHandler(async (req, res) => {
    if (!validate(req, res)) return;
    const patch = {};
    if (req.body.title != null) patch.title = req.body.title;
    if (req.body.description != null) patch.description = req.body.description;
    if (req.body.price != null && !Number.isNaN(Number(req.body.price)))
      patch.price_kobo = Math.round(Number(req.body.price) * 100);
    if (req.body.is_published != null) patch.is_active = !!req.body.is_published;
    else if (req.body.status != null)
      patch.is_active = ["published", "approved", "live", "active"].includes(req.body.status);
    if (!Object.keys(patch).length) return err400(res, "No valid fields to update");

    const { data, error } = await listings()
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select(LISTING_COLS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return err404(res, "Course not found");

    // Notify the instructor of a moderation decision.
    if (data.teacher_id) {
      if (patch.is_active === true) notify.courseApproved({ instructorId: data.teacher_id, courseTitle: data.title });
      else if (patch.is_active === false) notify.courseRejected({ instructorId: data.teacher_id, courseTitle: data.title, reason: req.body.reason });
    }
    ok(res, mapListing(data));
  })
);

router.delete("/courses/:id", adminOnly, asyncHandler(async (req, res) => {
  const { error } = await listings().delete().eq("id", req.params.id);
  if (error) throw error;
  ok(res, { deleted: true });
}));

export default router;
