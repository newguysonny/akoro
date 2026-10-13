/**
 * peer-sessions.js  —  Piabam Student-Hosted Peer Revision Sessions router
 *
 * Students create their own revision rooms.
 * Meetings are created using the COURSE INSTRUCTOR's stored provider_tokens —
 * not the student's — ensuring meetings are on a reliable school-owned account.
 *
 * Usage in app.js:
 *   import peerSessionsRouter from "./routes/peer-sessions.js";
 *   app.use("/api", peerSessionsRouter);
 */

import { Router }                         from "express";
import { body, validationResult }         from "express-validator";
import db                                 from "../../db.js";
import { authenticateToken }              from "../auth/routes.js";
import { createMeeting }                  from "./meeting-integration.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
const res201 = (res, data)            => res.status(201).json({ success: true,  data });
const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).json({ success: false, message: "Validation failed", errors: errors.array({ onlyFirstError: true }) });
  next();
};

const now = () => new Date().toISOString();

const SESSION_SELECT = `
  id, title, topic, subject, scheduled_start, scheduled_end,
  actual_start, actual_end, platform, meeting_url, meeting_password,
  max_participants, current_participants, status, recording_url,
  created_at, updated_at,
  host:users!peer_sessions_host_student_id_fkey ( id, full_name, username, avatar_url ),
  instructor:users!peer_sessions_instructor_id_fkey ( id, full_name, username )
`;

