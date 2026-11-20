/**
 * courses.js  —  Piabam Courses & Sessions router
 *
 * Usage in app.js:
 *   import coursesRouter from "./routes/courses.js";
 *   app.use("/api/courses", coursesRouter);
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § UPLOAD CONFIG      multer instances + MIME guards
 *  § STORE              in-memory DB — swap internals for Postgres/Mongo here
 *  § HELPERS            response shorthands + async wrapper + validator runner
 *  § VALIDATION RULES   express-validator chains
 *  § COURSE HANDLERS    CRUD + file uploads + curriculum helpers
 *  § SESSION HANDLERS   CRUD + status patch
 *  § ROUTER             all route definitions
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * To extract any section into its own file later:
 *   1. Cut everything between the section markers
 *   2. Add the necessary `import` / `export` statements
 *   3. Replace the inline block with a single import line in this file
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }                                    from "express";
import multer, { MulterError }                       from "multer";
import { body, query, param, validationResult }      from "express-validator";
import { v4 as uuid }                                from "uuid";
import path                                          from "path";
import fs                                            from "fs";
import { fileURLToPath }                             from "url";
import { CourseStore, SessionStore, now }             from "./courses-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── § UPLOAD CONFIG ──────────────────────────────────────────────────────────

const UPLOAD_ROOT = path.join(__dirname, "../uploads");

["thumbnails", "promos", "materials", "lectures"].forEach((d) =>
  fs.mkdirSync(path.join(UPLOAD_ROOT, d), { recursive: true })
);

const MIME_TYPES = {
  image:    ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"],
  video:    ["video/mp4", "video/quicktime", "video/x-msvideo", "video/webm", "video/x-matroska"],
  audio:    ["audio/mpeg", "audio/wav", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/markdown",
  ],
};

const diskStorage = (subdir) =>
  multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(UPLOAD_ROOT, subdir)),
    filename:    (_req, file,  cb) =>
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`),
  });

const mimeFilter = (...types) => (_req, file, cb) => {
  const allowed = types.some((t) => MIME_TYPES[t]?.includes(file.mimetype));
  allowed
    ? cb(null, true)
    : cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
};

// Each uploader is a raw multer middleware — called manually in handlers
// so upload errors flow through Express's error handler cleanly.
const uploader = {
  thumbnail:    multer({ storage: diskStorage("thumbnails"), limits: { fileSize: 5   * 1024 ** 2 },        fileFilter: mimeFilter("image")                      }).single("thumbnail"),
  promo:        multer({ storage: diskStorage("promos"),     limits: { fileSize: 500  * 1024 ** 2 },        fileFilter: mimeFilter("video")                      }).single("promoVideo"),
  material:     multer({ storage: diskStorage("materials"),  limits: { fileSize: 50   * 1024 ** 2 },        fileFilter: mimeFilter("image", "document", "audio")  }).single("material"),
  lectureVideo: multer({ storage: diskStorage("lectures"),   limits: { fileSize: 2    * 1024 ** 3 },        fileFilter: mimeFilter("video")                      }).single("lectureVideo"),
};

const publicUrl = (req, subdir, filename) =>
  `${req.protocol}://${req.get("host")}/uploads/${subdir}/${filename}`;

// ─── § STORE ──────────────────────────────────────────────────────────────────
// Seed data and both in-memory stores live in courses-store.js (behaviour
// unchanged); this file keeps only the router, uploaders and handlers.

// ─── § HELPERS ────────────────────────────────────────────────────────────────

// Async wrapper — unhandled rejections flow to Express error handler
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Response shorthands
const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res204 = (res)                  => res.status(204).send();
const res400 = (res, message)         => res.status(400).json({ success: false, message });
const res404 = (res, message)         => res.status(404).json({ success: false, message });

// Validation runner — place after any express-validator rule arrays
const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

// Derived-field helper — keeps modules/lessons counts in sync on write
const recomputeCounts = (data) => {
  if (data.curriculum) {
    data.modules = data.curriculum.length;
    data.lessons = data.curriculum.reduce((n, m) => n + (m.lectures?.length ?? 0), 0);
  }
  if (data.topics && !data.curriculum) {
    data.modules = data.topics.length;
  }
  return data;
};

// ─── § VALIDATION RULES ───────────────────────────────────────────────────────

const rules = {
  course: {
    list: [
      query("courseType").optional().isIn(["live", "ondemand"]),
      query("status").optional().isIn(["live", "draft", "archived"]),
      query("subject").optional().trim(),
      query("search").optional().trim().isLength({ max: 200 }),
    ],
    create: [
      body("title").trim().notEmpty().withMessage("title is required").isLength({ max: 200 }),
      body("courseType").notEmpty().isIn(["live", "ondemand"]).withMessage("courseType must be 'live' or 'ondemand'"),
      body("subject").trim().notEmpty().withMessage("subject is required"),
      body("level").trim().notEmpty().withMessage("level is required"),
      body("language").optional().trim(),
      body("description").optional().trim().isLength({ max: 2000 }),
      body("price").optional({ nullable: true }).isFloat({ min: 0 }).withMessage("price must be ≥ 0"),
      body("pricing").optional().isIn(["free", "paid", "freemium"]).withMessage("pricing must be free | paid | freemium"),
      body("platform").optional().isIn(["zoom", "meet", "teams", "—", ""]).withMessage("Invalid platform"),
      body("status").optional().isIn(["live", "draft", "archived"]).withMessage("status must be live | draft | archived"),
      body("sessionLengthMin").optional({ nullable: true }).isInt({ min: 15, max: 300 }).withMessage("sessionLengthMin must be 15–300"),
      body("schedulePattern").optional({ nullable: true }).isIn(["weekly", "biweekly", "custom"]).withMessage("Invalid schedulePattern"),
      body("topics").optional().isArray(),
      body("curriculum").optional().isArray(),
    ],
  },
  session: {
    create: [
      param("courseId").notEmpty().withMessage("courseId param is required"),
      body("title").trim().notEmpty().withMessage("title is required"),
      body("date").optional().trim(),
      body("time").optional().trim(),
      body("platform").optional().isIn(["zoom", "meet", "teams"]).withMessage("Invalid platform"),
      body("description").optional().trim().isLength({ max: 1000 }),
      body("durationMin").optional({ nullable: true }).isInt({ min: 15, max: 300 }),
    ],
  },
};

// ─── § COURSE HANDLERS ────────────────────────────────────────────────────────

const courseHandlers = {

  // GET /
  list: asyncHandler(async (req, res) => {
    const courses = CourseStore.list(req.query);
    res200(res, courses, { total: courses.length });
  }),

  // GET /:id
  get: asyncHandler(async (req, res) => {
    const course = CourseStore.get(req.params.id);
    if (!course) return res404(res, `Course ${req.params.id} not found`);
    res200(res, course);
  }),

  // POST /
  create: asyncHandler(async (req, res) => {
    const {
      title, courseType, subject, level,
      language      = "English",
      description   = "",
      status        = "draft",
      platform      = "—",
      price         = 0,
      pricing       = "paid",
      salePrice     = null,
      saleEnds      = null,
      introSession  = "paid",
      refundPolicy  = "30",
      enrolment     = "open",
      sessionLengthMin = null,
      schedulePattern  = null,
      topics       = [],
      curriculum   = [],
      emoji        = "📚",
      color        = "#1A1A2E",
    } = req.body;

    const course = CourseStore.create({
      id: uuid(),
      title, courseType, subject, level, language, description,
      status, platform, price, pricing, salePrice, saleEnds,
      introSession, refundPolicy, enrolment, sessionLengthMin, schedulePattern,
      topics:     topics.map((t) => ({ id: uuid(), ...t, materials: t.materials ?? [] })),
      curriculum: curriculum.map((m) => ({ id: uuid(), ...m, lectures: (m.lectures ?? []).map((l) => ({ id: uuid(), ...l })) })),
      emoji,
      color,
      thumb:         `linear-gradient(135deg,${color},${color}88)`,
      thumbnailUrl:  null,
      promoVideoUrl: null,
      nextSession:   courseType === "ondemand" ? "Self-paced" : "—",
      modules:       curriculum.length || topics.length,
      lessons:       curriculum.reduce((n, m) => n + (m.lectures?.length ?? 0), 0),
    });

    res201(res, course);
  }),

  // PUT /:id  /  PATCH /:id
  update: asyncHandler(async (req, res) => {
    const course = CourseStore.get(req.params.id);
    if (!course) return res404(res, `Course ${req.params.id} not found`);
    res200(res, CourseStore.update(req.params.id, recomputeCounts({ ...req.body })));
  }),

  // DELETE /:id
  delete: asyncHandler(async (req, res) => {
    if (!CourseStore.delete(req.params.id))
      return res404(res, `Course ${req.params.id} not found`);
    res204(res);
  }),

  // PATCH /:id/status
  patchStatus: asyncHandler(async (req, res) => {
    const VALID = ["live", "draft", "archived"];
    const { status } = req.body;
    if (!VALID.includes(status))
      return res400(res, `status must be one of: ${VALID.join(", ")}`);
    const course = CourseStore.get(req.params.id);
    if (!course) return res404(res, `Course ${req.params.id} not found`);
    res200(res, CourseStore.update(req.params.id, { status }));
  }),

  // POST /:id/thumbnail
  uploadThumbnail: (req, res, next) =>
    uploader.thumbnail(req, res, (err) => {
      if (err) return next(err);
      const course = CourseStore.get(req.params.id);
      if (!course)   return res404(res, `Course ${req.params.id} not found`);
      if (!req.file) return res400(res, "No file received");
      const thumbnailUrl = publicUrl(req, "thumbnails", req.file.filename);
      res200(res, { thumbnailUrl, course: CourseStore.update(req.params.id, { thumbnailUrl }) });
    }),

  // POST /:id/promo-video
  uploadPromo: (req, res, next) =>
    uploader.promo(req, res, (err) => {
      if (err) return next(err);
      const course = CourseStore.get(req.params.id);
      if (!course)   return res404(res, `Course ${req.params.id} not found`);
      if (!req.file) return res400(res, "No file received");
      const promoVideoUrl = publicUrl(req, "promos", req.file.filename);
      res200(res, { promoVideoUrl, course: CourseStore.update(req.params.id, { promoVideoUrl }) });
    }),

  // POST /:id/topics/:topicId/materials
  uploadTopicMaterial: (req, res, next) =>
    uploader.material(req, res, (err) => {
      if (err) return next(err);
      const course = CourseStore.get(req.params.id);
      if (!course) return res404(res, `Course ${req.params.id} not found`);
      const topic = course.topics?.find((t) => t.id === req.params.topicId);
      if (!topic)  return res404(res, `Topic ${req.params.topicId} not found`);

      const material = {
        id:         uuid(),
        type:       req.body.materialType  || "document",
        title:      req.body.materialTitle || req.file?.originalname || "Untitled",
        free:       req.body.free === "true",
        fileUrl:    req.file ? publicUrl(req, "materials", req.file.filename) : null,
        filename:   req.file?.originalname ?? null,
        fileSize:   req.file?.size         ?? null,
        uploadedAt: now(),
      };

      topic.materials.push(material);
      res200(res, { material, course: CourseStore.update(req.params.id, { topics: course.topics }) });
    }),

  // POST /:id/curriculum/:moduleId/lectures/:lectureId/video
  uploadLectureVideo: (req, res, next) =>
    uploader.lectureVideo(req, res, (err) => {
      if (err) return next(err);
      const course = CourseStore.get(req.params.id);
      if (!course)   return res404(res, `Course ${req.params.id} not found`);
      const mod = course.curriculum?.find((m) => m.id === req.params.moduleId);
      if (!mod)      return res404(res, `Module ${req.params.moduleId} not found`);
      const lecture = mod.lectures?.find((l) => l.id === req.params.lectureId);
      if (!lecture)  return res404(res, `Lecture ${req.params.lectureId} not found`);
      if (!req.file) return res400(res, "No file received");

      lecture.videoUrl   = publicUrl(req, "lectures", req.file.filename);
      lecture.videoFile  = req.file.filename;
      lecture.videoSize  = req.file.size;
      lecture.uploadedAt = now();

      res200(res, { videoUrl: lecture.videoUrl, lecture, course: CourseStore.update(req.params.id, { curriculum: course.curriculum }) });
    }),

  // POST /:id/curriculum
  addModule: asyncHandler(async (req, res) => {
    const course = CourseStore.get(req.params.id);
    if (!course) return res404(res, `Course ${req.params.id} not found`);

    const mod = {
      id:       uuid(),
      title:    req.body.title    || "New Module",
      lectures: (req.body.lectures ?? []).map((l) => ({ id: uuid(), ...l })),
    };
    const curriculum = [...(course.curriculum ?? []), mod];
    res201(res, {
      module: mod,
      course: CourseStore.update(req.params.id, recomputeCounts({ curriculum })),
    });
  }),

  // POST /:id/curriculum/:moduleId/lectures
  addLecture: asyncHandler(async (req, res) => {
    const course = CourseStore.get(req.params.id);
    if (!course) return res404(res, `Course ${req.params.id} not found`);
    const mod = course.curriculum?.find((m) => m.id === req.params.moduleId);
    if (!mod)  return res404(res, `Module ${req.params.moduleId} not found`);

    const lecture = {
      id:       uuid(),
      title:    req.body.title    || "New Lecture",
      type:     req.body.type     || "video",
      free:     req.body.free     ?? false,
      duration: req.body.duration || "—",
      videoUrl: null,
    };
    mod.lectures.push(lecture);
    res201(res, {
      lecture,
      course: CourseStore.update(req.params.id, recomputeCounts({ curriculum: course.curriculum })),
    });
  }),
};

// ─── § SESSION HANDLERS ───────────────────────────────────────────────────────

const sessionHandlers = {

  // GET /api/sessions  (global — used by app.js directly if needed)
  listAll: asyncHandler(async (req, res) => {
    const sessions = SessionStore.list(req.query);
    res200(res, sessions, { total: sessions.length });
  }),

  // GET /:courseId/sessions
  listByCourse: asyncHandler(async (req, res) => {
    const course = CourseStore.get(req.params.courseId);
    if (!course) return res404(res, `Course ${req.params.courseId} not found`);
    const sessions = SessionStore.listByCourse(req.params.courseId);
    res200(res, sessions, { total: sessions.length });
  }),

  // GET /:courseId/sessions/:id
  get: asyncHandler(async (req, res) => {
    const session = SessionStore.get(req.params.id);
    if (!session || session.courseId !== req.params.courseId)
      return res404(res, `Session ${req.params.id} not found`);
    res200(res, session);
  }),

  // POST /:courseId/sessions
  create: asyncHandler(async (req, res) => {
    const course = CourseStore.get(req.params.courseId);
    if (!course) return res404(res, `Course ${req.params.courseId} not found`);
    if (course.courseType !== "live")
      return res400(res, "Sessions can only be added to live courses");

    const {
      title,
      date        = "",
      time        = "",
      platform    = course.platform || "zoom",
      description = "",
      durationMin = course.sessionLengthMin ?? 90,
      status      = "upcoming",
    } = req.body;

    res201(res, SessionStore.create({
      id: uuid(), courseId: req.params.courseId,
      title, date, time, platform, description, durationMin,
      enrolled: 0, status, createdAt: now(),
    }));
  }),

  // PUT /:courseId/sessions/:id  /  PATCH /:courseId/sessions/:id
  update: asyncHandler(async (req, res) => {
    const session = SessionStore.get(req.params.id);
    if (!session || session.courseId !== req.params.courseId)
      return res404(res, `Session ${req.params.id} not found`);
    res200(res, SessionStore.update(req.params.id, req.body));
  }),

  // PATCH /:courseId/sessions/:id/status
  patchStatus: asyncHandler(async (req, res) => {
    const VALID = ["upcoming", "live", "recorded", "cancelled"];
    const { status } = req.body;
    if (!VALID.includes(status))
      return res400(res, `status must be one of: ${VALID.join(", ")}`);
    const session = SessionStore.get(req.params.id);
    if (!session || session.courseId !== req.params.courseId)
      return res404(res, `Session ${req.params.id} not found`);
    res200(res, SessionStore.update(req.params.id, { status }));
  }),

  // DELETE /:courseId/sessions/:id
  delete: asyncHandler(async (req, res) => {
    const session = SessionStore.get(req.params.id);
    if (!session || session.courseId !== req.params.courseId)
      return res404(res, `Session ${req.params.id} not found`);
    SessionStore.delete(req.params.id);
    res204(res);
  }),
};

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

// ── Courses ──────────────────────────────────────────────────────────────────
router.get   ("/",          rules.course.list,   runValidation, courseHandlers.list);
router.post  ("/",          rules.course.create, runValidation, courseHandlers.create);
router.get   ("/:id",                            courseHandlers.get);
router.put   ("/:id",                            courseHandlers.update);
router.patch ("/:id",                            courseHandlers.update);
router.patch ("/:id/status",                     courseHandlers.patchStatus);
router.delete("/:id",                            courseHandlers.delete);

// ── Course file uploads ───────────────────────────────────────────────────────
router.post("/:id/thumbnail",                                        courseHandlers.uploadThumbnail);
router.post("/:id/promo-video",                                      courseHandlers.uploadPromo);
router.post("/:id/topics/:topicId/materials",                        courseHandlers.uploadTopicMaterial);

// ── On-demand curriculum ──────────────────────────────────────────────────────
router.post("/:id/curriculum",                                       courseHandlers.addModule);
router.post("/:id/curriculum/:moduleId/lectures",                    courseHandlers.addLecture);
router.post("/:id/curriculum/:moduleId/lectures/:lectureId/video",   courseHandlers.uploadLectureVideo);

// ── Sessions (nested under courses) ──────────────────────────────────────────
router.get   ("/:courseId/sessions",             sessionHandlers.listByCourse);
router.post  ("/:courseId/sessions",             rules.session.create, runValidation, sessionHandlers.create);
router.get   ("/:courseId/sessions/:id",         sessionHandlers.get);
router.put   ("/:courseId/sessions/:id",         sessionHandlers.update);
router.patch ("/:courseId/sessions/:id",         sessionHandlers.update);
router.patch ("/:courseId/sessions/:id/status",  sessionHandlers.patchStatus);
router.delete("/:courseId/sessions/:id",         sessionHandlers.delete);

// ─────────────────────────────────────────────────────────────────────────────

export { sessionHandlers };   // export so app.js can mount GET /api/sessions globally if needed
export default router;

/**
 * ── app.js wiring (for reference) ────────────────────────────────────────────
 *
 * import coursesRouter, { sessionHandlers } from "./routes/courses.js";
 *
 * app.use("/api/courses",  coursesRouter);
 * app.use("/api/sessions", sessionHandlers.listAll);   // optional global endpoint
 *
 * // Global error handler (add after all routes)
 * app.use((err, _req, res, _next) => {
 *   if (err instanceof MulterError)
 *     return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
 *   if (err.message?.startsWith("Unsupported file type"))
 *     return res.status(415).json({ success: false, message: err.message });
 *   console.error(err);
 *   res.status(500).json({ success: false, message: "Internal server error" });
 * });
 */
