/**
 * live-sessions-service-host.js — instructor controls and attendance analytics.
 *
 * Start, end, recording upload, participant list, feedback and the analytics
 * read. Status codes, socket emissions and notification fallbacks are the
 * originals; every query is behind live-sessions-store.js.
 */

import { endMeeting } from "./meeting-integration.js";
import * as store from "./live-sessions-store.js";
import { now } from "./live-sessions-rules.js";
import { asyncHandler, res200, res400, res403, res404 } from "./live-sessions-service.js";

// ─── § HOST HANDLERS ──────────────────────────────────────────────────────────

export const hostHandlers = {

  /**
   * POST /api/live-sessions/:sessionId/start
   * Instructor marks session as live → broadcasts via Socket.io.
   */
  start: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    const session = await store.getSession(
      sessionId, "id, title, join_url, course_id, instructor_id, status",
    );

    if (!session) return res404(res, "Session not found");
    if (session.instructor_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Not authorised");
    if (session.status !== "scheduled")
      return res400(res, `Cannot start a session with status: ${session.status}`);

    await store.updateSession(sessionId, { status: "live", actual_start: now(), updated_at: now() });

    // Get all registered participants for notification
    const participants = await store.listRegisteredParticipantsWithUsers(sessionId);

    // Broadcast via Socket.io to session room
    const io = req.app.get("io");
    io?.to(`session:${sessionId}`).emit("session-started", {
      sessionId,
      title:      session.title,
      meetingUrl: session.join_url,
    });

    // Also broadcast to course chat room
    io?.to(`chat:${session.course_id}`).emit("system-alert", {
      text: `"${session.title}" is now LIVE! Join now →`,
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

    const session = await store.getSession(
      sessionId, "id, status, meeting_id, platform, instructor_id, title, course_id",
    );

    if (!session) return res404(res, "Session not found");
    if (session.instructor_id !== req.user.id && req.user.role !== "admin")
      return res403(res, "Not authorised");
    if (session.status !== "live")
      return res400(res, "Session is not currently live");

    // End meeting on platform
    if (session.meeting_id) {
      await endMeetingFor(session);
    }

    await store.updateSession(sessionId, {
      status:        "ended",
      actual_end:    now(),
      recording_url: recording_url ?? null,
      updated_at:    now(),
    });

    // Mark all still-joined participants as attended
    const joinedParticipants = await store.listJoinedParticipants(sessionId);

    for (const p of (joinedParticipants ?? [])) {
      const durMin = p.joined_at
        ? Math.round((Date.now() - new Date(p.joined_at).getTime()) / 60000)
        : 0;
      await store.updateParticipant(p.id, { status: "left", attended: true, left_at: now(), duration_minutes: durMin });
    }

    // Compute analytics
    const totalReg = await store.countParticipants(sessionId);
    const totalAtt = await store.countParticipants(sessionId, { attended: true });

    const attendanceRate = totalReg
      ? Math.round(((totalAtt ?? 0) / totalReg) * 100 * 100) / 100
      : 0;

    await store.updateAnalytics(sessionId, {
      total_registered: totalReg ?? 0,
      total_attended:   totalAtt ?? 0,
      attendance_rate:  attendanceRate,
    });

    // Broadcast via Socket.io
    const io = req.app.get("io");
    io?.to(`session:${sessionId}`).emit("session-ended", {
      sessionId,
      recording_url: recording_url ?? null,
    });

    // Notify attendees that recording is available
    if (recording_url) {
      const attended = await store.listAttendedParticipantsWithUsers(sessionId);

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

    const { data, error } = await store.updateSessionOwned(req.params.sessionId, req.user.id, {
      recording_url, status: "recorded", updated_at: now(),
    });

    if (error || !data) return res404(res, "Session not found or not authorised");
    res200(res, data);
  }),

  /**
   * GET /api/live-sessions/:sessionId/participants
   * List participants with attendance status (instructor only).
   */
  listParticipants: asyncHandler(async (req, res) => {
    const { data, error } = await store.listParticipants(req.params.sessionId);

    if (error) throw new Error(error.message);
    res200(res, data ?? [], { total: data?.length ?? 0 });
  }),

  /**
   * POST /api/live-sessions/:sessionId/feedback
   * Student submits post-session rating and feedback.
   */
  feedback: asyncHandler(async (req, res) => {
    const { rating, feedback_text } = req.body;

    const { data, error } = await store.setParticipantFeedback(
      req.params.sessionId, req.user.id, rating, feedback_text ?? null,
    );

    if (error || !data) return res404(res, "Participation record not found");

    // Update avg_rating in session_analytics
    const ratings = await store.listFeedbackRatings(req.params.sessionId);

    if (ratings?.length) {
      const avg = ratings.reduce((s, r) => s + r.feedback_rating, 0) / ratings.length;
      await store.updateAnalytics(req.params.sessionId, { avg_rating: Math.round(avg * 100) / 100 });
    }

    res200(res, { message: "Feedback submitted", feedback_rating: rating });
  }),
};

/**
 * GET /api/live-sessions/:sessionId/analytics
 * Attendance analytics (session host only, checked by the router).
 */
export const analyticsHandler = asyncHandler(async (req, res) => {
  const { data, error } = await store.getAnalytics(req.params.sessionId);

  if (error || !data) return res404(res, "Analytics not found for this session");
  res200(res, data);
});

// End the provider meeting without failing the request over it.
const endMeetingFor = (session) =>
  endMeeting(session.instructor_id, session.platform, session.meeting_id)
    .catch((e) => console.warn("[live-sessions] endMeeting failed:", e.message));
