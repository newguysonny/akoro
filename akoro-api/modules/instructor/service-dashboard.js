/**
 * instructor/service-dashboard.js — dashboard stats, the teacher/agent profile
 * and preferences, and the classroom pickers.
 */
import { PROFILE_FIELDS, levelFromXp } from "./rules.js";
import { asyncHandler, ok, err400, err403, err404, err500, now, notify } from "./service-core.js";
import {
  profileUser, updateProfileUser, agentSummary, agentXp, upsertAgent,
  notificationPreferences, upsertNotificationPreferences,
  schoolAdminOf, schoolAdminForClass, classroomsListed,
  classroomAccess, classroomStudentsForClass, agentsForUsers,
} from "./store-people.js";
import {
  coursesForStats, activeEnrollmentCount, paidEnrollments,
} from "./store-courses.js";

// ─── § STATS ──────────────────────────────────────────────────────────────────

export const getStats = asyncHandler(async (req, res) => {
  try {
    const teacherId = req.user.id;

    // Get teacher's courses
    const { data: courses, error: coursesErr } = await coursesForStats(teacherId);

    if (coursesErr) throw new Error(coursesErr.message);

    const courseIds    = (courses ?? []).map((c) => c.id);
    const activeCourses = (courses ?? []).filter((c) => c.is_published).length;

    let totalStudents = 0;
    let totalRevenue  = 0;

    if (courseIds.length > 0) {
      // Total enrolled students
      const { count: studentCount, error: enrollErr } = await activeEnrollmentCount(courseIds);

      if (enrollErr) throw new Error(enrollErr.message);
      totalStudents = studentCount ?? 0;

      // Total revenue: only count enrollments backed by an actual payment.
      // Manually-added / invited / free enrollments have payment_id = NULL and
      // must not inflate revenue.
      const { data: paid, error: revErr } = await paidEnrollments(courseIds);

      if (revErr) throw new Error(revErr.message);

      const priceMap = Object.fromEntries((courses ?? []).map((c) => [c.id, c.price ?? 0]));
      totalRevenue = (paid ?? []).reduce(
        (sum, e) => sum + (priceMap[e.course_id] ?? 0),
        0,
      );
    }

    // Agent XP from user_agents (only total_xp is stored)
    const { data: agent } = await agentXp(teacherId);

    ok(res, {
      total_students:  totalStudents,
      total_revenue:   totalRevenue,
      active_courses:  activeCourses,
      total_courses:   courseIds.length,
      agent_xp:        agent?.total_xp ?? 0,
      agent_level:     levelFromXp(agent?.total_xp),
      streak_days:     0,
    });
  } catch (e) {
    err500(res, e);
  }
});

// ─── § PROFILE ────────────────────────────────────────────────────────────────

export const getProfile = asyncHandler(async (req, res) => {
  try {
    const [{ data: user, error: userErr }, { data: agent }, { data: notif }] = await Promise.all([
      profileUser(req.user.id),
      agentSummary(req.user.id),
      notificationPreferences(req.user.id),
    ]);

    if (userErr || !user) return err404(res, "User not found");

    ok(res, {
      ...user,
      agent: agent ? {
        ...agent,
        xp:          agent.total_xp ?? 0,
        level:       levelFromXp(agent.total_xp),
        streak_days: 0,
      } : null,
      notif: notif ? {
        email:            notif.email_enabled,
        push:             notif.push_enabled,
        sessionReminders: notif.notify_session_reminders,
        announcements:    notif.notify_new_announcements,
        qaReplies:        notif.notify_qa_replies,
      } : null,
    });
  } catch (e) {
    err500(res, e);
  }
});

export const updateProfile = asyncHandler(async (req, res) => {
  try {
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => PROFILE_FIELDS.includes(k)),
    );

    if (Object.keys(updates).length === 0)
      return err400(res, `No valid fields provided. Allowed: ${PROFILE_FIELDS.join(", ")}`);

    updates.updated_at = now();

    const { data, error } = await updateProfileUser(req.user.id, updates);

    if (error) {
      // Unique-violation on username → friendly 400
      if (/duplicate key|unique/i.test(error.message)) return err400(res, "That username is already taken");
      throw new Error(error.message);
    }
    notify(req.user.id, { type: "profile_updated", title: "Profile updated", content: "Your profile details were saved" });
    ok(res, data);
  } catch (e) {
    err500(res, e);
  }
});

