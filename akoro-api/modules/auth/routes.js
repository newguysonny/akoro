/**
 * auth.js  —  Piabam Auth, Users & Student Activity router
 *
 * Usage in app.js:
 *   import authRouter, { authenticateToken, requireRole } from "./routes/auth.js";
 *   app.use("/api/auth",     authRouter);
 *
 * Named exports  (used by other routers as middleware):
 *   authenticateToken   — verifies Bearer JWT, attaches req.user
 *   requireRole(roles)  — guards routes to specific roles
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § USER STORE          in-memory users table — swap for DB
 *  § HELPERS             async wrapper, response shorthands
 *  § JWT MIDDLEWARE       authenticateToken + requireRole
 *  § VALIDATION RULES    express-validator chains
 *  § AUTH HANDLERS       register, login, me, refresh
 *  § DASHBOARD HANDLER   role-aware stats endpoint
 *  § ENROLLMENT HANDLERS enroll, list enrolled courses
 *  § PROGRESS HANDLERS   video watch progress + course completion
 *  § REVIEW HANDLERS     submit + list reviews per course
 *  § ROUTER              all route definitions
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Dependencies (add to package.json):
 *   "jsonwebtoken": "^9.0.2"
 *   "bcrypt":       "^5.1.1"
 *
 * Environment variables (.env):
 *   JWT_SECRET          strong random string — required in production
 *   JWT_EXPIRES_IN      e.g. "7d"  (default: "7d")
 *   BCRYPT_ROUNDS       e.g. 10    (default: 10)
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }                               from "express";
import jwt                                      from "jsonwebtoken";
import bcrypt                                   from "bcrypt";
import { body, validationResult }               from "express-validator";

// ─── § USER STORE ─────────────────────────────────────────────────────────────
// Swap the arrays + helper bodies for real DB calls without touching anything above.
// Enrollment, progress, and review records live here too — they are child
// records of users and are naturally co-located.

let _users = [];
let _enrollments  = [];   // { id, userId, courseId, enrolledAt, completedAt }
let _videoProgress = [];  // { id, userId, videoId, courseId, watchedDuration, lastPosition, completed, updatedAt }
let _reviews = [];        // { id, userId, courseId, rating, comment, createdAt, updatedAt }

const now = () => new Date().toISOString();

// Seed demo accounts on first load
const _seedUsers = async () => {
  if (_users.length) return;
  const salt = parseInt(process.env.BCRYPT_ROUNDS ?? "10", 10);
  _users = [
    { id: "u-admin-1",      email: "admin@akoro.app",      username: "admin",      passwordHash: await bcrypt.hash("Admin123!",      salt), fullName: "System Admin",    role: "admin",      isActive: true, avatarUrl: null, createdAt: now() },
    { id: "u-teacher-1",    email: "amara@akoro.app",       username: "dr_amara",   passwordHash: await bcrypt.hash("Teacher123!",    salt), fullName: "Dr. Amara Diallo",role: "instructor", isActive: true, avatarUrl: null, createdAt: now() },
    { id: "u-student-1",    email: "chuks@gmail.com",        username: "chuks_obi",  passwordHash: await bcrypt.hash("Student123!",    salt), fullName: "Chukwuemeka Obi", role: "student",    isActive: true, avatarUrl: null, createdAt: now() },
  ];
};
_seedUsers();   // fire-and-forget — no await needed at module level

const UserStore = {
  getById:       (id)    => _users.find((u) => u.id    === id)    ?? null,
  getByEmail:    (email) => _users.find((u) => u.email === email) ?? null,
  getByUsername: (name)  => _users.find((u) => u.username === name) ?? null,
  create:        (data)  => { _users.push(data); return data; },
  update:        (id, d) => { const i = _users.findIndex((u) => u.id === id); if (i === -1) return null; _users[i] = { ..._users[i], ...d, id }; return _users[i]; },
  // Return safe public shape — never leak passwordHash
  safe: (u) => ({ id: u.id, email: u.email, username: u.username, fullName: u.fullName, role: u.role, avatarUrl: u.avatarUrl, createdAt: u.createdAt }),
};

const EnrollmentStore = {
  list:          (f = {}) => { let r = [..._enrollments]; if (f.userId) r = r.filter((e) => e.userId === f.userId); if (f.courseId) r = r.filter((e) => e.courseId === f.courseId); return r; },
  get:           (userId, courseId) => _enrollments.find((e) => e.userId === userId && e.courseId === courseId) ?? null,
  create:        (data)  => { _enrollments.push(data); return data; },
  update:        (id, d) => { const i = _enrollments.findIndex((e) => e.id === id); if (i === -1) return null; _enrollments[i] = { ..._enrollments[i], ...d }; return _enrollments[i]; },
  delete:        (id)    => { const i = _enrollments.findIndex((e) => e.id === id); if (i === -1) return false; _enrollments.splice(i, 1); return true; },
};

const ProgressStore = {
  get:    (userId, videoId) => _videoProgress.find((p) => p.userId === userId && p.videoId === videoId) ?? null,
  upsert: (data) => {
    const i = _videoProgress.findIndex((p) => p.userId === data.userId && p.videoId === data.videoId);
    if (i === -1) { _videoProgress.push({ ...data, id: crypto.randomUUID() }); return _videoProgress[_videoProgress.length - 1]; }
    _videoProgress[i] = { ..._videoProgress[i], ...data, updatedAt: now() };
    return _videoProgress[i];
  },
  countByCourse: (userId, courseId) => ({
    total:     _videoProgress.filter((p) => p.userId === userId && p.courseId === courseId).length,
    completed: _videoProgress.filter((p) => p.userId === userId && p.courseId === courseId && p.completed).length,
  }),
};

const ReviewStore = {
  listByCourse: (courseId) => _reviews.filter((r) => r.courseId === courseId),
  get:          (userId, courseId) => _reviews.find((r) => r.userId === userId && r.courseId === courseId) ?? null,
  upsert: (data) => {
    const i = _reviews.findIndex((r) => r.userId === data.userId && r.courseId === data.courseId);
    if (i === -1) { _reviews.push({ ...data, id: crypto.randomUUID(), createdAt: now(), updatedAt: now() }); return _reviews[_reviews.length - 1]; }
    _reviews[i] = { ..._reviews[i], ...data, updatedAt: now() };
    return _reviews[i];
  },
  avgRating: (courseId) => {
    const rs = _reviews.filter((r) => r.courseId === courseId);
    if (!rs.length) return 0;
    return +(rs.reduce((s, r) => s + r.rating, 0) / rs.length).toFixed(2);
  },
};

// ─── § HELPERS ────────────────────────────────────────────────────────────────

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res400 = (res, message)         => res.status(400).json({ success: false, message });
const res401 = (res, message)         => res.status(401).json({ success: false, message });
const res403 = (res, message)         => res.status(403).json({ success: false, message });
const res404 = (res, message)         => res.status(404).json({ success: false, message });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const JWT_SECRET     = process.env.JWT_SECRET     ?? "akoro-dev-secret-change-in-production";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? "7d";
const BCRYPT_ROUNDS  = parseInt(process.env.BCRYPT_ROUNDS ?? "10", 10);

const signToken = (user) =>
  jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

// ─── § JWT MIDDLEWARE ─────────────────────────────────────────────────────────

/**
 * authenticateToken
 * Verifies the Bearer token in Authorization header.
 * Attaches the safe user object to req.user on success.
 * Export this so other routers (courses.js, stream.js) can import it.
 */
