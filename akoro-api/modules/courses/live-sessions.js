/**
 * live-sessions.js  —  Piabam Live Session Lifecycle router
 *
 * Runs on: Railway (API server)
 *
 * Handles:
 *   - Create session → auto-creates meeting via meeting-integration
 *   - List, get, update, cancel sessions
 *   - Student join (capacity check + waitlist)
 *   - Student leave / check-out
 *   - Instructor start session → notify all participants via Socket.io
 *   - Instructor end session → compute attendance analytics
 *   - Recording URL upload
 *   - Participant list + attendance (instructor)
 *   - Post-session feedback (student)
 *   - Student upcoming sessions dashboard
 *   - Waitlist join
 *
 * Usage in app.js:
 *   import liveSessionsRouter from "./modules/courses/live-sessions.js";
 *   app.use("/api", liveSessionsRouter);
 *
 * The lifecycle is split into layers inside this module:
 *   routes  → live-sessions.js (this file, mounted entry)
 *   service → live-sessions-service.js, -service-host.js, -service-reads.js
 *   rules   → live-sessions-rules.js (validation chains + field allowlist)
 *   store   → live-sessions-store.js (Supabase queries, no Express)
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }                          from "express";
import { validationResult }                from "express-validator";
import { authenticateToken, requireRole }  from "../auth/index.js";
import * as store                          from "./live-sessions-store.js";
import { sessionRules as rules }           from "./live-sessions-rules.js";
import {
  asyncHandler, res403, res404, sessionHandlers, participantHandlers,
} from "./live-sessions-service.js";
import { hostHandlers, analyticsHandler }  from "./live-sessions-service-host.js";
import {
  curriculumHandler, dashboardHandler, instructorSessionsHandler, replayHandler,
} from "./live-sessions-service-reads.js";

// ─── § VALIDATION ─────────────────────────────────────────────────────────────

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

/**
 * The session's own instructor (or an admin). The participant list carries
 * learners' emails, so the instructor role alone is not enough (Phase 15 item 6).
 */
const requireSessionHost = asyncHandler(async (req, res, next) => {
  const session = await store.findSessionHost(req.params.sessionId);
  if (!session) return res404(res, "Session not found");
  if (session.instructor_id !== req.user.id && req.user.role !== "admin") return res403(res, "Not your session");
  next();
});

// Session CRUD
router.post  ("/courses/:courseId/live-sessions",            authenticateToken, requireRole(["instructor", "admin"]), rules.create, runValidation, sessionHandlers.create);
router.get   ("/courses/:courseId/live-sessions",            authenticateToken, sessionHandlers.list);
router.get   ("/live-sessions/:sessionId",                   authenticateToken, sessionHandlers.get);
router.put   ("/live-sessions/:sessionId",                   authenticateToken, requireRole(["instructor", "admin"]), rules.update, runValidation, sessionHandlers.update);
router.delete("/live-sessions/:sessionId",                   authenticateToken, requireRole(["instructor", "admin"]), sessionHandlers.cancel);

// Student participation
router.post("/live-sessions/:sessionId/register",            authenticateToken, participantHandlers.register);
router.post("/live-sessions/:sessionId/join",                authenticateToken, participantHandlers.join);
router.post("/live-sessions/:sessionId/leave",               authenticateToken, participantHandlers.leave);
router.post("/live-sessions/:sessionId/feedback",            authenticateToken, rules.feedback, runValidation, hostHandlers.feedback);

// Instructor controls
router.post("/live-sessions/:sessionId/start",               authenticateToken, requireRole(["instructor", "admin"]), hostHandlers.start);
router.post("/live-sessions/:sessionId/end",                 authenticateToken, requireRole(["instructor", "admin"]), hostHandlers.end);
router.put ("/live-sessions/:sessionId/recording",           authenticateToken, requireRole(["instructor", "admin"]), hostHandlers.updateRecording);
router.get ("/live-sessions/:sessionId/participants",        authenticateToken, requireRole(["instructor", "admin"]), requireSessionHost, hostHandlers.listParticipants);
router.get ("/live-sessions/:sessionId/analytics",           authenticateToken, requireRole(["instructor", "admin"]), requireSessionHost, analyticsHandler);

// Dashboards
router.get("/courses/:courseId/curriculum",                  authenticateToken, curriculumHandler);
router.get("/user/sessions",                                 authenticateToken, dashboardHandler);
router.get("/instructor/sessions",                           authenticateToken, requireRole(["instructor", "admin"]), instructorSessionsHandler);

// Recording playback
router.get("/live-sessions/:sessionId/replay",               authenticateToken, replayHandler);

export default router;