const handlers = {

  /**
   * GET /api/courses/:courseId/peer-sessions
   */
  list: asyncHandler(async (req, res) => {
    const { status } = req.query;

    let query = db
      .from("peer_sessions")
      .select(SESSION_SELECT)
      .eq("course_id", req.params.courseId)
      .order("scheduled_start", { ascending: true });

    if (status) query = query.eq("status", status);

    const { data: sessions, error } = await query;
    if (error) throw new Error(error.message);

    // Enrich with registration status + participant count
    const enriched = await Promise.all((sessions ?? []).map(async (s) => {
      const { data: reg } = await db
        .from("peer_session_participants")
        .select("status")
        .eq("peer_session_id", s.id)
        .eq("user_id", req.user.id)
        .single();

      const { count } = await db
        .from("peer_session_participants")
        .select("id", { count: "exact", head: true })
        .eq("peer_session_id", s.id);

      // Hide meeting URL from unregistered users when not live
      const showUrl = reg || s.status === "live" || s.host?.id === req.user.id;

      return {
        ...s,
        meeting_url:        showUrl ? s.meeting_url : null,
        meeting_password:   showUrl ? s.meeting_password : null,
        is_registered:      !!reg,
        participant_status: reg?.status ?? null,
        participant_count:  count ?? 0,
      };
    }));

    res200(res, enriched, { total: enriched.length });
  }),

  /**
   * GET /api/peer-sessions/:sessionId
   */
  get: asyncHandler(async (req, res) => {
    const { data: session, error } = await db
      .from("peer_sessions")
      .select(SESSION_SELECT)
      .eq("id", req.params.sessionId)
      .single();

    if (error || !session) return res404(res, "Peer session not found");

    const { data: reg } = await db
      .from("peer_session_participants")
      .select("status, joined_at")
      .eq("peer_session_id", session.id)
      .eq("user_id", req.user.id)
      .single();

    const { count } = await db
      .from("peer_session_participants")
      .select("id", { count: "exact", head: true })
      .eq("peer_session_id", session.id);

    res200(res, {
      ...session,
      is_registered:      !!reg,
      participant_status: reg?.status ?? null,
      participant_count:  count ?? 0,
    });
  }),

  /**
   * POST /api/courses/:courseId/peer-sessions
   * Student creates a revision room.
   * Meeting is created via the INSTRUCTOR's stored token.
   */
  create: asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const {
      title, topic, subject,
      scheduled_start, duration_min = 60,
      timezone = "Africa/Lagos",
      max_participants = 15,
    } = req.body;

    // Must be enrolled
    const { data: enrollment } = await db
      .from("enrollments")
      .select("id")
      .eq("user_id", req.user.id)
      .eq("course_id", courseId)
      .eq("status", "active")
      .single();

    if (!enrollment)
      return res403(res, "You must be enrolled in this course to host a peer session");

    // Get course instructor
    const { data: course } = await db
      .from("courses")
      .select("instructor_id, title")
      .eq("id", courseId)
      .single();

    if (!course) return res404(res, "Course not found");

    // Create meeting using INSTRUCTOR's token
    let meeting;
    try {
      meeting = await createMeeting(course.instructor_id, {
        topic:      `[Peer Revision] ${title} — ${course.title}`,
        startTime:  scheduled_start,
        durationMin: duration_min,
        timezone,
      });
    } catch (e) {
      return res400(res, `Could not create meeting: ${e.message}. The instructor may need to reconnect their meeting platform.`);
    }

    const { data: session, error } = await db
      .from("peer_sessions")
      .insert({
        course_id:        courseId,
        host_student_id:  req.user.id,
        instructor_id:    course.instructor_id,
        title,
        topic:            topic ?? null,
        subject:          subject ?? null,
        scheduled_start,
        scheduled_end:    new Date(new Date(scheduled_start).getTime() + duration_min * 60_000).toISOString(),
        platform:         meeting.platform,
        meeting_id:       meeting.meetingId,
        meeting_url:      meeting.meetingUrl,
        meeting_password: meeting.password ?? null,
        max_participants,
        status:           "upcoming",
      })
      .select(SESSION_SELECT)
      .single();

    if (error) throw new Error(error.message);

    // Auto-register the host
    await db.from("peer_session_participants").insert({
      peer_session_id: session.id,
      user_id:         req.user.id,
      status:          "registered",
    });

    console.log(`[peer-sessions] ✅ Created by student=${req.user.id}  session=${session.id}  platform=${meeting.platform}`);

    res201(res, {
      ...session,
      note: "Meeting created via course instructor's account",
    });
  }),

  /**
   * PUT /api/peer-sessions/:sessionId
   * Host can update title, topic, scheduled_start.
   */
  update: asyncHandler(async (req, res) => {
    const { data: session } = await db
      .from("peer_sessions")
      .select("host_student_id, status")
      .eq("id", req.params.sessionId)
      .single();

    if (!session) return res404(res, "Peer session not found");
    if (session.host_student_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Only the host can update this session");
    if (session.status !== "upcoming")
      return res400(res, "Cannot update a session that is already live or ended");

    const allowed = ["title", "topic", "subject", "scheduled_start", "max_participants"];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    updates.updated_at = now();

    const { data, error } = await db
      .from("peer_sessions")
      .update(updates)
      .eq("id", req.params.sessionId)
      .select(SESSION_SELECT)
      .single();

    if (error) throw new Error(error.message);
    res200(res, data);
  }),

  /**
   * DELETE /api/peer-sessions/:sessionId
   * Cancel session (host or instructor).
   */
  cancel: asyncHandler(async (req, res) => {
    const { data: session } = await db
      .from("peer_sessions")
      .select("host_student_id, instructor_id, status, title")
      .eq("id", req.params.sessionId)
      .single();

    if (!session) return res404(res, "Peer session not found");

    const canCancel =
      session.host_student_id === req.user.id ||
      session.instructor_id   === req.user.id ||
      req.user.role           === "admin";

    if (!canCancel) return res403(res, "Not authorised to cancel this session");

    await db
      .from("peer_sessions")
      .update({ status: "cancelled", updated_at: now() })
      .eq("id", req.params.sessionId);

    res200(res, { message: "Session cancelled" });
  }),

  /**
   * POST /api/peer-sessions/:sessionId/join
   * Returns meeting URL. Marks participant as joined.
   */
  join: asyncHandler(async (req, res) => {
    const { data: session } = await db
      .from("peer_sessions")
      .select("id, status, meeting_url, meeting_password, platform, title, max_participants, current_participants, course_id")
      .eq("id", req.params.sessionId)
      .single();

    if (!session) return res404(res, "Peer session not found");
    if (session.status !== "live")
      return res400(res, `Session is not live yet (status: ${session.status})`);

    if (session.current_participants >= session.max_participants)
      return res400(res, "Session is at full capacity");

    // Must be enrolled in the course
    const { data: enrollment } = await db
      .from("enrollments")
      .select("id")
      .eq("user_id", req.user.id)
      .eq("course_id", session.course_id)
      .eq("status", "active")
      .single();

    if (!enrollment && req.user.role === "student")
      return res403(res, "You must be enrolled in this course to join");

    // Upsert participant
    const { data: existing } = await db
      .from("peer_session_participants")
      .select("id")
      .eq("peer_session_id", session.id)
      .eq("user_id", req.user.id)
      .single();

    if (existing) {
      await db
        .from("peer_session_participants")
        .update({ status: "joined", joined_at: now() })
        .eq("id", existing.id);
    } else {
      await db.from("peer_session_participants").insert({
        peer_session_id: session.id,
        user_id:         req.user.id,
        status:          "joined",
        joined_at:       now(),
      });
    }

    // Update count
    const { count } = await db
      .from("peer_session_participants")
      .select("id", { count: "exact", head: true })
      .eq("peer_session_id", session.id)
      .eq("status", "joined");

    await db
      .from("peer_sessions")
      .update({ current_participants: count ?? 0 })
      .eq("id", session.id);

    res200(res, {
      meeting_url:      session.meeting_url,
      meeting_password: session.meeting_password,
      platform:         session.platform,
      session_title:    session.title,
    });
  }),

  /**
   * POST /api/peer-sessions/:sessionId/leave
   */
  leave: asyncHandler(async (req, res) => {
    const { data: reg } = await db
      .from("peer_session_participants")
      .select("id, joined_at")
      .eq("peer_session_id", req.params.sessionId)
      .eq("user_id", req.user.id)
      .single();

    if (!reg) return res404(res, "Participant record not found");

    await db
      .from("peer_session_participants")
      .update({ status: "left", left_at: now() })
      .eq("id", reg.id);

    const { count } = await db
      .from("peer_session_participants")
      .select("id", { count: "exact", head: true })
      .eq("peer_session_id", req.params.sessionId)
      .eq("status", "joined");

    await db
      .from("peer_sessions")
      .update({ current_participants: count ?? 0 })
      .eq("id", req.params.sessionId);

    res200(res, { message: "Left session" });
  }),

  /**
   * POST /api/peer-sessions/:sessionId/start
   * Host marks session as live.
   */
  start: asyncHandler(async (req, res) => {
    const { data: session } = await db
      .from("peer_sessions")
      .select("host_student_id, status, title, course_id")
      .eq("id", req.params.sessionId)
      .single();

    if (!session) return res404(res, "Peer session not found");
    if (session.host_student_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Only the host can start this session");
    if (session.status !== "upcoming")
      return res400(res, `Cannot start a session with status: ${session.status}`);

    await db
      .from("peer_sessions")
      .update({ status: "live", actual_start: now(), updated_at: now() })
      .eq("id", req.params.sessionId);

    // Notify course chat room
    req.app.get("io")?.to(`chat:${session.course_id}`).emit("system-alert", {
      text: `Peer revision session "${session.title}" is now live!`,
    });

    res200(res, { status: "live", message: "Session started" });
  }),

  /**
   * POST /api/peer-sessions/:sessionId/end
   * Host ends the session.
   */
  end: asyncHandler(async (req, res) => {
    const { data: session } = await db
      .from("peer_sessions")
      .select("host_student_id, status")
      .eq("id", req.params.sessionId)
      .single();

    if (!session) return res404(res, "Peer session not found");
    if (session.host_student_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Only the host can end this session");
    if (session.status !== "live")
      return res400(res, "Session is not currently live");

    await db
      .from("peer_sessions")
      .update({ status: "ended", actual_end: now(), updated_at: now() })
      .eq("id", req.params.sessionId);

    res200(res, { status: "ended", message: "Session ended" });
  }),
};

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

router.get   ("/courses/:courseId/peer-sessions",       authenticateToken, handlers.list);
router.post  ("/courses/:courseId/peer-sessions",       authenticateToken, [
  body("title").trim().notEmpty(),
  body("scheduled_start").isISO8601(),
], runValidation, handlers.create);

router.get   ("/peer-sessions/:sessionId",              authenticateToken, handlers.get);
router.put   ("/peer-sessions/:sessionId",              authenticateToken, handlers.update);
router.delete("/peer-sessions/:sessionId",              authenticateToken, handlers.cancel);
router.post  ("/peer-sessions/:sessionId/join",         authenticateToken, handlers.join);
router.post  ("/peer-sessions/:sessionId/leave",        authenticateToken, handlers.leave);
router.post  ("/peer-sessions/:sessionId/start",        authenticateToken, handlers.start);
router.post  ("/peer-sessions/:sessionId/end",          authenticateToken, handlers.end);

export default router;