// PATCH /profile/notifications — upsert into the shared
// user_notification_preferences table (same model as the learner app).
export const updateNotifications = asyncHandler(async (req, res) => {
  try {
    const { email, push, sessionReminders, announcements, qaReplies } = req.body ?? {};

    const row = { user_id: req.user.id, updated_at: now() };
    if (email            !== undefined) row.email_enabled            = email;
    if (push             !== undefined) row.push_enabled             = push;
    if (sessionReminders !== undefined) row.notify_session_reminders = sessionReminders;
    if (announcements    !== undefined) row.notify_new_announcements = announcements;
    if (qaReplies        !== undefined) row.notify_qa_replies        = qaReplies;

    if (Object.keys(row).length <= 2)
      return err400(res, "No valid notification fields provided");

    const { error } = await upsertNotificationPreferences(row);

    if (error) throw new Error(error.message);
    notify(req.user.id, { type: "settings_updated", title: "Notification preferences updated", content: "Your notification settings were saved" });
    ok(res, { saved: true });
  } catch (e) {
    err500(res, e);
  }
});

export const updateAgent = asyncHandler(async (req, res) => {
  try {
    const allowed = ["agent_name", "agent_emoji", "agent_color"];
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => allowed.includes(k)),
    );

    if (Object.keys(updates).length === 0)
      return err400(res, "No valid fields provided. Allowed: agent_name, agent_emoji, agent_color");

    updates.updated_at = now();

    // Upsert — create agent row if it doesn't exist
    const { data, error } = await upsertAgent({ user_id: req.user.id, ...updates });

    if (error) throw new Error(error.message);
    notify(req.user.id, { type: "settings_updated", title: "AI agent updated", content: `Agent is now ${data.agent_emoji ?? ""} ${data.agent_name ?? ""}`.trim() });
    ok(res, data);
  } catch (e) {
    err500(res, e);
  }
});

// ─── § CLASSROOMS ─────────────────────────────────────────────────────────────

/**
 * GET /api/instructor/classrooms
 *
 * The classes this user can assign work to. "Class" and "course" are different
 * groupings and the UI now asks which one you mean: a course is who enrolled in
 * a subject, a class is JSS1 — the same learners only by coincidence.
 *
 * Serves both portals. An instructor gets the classes they teach; a school
 * admin gets every class in their school, because that is the set they think
 * in. The two are unioned rather than branched on role, so a head of
 * department who both teaches and administers sees all of theirs.
 */
export const listClassrooms = asyncHandler(async (req, res) => {
  try {
    const { data: school } = await schoolAdminOf(req.user.id);

    const { data, error } = await classroomsListed(req.user.id, school?.id ?? null);
    if (error) throw new Error(error.message);

    ok(res, (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? null,
      student_count: c.classroom_students?.length ?? 0,
    })));
  } catch (e) {
    err500(res, e);
  }
});

/**
 * GET /api/instructor/classrooms/:id/students
 * Who is actually in a class, for the picker and for the "N will get this"
 * count. has_agent matters for battles — no agent, no fight.
 */
export const listClassroomStudents = asyncHandler(async (req, res) => {
  try {
    // Only a class this caller may list (GET /classrooms): one they teach, one in
    // the school they run, or any for an admin. It used to answer any class id
    // to any instructor (Phase 15 item 6).
    const { data: room } = await classroomAccess(req.params.id);
    if (!room) return err404(res, "Class not found");
    let allowed = req.user.role === "admin" || room.teacher_id === req.user.id;
    if (!allowed && room.school_id) {
      const { data: school } = await schoolAdminForClass(req.user.id, room.school_id);
      allowed = !!school;
    }
    if (!allowed) return err403(res, "You do not teach this class");

    const { data: rows } = await classroomStudentsForClass(req.params.id);

    const ids = (rows ?? []).map((r) => r.user_id);
    const { data: agents } = ids.length
      ? await agentsForUsers(ids)
      : { data: [] };
    const withAgent = new Set((agents ?? []).map((a) => a.user_id));

    ok(res, (rows ?? []).map((r) => ({
      id:        r.users.id,
      username:  r.users.username,
      full_name: r.users.full_name,
      avatar:    r.users.avatar_url ?? null,
      emoji:     r.users.avatar_emoji ?? null,
      has_agent: withAgent.has(r.user_id),
    })));
  } catch (e) {
    err500(res, e);
  }
});