export const authenticateToken = async (req, res, next) => {
  const header = req.headers["authorization"];
  const token  = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res401(res, "Access token required");

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user    = UserStore.getById(decoded.userId);
    if (!user || !user.isActive) return res401(res, "User not found or deactivated");
    req.user = UserStore.safe(user);
    next();
  } catch {
    return res403(res, "Invalid or expired token");
  }
};

/**
 * requireRole(roles)
 * Use after authenticateToken.  Example: requireRole(["admin","instructor"])
 */
export const requireRole = (roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role))
    return res403(res, `Requires one of: ${roles.join(", ")}`);
  next();
};

// ─── § VALIDATION RULES ───────────────────────────────────────────────────────

const rules = {
  register: [
    body("email").trim().isEmail().withMessage("Valid email required").normalizeEmail(),
    body("username").trim().notEmpty().isLength({ min: 3, max: 40 }).withMessage("Username must be 3–40 chars").matches(/^[a-zA-Z0-9_]+$/).withMessage("Username: letters, numbers, underscores only"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
    body("fullName").optional().trim().isLength({ max: 120 }),
    body("role").optional().isIn(["student", "instructor"]).withMessage("role must be student or instructor"),
  ],
  login: [
    body("email").trim().isEmail().withMessage("Valid email required").normalizeEmail(),
    body("password").notEmpty().withMessage("Password required"),
  ],
  review: [
    body("rating").isInt({ min: 1, max: 5 }).withMessage("Rating must be 1–5"),
    body("comment").optional().trim().isLength({ max: 2000 }),
  ],
  progress: [
    body("videoId").notEmpty().withMessage("videoId required"),
    body("courseId").notEmpty().withMessage("courseId required"),
    body("position").isInt({ min: 0 }).withMessage("position must be a non-negative integer"),
    body("completed").optional().isBoolean(),
  ],
  enroll: [],   // params-only, no body fields needed
};

// ─── § AUTH HANDLERS ──────────────────────────────────────────────────────────

const authHandlers = {

  // POST /api/auth/register
  register: asyncHandler(async (req, res) => {
    const { email, username, password, fullName, role = "student" } = req.body;

    if (UserStore.getByEmail(email))
      return res400(res, "Email already registered");
    if (UserStore.getByUsername(username))
      return res400(res, "Username already taken");

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = UserStore.create({
      id:           crypto.randomUUID(),
      email,
      username,
      passwordHash,
      fullName:     fullName ?? null,
      role,
      isActive:     true,
      avatarUrl:    null,
      createdAt:    now(),
    });

    const token = signToken(user);
    res201(res, { token, user: UserStore.safe(user) });
  }),

  // POST /api/auth/login
  login: asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const user = UserStore.getByEmail(email);
    if (!user) return res401(res, "Invalid credentials");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res401(res, "Invalid credentials");

    if (!user.isActive) return res403(res, "Account deactivated");

    const token = signToken(user);
    res200(res, { token, user: UserStore.safe(user) });
  }),

  // GET /api/auth/me  (requires token)
  me: asyncHandler(async (req, res) => {
    res200(res, req.user);
  }),

  // POST /api/auth/refresh  (exchange a still-valid token for a fresh one)
  refresh: asyncHandler(async (req, res) => {
    const user = UserStore.getById(req.user.id);
    if (!user) return res401(res, "User not found");
    const token = signToken(user);
    res200(res, { token, user: UserStore.safe(user) });
  }),
};

