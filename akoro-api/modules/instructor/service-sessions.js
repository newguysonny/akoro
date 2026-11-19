/**
 * instructor/service-sessions.js — live sessions: listing, creation,
 * rescheduling, deletion, and their reminder side effects.
 */
import { mapSession } from "./rules.js";
import {
  asyncHandler, created, ok, err400, err403, err404, err500, now,
  notify, notifyMany, enrolledStudentIds,
} from "./service-core.js";
import { coursesOfTeacher, courseOwnerSingle } from "./store-courses.js";
import {
  sessionsForCourses, sessionWithOwner, sessionCourseRef,
  insertSession, updateSession as updateSessionRow, deleteSession as deleteSessionRow,
} from "./store-sessions.js";

/** Run a reminder step (workers/sessionNotifier.js) without ever failing the request over it. */
const sessionReminders = (fn) => import("../../workers/sessionNotifier.js").then(fn)
  .catch((e) => console.warn("[instructor] session reminders:", e.message));

export const listSessions = asyncHandler(async (req, res) => {
  try {
    const { courseId } = req.query;

    // Get teacher's course IDs first
    const { data: courses, error: cErr } = await coursesOfTeacher(req.user.id, courseId);
    if (cErr) throw new Error(cErr.message);

    const ids = (courses ?? []).map((c) => c.id);
    if (ids.length === 0) return ok(res, []);

    const { data: sessions, error } = await sessionsForCourses(ids);

    if (error) throw new Error(error.message);
    ok(res, (sessions ?? []).map(mapSession));
  } catch (e) {
    err500(res, e);
  }
});

export const createSession = asyncHandler(async (req, res) => {
  try {
    const b = req.body;
    const courseId       = b.courseId ?? b.course_id;
    const title          = b.title;
    const scheduledStart = b.startTime ?? b.scheduled_start;
    const durationMin    = Number(b.duration ?? b.duration_minutes ?? 60);
    const platform       = b.platform ?? "zoom";
    const meetingUrl     = b.meetingLink ?? b.meeting_url ?? null;

    if (!courseId)       return err400(res, "courseId is required");
    if (!title)          return err400(res, "title is required");
    if (!scheduledStart) return err400(res, "startTime is required");

    // Verify ownership
    const { data: course } = await courseOwnerSingle(courseId);

    if (!course)                        return err404(res, "Course not found");
    if (course.instructor_id !== req.user.id) return err403(res, "You do not own this course");

    const scheduledEnd = new Date(new Date(scheduledStart).getTime() + durationMin * 60000).toISOString();

    const { data, error } = await insertSession({
      course_id:        courseId,
      instructor_id:    req.user.id,
      module_id:        b.moduleId ?? b.module_id ?? null,
      order_index:      Number(b.orderIndex ?? b.order_index ?? 0),
      title,
      description:      b.description ?? null,
      scheduled_start:  scheduledStart,
      scheduled_end:    scheduledEnd,
      platform,
      meeting_url:      meetingUrl,
      status:           "scheduled",
      max_participants: 50,
      created_at:       now(),
      updated_at:       now(),
    });

    if (error) throw new Error(error.message);
    notify(req.user.id, {
      type:      "session_reminder",
      title:     `Session "${title}" scheduled`,
      content:   `Starts ${new Date(scheduledStart).toLocaleString()}`,
      relatedId: data.id,
    });
    // Recipient side — notify every enrolled student of the new session.
    notifyMany(await enrolledStudentIds(courseId), {
      type:      "session_scheduled",
      title:     `New session: "${title}"`,
      content:   `Starts ${new Date(scheduledStart).toLocaleString()}`,
      relatedId: data.id,
    });
    // …and the 24 h / 1 h / 10 min reminders before it starts.
    await sessionReminders((m) => m.scheduleSessionReminders({ sessionId: data.id, scheduledStart: data.scheduled_start, sessionTitle: title, meetingUrl }));
    created(res, mapSession(data));
  } catch (e) {
    err500(res, e);
  }
});

export const updateSession = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    // Get session and verify course ownership
    const { data: session } = await sessionWithOwner(id);

    if (!session) return err404(res, "Session not found");

    const { data: course } = await courseOwnerSingle(session.course_id);

    if (!course || course.instructor_id !== req.user.id)
      return err403(res, "You do not own this session's course");

    const b = req.body;
    const updates = {};
    if (b.title       !== undefined) updates.title           = b.title;
    if (b.description !== undefined) updates.description     = b.description;
    if (b.platform    !== undefined) updates.platform        = b.platform;
    if (b.status      !== undefined) updates.status          = b.status;
    if (b.startTime !== undefined || b.scheduled_start !== undefined) updates.scheduled_start = b.startTime ?? b.scheduled_start;
    if (b.meetingLink !== undefined || b.meeting_url !== undefined) updates.meeting_url = b.meetingLink ?? b.meeting_url;
    if (b.moduleId !== undefined || b.module_id !== undefined) updates.module_id = b.moduleId ?? b.module_id;
    if (b.orderIndex !== undefined || b.order_index !== undefined) updates.order_index = Number(b.orderIndex ?? b.order_index);
    if (Object.keys(updates).length === 0) return err400(res, "No updatable fields provided");
    updates.updated_at = now();

    const { data, error } = await updateSessionRow(id, updates);

    if (error) throw new Error(error.message);
    notify(req.user.id, { type: "session_updated", title: `Session "${data.title}" updated`, content: "Changes saved", relatedId: data.id });
    // Recipient side — only notify students when the time changes (avoid noise).
    // A moved or cancelled session: its old reminders go; a moved one gets new ones.
    if (updates.scheduled_start || (updates.status && updates.status !== "scheduled")) {
      await sessionReminders(async (m) => {
        await m.cancelSessionReminders(id);
        if (data.status === "scheduled") await m.scheduleSessionReminders({ sessionId: id, scheduledStart: data.scheduled_start, sessionTitle: data.title, meetingUrl: data.meeting_url });
      });
    }
    if (updates.scheduled_start) {
      notifyMany(await enrolledStudentIds(session.course_id), {
        type:      "session_rescheduled",
        title:     `Session "${data.title}" rescheduled`,
        content:   `Now starts ${new Date(updates.scheduled_start).toLocaleString()}`,
        relatedId: data.id,
      });
    }
    ok(res, mapSession(data));
  } catch (e) {
    err500(res, e);
  }
});

export const deleteSession = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    const { data: session } = await sessionCourseRef(id);

    if (!session) return err404(res, "Session not found");

    const { data: course } = await courseOwnerSingle(session.course_id);

    if (!course || course.instructor_id !== req.user.id)
      return err403(res, "You do not own this session's course");

    const { error } = await deleteSessionRow(id);
    if (error) throw new Error(error.message);
    await sessionReminders((m) => m.cancelSessionReminders(id));

    notify(req.user.id, { type: "session_deleted", title: "Session deleted", content: "A live session was removed" });
    ok(res, { message: "Session deleted" });
  } catch (e) {
    err500(res, e);
  }
});
