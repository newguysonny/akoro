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
 *   import liveSessionsRouter from "./routes/live-sessions.js";
 *   app.use("/api", liveSessionsRouter);
 *
 * ─── Sections ────────────────────────────────────────────────────────────────
 *  § IMPORTS
 *  § HELPERS
 *  § VALIDATION RULES
 *  § SESSION HANDLERS    create, list, get, update, cancel
 *  § PARTICIPANT HANDLERS join, leave, start, end, recording, feedback
 *  § WAITLIST HANDLER
 *  § ANALYTICS HANDLER
 *  § DASHBOARD HANDLER   student upcoming sessions
 *  § ROUTER
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── § IMPORTS ────────────────────────────────────────────────────────────────

import { Router }                          from "express";
import { body, param, query, validationResult } from "express-validator";
import db                                  from "../../db.js";
import { authenticateToken, requireRole }  from "../auth/routes.js";
import { createMeeting, endMeeting }       from "./meeting-integration.js";

// ─── § HELPERS ────────────────────────────────────────────────────────────────

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

// ─── § VALIDATION RULES ───────────────────────────────────────────────────────

const rules = {
  create: [
    body("title").trim().notEmpty().withMessage("title is required"),
    body("scheduled_start").isISO8601().withMessage("scheduled_start must be a valid ISO date"),
    body("platform").optional().isIn(["zoom", "meet", "teams"]),
    body("session_type").optional().isIn(["class", "revision", "office_hours"]),
    body("max_participants").optional().isInt({ min: 1, max: 500 }),
    body("description").optional().trim(),
    body("topic").optional().trim(),
  ],
  update: [
    body("title").optional().trim().notEmpty(),
    body("scheduled_start").optional().isISO8601(),
    body("description").optional().trim(),
    body("topic").optional().trim(),
    body("max_participants").optional().isInt({ min: 1, max: 500 }),
  ],
  feedback: [
    body("rating").isInt({ min: 1, max: 5 }).withMessage("rating must be 1–5"),
    body("feedback_text").optional().trim().isLength({ max: 1000 }),
  ],
};

// ─── § SESSION HANDLERS ───────────────────────────────────────────────────────

