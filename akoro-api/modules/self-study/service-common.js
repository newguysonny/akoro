/**
 * modules/self-study/service-common.js — shared orchestration: the clock, the
 * assignment ownership guard, and the target visibility guard used by the
 * file and paper routes. The guards keep the same query order as before:
 * creator/admin first, then the caller's school.
 */
import { mySchool } from "./createAssignment.js";
import { canManageAssignment, isTeacher } from "./rules.js";
import * as store from "./store-assignments.js";

export const now = () => new Date().toISOString();

/** Load an assignment the caller is allowed to manage. */
export async function ownedAssignment(req, id) {
  const { data } = await store.findAssignment(id);
  if (!data) return { error: "not_found" };
  if (data.created_by === req.user.id || req.user.role === "admin") return { assignment: data };
  const school = await mySchool(req.user.id);
  if (canManageAssignment(data, req.user, school)) return { assignment: data };
  return { error: "forbidden" };
}

/** The caller's target row for one assignment (learners). */
export async function myTargetOf(assignmentId, userId) {
  const { data } = await store.targetByStudent(assignmentId, userId, "id, status");
  return data ?? null;
}

/** May the caller see this target's work? The learner it belongs to, or the
 *  teacher / school that owns the activity. → { target } | { status, error } */
export async function viewableTarget(req, targetId) {
  const { data: t } = await store.targetById(targetId, "id, assignment_id, student_id, status, submission, submission_pdf");
  if (!t) return { status: 404, error: "Not found" };
  if (t.student_id === req.user.id) return { target: t };
  if (isTeacher(req.user)) {
    const { error } = await ownedAssignment(req, t.assignment_id);
    if (!error) return { target: t };
  }
  return { status: 403, error: "Not yours to see" };
}
