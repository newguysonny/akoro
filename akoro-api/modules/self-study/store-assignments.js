/**
 * modules/self-study/store-assignments.js — Supabase queries for self-study
 * assignments, learner targets and submission files. No Express objects cross
 * this boundary; services own the branching on data/error.
 */
import db from "../../db.js";

const edu = () => db.schema("edu");

/* ── Assignments ─────────────────────────────────────────────────────────── */

export const findAssignment = (id) =>
  edu().from("self_study_assignments").select("*").eq("id", id).maybeSingle();

export const findAssignmentFields = (id, cols) =>
  edu().from("self_study_assignments").select(cols).eq("id", id).maybeSingle();

export const listAssignments = (userId, schoolId) => {
  let q = edu().from("self_study_assignments").select("*").order("created_at", { ascending: false }).limit(100);
  q = schoolId ? q.or(`created_by.eq.${userId},school_id.eq.${schoolId}`) : q.eq("created_by", userId);
  return q;
};

export const assignmentsByIds = (ids) =>
  edu().from("self_study_assignments").select("*").in("id", ids);

export const updateAssignment = (id, patch) =>
  edu().from("self_study_assignments").update(patch).eq("id", id);

export const updateAssignmentReturning = (id, patch) =>
  edu().from("self_study_assignments").update(patch).eq("id", id).select().single();

export const deleteAssignment = (id) =>
  edu().from("self_study_assignments").delete().eq("id", id);

/* ── Learner targets ─────────────────────────────────────────────────────── */

export const targetsForAssignment = (assignmentId) =>
  edu().from("self_study_targets").select("*").eq("assignment_id", assignmentId);

export const targetsForStudent = (studentId) =>
  edu().from("self_study_targets").select("*").eq("student_id", studentId).order("created_at", { ascending: false }).limit(60);

export const completionDaysFor = (studentId) =>
  edu().from("self_study_targets").select("completed_at").eq("student_id", studentId);

export const targetsByAssignmentIds = (ids) =>
  edu().from("self_study_targets").select("assignment_id, status").in("assignment_id", ids);

export const targetByStudent = (assignmentId, studentId, cols = "*") =>
  edu().from("self_study_targets").select(cols).eq("assignment_id", assignmentId).eq("student_id", studentId).maybeSingle();

export const targetById = (id, cols = "*") =>
  edu().from("self_study_targets").select(cols).eq("id", id).maybeSingle();

export const upsertTargets = (rows) =>
  edu().from("self_study_targets").upsert(rows, { onConflict: "assignment_id,student_id" });

export const updateTarget = (id, patch) =>
  edu().from("self_study_targets").update(patch).eq("id", id);

export const updateTargetReturning = (id, patch) =>
  edu().from("self_study_targets").update(patch).eq("id", id).select().single();

export const updateTargetForStudent = (assignmentId, studentId, patch, cols = "*") =>
  edu().from("self_study_targets").update(patch).eq("assignment_id", assignmentId).eq("student_id", studentId).select(cols).single();

export const updateTargetForStudentMaybe = (assignmentId, studentId, patch, cols) =>
  edu().from("self_study_targets").update(patch).eq("assignment_id", assignmentId).eq("student_id", studentId).select(cols).maybeSingle();

export const deleteTarget = (assignmentId, studentId) =>
  edu().from("self_study_targets").delete().eq("assignment_id", assignmentId).eq("student_id", studentId);

/* ── Submission files ────────────────────────────────────────────────────── */

export const findFile = (id, cols = "*") =>
  edu().from("self_study_files").select(cols).eq("id", id).maybeSingle();

export const filesForTargets = (targetIds) =>
  edu().from("self_study_files")
    .select("id, target_id, name, size, mime, kind, question_index, created_at").in("target_id", targetIds);

export const openFilesForTargets = (targetIds) =>
  edu().from("self_study_files")
    .select("id, target_id, name, size, mime, kind, question_index").in("target_id", targetIds)
    .order("created_at", { ascending: true }).limit(500);

export const filesForTarget = (targetId) =>
  edu().from("self_study_files")
    .select("id, name, size, mime, kind, question_index").eq("target_id", targetId)
    .order("created_at", { ascending: true }).limit(200);

export const countFiles = (targetId, questionIndex) => {
  let q = edu().from("self_study_files").select("id", { count: "exact", head: true }).eq("target_id", targetId);
  q = questionIndex === null ? q.is("question_index", null) : q.eq("question_index", questionIndex);
  return q;
};

export const insertFile = (row) =>
  edu().from("self_study_files")
    .insert(row).select("id, name, size, mime, kind, question_index").single();

export const deleteFile = (id) =>
  edu().from("self_study_files").delete().eq("id", id);
