/**
 * modules/self-study/outcomes.js — class results, agent-readable.
 *
 * Powers the `check_activity_outcomes` chat tool: the agent sees how an
 * assigned activity actually went (completion, understanding, confusion) so
 * it can suggest the next move — "your osmosis assignment averaged 54%,
 * want me to prepare a revision self-study?" — and the human decides.
 * Summary only: no per-learner rows or names cross into the model.
 */

import db from "../../db.js";

const edu = () => db.schema("edu");

/** Load an assignment the instructor owns (admin excepted), or null. */
export async function ownedActivity(instructor, id) {
  const { data } = await edu().from("self_study_assignments")
    .select("id, title, subject, topic, type, created_by, created_at").eq("id", id).maybeSingle();
  if (!data) return null;
  if (data.created_by !== instructor.id && instructor.role !== "admin") return null;
  return data;
}

/** One activity's class summary — averages over per-learner cognitive state. */
export async function activityOutcomeSummary(instructor, assignmentId) {
  const activity = await ownedActivity(instructor, assignmentId);
  if (!activity) return null;

  const { data: targets } = await edu().from("self_study_targets")
    .select("student_id, status").eq("assignment_id", activity.id);
  const rows = targets ?? [];

  const ids = rows.map((r) => r.student_id);
  let cognitive = [];
  if (ids.length) {
    const { data: agents } = await edu().from("student_agents")
      .select("student_id, knowledge_score").in("student_id", ids);
    const byStudent = new Map((agents ?? []).map((a) => [a.student_id, a.id]));
    const states = await Promise.all([...byStudent.values()].map((agentId) =>
      getStudentStateSafe(agentId)));
    cognitive = states.filter(Boolean);
  }
  const avg = (key) => {
    const vals = cognitive.map((c) => c[key]).filter((v) => typeof v === "number");
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };

  return {
    assignmentId: activity.id,
    title: activity.title,
    type: activity.type ?? "self_study",
    subject: activity.subject,
    topic: activity.topic,
    createdAt: activity.created_at,
    summary: {
      assigned: rows.length,
      started:  rows.filter((r) => r.status === "started").length,
      complete: rows.filter((r) => r.status === "complete").length,
      avgUnderstanding: avg("understanding"),
      avgConfusion:     avg("confusion"),
      avgEngagement:    avg("engagement"),
    },
  };
}

/** The instructor's recent activities (newest first) for pick-one flows. */
export async function listRecentActivities(instructor, limit = 5) {
  const { data } = await db.from("self_study_assignments")
    .select("id, title, type, subject, topic, created_at")
    .eq("created_by", instructor.id)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 10));
  return data ?? [];
}

async function getStudentStateSafe(agentId) {
  try {
    const { getStudentState } = await import("../adaptive-learning/student-state.js");
    const st = await getStudentState(agentId);
    return st?.cognitive ?? null;
  } catch { return null; }
}