const sessionHandlers = {

  /**
   * POST /api/courses/:courseId/live-sessions
   * Instructor creates a session.
   * Auto-creates meeting on Zoom/Meet/Teams and registers all enrolled students.
   */
  create: asyncHandler(async (req, res) => {
    const { courseId } = req.params;
    const {
      title, scheduled_start, description, topic,
      platform, max_participants = 50,
      session_type = "class",
    } = req.body;

    // Verify instructor owns course
    const { data: course } = await db
      .from("courses")
      .select("id, title, instructor_id, subject")
      .eq("id", courseId)
      .single();

    if (!course) return res404(res, "Course not found");
    if (course.instructor_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "You do not own this course");

    // Create meeting on platform
    const meeting = await createMeeting(req.user.id, {
      topic:      title,
      startTime:  scheduled_start,
      durationMin: 90,
      platform,
    });

    // Insert session record
    const { data: session, error: sessionErr } = await db
      .from("live_sessions")
      .insert({
        course_id:        courseId,
        instructor_id:    req.user.id,
        title,
        description:      description ?? null,
        topic:            topic ?? null,
        subject:          course.subject ?? null,
        session_type,
        scheduled_start,
        platform:         meeting.platform,
        meeting_id:       meeting.meetingId,
        meeting_password: meeting.password ?? null,
        meeting_url:      meeting.meetingUrl,
        join_url:         meeting.joinUrl,
        max_participants,
        status:           "scheduled",
      })
      .select()
      .single();

    if (sessionErr) throw new Error(sessionErr.message);

    // Register all currently enrolled students as participants
    const { data: enrollments } = await db
      .from("enrollments")
      .select("id, user_id")
      .eq("course_id", courseId)
      .eq("status", "active");

    if (enrollments?.length) {
      const participants = enrollments.map((e) => ({
        session_id:    session.id,
        user_id:       e.user_id,
        enrollment_id: e.id,
        status:        "registered",
      }));

      await db.from("session_participants").insert(participants);
    }

    // Initialise analytics row
    await db.from("session_analytics").insert({
      session_id:       session.id,
      total_registered: enrollments?.length ?? 0,
      peak_concurrent:  0,
    });

    // Schedule reminder notifications via BullMQ (imported lazily to avoid circular deps)
    try {
      const { sessionQueue } = await import("../workers/sessionNotifier.js");
      await sessionQueue.add("schedule-reminders", {
        sessionId:      session.id,
        scheduledStart: scheduled_start,
        courseTitle:    course.title,
        sessionTitle:   title,
        meetingUrl:     meeting.joinUrl,
        participantIds: enrollments?.map((e) => e.user_id) ?? [],
      });
    } catch (e) {
      console.warn("[live-sessions] sessionQueue not available:", e.message);
    }

    console.log(`[live-sessions] ✅ Created session=${session.id}  participants=${enrollments?.length ?? 0}`);

    res201(res, {
      ...session,
      participant_count: enrollments?.length ?? 0,
    });
  }),

  /**
   * GET /api/courses/:courseId/live-sessions
   * List sessions for a course. Optional ?status= and ?upcoming= filters.
   */
  list: asyncHandler(async (req, res) => {
    const { courseId }                   = req.params;
    const { status, upcoming, limit = 20, offset = 0 } = req.query;

    let query = db
      .from("live_sessions")
      .select(`
        id, title, description, topic, session_type,
        scheduled_start, scheduled_end, actual_start, actual_end,
        platform, join_url, meeting_password,
        max_participants, current_participants, waitlist_enabled,
        status, recording_url, created_at,
        users!live_sessions_instructor_id_fkey ( id, full_name, avatar_url )
      `)
      .eq("course_id", courseId)
      .order("scheduled_start", { ascending: true })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status && status !== "all") query = query.eq("status", status);
    if (upcoming === "true") query = query.gt("scheduled_start", now()).eq("status", "scheduled");

    const { data: sessions, error } = await query;
    if (error) throw new Error(error.message);

    // Enrich with current user's registration status
    const enriched = await Promise.all((sessions ?? []).map(async (s) => {
      const { data: reg } = await db
        .from("session_participants")
        .select("status, joined_at")
        .eq("session_id", s.id)
        .eq("user_id", req.user.id)
        .single();

      // Redact meeting password for non-instructors unless session is live
      if (req.user.role === "student" && s.status !== "live") {
        delete s.meeting_password;
      }

      return {
        ...s,
        is_registered:       !!reg,
        participant_status:  reg?.status ?? null,
        can_join: s.status === "live" && !!reg && s.current_participants < s.max_participants,
      };
    }));

    res200(res, enriched, { total: enriched.length });
  }),

  /**
   * GET /api/live-sessions/:sessionId
   */
  get: asyncHandler(async (req, res) => {
    const { data: session, error } = await db
      .from("live_sessions")
      .select(`
        *,
        users!live_sessions_instructor_id_fkey ( id, full_name, avatar_url, username )
      `)
      .eq("id", req.params.sessionId)
      .single();

    if (error || !session) return res404(res, "Session not found");

    // Student registration status
    const { data: reg } = await db
      .from("session_participants")
      .select("status, joined_at, reminder_24h_sent, reminder_1h_sent")
      .eq("session_id", session.id)
      .eq("user_id", req.user.id)
      .single();

    if (req.user.role === "student" && session.status !== "live") {
      delete session.meeting_password;
    }

    res200(res, { ...session, registration: reg ?? null });
  }),

  /**
   * PUT /api/live-sessions/:sessionId
   * Update session details (instructor only).
   */
  update: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const allowed = ["title", "description", "topic", "scheduled_start", "scheduled_end", "max_participants"];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    updates.updated_at = now();

    const { data, error } = await db
      .from("live_sessions")
      .update(updates)
      .eq("id", sessionId)
      .eq("instructor_id", req.user.id)
      .select()
      .single();

    if (error || !data) return res404(res, "Session not found or not authorised");
    res200(res, data);
  }),

  /**
   * DELETE /api/live-sessions/:sessionId
   * Cancel a session — notifies all registered participants.
   */
  cancel: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const { data: session } = await db
      .from("live_sessions")
      .select("id, status, meeting_id, platform, instructor_id, title, course_id")
      .eq("id", sessionId)
      .single();

    if (!session) return res404(res, "Session not found");
    if (session.instructor_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Not authorised");
    if (session.status === "ended" || session.status === "cancelled")
      return res400(res, `Cannot cancel a session with status: ${session.status}`);

    // End meeting on platform
    if (session.meeting_id) {
      await endMeeting(session.instructor_id, session.platform, session.meeting_id)
        .catch((e) => console.warn("[live-sessions] endMeeting failed:", e.message));
    }

    await db
      .from("live_sessions")
      .update({ status: "cancelled", updated_at: now() })
      .eq("id", sessionId);

    // Notify participants
    const io = req.app.get("io");
    io?.to(`session:${sessionId}`).emit("session-cancelled", {
      sessionId,
      title: session.title,
      message: "This session has been cancelled",
    });

    res200(res, { message: "Session cancelled" });
  }),
};

