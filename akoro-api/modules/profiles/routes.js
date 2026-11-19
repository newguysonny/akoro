/**
 * modules/profiles/routes.js  —  Akoro Profiles Module
 *
 * Three profile types on the platform:
 *
 *   Teacher profile
 *     - Gets one classroom on signup (default 20 student slots)
 *     - Adding students beyond 20 requires ₦5,000/month upgrade
 *     - Adding a student auto-creates their platform account
 *     - Teacher app users
 *
 *   School profile
 *     - Created by admin or self-registered
 *     - Can create multiple classrooms
 *     - Can create teacher accounts and link to classrooms
 *     - Unlimited students/learners
 *     - Adding a student auto-creates their platform account
 *     - School/enterprise app users
 *
 *   Admin
 *     - Platform-wide access
 *     - Can view/manage all profiles, classrooms, schools
 *
 * Auto-create flow:
 *   Teacher/school adds a student (name + email/phone) →
 *   System checks if account exists →
 *   If not: creates account with temp password →
 *   Sends welcome email/SMS with credentials →
 *   Student logs in and sets permanent password
 *
 * Layering: this router wires validators and authentication to the service
 * handlers; the services own the flow, rules.js holds pure decisions and
 * store-*.js holds every Supabase query. Ownership checks stay in the store
 * query (teacher_id / school_id / admin_user_id) and in the service before any
 * read or write.
 *
 * Usage in app.js:
 *   import profilesModule from "./modules/profiles/routes.js";
 *   app.use("/api/profiles", profilesModule);
 */

import { Router }                         from "express";
import { body, validationResult }         from "express-validator";
import multerLib                           from "multer";
import { authenticateToken, requireRole } from "../auth/index.js";
import { asyncHandler, res400 }           from "./http.js";
import * as invites                        from "./service-invites.js";
import * as links                          from "./service-links.js";
import * as school                         from "./service-school.js";
import * as settings                       from "./service-settings.js";
import * as students                       from "./service-students.js";
import * as teacher                        from "./service-teacher.js";

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const router = Router();

// Teacher
router.get   ("/teacher/me",                                           authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(teacher.getProfile));
router.get   ("/teacher/classrooms",                                   authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(teacher.listClassrooms));
router.post  ("/teacher/classrooms",                                   authenticateToken, requireRole(["instructor", "admin"]), [body("name").notEmpty()], runValidation, asyncHandler(teacher.createClassroom));
router.get   ("/teacher/classrooms/:classroomId/students",             authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(teacher.listStudents));
router.post  ("/teacher/classrooms/:classroomId/students",             authenticateToken, requireRole(["instructor", "admin"]), [body("name").notEmpty()], runValidation, asyncHandler(teacher.addStudent));
router.delete("/teacher/classrooms/:classroomId/students/:userId",     authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(teacher.removeStudent));
router.post  ("/teacher/classrooms/:classroomId/upgrade",              authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(teacher.upgradeClassroom));

// School
router.post  ("/schools",                                              authenticateToken, [body("name").notEmpty()], runValidation, asyncHandler(school.create));
router.get   ("/schools/:schoolId",                                    authenticateToken, asyncHandler(school.get));
router.get   ("/schools/:schoolId/classrooms",                         authenticateToken, asyncHandler(school.listClassrooms));
router.post  ("/schools/:schoolId/classrooms",                         authenticateToken, [body("name").notEmpty()], runValidation, asyncHandler(school.createClassroom));
router.post  ("/schools/:schoolId/teachers",                           authenticateToken, [body("name").notEmpty()], runValidation, asyncHandler(school.createTeacher));
router.post  ("/schools/:schoolId/classrooms/:classroomId/students",   authenticateToken, [body("name").notEmpty()], runValidation, asyncHandler(school.addStudent));

// Admin
router.get("/admin/schools",                                           authenticateToken, requireRole(["admin"]), asyncHandler(school.listSchools));
router.get("/admin/teachers",                                          authenticateToken, requireRole(["admin"]), asyncHandler(school.listTeachers));

