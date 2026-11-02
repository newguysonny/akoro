/**
 * modules/tasks/lib/db.js
 * All DB query functions for the task system.
 * Adapted from Drizzle ORM → Supabase JS client (our db.js).
 * The rest of the tasks module never imports supabase directly.
 */

import db from "../../../db.js";

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const TaskDB = {
  async create(data) {
    const { data: task, error } = await db.from("tasks").insert(data).select().single();
    if (error) throw new Error(error.message);
    return task;
  },

  async findById(id) {
    const { data } = await db.from("tasks").select("*").eq("id", id).single();
    return data ?? null;
  },

  async findByIdWithRelations(id) {
    const task = await TaskDB.findById(id);
    if (!task) return null;
    const [files, runs, outputs] = await Promise.all([
      TaskFileDB.listByTask(id),
      TaskRunDB.listByTask(id),
      TaskOutputDB.listByTask(id),
    ]);
    return { ...task, files, runs, latestOutput: outputs[0] ?? null };
  },

  async listByCreator(creatorId, status) {
    let q = db.from("tasks").select("*").eq("creator_id", creatorId);
    if (status) q = q.eq("status", status);
    const { data } = await q.order("created_at", { ascending: false });
    return data ?? [];
  },

  async updateStatus(id, status, extra = {}) {
    const updates = { status, ...extra };
    if (extra.startedAt)   updates.started_at   = extra.startedAt;
    if (extra.completedAt) updates.completed_at = extra.completedAt;
    if (extra.bullJobId)   updates.bull_job_id   = extra.bullJobId;
    const { data, error } = await db.from("tasks").update(updates).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async update(id, data) {
    const { data: updated, error } = await db.from("tasks").update(data).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return updated;
  },

  async cancel(id) {
    const { data, error } = await db.from("tasks").update({ status: "cancelled" }).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  async findOverdue() {
    const { data } = await db.from("tasks")
      .select("*")
      .in("status", ["pending", "queued"])
      .lt("due_at", new Date().toISOString())
      .not("due_at", "is", null);
    return data ?? [];
  },
};

// ─── Task Files ───────────────────────────────────────────────────────────────

export const TaskFileDB = {
  async create(data) {
    const { data: file, error } = await db.from("task_files").insert(data).select().single();
    if (error) throw new Error(error.message);
    return file;
  },

  async listByTask(taskId) {
    const { data } = await db.from("task_files").select("*").eq("task_id", taskId).order("created_at");
    return data ?? [];
  },

  async findById(id) {
    const { data } = await db.from("task_files").select("*").eq("id", id).single();
    return data ?? null;
  },
};

// ─── Task Runs ────────────────────────────────────────────────────────────────

export const TaskRunDB = {
  async create(data) {
    const { data: run, error } = await db.from("task_runs").insert({
      task_id:     data.taskId,
      run_number:  data.runNumber,
      status:      data.status,
      agent_steps: JSON.stringify(data.agentSteps ?? []),
    }).select().single();
    if (error) throw new Error(error.message);
    return { ...run, agentSteps: data.agentSteps ?? [] };
  },

  async nextRunNumber(taskId) {
    const { count } = await db.from("task_runs").select("id", { count: "exact", head: true }).eq("task_id", taskId);
    return (count ?? 0) + 1;
  },

  async listByTask(taskId) {
    const { data } = await db.from("task_runs").select("*").eq("task_id", taskId).order("run_number", { ascending: false });
    return (data ?? []).map((r) => ({ ...r, agentSteps: typeof r.agent_steps === "string" ? JSON.parse(r.agent_steps) : (r.agent_steps ?? []) }));
  },

  async update(id, updates) {
    const payload = { ...updates };
    if (updates.agentSteps !== undefined) payload.agent_steps = JSON.stringify(updates.agentSteps);
    const { data, error } = await db.from("task_runs").update(payload).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
};

// ─── Task Outputs ─────────────────────────────────────────────────────────────

export const TaskOutputDB = {
  async create(data) {
    const { data: output, error } = await db.from("task_outputs").insert({
      run_id:      data.runId,
      task_id:     data.taskId,
      output_type: data.outputType,
      content:     data.content,
      delivered:   data.delivered ?? false,
    }).select().single();
    if (error) throw new Error(error.message);
    return output;
  },

  async listByTask(taskId) {
    const { data } = await db.from("task_outputs").select("*").eq("task_id", taskId).order("created_at", { ascending: false });
    return data ?? [];
  },

  async markDelivered(id) {
    await db.from("task_outputs").update({ delivered: true }).eq("id", id);
  },
};

// ─── Task Schedules ───────────────────────────────────────────────────────────

export const TaskScheduleDB = {
  async create(data) {
    const { data: sched, error } = await db.from("task_schedules").insert({
      task_id:   data.taskId,
      cron_expr: data.cronExpr,
      timezone:  data.timezone ?? "Africa/Lagos",
    }).select().single();
    if (error) throw new Error(error.message);
    return sched;
  },

  async findByTask(taskId) {
    const { data } = await db.from("task_schedules").select("*").eq("task_id", taskId).single();
    return data ?? null;
  },

  async update(id, updates) {
    const { data, error } = await db.from("task_schedules").update(updates).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return data;
  },
};

// ─── Agents ───────────────────────────────────────────────────────────────────
// Task agents = teacher's AI assistants — separate from student user_agents

export const AgentDB = {
  async findById(id) {
    // Look in user_agents first (student/teacher agents), then task_agents
    const { data: ua } = await db.from("user_agents").select("*").eq("id", id).single();
    if (ua) return {
      id: ua.id, teacherId: ua.user_id, name: ua.agent_name,
      emoji: ua.agent_emoji, systemPrompt: null, subject: null,
      level: 1, xp: ua.total_xp,
    };
    const { data: ta } = await db.from("task_agents").select("*").eq("id", id).single();
    return ta ?? null;
  },
};