// ─── § PARTICIPANT HANDLERS ───────────────────────────────────────────────────

const participantHandlers = {

  /**
   * POST /api/live-sessions/:sessionId/register
   * Student pre-registers for a session before it goes live.
   * Added to waitlist if session is full.
   */
  register: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId        = req.user.id;

    const { data: session } = await db
      .from("live_sessions")
      .select("id, course_id, title, scheduled_start, join_url, max_participants, status")
      .eq("id", sessionId)
      .single();

    if (!session) return res404(res, "Session not found");
    if (session.status === "cancelled") return res400(res, "Session has been cancelled");

    // Verify enrollment
    const { data: enrollment } = await db
      .from("enrollments")
      .select("id")
      .eq("user_id", userId)
      .eq("course_id", session.course_id)
      .eq("status", "active")
      .single();

    if (!enrollment) return res403(res, "You must be enrolled in this course to register");

    // Check if already registered
    const { data: existing } = await db
      .from("session_participants")
      .select("id, status")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .single();

    if (existing) return res400(res, `Already registered (status: ${existing.status})`);

    // Check capacity
    const { count } = await db
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("status", "registered");

    if ((count ?? 0) >= session.max_participants) {
      // Add to waitlist
      const { count: wlCount } = await db
        .from("session_waitlist")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sessionId);

      await db.from("session_waitlist").insert({
        session_id: sessionId,
        user_id:    userId,
        position:   (wlCount ?? 0) + 1,
      });

      return res200(res, {
        waitlisted:       true,
        waitlist_position: (wlCount ?? 0) + 1,
        message:          "Session is full. You have been added to the waitlist.",
      });
    }

    await db.from("session_participants").insert({
      session_id:    sessionId,
      user_id:       userId,
      enrollment_id: enrollment.id,
      status:        "registered",
    });

    res201(res, {
      registered: true,
      session_title:   session.title,
      scheduled_start: session.scheduled_start,
      message:         "Successfully registered for session",
    });
  }),

  /**
   * POST /api/live-sessions/:sessionId/join
   * Student joins a live session → returns meeting URL.
   */
  join: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId        = req.user.id;

    const { data: session } = await db
      .from("live_sessions")
      .select("id, status, join_url, meeting_password, platform, title, max_participants, current_participants, course_id, instructor_id")
      .eq("id", sessionId)
      .single();

    if (!session) return res404(res, "Session not found");
    if (session.status !== "live")
      return res400(res, `Session is not live yet (status: ${session.status})`);

    // Check capacity
    if (session.current_participants >= session.max_participants) {
      // Add to waitlist if not already there
      await db.from("session_waitlist").upsert(
        { session_id: sessionId, user_id: userId },
        { onConflict: "session_id,user_id" }
      );
      return res400(res, "Session is full. You have been added to the waitlist.");
    }

    // Upsert participant as joined
    const { data: reg } = await db
      .from("session_participants")
      .select("id")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .single();

    if (reg) {
      await db
        .from("session_participants")
        .update({ status: "joined", joined_at: now() })
        .eq("id", reg.id);
    } else {
      // Allow join without prior registration (e.g. revision sessions)
      const { data: enrollment } = await db
        .from("enrollments")
        .select("id")
        .eq("user_id", userId)
        .eq("course_id", session.course_id)
        .eq("status", "active")
        .single();

      if (!enrollment && req.user.role === "student")
        return res403(res, "You must be enrolled to join this session");

      await db.from("session_participants").insert({
        session_id:    sessionId,
        user_id:       userId,
        enrollment_id: enrollment?.id ?? null,
        status:        "joined",
        joined_at:     now(),
      });
    }

    // Update current_participants count
    const { count } = await db
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("status", "joined");

    await db
      .from("live_sessions")
      .update({ current_participants: count ?? 0 })
      .eq("id", sessionId);

    // Update peak concurrent in analytics
    await db
      .from("session_analytics")
      .update({ peak_concurrent: count ?? 0 })
      .eq("session_id", sessionId)
      .lt("peak_concurrent", count ?? 0);

    res200(res, {
      meeting_url:      session.join_url,
      meeting_password: session.meeting_password,
      platform:         session.platform,
      session_title:    session.title,
    });
  }),

  /**
   * POST /api/live-sessions/:sessionId/leave
   * Student checks out of a session.
   */
  leave: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId        = req.user.id;

    const { data: reg } = await db
      .from("session_participants")
      .select("id, joined_at")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .single();

    if (!reg) return res404(res, "Participant record not found");

    const durationMin = reg.joined_at
      ? Math.round((Date.now() - new Date(reg.joined_at).getTime()) / 60000)
      : 0;

    await db
      .from("session_participants")
      .update({ status: "left", left_at: now(), duration_minutes: durationMin })
      .eq("id", reg.id);

    // Decrement count
    const { count } = await db
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("status", "joined");

    await db
      .from("live_sessions")
      .update({ current_participants: count ?? 0 })
      .eq("id", sessionId);

    res200(res, { message: "Left session", duration_minutes: durationMin });
  }),

  /**
   * POST /api/live-sessions/:sessionId/start
   * Instructor marks session as live → broadcasts via Socket.io.
   */
  start: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const { data: session } = await db
      .from("live_sessions")
      .select("id, title, join_url, course_id, instructor_id, status")
      .eq("id", sessionId)
      .single();

    if (!session) return res404(res, "Session not found");
    if (session.instructor_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Not authorised");
    if (session.status !== "scheduled")
      return res400(res, `Cannot start a session with status: ${session.status}`);

    await db
      .from("live_sessions")
      .update({ status: "live", actual_start: now(), updated_at: now() })
      .eq("id", sessionId);

    // Get all registered participants for notification
    const { data: participants } = await db
      .from("session_participants")
      .select("user_id, users(email, full_name, phone)")
      .eq("session_id", sessionId)
      .eq("status", "registered");

    // Broadcast via Socket.io to session room
    const io = req.app.get("io");
    io?.to(`session:${sessionId}`).emit("session-started", {
      sessionId,
      title:      session.title,
      meetingUrl: session.join_url,
    });

    // Also broadcast to course chat room
    io?.to(`chat:${session.course_id}`).emit("system-alert", {
      text: `🔴 "${session.title}" is now LIVE! Join now →`,
      meetingUrl: session.join_url,
    });

    // Trigger started notifications via notificationService
    try {
      const { sendSessionNotifications } = await import("../services/notificationService.js");
      await sendSessionNotifications({
        type:          "session_started",
        sessionId,
        sessionTitle:  session.title,
        meetingUrl:    session.join_url,
        participants:  participants ?? [],
      });
    } catch (e) {
      console.warn("[live-sessions] notificationService not available:", e.message);
    }

    res200(res, {
      status:           "live",
      participant_count: participants?.length ?? 0,
      message:          "Session started",
    });
  }),

  /**
   * POST /api/live-sessions/:sessionId/end
   * Instructor ends the session → compute attendance analytics.
   */
  end: asyncHandler(async (req, res) => {
    const { sessionId }    = req.params;
    const { recording_url } = req.body;

    const { data: session } = await db
      .from("live_sessions")
      .select("id, status, meeting_id, platform, instructor_id, title, course_id")
      .eq("id", sessionId)
      .single();

    if (!session) return res404(res, "Session not found");
    if (session.instructor_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Not authorised");
    if (session.status !== "live")
      return res400(res, "Session is not currently live");

    // End meeting on platform
    if (session.meeting_id) {
      await endMeeting(session.instructor_id, session.platform, session.meeting_id)
        .catch((e) => console.warn("[live-sessions] endMeeting failed:", e.message));
    }

    await db
      .from("live_sessions")
      .update({
        status:        "ended",
        actual_end:    now(),
        recording_url: recording_url ?? null,
        updated_at:    now(),
      })
      .eq("id", sessionId);

    // Mark all still-joined participants as attended
    const { data: joinedParticipants } = await db
      .from("session_participants")
      .select("id, joined_at")
      .eq("session_id", sessionId)
      .eq("status", "joined");

    for (const p of (joinedParticipants ?? [])) {
      const durMin = p.joined_at
        ? Math.round((Date.now() - new Date(p.joined_at).getTime()) / 60000)
        : 0;
      await db
        .from("session_participants")
        .update({ status: "left", attended: true, left_at: now(), duration_minutes: durMin })
        .eq("id", p.id);
    }

    // Compute analytics
    const { count: totalReg } = await db
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);

    const { count: totalAtt } = await db
      .from("session_participants")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("attended", true);

    const attendanceRate = totalReg
      ? Math.round(((totalAtt ?? 0) / totalReg) * 100 * 100) / 100
      : 0;

    await db
      .from("session_analytics")
      .update({
        total_registered: totalReg ?? 0,
        total_attended:   totalAtt ?? 0,
        attendance_rate:  attendanceRate,
      })
      .eq("session_id", sessionId);

    // Broadcast via Socket.io
    const io = req.app.get("io");
    io?.to(`session:${sessionId}`).emit("session-ended", {
      sessionId,
      recording_url: recording_url ?? null,
    });

    // Notify attendees that recording is available
    if (recording_url) {
      const { data: attended } = await db
        .from("session_participants")
        .select("user_id, users(email, full_name)")
        .eq("session_id", sessionId)
        .eq("attended", true);

      try {
        const { sendSessionNotifications } = await import("../services/notificationService.js");
        await sendSessionNotifications({
          type:         "recording_available",
          sessionId,
          sessionTitle: session.title,
          recordingUrl: recording_url,
          participants: attended ?? [],
        });
      } catch (e) {
        console.warn("[live-sessions] notificationService not available:", e.message);
      }
    }

    res200(res, {
      status:           "ended",
      total_registered: totalReg ?? 0,
      total_attended:   totalAtt ?? 0,
      attendance_rate:  attendanceRate,
      recording_url:    recording_url ?? null,
    });
  }),

  /**
   * PUT /api/live-sessions/:sessionId/recording
   * Upload or update recording URL after session ends.
   */
  updateRecording: asyncHandler(async (req, res) => {
    const { recording_url } = req.body;
    if (!recording_url) return res400(res, "recording_url is required");

    const { data, error } = await db
      .from("live_sessions")
      .update({ recording_url, status: "recorded", updated_at: now() })
      .eq("id", req.params.sessionId)
      .eq("instructor_id", req.user.id)
      .select()
      .single();

    if (error || !data) return res404(res, "Session not found or not authorised");
    res200(res, data);
  }),

  /**
   * GET /api/live-sessions/:sessionId/participants
   * List participants with attendance status (instructor only).
   */
  listParticipants: asyncHandler(async (req, res) => {
    const { data, error } = await db
      .from("session_participants")
      .select(`
        id, status, joined_at, left_at, duration_minutes,
        attended, feedback_rating, feedback_text,
        users ( id, full_name, username, email, avatar_url )
      `)
      .eq("session_id", req.params.sessionId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  /**
   * POST /api/live-sessions/:sessionId/feedback
   * Student submits post-session rating and feedback.
   */
  feedback: asyncHandler(async (req, res) => {
    const { rating, feedback_text } = req.body;

    const { data, error } = await db
      .from("session_participants")
      .update({ feedback_rating: rating, feedback_text: feedback_text ?? null })
      .eq("session_id", req.params.sessionId)
      .eq("user_id", req.user.id)
      .select()
      .single();

    if (error || !data) return res404(res, "Participation record not found");

    // Update avg_rating in session_analytics
    const { data: ratings } = await db
      .from("session_participants")
      .select("feedback_rating")
      .eq("session_id", req.params.sessionId)
      .not("feedback_rating", "is", null);

    if (ratings?.length) {
      const avg = ratings.reduce((s, r) => s + r.feedback_rating, 0) / ratings.length;
      await db
        .from("session_analytics")
        .update({ avg_rating: Math.round(avg * 100) / 100 })
        .eq("session_id", req.params.sessionId);
    }

    res200(res, { message: "Feedback submitted", feedback_rating: rating });
  }),
};

// ─── § WAITLIST HANDLER ───────────────────────────────────────────────────────

const waitlistHandler = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;

  const { data: session } = await db
    .from("live_sessions")
    .select("id, max_participants, waitlist_enabled, course_id")
    .eq("id", sessionId)
    .single();

  if (!session)                return res404(res, "Session not found");
  if (!session.waitlist_enabled) return res400(res, "Waitlist is not enabled for this session");

  const { count } = await db
    .from("session_waitlist")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

  await db.from("session_waitlist").upsert(
    { session_id: sessionId, user_id: req.user.id, position: (count ?? 0) + 1 },
    { onConflict: "session_id,user_id" }
  );

  res201(res, { waitlisted: true, position: (count ?? 0) + 1 });
});

