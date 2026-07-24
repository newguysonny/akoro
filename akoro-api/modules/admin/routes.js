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
import { authenticateToken, requireRole } from "../auth/routes.js";
import { notify }                         from "../notifications/events.js";

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

router.get("/stats", adminOnly, asyncHandler(async (req, res) => {
  const [
    { count: totalUsers },
    { count: totalInstructors },
    { count: totalCourses },
    { count: totalStudents },
  ] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).eq("role", "instructor"),
    db.from("courses").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).eq("role", "student"),
  ]);

  // recent signups (last 30 days)
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: newUsers } = await db.from("users")
    .select("*", { count: "exact", head: true })
    .gte("created_at", since);

  ok(res, { totalUsers, totalInstructors, totalCourses, totalStudents, newUsers });
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
  if (search) q = q.or(`email.ilike.%${search}%,full_name.ilike.%${search}%,username.ilike.%${search}%`);

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
  if (search) q = q.or(`email.ilike.%${search}%,full_name.ilike.%${search}%,username.ilike.%${search}%`);

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
    if (["pending", "verified", "rejected"].includes(status)) q = q.eq("verification_status", status);
    if (search) q = q.or(`name.ilike.%${search}%,website.ilike.%${search}%,address.ilike.%${search}%`);
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

const COURSE_BASE_COLS = "id,title,description,topic,subject,status,is_published,created_at,instructor_id";
const COURSE_COLS = COURSE_BASE_COLS + ",instructor:users!instructor_id(id,full_name,email)";

router.get("/courses", adminOnly, asyncHandler(async (req, res) => {
  const { search = "", limit = 50, offset = 0 } = req.query;
  const lim = Math.min(Number(limit) || 50, 200);
  const off = Number(offset) || 0;

  const build = (cols) => {
    let q = db.from("courses").select(cols, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(off, off + lim - 1);
    if (search) q = q.or(`title.ilike.%${search}%,topic.ilike.%${search}%,subject.ilike.%${search}%`);
    return q;
  };

  let { data, count, error } = await build(COURSE_COLS);
  if (error) {
    // Embedded join failed — fall back to a plain select + manual stitch.
    ({ data, count, error } = await build(COURSE_BASE_COLS));
    if (error) throw error;
    data = await stitchUsers(data || [], "instructor_id", "instructor");
  }
  ok(res, data, { total: count, limit: lim, offset: off });
}));

router.patch("/courses/:id",
  ...adminOnly,
  body("status").optional().isString(),
  body("is_published").optional().isBoolean(),
  asyncHandler(async (req, res) => {
    if (!validate(req, res)) return;
    const allowed = ["status", "is_published", "title", "description"];
    const patch = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k))
    );
    if (!Object.keys(patch).length) return err400(res, "No valid fields to update");

    const { data, error } = await db.from("courses")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select(COURSE_COLS)
      .maybeSingle();
    if (error) throw error;
    if (!data) return err404(res, "Course not found");

    // Notify the instructor of a moderation decision.
    if (data.instructor?.id) {
      if (patch.is_published === true || patch.status === "approved" || patch.status === "published")
        notify.courseApproved({ instructorId: data.instructor.id, courseTitle: data.title });
      else if (patch.status === "rejected" || patch.is_published === false)
        notify.courseRejected({ instructorId: data.instructor.id, courseTitle: data.title, reason: req.body.reason });
    }
    ok(res, data);
  })
);

router.delete("/courses/:id", adminOnly, asyncHandler(async (req, res) => {
  const { error } = await db.from("courses").delete().eq("id", req.params.id);
  if (error) throw error;
  ok(res, { deleted: true });
}));

export default router;
