/**
 * live-sessions-service-reads.js — read-only live-session views.
 *
 * The student dashboard, instructor session list, course curriculum tree and
 * recording replay. Shaping/sorting is unchanged; every query is behind
 * live-sessions-store.js.
 */

import * as store from "./live-sessions-store.js";
import { asyncHandler, res200, res403, res404 } from "./live-sessions-service.js";

// ─── § DASHBOARD HANDLERS ─────────────────────────────────────────────────────

/**
 * GET /api/user/sessions
 * Returns upcoming and live sessions the student is registered for.
 */
export const dashboardHandler = asyncHandler(async (req, res) => {
  const userId = req.user.id;

  const { data, error } = await store.listStudentSessions(userId);

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
export const instructorSessionsHandler = asyncHandler(async (req, res) => {
  const { data, error } = await store.listInstructorSessions(req.user.id);

  if (error) throw new Error(error.message);
  res200(res, data ?? [], { total: data?.length ?? 0 });
});

/**
 * GET /api/courses/:courseId/curriculum
 * Learner-facing modular schedule: course_modules (weeks) → their live_sessions,
 * with the student's registration state, join eligibility, and per-topic
 * materials. Sessions without a module fall into an "unscheduled" bucket.
 */
export const curriculumHandler = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const userId       = req.user.id;
  const isStudent    = req.user.role === "student";

  const course = await store.findCurriculumCourse(courseId);
  if (!course) return res404(res, "Course not found");

  // Enrollment gate (instructors/admins always allowed for their own course).
  let enrolled = false;
  if (course.instructor_id !== userId) {
    const enr = await store.findActiveEnrollmentMaybe(userId, courseId);
    enrolled = !!enr;
    if (!enrolled && isStudent) return res403(res, "You must be enrolled to view this curriculum");
  } else {
    enrolled = true;
  }

  const [modules, sessions] = await Promise.all([
    store.listCourseModules(courseId),
    store.listCurriculumSessions(courseId),
  ]);

  const sessionIds = (sessions ?? []).map((s) => s.id);

  // Batch-fetch the student's participant rows + all materials (avoid N+1).
  const [regs, materials] = await Promise.all([
    sessionIds.length
      ? store.listParticipantStatuses(userId, sessionIds)
      : Promise.resolve([]),
    sessionIds.length
      ? store.listSessionMaterials(sessionIds)
      : Promise.resolve([]),
  ]);

  const regBySession = Object.fromEntries((regs ?? []).map((r) => [r.session_id, r.status]));
  const matsBySession = {};
  for (const m of materials ?? []) (matsBySession[m.session_id] ??= []).push(m);

  const shapeSession = (s) => {
    const registered = s.id in regBySession;
    const out = {
      id: s.id, title: s.title, topic: s.topic, description: s.description,
      session_type: s.session_type, module_id: s.module_id, order_index: s.order_index,
      scheduled_start: s.scheduled_start, scheduled_end: s.scheduled_end,
      status: s.status, platform: s.platform, recording_url: s.recording_url,
      max_participants: s.max_participants, current_participants: s.current_participants,
      is_registered: registered,
      participant_status: regBySession[s.id] ?? null,
      can_join: s.status === "live" && s.current_participants < s.max_participants,
      materials: matsBySession[s.id] ?? [],
      // Only expose the join URL/password once the session is live.
      join_url: s.status === "live" ? s.join_url : null,
      meeting_password: (s.status === "live" && !isStudent) ? s.meeting_password : null,
    };
    return out;
  };

  const byModule = {};
  const unscheduled = [];
  for (const s of sessions ?? []) {
    const shaped = shapeSession(s);
    if (s.module_id) (byModule[s.module_id] ??= []).push(shaped);
    else unscheduled.push(shaped);
  }

  const moduleTree = (modules ?? []).map((m) => ({
    id: m.id, title: m.title, description: m.description, order_index: m.order_index,
    sessions: byModule[m.id] ?? [],
  }));

  res200(res, {
    course: { id: course.id, title: course.title, description: course.description, cover_image_url: course.cover_image_url },
    enrolled,
    modules: moduleTree,
    unscheduled,
  });
});

// ─── § RECORDING PLAYBACK ─────────────────────────────────────────────────────

/**
 * GET /api/live-sessions/:sessionId/replay
 * Get the recording URL for a session (students and instructor).
 */
export const replayHandler = asyncHandler(async (req, res) => {
  const { data: session, error } = await store.getReplaySession(req.params.sessionId);

  if (error || !session) return res.status(404).json({ success: false, message: "Session not found" });
  if (!session.recording_url) return res.status(404).json({ success: false, message: "No recording available for this session" });

  // Check access: must be enrolled or be the instructor
  if (session.instructor_id !== req.user.id) {
    const enrolled = await store.findActiveEnrollment(req.user.id, session.course_id);
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
});