// ─── § ANALYTICS HANDLER ─────────────────────────────────────────────────────

const analyticsHandler = asyncHandler(async (req, res) => {
  const { data, error } = await db
    .from("session_analytics")
    .select("*")
    .eq("session_id", req.params.sessionId)
    .single();

  if (error || !data) return res404(res, "Analytics not found for this session");
  res200(res, data);
});

// ─── § DASHBOARD HANDLER ─────────────────────────────────────────────────────

/**
 * GET /api/user/sessions
 * Returns upcoming and live sessions the student is registered for.
 */
const dashboardHandler = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await db
    .from("session_participants")
    .select(`
      status,
      live_sessions (
        id, title, description, topic, session_type,
        scheduled_start, status, join_url, platform,
        courses ( id, title, cover_image_url ),
        users!live_sessions_instructor_id_fkey ( full_name, avatar_url )
      )
    `)
    .eq("user_id", userId)
    .in("live_sessions.status", ["scheduled", "live"])
    .order("live_sessions.scheduled_start", { ascending: true })
    .limit(10);

  if (error) throw new Error(error.message);

  const sessions = (data ?? [])
    .filter((d) => d.live_sessions)
    .map((d) => ({
      ...d.live_sessions,
      participant_status: d.status,
      can_join:
        d.live_sessions.status === "live" && d.status === "registered",
    }))
    .sort((a, b) => {
      // Live sessions first
      if (a.status === "live" && b.status !== "live") return -1;
      if (b.status === "live" && a.status !== "live") return  1;
      return new Date(a.scheduled_start) - new Date(b.scheduled_start);
    });

  res200(res, sessions, { total: sessions.length });
});

