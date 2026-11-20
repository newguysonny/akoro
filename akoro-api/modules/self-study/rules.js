/**
 * modules/self-study/rules.js — pure validation, windows and ownership
 * predicates. No Express, no Supabase: everything here is synchronous and
 * side-effect free, so the same decisions are testable in isolation.
 */

/**
 * Matches modules/school/routes.js SCHOOL_ROLES plus instructors: the platform
 * has used both "school" and "school_admin" over time, so accept both.
 */
export const TEACHER_ROLES = ["instructor", "teacher", "school", "school_admin", "admin"];

/** An AI marking draft still "making" after this long was cut off. */
export const AI_DRAFT_STALE_MS = 5 * 60_000;

/** The fields PATCH /:id is allowed to change. */
export const ASSIGNMENT_EDITABLE = [
  "title", "subject", "topic", "subtopics", "objectives", "instructions",
  "difficulty", "due_at", "status", "type", "details",
];

export const isTeacher = (user) => TEACHER_ROLES.includes(user?.role);

/** May this user manage the assignment (creator, admin, or their school's)? */
export const canManageAssignment = (assignment, user, school) =>
  assignment.created_by === user.id ||
  user.role === "admin" ||
  !!(school && assignment.school_id === school.id);

/** An AI draft left "making" past the window was cut off by a restart. */
export const isStaleDraft = (aiGrade, at = Date.now()) =>
  aiGrade?.status === "making" && at - Date.parse(aiGrade.at || 0) > AI_DRAFT_STALE_MS;

/** A draft requested within the window is still in flight (409 on re-request). */
export const isDraftInFlight = (aiGrade, at = Date.now()) =>
  aiGrade?.status === "making" && at - Date.parse(aiGrade?.at || "") < AI_DRAFT_STALE_MS;

/** The published grade, or the refusal text the API has always returned. */
export const readGrade = (grade) => {
  const n = Number(grade);
  return Number.isFinite(n) && n >= 0 && n <= 100
    ? { n }
    : { error: "grade must be a number from 0 to 100" };
};

/** Late work is accepted and marked late: { late, lateByMinutes } or {}. */
export const lateOf = (submittedAt, dueAt) => {
  const dueMs = dueAt ? Date.parse(dueAt) : NaN;
  return Number.isFinite(dueMs) && Date.parse(submittedAt) > dueMs
    ? { late: true, lateByMinutes: Math.round((Date.parse(submittedAt) - dueMs) / 60000) }
    : {};
};
