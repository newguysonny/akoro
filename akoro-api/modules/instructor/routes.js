/**
 * instructor/routes.js  —  Instructor / Teacher Dashboard router (Phase 19 split)
 *
 * Mount in app.js:
 *   import instructorRouter from "./modules/instructor/index.js";
 *   app.use("/api/instructor", instructorRouter);
 *
 * Router and middleware only. Every handler is a thin reference to
 * service.js, which orchestrates the request:
 *
 *   routes.js → service.js → rules.js → store.js
 *
 *   service*.js   request orchestration, split by resource
 *   rules.js      pure predicates/normalisers (no db import)
 *   store*.js     every Supabase query (no Express import)
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § ROUTER
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }                         from "express";
import multerLib                          from "multer";
import { authenticateToken, requireRole } from "../auth/index.js";
import * as service                       from "./service.js";

// In-memory multer for course cover uploads (8 MB cap, images only).
const upload = multerLib({ storage: multerLib.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

// All routes require authentication and instructor/admin role
router.use(authenticateToken);

// Streaming + social credential storage is shared with the SCHOOL portal, so it
// must accept school roles too. Registered BEFORE the instructor/admin gate
// below (these only read/write the caller's own user_settings — safe).
const CRED_ROLES = ["instructor", "admin", "school", "school_admin", "teacher"];
router.get   ("/streaming",           requireRole(CRED_ROLES), service.getStreaming);
router.post  ("/streaming/connect",   requireRole(CRED_ROLES), service.connectStreaming);
router.delete("/streaming/:platform", requireRole(CRED_ROLES), service.disconnectStreaming);
router.get   ("/social",              requireRole(CRED_ROLES), service.getSocial);
router.post  ("/social/connect",      requireRole(CRED_ROLES), service.connectSocial);
router.delete("/social/:platform",    requireRole(CRED_ROLES), service.disconnectSocial);

router.use(requireRole(["instructor", "admin"]));

// Stats
router.get("/stats", service.getStats);

// Profile
router.get  ("/profile",        service.getProfile);
router.patch("/profile",               service.updateProfile);
router.patch("/profile/notifications", service.updateNotifications);
router.patch("/profile/agent",         service.updateAgent);

// Courses
router.get   ("/classrooms", service.listClassrooms);
router.get   ("/classrooms/:id/students", service.listClassroomStudents);
router.get   ("/courses",     service.listCourses);
router.post  ("/courses",     service.createCourse);
router.patch ("/courses/:id", service.updateCourse);
router.delete("/courses/:id", service.deleteCourse);

// POST /api/instructor/courses/upload — upload a course cover, returns { url }.
router.post("/courses/upload", upload.single("file"), service.uploadCourseCover);

// Live Sessions
router.get   ("/sessions",     service.listSessions);
router.post  ("/sessions",     service.createSession);
router.patch ("/sessions/:id", service.updateSession);
router.delete("/sessions/:id", service.deleteSession);

// Modules + recurrence schedule
router.get   ("/courses/:courseId/modules",          service.listModules);
router.post  ("/courses/:courseId/modules",          service.createModule);
router.patch ("/modules/:id",                        service.updateModule);
router.delete("/modules/:id",                        service.deleteModule);
router.post  ("/courses/:courseId/schedule/preview", service.previewSchedule);
router.post  ("/courses/:courseId/schedule/commit",  service.commitSchedule);
router.post  ("/courses/:courseId/curriculum",       service.commitCurriculum);

// Session materials
router.get   ("/sessions/:id/materials", service.listMaterials);
router.post  ("/sessions/:id/materials", service.addMaterial);
router.delete("/materials/:id",          service.deleteMaterial);

// Students
router.get   ("/students",                   service.listStudents);
router.post  ("/students",                   service.enrolStudent);
router.delete("/students/:enrollmentId",     service.removeStudent);

// Battles
router.get   ("/battles",     service.listBattles);
router.post  ("/battles",     service.createBattle);
router.patch ("/battles/:id", service.updateBattle);
router.delete("/battles/:id", service.deleteBattle);

// ── Document templates ──────────────────────────────────────────────────────
// Instructors' own document/form templates + the shared default gallery
// (lesson plan, report card, worksheet, certificate). Create, view as a real
// file, and generate filled documents.
router.get("/documents/templates", service.listDocTemplates);
router.post("/documents/templates", service.createDocTemplate);
// AI-create a document template from an uploaded sample's OCR text.
router.post("/documents/templates/from-sample", service.createDocTemplateFromSample);
router.put("/documents/templates/:id", service.updateDocTemplate);
router.delete("/documents/templates/:id", service.deleteDocTemplate);
router.get("/documents/templates/:id/html", service.docTemplateHtml);
router.post("/documents/templates/:id/render", service.renderDocTemplate);
router.post("/documents/preview", service.previewDocument);

export default router;