/**
 * GET /api/instructor/sessions
 * Returns all sessions created by the instructor.
 */
const instructorSessionsHandler = asyncHandler(async (req, res) => {
  const { data, error } = await db
    .from("live_sessions")
    .select(`
      id, title, session_type, scheduled_start, status,
      max_participants, current_participants, recording_url,
      courses ( id, title )
    `)
    .eq("instructor_id", req.user.id)
    .order("scheduled_start", { ascending: false });

  if (error) throw new Error(error.message);
  res200(res, data ?? [], { total: data?.length ?? 0 });
});

// ─── § ROUTER ─────────────────────────────────────────────────────────────────

const router = Router();

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
router.post("/live-sessions/:sessionId/waitlist",            authenticateToken, waitlistHandler);
router.post("/live-sessions/:sessionId/feedback",            authenticateToken, rules.feedback, runValidation, participantHandlers.feedback);

// Instructor controls
router.post("/live-sessions/:sessionId/start",               authenticateToken, requireRole(["instructor", "admin"]), participantHandlers.start);
router.post("/live-sessions/:sessionId/end",                 authenticateToken, requireRole(["instructor", "admin"]), participantHandlers.end);
router.put ("/live-sessions/:sessionId/recording",           authenticateToken, requireRole(["instructor", "admin"]), participantHandlers.updateRecording);
router.get ("/live-sessions/:sessionId/participants",        authenticateToken, requireRole(["instructor", "admin"]), participantHandlers.listParticipants);
router.get ("/live-sessions/:sessionId/analytics",           authenticateToken, requireRole(["instructor", "admin"]), analyticsHandler);