// ─── § DASHBOARD HANDLER ──────────────────────────────────────────────────────
// Returns role-aware stats.
// Import CourseStore from store.js in production — stubbed here for portability.

const dashboardHandler = asyncHandler(async (req, res) => {
  const { role, id } = req.user;

  if (role === "student") {
    const enrollments = EnrollmentStore.list({ userId: id });
    const completed   = enrollments.filter((e) => e.completedAt).length;
    const totalWatch  = _videoProgress.filter((p) => p.userId === id)
                                       .reduce((s, p) => s + (p.watchedDuration ?? 0), 0);
    return res200(res, {
      role,
      stats: { totalCourses: enrollments.length, completedCourses: completed, totalWatchTimeSecs: totalWatch },
      enrollments,
    });
  }

  if (role === "instructor") {
    // In production: query courses WHERE teacherId = id from CourseStore
    return res200(res, {
      role,
      stats: { totalCourses: 0, totalStudents: 0, totalRevenue: 0 },
      message: "Connect CourseStore in production to populate instructor stats",
    });
  }

  // admin
  return res200(res, {
    role,
    stats: {
      totalUsers:     _users.length,
      totalEnrollments: _enrollments.length,
      totalReviews:   _reviews.length,
    },
    users: _users.map(UserStore.safe),
  });
});

