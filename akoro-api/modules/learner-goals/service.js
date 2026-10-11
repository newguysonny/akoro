/**
 * modules/learner-goals/service.js — the ONE write path for goals.
 *
 * Both the REST routes (/api/goals) and the agent's chat tools call these
 * functions, so validation, the active-goal cap and ownership live in
 * exactly one place. 'source' provenance: 'learner' when the learner
 * explicitly asks (in the UI or in chat); 'agent' arrives ONLY through an
 * approved proposal (human-in-the-loop, enforced in agent-proposals).
 */
import db from "../../db.js";

const edu = () => db.schema("edu");

export const GOAL_STATUSES = ["active", "paused", "achieved", "dismissed"];
export const MAX_ACTIVE_GOALS = 10;

const clean = (v, max) => {
  const s = String(v ?? "").trim();
  return (s && s.length <= max) ? s : null;
};

export const validateGoalTitle = (title) => clean(title, 120);

/** All the learner's live goals, active first, newest first. */
export async function listGoals(userId) {
  const { data, error } = await edu().from("learner_goals")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "paused", "achieved"])
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) return { error: "Could not load goals", status: 503 };
  const rows = data || [];
  rows.sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1));
  return { goals: rows };
}

export async function createGoal(userId, input = {}, { source = "learner" } = {}) {
  const title = validateGoalTitle(input.title);
  if (!title) return { error: "Give the goal a title (max 120 characters)." };

  const { count: activeCount, error: countError } = await edu().from("learner_goals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("status", "active");
  if (countError) return { error: "Could not check your goals", status: 503 };
  if ((activeCount ?? 0) >= MAX_ACTIVE_GOALS) {
    return { error: `You already have ${MAX_ACTIVE_GOALS} active goals — achieve, pause or remove one first.` };
  }

  let targetDate = null;
  if (input.target_date) {
    const d = new Date(input.target_date);
    if (Number.isNaN(d.getTime())) return { error: "The target date could not be parsed." };
    targetDate = d.toISOString().slice(0, 10);
  }

  const { data, error } = await edu().from("learner_goals").insert({
    user_id: userId,
    title,
    category: clean(input.category, 40),
    metric:   clean(input.metric, 160),
    exam:     clean(input.exam, 40),
    target_date: targetDate,
    source,
  }).select("*").single();
  if (error) return { error: "Could not save the goal", status: 503 };
  return { goal: data };
}

export async function updateGoal(userId, id, patch = {}) {
  const { data: row } = await edu().from("learner_goals")
    .select("id").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!row) return { notFound: true };

  const update = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) {
    const title = validateGoalTitle(patch.title);
    if (!title) return { error: "Give the goal a title (max 120 characters)." };
    update.title = title;
  }
  for (const f of ["category", "metric", "exam", "progress_note"]) {
    if (patch[f] === undefined) continue;
    const max = f === "metric" ? 160 : f === "progress_note" ? 500 : 40;
    // Too long is cut to fit — it used to come back null and WIPE the saved
    // value while reporting success. Clearing it on purpose ("" or null) still works.
    const empty = patch[f] === null || String(patch[f]).trim() === "";
    update[f] = empty ? null : clean(String(patch[f]).trim().slice(0, max), max);
  }
  if (patch.target_date !== undefined) {
    if (patch.target_date === null || patch.target_date === "") update.target_date = null;
    else {
      const d = new Date(patch.target_date);
      if (Number.isNaN(d.getTime())) return { error: "The target date could not be parsed." };
      update.target_date = d.toISOString().slice(0, 10);
    }
  }
  if (patch.status !== undefined) {
    if (!GOAL_STATUSES.includes(patch.status)) return { error: "Unknown goal status." };
    update.status = patch.status;
  }

  const { data, error } = await edu().from("learner_goals")
    .update(update).eq("id", row.id).select("*").single();
  if (error) return { error: "Could not update the goal", status: 503 };
  return { goal: data };
}
