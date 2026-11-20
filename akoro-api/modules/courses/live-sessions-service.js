/**
 * live-sessions-service.js — request orchestration for live sessions.
 *
 * Session CRUD and student participation (register, join, leave). Who may act,
 * which status/body is right, and the socket/notification side effects live
 * here; every query is behind live-sessions-store.js and every pure rule is in
 * live-sessions-rules.js. Host controls are in live-sessions-service-host.js;
 * the read-only dashboards are in live-sessions-service-reads.js.
 */

import { notify } from "../notifications/index.js";
import { createMeeting, endMeeting } from "./meeting-integration.js";
import * as store from "./live-sessions-store.js";
import { now, UPDATABLE_SESSION_FIELDS } from "./live-sessions-rules.js";

// ─── § HELPERS ────────────────────────────────────────────────────────────────

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const res200 = (res, data, meta = {}) => res.status(200).json({ success: true,  data, ...meta });
export const res201 = (res, data)            => res.status(201).json({ success: true,  data });
export const res400 = (res, msg)             => res.status(400).json({ success: false, message: msg });
export const res403 = (res, msg)             => res.status(403).json({ success: false, message: msg });
export const res404 = (res, msg)             => res.status(404).json({ success: false, message: msg });

/** Run a reminder step (workers/sessionNotifier.js) without ever failing the request over it. */
export const reminders = (fn) => import("../../workers/sessionNotifier.js").then(fn)
  .catch((e) => console.warn("[live-sessions] session reminders:", e.message));

// ─── § SESSION HANDLERS ───────────────────────────────────────────────────────

export const sessionHandlers = {

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
    const course = await store.findCourse(courseId);

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
    const { data: session, error: sessionErr } = await store.insertSession({
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
    });

    if (sessionErr) throw new Error(sessionErr.message);

    // Register all currently enrolled students as participants
    const enrollments = await store.listActiveEnrollments(courseId);

    if (enrollments?.length) {
      const participants = enrollments.map((e) => ({
        session_id:    session.id,
        user_id:       e.user_id,
        enrollment_id: e.id,
        status:        "registered",
      }));

      await store.insertParticipants(participants);
    }

    // Initialise analytics row
    await store.insertAnalytics({
      session_id:       session.id,
      total_registered: enrollments?.length ?? 0,
      peak_concurrent:  0,
    });

    // The 24 h / 1 h / 10 min reminders (workers/sessionNotifier.js; imported lazily to avoid circular deps).
    await reminders((m) => m.scheduleSessionReminders({
      sessionId:      session.id,
      scheduledStart: scheduled_start,
      courseTitle:    course.title,
      sessionTitle:   title,
      meetingUrl:     meeting.joinUrl,
    }));

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

    const { data: sessions, error } = await store.listCourseSessions(courseId, {
      status, upcoming: upcoming === "true", limit, offset,
    });
    if (error) throw new Error(error.message);

    // Enrich with current user's registration status
    const enriched = await Promise.all((sessions ?? []).map(async (s) => {
      const reg = await store.getParticipant(s.id, req.user.id);

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
    const { data: session, error } = await store.getSessionFull(req.params.sessionId);

    if (error || !session) return res404(res, "Session not found");

    // Student registration status
    const reg = await store.getParticipant(
      session.id, req.user.id, "status, joined_at, reminder_24h_sent, reminder_1h_sent",
    );

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
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => UPDATABLE_SESSION_FIELDS.includes(k)),
    );
    updates.updated_at = now();

    const { data, error } = await store.updateSessionOwned(sessionId, req.user.id, updates);

    if (error || !data) return res404(res, "Session not found or not authorised");
    // A moved session gets fresh reminders; the old ones are dropped (any already queued skip themselves).
    if (updates.scheduled_start) {
      await reminders(async (m) => { await m.cancelSessionReminders(sessionId); await m.scheduleSessionReminders({ sessionId, scheduledStart: data.scheduled_start, sessionTitle: data.title }); });
    }
    res200(res, data);
  }),

  /**
   * DELETE /api/live-sessions/:sessionId
   * Cancel a session — notifies all registered participants.
   */
  cancel: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const session = await store.getSession(
      sessionId, "id, status, meeting_id, platform, instructor_id, title, course_id",
    );

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

    await store.updateSession(sessionId, { status: "cancelled", updated_at: now() });
    await reminders((m) => m.cancelSessionReminders(sessionId));

    // Notify participants — live socket to anyone in the room…
    const io = req.app.get("io") || global.io || global._io;
    io?.to(`session:${sessionId}`).emit("session-cancelled", {
      sessionId,
      title: session.title,
      message: "This session has been cancelled",
    });

    // …and a persistent bell notification for every enrolled student.
    try {
      if (session.course_id) {
        const enrolled = await store.listEnrolledUserIds(session.course_id);
        for (const { user_id } of (enrolled ?? [])) {
          notify.sessionCancelled({ userId: user_id, sessionTitle: session.title, relatedId: sessionId });
        }
      }
    } catch (e) { console.warn("[live-sessions] cancel notify failed:", e.message); }

    res200(res, { message: "Session cancelled" });
  }),
};