// ─── § ENROLLMENT HANDLERS ────────────────────────────────────────────────────

const enrollmentHandlers = {

  // POST /api/courses/:courseId/enroll
  enroll: asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const userId       = req.user.id;

    if (EnrollmentStore.get(userId, courseId))
      return res400(res, "Already enrolled in this course");

    // In production: verify course exists + is published via CourseStore
    const enrollment = EnrollmentStore.create({
      id:          crypto.randomUUID(),
      userId,
      courseId,
      progress:    0,
      enrolledAt:  now(),
      completedAt: null,
    });

    res201(res, enrollment);
  }),

  // DELETE /api/courses/:courseId/enroll  (unenroll)
  unenroll: asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const enrollment   = EnrollmentStore.get(req.user.id, courseId);
    if (!enrollment) return res404(res, "Enrollment not found");

    EnrollmentStore.delete(enrollment.id);
    res200(res, { message: "Successfully unenrolled" });
  }),

  // GET /api/enrollments  (list the current user's enrollments)
  listMine: asyncHandler(async (req, res) => {
    const enrollments = EnrollmentStore.list({ userId: req.user.id });
    res200(res, enrollments, { total: enrollments.length });
  }),
};

// ─── § PROGRESS HANDLERS ──────────────────────────────────────────────────────

const progressHandlers = {

  // POST /api/progress
  // Called by the video player on a regular heartbeat (e.g. every 15s)
  update: asyncHandler(async (req, res) => {
    const { videoId, courseId, position, completed = false } = req.body;
    const userId = req.user.id;

    // Must be enrolled to track progress
    if (!EnrollmentStore.get(userId, courseId))
      return res403(res, "You must be enrolled to track progress");

    const progress = ProgressStore.upsert({
      userId,
      videoId,
      courseId,
      lastPosition:    position,
      watchedDuration: position,   // simplified — a real impl tracks cumulative unique seconds
      completed:       !!completed,
      updatedAt:       now(),
    });

    // Recompute course completion percentage
    const { total, completed: done } = ProgressStore.countByCourse(userId, courseId);
    const courseProgress = total > 0 ? Math.round((done / total) * 100) : 0;

    // Update enrollment progress
    const enrollment = EnrollmentStore.get(userId, courseId);
    if (enrollment) {
      EnrollmentStore.update(enrollment.id, {
        progress:    courseProgress,
        completedAt: courseProgress === 100 ? now() : enrollment.completedAt,
      });
    }

    res200(res, { videoProgress: progress, courseProgress });
  }),

  // GET /api/progress/:videoId
  getVideo: asyncHandler(async (req, res) => {
    const progress = ProgressStore.get(req.user.id, req.params.videoId);
    res200(res, progress ?? { lastPosition: 0, completed: false });
  }),

  // GET /api/progress/course/:courseId
  getCourse: asyncHandler(async (req, res) => {
    const enrollment = EnrollmentStore.get(req.user.id, req.params.courseId);
    if (!enrollment) return res404(res, "Not enrolled in this course");
    res200(res, { progress: enrollment.progress, completedAt: enrollment.completedAt });
  }),
};

// ─── § REVIEW HANDLERS ────────────────────────────────────────────────────────

const reviewHandlers = {

  // POST /api/courses/:courseId/reviews
  submit: asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const userId       = req.user.id;

    if (!EnrollmentStore.get(userId, courseId))
      return res403(res, "You must be enrolled to leave a review");

    const review = ReviewStore.upsert({
      userId,
      courseId,
      rating:  req.body.rating,
      comment: req.body.comment ?? null,
    });

    // In production: push avgRating back to CourseStore.update(courseId, { rating })
    const avg = ReviewStore.avgRating(courseId);

    res201(res, { review, courseAvgRating: avg });
  }),

  // GET /api/courses/:courseId/reviews
  list: asyncHandler(async (req, res) => {
    const reviews = ReviewStore.listByCourse(req.params.courseId);
    const avg     = ReviewStore.avgRating(req.params.courseId);
    res200(res, { reviews, avgRating: avg, total: reviews.length });
  }),
};

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post("/register",  rules.register, runValidation,  authHandlers.register);
router.post("/login",     rules.login,    runValidation,  authHandlers.login);
router.get ("/me",        authenticateToken,              authHandlers.me);
router.post("/refresh",   authenticateToken,              authHandlers.refresh);

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get ("/dashboard", authenticateToken,              dashboardHandler);

