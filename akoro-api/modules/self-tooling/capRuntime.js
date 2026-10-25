/**
 * modules/self-tooling/capRuntime.js — capabilities that run here rather than
 * through an existing chat tool (`runtime: true` in capabilities.js). Each one
 * takes the learner's id from the server, never from tool arguments, and
 * applies its own scope rules. Only reachable once the capability is enabled
 * (an admin grant for locked ones), and that is re-checked on every run.
 */
import db from "../../db.js";
import { blockedWith } from "../agent-network/network.js";

const MAX_BATTLES = 30;

export const CAP_RUNNERS = {
  /** Other players' results in battles this learner took part in. */
  async "battles.class_results"(learnerId) {
    const { data: mine, error } = await db.from("battle_participants").select("battle_id")
      .eq("user_id", learnerId).order("joined_at", { ascending: false, nullsFirst: false }).limit(MAX_BATTLES);
    if (error) throw new Error("couldn't read battles");
    const ids = [...new Set((mine || []).map((r) => r.battle_id))];
    if (!ids.length) return { results: [] };
    const [{ data: rows, error: e2 }, { data: battles }, blocked] = await Promise.all([
      db.from("battle_participants").select("battle_id, user_id, score, final_rank, is_winner").in("battle_id", ids).limit(1000),
      db.from("battles").select("id, title, subject").in("id", ids),
      blockedWith(learnerId).catch(() => new Set()),
    ]);
    if (e2) throw new Error("couldn't read battle results");
    const others = [...new Set((rows || []).map((r) => r.user_id).filter((u) => u !== learnerId))];
    const { data: users } = others.length ? await db.from("users").select("id, full_name, username").in("id", others) : { data: [] };
    const name = new Map((users || []).map((u) => [u.id, (u.full_name || "").split(" ")[0] || u.username || "A player"]));
    const battle = new Map((battles || []).map((b) => [b.id, b]));
    return {
      results: (rows || []).filter((r) => r.user_id === learnerId || !blocked.has(r.user_id)).map((r) => ({
        battleTitle: battle.get(r.battle_id)?.title || null, subject: battle.get(r.battle_id)?.subject || null,
        player: r.user_id === learnerId ? "You" : name.get(r.user_id) || "A player",
        score: r.score, rank: r.final_rank, isWinner: r.is_winner, isMe: r.user_id === learnerId,
      })),
    };
  },

  async "verify.probe"() {
    return { checkedAt: new Date().toISOString(), ok: true };
  },
};

/**
 * Write runners (S6): apply one capability to ONE of the learner's own rows,
 * by the row's id. Called only from a confirmed card (confirmations.js); the
 * owner is checked here again, whatever the confirmation says.
 * → { ok: true } | { ok: false, error }
 */
/** The same as the app's "mark done" (PATCH /api/tasks/:id/toggle), side effects included. */
const markTaskDone = async (learnerId, ref) => {
  const { data, error } = await db.from("tasks").update({ status: "done", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", ref).eq("creator_id", learnerId).neq("status", "done").select("id").maybeSingle();
  if (error) return { ok: false, error: "couldn't update the task" };
  if (!data) return { ok: false, error: "not found or already done" };
  try {
    const [{ cancelAutonomyReviewForTask }, { emitAutonomyEvent }] = await Promise.all([
      import("../adaptive-learning/learner-autonomy.js"), import("../autonomy/triggers.js"),
    ]);
    await cancelAutonomyReviewForTask({ taskId: data.id, userId: learnerId }).catch(() => {});
    emitAutonomyEvent(learnerId, "task_done").catch(() => {});
  } catch { /* the task is done; follow-ups are best effort, as in the route */ }
  return { ok: true };
};
/** The same as the app's delete (DELETE /api/tasks/:id): never a running task; its schedule is cancelled first. */
const deleteTask = async (learnerId, ref) => {
  const { data: task, error } = await db.from("tasks").select("id, status, bull_job_id").eq("id", ref).eq("creator_id", learnerId).maybeSingle();
  if (error) return { ok: false, error: "couldn't read the task" };
  if (!task) return { ok: false, error: "not found or already deleted" };
  if (task.status === "running") return { ok: false, error: "it's running right now" };
  try {
    const { cancelTask } = await import("../tasks/scheduler.js");
    await cancelTask(task.bull_job_id, task.id);
  } catch { /* nothing scheduled to cancel */ }
  const { error: delErr } = await db.from("tasks").delete().eq("id", task.id).eq("creator_id", learnerId);
  if (delErr) return { ok: false, error: "couldn't delete the task" };
  try {
    const { cancelAutonomyReviewForTask } = await import("../adaptive-learning/learner-autonomy.js");
    await cancelAutonomyReviewForTask({ taskId: task.id, userId: learnerId }).catch(() => {});
  } catch { /* best effort, as for mark done */ }
  return { ok: true };
};
export const WRITE_RUNNERS = {
  "tasks.mark_done": markTaskDone,
  "tasks.delete": deleteTask,
  "verify.task_done": markTaskDone,
  /** Through the study_buddy tool, so its own checks (and notifications) run. */
  async "buddies.end"(learnerId, ref, { callTool }) {
    const r = await callTool("study_buddy", { action: "end", id: ref });
    return r?.error ? { ok: false, error: String(r.error).slice(0, 120) } : { ok: true };
  },
};