// Dashboards
router.get("/user/sessions",                                 authenticateToken, dashboardHandler);
router.get("/instructor/sessions",                           authenticateToken, requireRole(["instructor", "admin"]), instructorSessionsHandler);

export default router;

// ─── Recording playback ───────────────────────────────────────────────────────

/**
 * PUT /api/live-sessions/:sessionId/recording
 * Store the recording URL after the session ends (called by encoder worker or Zoom webhook).
 */
// (Already exists in live-sessions.js as participantHandlers.updateRecording)

/**
 * GET /api/live-sessions/:sessionId/replay
 * Get the recording URL for a session (students and instructor).
 */
const asyncHndlr = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get("/live-sessions/:sessionId/replay", authenticateToken, asyncHndlr(async (req, res) => {
  const { data: session, error } = await db
    .from("live_sessions")
    .select("id, course_id, title, recording_url, status, instructor_id, scheduled_start, scheduled_end, actual_start, actual_end")
    .eq("id", req.params.sessionId)
    .single();

  if (error || !session) return res.status(404).json({ success: false, message: "Session not found" });
  if (!session.recording_url) return res.status(404).json({ success: false, message: "No recording available for this session" });

  // Check access: must be enrolled or be the instructor
  if (session.instructor_id !== req.user.id) {
    const { data: enrolled } = await db.from("enrollments")
      .select("id").eq("user_id", req.user.id).eq("course_id", session.course_id).eq("status", "active").single();
    if (!enrolled) return res.status(403).json({ success: false, message: "You must be enrolled to watch this recording" });
  }

  // Derive duration from actual times if present, else the scheduled window.
  const startAt = session.actual_start || session.scheduled_start;
  const endAt   = session.actual_end   || session.scheduled_end;
  const durationMinutes = startAt && endAt
    ? Math.max(0, Math.round((new Date(endAt) - new Date(startAt)) / 60000))
    : null;

  res.status(200).json({
    success: true,
    data: {
      session_id:        session.id,
      title:             session.title,
      recording_url:     session.recording_url,
      duration_minutes:  durationMinutes,
      ended_at:          session.actual_end,
    },
  });
}));