// ─── Student / self settings ──────────────────────────────────────────────────

/** GET /api/profiles/me — full profile + agent + notification prefs */
router.get("/me", authenticateToken, asyncHandler(settings.getMe));

/**
 * GET /api/profiles/me/location — the caller's self-reported location only.
 * This intentionally does not return contact details or infer a timezone.
 */
router.get("/me/location", authenticateToken, asyncHandler(settings.getLocation));

/**
 * PATCH /api/profiles/me/location — update city and/or country for this user.
 * An IANA timezone remains a separate explicit setting because a place name is
 * not a reliable timezone authority.
 */
router.patch("/me/location", authenticateToken, [
  body("city").optional().isString().trim().isLength({ max: 120 }),
  body("country").optional().isString().trim().isLength({ max: 80 }),
], runValidation, asyncHandler(settings.patchLocation));

/** PATCH /api/profiles/me — update user profile fields */
router.patch("/me", authenticateToken, [
  body("fullName").optional().trim().isLength({ min: 1, max: 120 }),
  body("username").optional().trim().isLength({ min: 3, max: 40 }).matches(/^[a-zA-Z0-9_]+$/),
  body("phone").optional().trim(),
  body("avatarEmoji").optional().trim(),
  body("country").optional().trim(),
  body("city").optional().trim().isLength({ max: 120 }),
  body("schoolName").optional().trim(),
  body("schoolType").optional().trim(),
  body("yearGroup").optional().trim(),
  body("studyLevel").optional().trim(),
  body("language").optional().trim(),
  body("timeZone").optional().trim().isLength({ min: 1, max: 80 }),
  body("displayMode").optional().isIn(["light","dark","system"]),
  body("accentColor").optional().trim(),
  body("teachingGuide").optional().trim(),
  body("guideEmoji").optional().trim(),
  body("subjects").optional().isArray(),
  body("twoFactorEnabled").optional().isBoolean(),
  body("onboardingCompleted").optional().isBoolean(),
], runValidation, asyncHandler(settings.patchMe));

/** PATCH /api/profiles/me/notifications — update notification preferences */
router.patch("/me/notifications", authenticateToken, asyncHandler(settings.patchNotifications));

// ─── § MISSING ENDPOINTS — added per frontend audit ──────────────────────────

/**
 * GET /api/profiles/instructor/students
 * Global student list across ALL courses the teacher owns.
 * Supports ?search=, ?course_id=, ?status=, ?limit=, ?offset=
 */
router.get("/instructor/students", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(students.listInstructorStudents));

/**
 * POST /api/profiles/teacher/invite
 * A signed invite link into the teacher's own courses (one or several).
 */
router.post("/teacher/invite", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(invites.createInvite));

/**
 * GET /api/profiles/invite/:token — public: what the join page shows before
 * sign-in (course titles, teacher name, expiry).
 */
router.get("/invite/:token", asyncHandler(invites.previewInvite));

/**
 * POST /api/profiles/invite/redeem  { token }
 * The signed-in learner joins every course in the invite. Idempotent.
 */
router.post("/invite/redeem", authenticateToken, asyncHandler(invites.redeemInvite));

/**
 * POST /api/profiles/teacher/students/import
 * Bulk CSV import: parse rows, auto-create accounts, enrol in course.
 * Multipart form: csv file + optional course_id and/or classroom_id
 */
const importUpload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single("csv");

router.post("/teacher/students/import", authenticateToken, requireRole(["instructor", "admin"]), (req, res, next) => {
  importUpload(req, res, (err) => {
    if (err) return res400(res, `Upload error: ${err.message}`);
    if (!req.file) return res400(res, "CSV file is required");
    next();
  });
}, asyncHandler(students.importStudents));

/**
 * PATCH /api/profiles/students/:userId
 * Teacher edits a student's details (name, phone, access level).
 */
