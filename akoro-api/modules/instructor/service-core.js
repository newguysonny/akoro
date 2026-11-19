/**
 * instructor/service-core.js — the shared machinery every instructor request
 * uses: the async wrapper, response helpers, notifications, course ownership.
 *
 * Request orchestration, never SQL — the queries live in store*.js.
 */
import { activeStudentIds, courseForOwnership } from "./store-courses.js";
import { insertNotification, insertNotifications } from "./store-people.js";

// ─── request plumbing ────────────────────────────────────────────────────────

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const ok      = (res, data)  => res.json({ success: true, data });
export const created = (res, data)  => res.status(201).json({ success: true, data });
export const err400  = (res, error) => res.status(400).json({ error });
export const err403  = (res, error) => res.status(403).json({ error });
export const err404  = (res, error) => res.status(404).json({ error });
export const err500  = (res, e)     => res.status(500).json({ error: e.message ?? String(e) });

export const now = () => new Date().toISOString();

// ─── notifications ───────────────────────────────────────────────────────────

export const notify = async (userId, { type, title, content = null, relatedId = null }) => {
  try {
    const { error } = await insertNotification({
      user_id: userId, type, title, content, related_id: relatedId,
    });
    if (error) console.warn("[notify] insert failed:", error.message);
  } catch (e) {
    console.warn("[notify] insert threw:", e.message);
  }
};

// Fan-out the same notification to many recipients (e.g. all enrolled students).
export const notifyMany = async (userIds, { type, title, content = null, relatedId = null }) => {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (!ids.length) return;
  const rows = ids.map((id) => ({ user_id: id, type, title, content, related_id: relatedId }));
  try {
    const { error } = await insertNotifications(rows);
    if (error) console.warn("[notify] bulk insert failed:", error.message);
  } catch (e) {
    console.warn("[notify] bulk insert threw:", e.message);
  }
};

// Return the user_ids of all active students enrolled in a course.
export const enrolledStudentIds = async (courseId) => {
  const { data } = await activeStudentIds(courseId);
  return (data ?? []).map((r) => r.user_id);
};

// ─── ownership ───────────────────────────────────────────────────────────────

// Ownership guard — returns the course row or null.
export const ownCourse = async (courseId, userId) => {
  const { data } = await courseForOwnership(courseId);
  return data && data.instructor_id === userId ? data : null;
};