// ── Enrollments ───────────────────────────────────────────────────────────────
router.get   ("/enrollments",                 authenticateToken,                          enrollmentHandlers.listMine);
router.post  ("/courses/:courseId/enroll",    authenticateToken,                          enrollmentHandlers.enroll);
router.delete("/courses/:courseId/enroll",    authenticateToken,                          enrollmentHandlers.unenroll);

// ── Progress ──────────────────────────────────────────────────────────────────
router.post("/progress",                      authenticateToken, rules.progress, runValidation, progressHandlers.update);
router.get ("/progress/:videoId",             authenticateToken,                               progressHandlers.getVideo);
router.get ("/progress/course/:courseId",     authenticateToken,                               progressHandlers.getCourse);

// ── Reviews ───────────────────────────────────────────────────────────────────
router.post("/courses/:courseId/reviews",     authenticateToken, rules.review, runValidation,  reviewHandlers.submit);
router.get ("/courses/:courseId/reviews",                                                       reviewHandlers.list);

// ─────────────────────────────────────────────────────────────────────────────

export default router;

/**
 * ── app.js wiring (for reference) ────────────────────────────────────────────
 *
 * import authRouter, { authenticateToken, requireRole } from "./routes/auth.js";
 *
 * app.use("/api/auth", authRouter);
 *
 * // Re-export middleware for other routers:
 * // import { authenticateToken, requireRole } from "./routes/auth.js";
 *
 * ── Endpoints exposed ─────────────────────────────────────────────────────────
 *
 * POST   /api/auth/register
 * POST   /api/auth/login
 * GET    /api/auth/me
 * POST   /api/auth/refresh
 * GET    /api/auth/dashboard
 *
 * GET    /api/auth/enrollments
 * POST   /api/auth/courses/:courseId/enroll
 * DELETE /api/auth/courses/:courseId/enroll
 *
 * POST   /api/auth/progress
 * GET    /api/auth/progress/:videoId
 * GET    /api/auth/progress/course/:courseId
 *
 * POST   /api/auth/courses/:courseId/reviews
 * GET    /api/auth/courses/:courseId/reviews
 *
 * ── Database tables needed (Postgres) ────────────────────────────────────────
 *
 * CREATE TABLE users (
 *   id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   email         TEXT UNIQUE NOT NULL,
 *   username      TEXT UNIQUE NOT NULL,
 *   password_hash TEXT NOT NULL,
 *   full_name     TEXT,
 *   avatar_url    TEXT,
 *   role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','instructor','admin')),
 *   is_active     BOOLEAN NOT NULL DEFAULT true,
 *   created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 * );
 *
 * CREATE TABLE enrollments (
 *   id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *   course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 *   progress     INT NOT NULL DEFAULT 0,
 *   enrolled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   completed_at TIMESTAMPTZ,
 *   UNIQUE (user_id, course_id)
 * );
 *
 * CREATE TABLE video_progress (
 *   id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *   video_id         UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
 *   course_id        UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 *   watched_duration INT NOT NULL DEFAULT 0,
 *   last_position    INT NOT NULL DEFAULT 0,
 *   completed        BOOLEAN NOT NULL DEFAULT false,
 *   updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   UNIQUE (user_id, video_id)
 * );
 *
 * CREATE TABLE reviews (
 *   id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *   course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
 *   rating     INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
 *   comment    TEXT,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *   UNIQUE (user_id, course_id)
 * );
 *
 * CREATE INDEX ON enrollments   (user_id);
 * CREATE INDEX ON enrollments   (course_id);
 * CREATE INDEX ON video_progress(user_id);
 * CREATE INDEX ON video_progress(course_id);
 * CREATE INDEX ON reviews       (course_id);
 */