router.patch("/students/:userId", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(students.patchStudent));

/**
 * POST /api/profiles/students/:userId/message
 * Teacher sends a direct message to a student (in-app + email).
 */
router.post("/students/:userId/message", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(students.sendStudentMessage));

// ─── GET /api/profiles/teaching-guides ───────────────────────────────────────
router.get("/teaching-guides", authenticateToken, asyncHandler(settings.teachingGuides));

// ─── POST /api/profiles/me/deactivate ────────────────────────────────────────
router.post("/me/deactivate", authenticateToken, asyncHandler(settings.deactivate));

// ─── POST /api/profiles/me/avatar ────────────────────────────────────────────
const avatarUpload = multerLib({
  storage: multerLib.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG, WebP or GIF allowed"));
  },
}).single("file");

router.post("/me/avatar", authenticateToken, (req, res, next) => {
  avatarUpload(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}, asyncHandler(settings.uploadAvatar));

// ─── DELETE /api/profiles/me ──────────────────────────────────────────────────
router.delete("/me", authenticateToken, asyncHandler(settings.deleteMe));

// ═══════════════ OWNERSHIP: school ↔ teacher ↔ student links ═══════════════

/* ── Directories (for onboarding pickers) ─────────────────────────────── */

// GET /api/profiles/directory/schools — active schools a teacher can join.
router.get("/directory/schools", authenticateToken, asyncHandler(links.listDirectorySchools));

/**
 * GET /api/profiles/onboarding-prefill
 * What we already know about a learner their teacher added.
 */
router.get("/onboarding-prefill", authenticateToken, asyncHandler(links.getOnboardingPrefill));

// GET /api/profiles/directory/teachers — instructors a learner can join.
router.get("/directory/teachers", authenticateToken, asyncHandler(links.listDirectoryTeachers));

/* ── Teacher → school request + link status ───────────────────────────── */

// GET /api/profiles/me/school-link — the caller's school link + status.
router.get("/me/school-link", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(links.getSchoolLink));

// POST /api/profiles/me/school-request { school_id } — request to join a school.
router.post("/me/school-request", authenticateToken, requireRole(["instructor", "admin"]), [body("school_id").notEmpty()], runValidation, asyncHandler(links.requestSchool));

/* ── School admin: teacher join requests ──────────────────────────────── */

// GET /api/profiles/schools/:schoolId/teacher-requests?status=pending
router.get("/schools/:schoolId/teacher-requests", authenticateToken, requireRole(["school_admin", "admin"]), asyncHandler(links.listSchoolTeacherRequests));

// POST /api/profiles/schools/:schoolId/teacher-requests/:teacherId  { decision }
router.post("/schools/:schoolId/teacher-requests/:teacherId", authenticateToken, requireRole(["school_admin", "admin"]), [body("decision").isIn(["approve", "reject"])], runValidation, asyncHandler(links.decideSchoolTeacherRequest));

/* ── Learner → teacher request + link status ──────────────────────────── */

// GET /api/profiles/me/teacher-link — the learner's teacher membership.
router.get("/me/teacher-link", authenticateToken, asyncHandler(links.getTeacherLink));

// POST /api/profiles/me/teacher-request { teacher_id } — request to join a teacher.
router.post("/me/teacher-request", authenticateToken, [body("teacher_id").notEmpty()], runValidation, asyncHandler(links.requestTeacher));

/* ── Teacher: student join requests ───────────────────────────────────── */

// GET /api/profiles/teacher/join-requests — pending learners across my classes.
router.get("/teacher/join-requests", authenticateToken, requireRole(["instructor", "admin"]), asyncHandler(links.listTeacherJoinRequests));

// POST /api/profiles/teacher/join-requests/:id { decision } — approve/reject.
router.post("/teacher/join-requests/:id", authenticateToken, requireRole(["instructor", "admin"]), [body("decision").isIn(["approve", "reject"])], runValidation, asyncHandler(links.decideTeacherJoinRequest));

export default router;
