import { acceptChatSuggestion, dismissChatSuggestion } from "../agent-proposals/index.js";
import { TaskDB, TaskFileDB, TaskRunDB, TaskOutputDB, TaskScheduleDB } from "./lib/db.js";
import { scheduleTask, cancelTask, triggerNow } from "./scheduler.js";
import { extractIntent } from "./lib/context.js";
import { emitAutonomyEvent } from "../autonomy/index.js";
import { agentDeps } from "../../lib/agentDeps.js";
import { isLearnerTask, isPreciseDueAt, nextRecurrenceDue } from "./task-rules.js";
import { activeAgentForUser, openSuggestions, insertRecurrenceTask } from "./task-store.js";

// ─── POST /api/tasks ──────────────────────────────────────────────────────────
export async function createTask(req, res) {
  try {
    const { title, description, priority = "medium", agentId: providedAgentId, courseId, dueAt, isRecurring = false, cronExpr, timezone = "Africa/Lagos", fileIds = [] } = req.body;

    if (!title) return res.status(400).json({ error: "title is required" });
    if (dueAt !== undefined && dueAt !== null) {
      const validDue = isLearnerTask(req) ? isPreciseDueAt(dueAt) : Number.isFinite(new Date(dueAt).getTime());
      if (!validDue) return res.status(422).json({ error: isLearnerTask(req)
        ? "dueAt must be an ISO 8601 timestamp with a timezone offset"
        : "dueAt must be a valid timestamp" });
    }
    if (isLearnerTask(req) && isRecurring) {
      return res.status(422).json({ error: "Learner task autonomy supports one precise due time, not recurring runs" });
    }

    // Auto-resolve agentId from user's active agent if not provided
    let agentId = providedAgentId;
    if (!agentId) {
      const agent = await activeAgentForUser(req.user.id);
      agentId = agent?.id ?? null;
    }
    if (!agentId) return res.status(400).json({ error: "No agent found. Please set up your agent in settings." });
    if (isRecurring && !cronExpr) return res.status(400).json({ error: "cronExpr required for recurring tasks" });

    const teacherId             = req.user.id;
    const { taskType, payload } = await extractIntent(title, description, req.user.role);

    const task = await TaskDB.create({
      creator_id: teacherId, agent_id: agentId,
      course_id:  courseId ?? null, title,
      description: description ?? null, priority,
      status:      "pending", task_type: taskType, payload,
      due_at:      dueAt ?? null, is_recurring: isRecurring, timezone,
    });

    if (fileIds.length) {
      await Promise.all(fileIds.map((fid) =>
        TaskFileDB.create({ task_id: task.id, file_id: fid })
      ));
    }

    if (isRecurring && cronExpr) {
      await TaskScheduleDB.create({ taskId: task.id, cronExpr, timezone });
    }

    if (isLearnerTask(req)) {
      // Deliberately do not call scheduleTask(): that queue executes a task and
      // may spend coins. The autonomy service only queues a chat after checking
      // the learner's server-side opt-in at delivery time.
      try { await agentDeps().scheduleAutonomyReviewForTask(task); }
      catch (autonomyError) { console.warn("[tasks] autonomy schedule skipped:", autonomyError.message); }
      return res.status(201).json({ task: { ...task, bullJobId: null } });
    }

    const jobId = await scheduleTask(task);
    res.status(201).json({ task: { ...task, bullJobId: jobId } });
  } catch (err) {
    console.error("[tasks] Create error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/tasks ───────────────────────────────────────────────────────────
export async function listTasks(req, res) {
  try {
    const { status } = req.query;
    const tasks      = await TaskDB.listByCreator(req.user.id, status);
    res.json({ tasks, count: tasks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** GET /api/tasks/suggestions — the learner's open suggestions, newest first. */
export async function listSuggestions(req, res) {
  try {
    const { data, error } = await openSuggestions(req.user.id);
    if (error) throw new Error(error.message);
    res.json({ suggestions: data ?? [], count: (data ?? []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** POST /api/tasks/suggestions/:id/accept — turn one suggestion into a real task
    (this tab's contract; /api/agent/proposals/inbox accepts each kind as itself). */
export async function acceptSuggestion(req, res) {
  try {
    res.json(await acceptChatSuggestion(req.user.id, req.params.id, { asTask: true }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

/** PATCH /api/tasks/suggestions/:id/dismiss — close one suggestion, with an optional reason. */
export async function dismissSuggestion(req, res) {
  try {
    res.json({ suggestion: await dismissChatSuggestion(req.user.id, req.params.id, req.body?.reason) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

// ─── GET /api/tasks/:taskId ───────────────────────────────────────────────────
export async function getTask(req, res) {
  try {
    const task = await TaskDB.findByIdWithRelations(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });
    res.json({ task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── PATCH /api/tasks/:taskId ─────────────────────────────────────────────────
// Edits a task that has not started yet. Instructor tasks maintain their
// generic execution queue; learner tasks maintain only their opt-in chat review.
export async function updateTask(req, res) {
  try {
    const task = await TaskDB.findById(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });
    if (!["pending", "queued", "cancelled"].includes(task.status))
      return res.status(400).json({ error: "Cannot edit a running or completed task" });

    const { title, description, priority, dueAt, isRecurring, cronExpr, timezone, courseId } = req.body;
    const updates = {};
    if (title !== undefined)       updates.title       = title;
    if (description !== undefined) updates.description = description || null;
    if (priority !== undefined)    updates.priority    = priority;
    if (courseId !== undefined)    updates.course_id   = courseId || null;
    if (timezone !== undefined)    updates.timezone    = timezone;
    if (dueAt !== undefined && dueAt !== null) {
      const validDue = isLearnerTask(req) ? isPreciseDueAt(dueAt) : Number.isFinite(new Date(dueAt).getTime());
      if (!validDue) return res.status(422).json({ error: isLearnerTask(req)
        ? "dueAt must be an ISO 8601 timestamp with a timezone offset"
        : "dueAt must be a valid timestamp" });
    }
    if (isLearnerTask(req) && isRecurring) {
      return res.status(422).json({ error: "Learner task autonomy supports one precise due time, not recurring runs" });
    }
    // `dueAt: null` is a real instruction ("unschedule"), so the presence of
    // the key matters, not its truthiness.
    const timingChanged = dueAt !== undefined || isRecurring !== undefined || cronExpr !== undefined;
    if (dueAt !== undefined)       updates.due_at      = dueAt || null;
    if (isRecurring !== undefined) updates.is_recurring = !!isRecurring;

    if (isRecurring && !cronExpr && !(await TaskScheduleDB.findByTask(task.id)))
      return res.status(400).json({ error: "cronExpr required for recurring tasks" });

    let updated = Object.keys(updates).length ? await TaskDB.update(req.params.taskId, updates) : task;

    if (timingChanged) {
      // Re-point the schedule row first so scheduleTask() reads the new cron.
      if (!updated.is_recurring) {
        await TaskScheduleDB.removeByTask(task.id);
      } else if (cronExpr) {
        const existing = await TaskScheduleDB.findByTask(task.id);
        if (existing) await TaskScheduleDB.update(existing.id, { cron_expr: cronExpr, timezone: updated.timezone ?? "Africa/Lagos" });
        else          await TaskScheduleDB.create({ taskId: task.id, cronExpr, timezone: updated.timezone ?? "Africa/Lagos" });
      }
      await cancelTask(updated.bull_job_id, updated.id);
      if (isLearnerTask(req)) {
        // Learners edit study plans, not autonomous execution jobs. Keep the
        // task pending and re-point (or cancel) the chat-only due review.
        updated = await TaskDB.updateStatus(updated.id, "pending", { bullJobId: null });
        try {
          if (updated.due_at) await agentDeps().scheduleAutonomyReviewForTask(updated);
          else await agentDeps().cancelAutonomyReviewForTask({ taskId: updated.id, userId: req.user.id });
        } catch (autonomyError) {
          console.warn("[tasks] autonomy update skipped:", autonomyError.message);
        }
      } else {
        const jobId = await scheduleTask(updated);
        updated = { ...updated, bull_job_id: jobId, status: "queued" };
      }
    }

    res.json({ task: updated });
  } catch (err) {
    console.error("[tasks] Update error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ─── DELETE /api/tasks/:taskId ────────────────────────────────────────────────
// Removes the task for good: the queued job, the recurring schedule, and the
// row (runs/outputs/files cascade). Pass ?cancel=1 to keep the record and just
// mark it cancelled instead.
export async function deleteTask(req, res) {
  try {
    const task = await TaskDB.findById(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });
    if (task.status === "running") return res.status(400).json({ error: "Cannot delete a running task" });

    await cancelTask(task.bull_job_id, task.id);

    if (req.query.cancel === "1") {
      await TaskDB.cancel(req.params.taskId);
      return res.json({ success: true, cancelled: true });
    }

    await TaskDB.remove(req.params.taskId);
    res.json({ success: true, deleted: true });
  } catch (err) {
    console.error("[tasks] Delete error:", err.message);
    res.status(500).json({ error: err.message });
  }
}

// ─── POST /api/tasks/:taskId/trigger ─────────────────────────────────────────
export async function triggerTask(req, res) {
  try {
    const task = await TaskDB.findById(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });
    if (!["done", "failed", "pending", "queued"].includes(task.status)) return res.status(400).json({ error: "Task is already running" });

    const jobId = await triggerNow(task);
    await TaskDB.updateStatus(task.id, "queued", { bullJobId: jobId });
    res.json({ success: true, jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/tasks/:taskId/runs ──────────────────────────────────────────────
// Runs and outputs are the task creator's, like the task itself: these two
// used to answer for any task id (Phase 15 item 6).
export async function listTaskRuns(req, res) {
  try {
    const task = await TaskDB.findById(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });
    const runs = await TaskRunDB.listByTask(task.id);
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/tasks/:taskId/outputs ──────────────────────────────────────────
export async function listTaskOutputs(req, res) {
  try {
    const task = await TaskDB.findById(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });
    const outputs = await TaskOutputDB.listByTask(task.id);
    res.json({ outputs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/** Create the next occurrence of a repeating learner to-do (same task, due advanced). */
async function spawnNextRecurrence(task, everySeconds) {
  const due = nextRecurrenceDue(task.due_at, everySeconds);
  const next = await insertRecurrenceTask({
    creator_id: task.creator_id, agent_id: task.agent_id,
    title: task.title, description: task.description, priority: task.priority,
    status: "pending", task_type: task.task_type || "general",
    payload: { ...(task.payload || {}), recurrence: { everySeconds } },
    due_at: due.toISOString(), timezone: task.timezone, course_id: task.course_id ?? null,
  });
  try { await agentDeps().scheduleAutonomyReviewForTask(next); }
  catch (e) { console.warn("[tasks] recurrence autonomy schedule skipped:", e.message); }
  global.io?.to(`user:${task.creator_id}`).emit("task:created", next);
  return next;
}

// ─── PATCH /api/tasks/:taskId/toggle — mark done / reopen ──────────────────
export async function toggleTask(req, res) {
  try {
    const task = await TaskDB.findById(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });

    // Toggle: done → pending, anything else → done
    const newStatus = task.status === "done" ? "pending" : "done";
    const extra = newStatus === "done"
      ? { completedAt: new Date() }
      : { completedAt: null, startedAt: null };

    const updated = await TaskDB.updateStatus(req.params.taskId, newStatus, extra);
    if (newStatus === "done" && isLearnerTask(req)) {
      try { await agentDeps().cancelAutonomyReviewForTask({ taskId: updated.id, userId: req.user.id }); }
      catch (autonomyError) { console.warn("[tasks] autonomy cancellation skipped:", autonomyError.message); }
      // Event trigger: a finished task is fresh signal for the planner.
      emitAutonomyEvent(req.user.id, "task_done").catch(() => {});
      // A repeating to-do regenerates its next occurrence once completed.
      const everySeconds = Number(task.payload?.recurrence?.everySeconds)
        || (Number(task.payload?.recurrence?.everyDays) > 0 ? Number(task.payload.recurrence.everyDays) * 86_400 : null);
      if (Number.isInteger(everySeconds) && everySeconds >= 60) {
        try {
          const next = await spawnNextRecurrence(task, everySeconds);
          if (next) return res.json({ task: updated, next });
        } catch (recurErr) { console.warn("[tasks] recurrence spawn skipped:", recurErr.message); }
      }
    }
    res.json({ task: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── POST /api/tasks/:taskId/create-challenge ─────────────────────────────────
// Convert a completed or pending task into a battle challenge
export async function createChallenge(req, res) {
  try {
    const task = await TaskDB.findById(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });

    const { opponentId, xpPrize = 100, hp_per_miss, min_xp, total_questions } = req.body;
    if (!opponentId) return res.status(400).json({ error: "opponentId required" });

    // The one battle path: questions written and paid for by the creator, both
    // seats set up, the opponent notified with the full challenge card, entry
    // gate and HP/XP rules. This route used to insert a battle with no
    // questions, which ended the moment it started.
    const { createNetworkBattle } = await import("../battle/index.js");
    const difficulty = { easy: "easy", medium: "intermediate", intermediate: "intermediate", hard: "hard" }[String(task.payload?.difficulty ?? "medium").toLowerCase()] || "intermediate";
    const result = await createNetworkBattle({
      creatorId: req.user.id, opponents: [opponentId], source: "challenge",
      options: {
        kind: "1v1", subject: task.payload?.subject ?? task.subject ?? "General", topic: task.title,
        difficulty, total_questions, xp_prize: xpPrize, hp_per_miss, min_xp, title: String(task.title || "Challenge").slice(0, 120),
      },
    });
    const battle = { id: result.battleId };

    res.status(201).json({ success: true, battleId: battle.id });
  } catch (err) {
    if ([400, 402, 403, 404, 409, 429].includes(err?.status)) return res.status(err.status).json({ error: err.message });
    console.error("[tasks/create-challenge]", err.message);
    res.status(500).json({ error: err.message });
  }
}