// ─── § PARTICIPANT HANDLERS ───────────────────────────────────────────────────

export const participantHandlers = {

  /**
   * POST /api/live-sessions/:sessionId/register
   * Student pre-registers for a session before it goes live.
   * Added to waitlist if session is full.
   */
  register: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const userId        = req.user.id;

    const session = await store.getSession(
      sessionId, "id, course_id, title, scheduled_start, join_url, max_participants, status",
    );

    if (!session) return res404(res, "Session not found");
    if (session.status === "cancelled") return res400(res, "Session has been cancelled");

    // Verify enrollment
    const enrollment = await store.findActiveEnrollment(userId, session.course_id);

    if (!enrollment) return res403(res, "You must be enrolled in this course to register");

    // Check if already registered
    const existing = await store.getParticipant(sessionId, userId, "id, status");

    if (existing) return res400(res, `Already registered (status: ${existing.status})`);

    // Check capacity
    const count = await store.countParticipants(sessionId, { status: "registered" });

    if ((count ?? 0) >= session.max_participants) {
      // Add to waitlist
      const wlCount = await store.countWaitlist(sessionId);

      await store.insertWaitlist({
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

    await store.insertParticipant({
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

    const session = await store.getSession(
      sessionId, "id, status, join_url, meeting_password, platform, title, max_participants, current_participants, course_id, instructor_id",
    );

    if (!session) return res404(res, "Session not found");
    if (session.status !== "live")
      return res400(res, `Session is not live yet (status: ${session.status})`);

    // Check capacity
    if (session.current_participants >= session.max_participants) {
      // Add to waitlist if not already there
      await store.upsertWaitlist(sessionId, userId);
      return res400(res, "Session is full. You have been added to the waitlist.");
    }

    // Upsert participant as joined
    const reg = await store.getParticipant(sessionId, userId, "id");

    if (reg) {
      await store.updateParticipant(reg.id, { status: "joined", joined_at: now() });
    } else {
      // Allow join without prior registration (e.g. revision sessions)
      const enrollment = await store.findActiveEnrollment(userId, session.course_id);

      if (!enrollment && req.user.role === "student")
        return res403(res, "You must be enrolled to join this session");

      await store.insertParticipant({
        session_id:    sessionId,
        user_id:       userId,
        enrollment_id: enrollment?.id ?? null,
        status:        "joined",
        joined_at:     now(),
      });
    }

    // Update current_participants count
    const count = await store.countParticipants(sessionId, { status: "joined" });

    await store.updateSession(sessionId, { current_participants: count ?? 0 });

    // Update peak concurrent in analytics
    await store.raisePeakConcurrent(sessionId, count ?? 0);

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

    const reg = await store.getParticipant(sessionId, userId, "id, joined_at");

    if (!reg) return res404(res, "Participant record not found");

    const durationMin = reg.joined_at
      ? Math.round((Date.now() - new Date(reg.joined_at).getTime()) / 60000)
      : 0;

    await store.updateParticipant(reg.id, { status: "left", left_at: now(), duration_minutes: durationMin });

    // Decrement count
    const count = await store.countParticipants(sessionId, { status: "joined" });

    await store.updateSession(sessionId, { current_participants: count ?? 0 });

    res200(res, { message: "Left session", duration_minutes: durationMin });
  }),
};
