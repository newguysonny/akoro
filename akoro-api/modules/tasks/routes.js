/**
 * modules/tasks/routes.js
 * All HTTP endpoints for the task system.
 * Converted from TypeScript to JS ESM.
 * Auth uses our JWT middleware (not separate auth).
 */

import { acceptChatSuggestion, dismissChatSuggestion } from "../agent-proposals/inbox.js";
import { Router }                         from "express";
import db                                 from "../../db.js";
import { TaskDB, TaskFileDB, TaskRunDB, TaskOutputDB, TaskScheduleDB, DynamicToolDB } from "./lib/db.js";
import { scheduleTask, cancelTask, triggerNow, getQueueHealth, taskQueue } from "./scheduler.js";
import { cancelAutonomyReviewForTask, scheduleAutonomyReviewForTask } from "../adaptive-learning/learner-autonomy.js";
import { extractIntent }                  from "./lib/context.js";
import { createPresignedUpload }          from "./lib/storage.js";
import { extractTextFromUrl }             from "./lib/ocr.js";
import { ALL_TOOLS }                      from "./tools/index.js";
import { OPENAI_MODEL }                   from "../../lib/aiModel.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { emitAutonomyEvent } from "../autonomy/triggers.js";

const router = Router();

// ─── GET /api/tasks/health — public diagnostic (no auth) ─────────────────────
// A one-curl snapshot of whether the task system can actually run tasks:
// worker/Redis connectivity, model config, tool registry, and recent
// completion coverage (are created tasks producing outputs?). Mirrors the
// battle /health endpoint. Declared BEFORE authenticateToken so it's curl-able.
router.get("/health", async (req, res) => {
  const out = { worker: { enabled: process.env.ENABLE_TASK_WORKER !== "false" } };

  // Redis / queue — can the worker pick up jobs?
  try {
    out.queue = await taskQueue.getJobCounts("active", "waiting", "delayed", "completed", "failed");
    out.redis = "up";
  } catch (err) { out.redis = "down"; out.queueError = err.message; }

  // Anthropic config — the model id every tool runs on, and whether a key is set.
  out.openai = { model: OPENAI_MODEL, keyConfigured: !!process.env.OPENAI_API_KEY };

  // Tool registry — how many tools loaded, and every output_type they emit
  // (must all exist in the output_type enum or their inserts fail).
  out.tools = { loaded: ALL_TOOLS.length };

  // Recent coverage — of tasks finished in the last 24h, how many delivered
  // at least one output? The real "are tasks working" signal.
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await db.from("tasks")
      .select("id, status, created_at")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(500);
    const rows = recent ?? [];
    const by = (s) => rows.filter((t) => t.status === s).length;
    const doneIds = rows.filter((t) => t.status === "done").map((t) => t.id);
    const { data: orows } = doneIds.length
      ? await db.from("task_outputs").select("task_id").in("task_id", doneIds)
      : { data: [] };
    const withOut = new Set((orows ?? []).map((r) => r.task_id));
    out.tasks = {
      last24h:            rows.length,
      done:               by("done"),
      failed:             by("failed"),
      running:            by("running"),
      queued:             by("queued"),
      pending:            by("pending"),
      doneWithOutputs:    doneIds.filter((id) => withOut.has(id)).length,
      doneWithoutOutputs: doneIds.filter((id) => !withOut.has(id)).length,
      recentFailureIds:   rows.filter((t) => t.status === "failed").slice(0, 5).map((t) => t.id),
    };
  } catch (err) { out.tasksError = err.message; }

  const healthy = out.redis === "up" && out.worker.enabled && out.openai.keyConfigured;
  res.json({ ok: healthy, ...out });
});

router.use(authenticateToken);

// ═══════════════════════════════════════════════════════════════════════════════
// FDE / admin: config-only tool management (no code deploy)
// Mounted under /api/tasks/admin/tools — admin role only.
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_EXECUTORS = ["llm_prompt", "notify", "create_battle", "http_webhook"];
const VALID_SCOPES     = ["global", "user", "school"];

// GET /api/tasks/admin/tools — list (optional ?scope= &ownerUserId= &schoolId=)
router.get("/admin/tools", requireRole(["admin"]), async (req, res) => {
  try {
    const { scope, ownerUserId, schoolId } = req.query;
    const tools = await DynamicToolDB.list({ scope, ownerUserId, schoolId });
    res.json({ tools, count: tools.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/admin/tools — create a config-only tool
router.post("/admin/tools", requireRole(["admin"]), async (req, res) => {
  try {
    const {
      name, description, inputSchema, executor, config = {},
      scope = "global", ownerUserId, schoolId, intentKeywords = [],
    } = req.body;

    if (!name || !/^[a-z][a-z0-9_]*$/.test(name))
      return res.status(400).json({ error: "name must be snake_case (a-z, 0-9, _)" });
    if (!description)                       return res.status(400).json({ error: "description is required" });
    if (!VALID_EXECUTORS.includes(executor)) return res.status(400).json({ error: `executor must be one of ${VALID_EXECUTORS.join(", ")}` });
    if (!VALID_SCOPES.includes(scope))       return res.status(400).json({ error: `scope must be one of ${VALID_SCOPES.join(", ")}` });
    if (scope === "user"   && !ownerUserId)  return res.status(400).json({ error: "ownerUserId required for scope 'user'" });
    if (scope === "school" && !schoolId)     return res.status(400).json({ error: "schoolId required for scope 'school'" });

    const tool = await DynamicToolDB.create({
      name, description,
      input_schema:    inputSchema ?? { type: "object", properties: {} },
      executor, config, scope,
      owner_user_id:   scope === "user"   ? ownerUserId : null,
      school_id:       scope === "school" ? schoolId    : null,
      intent_keywords: intentKeywords,
      created_by:      req.user.id,
    });
    res.status(201).json({ tool });
  } catch (err) {
    console.error("[tasks/admin/tools] create:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/admin/tools/:id — update / enable / disable
router.patch("/admin/tools/:id", requireRole(["admin"]), async (req, res) => {
  try {
    const allowed = ["name", "description", "config", "enabled", "intent_keywords"];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (req.body.inputSchema !== undefined) updates.input_schema = req.body.inputSchema;
    if (!Object.keys(updates).length) return res.status(400).json({ error: "no updatable fields provided" });
    const tool = await DynamicToolDB.update(req.params.id, updates);
    res.json({ tool });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/admin/tools/:id
router.delete("/admin/tools/:id", requireRole(["admin"]), async (req, res) => {
  try {
    await DynamicToolDB.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/admin/partners — list schools + teachers for scoping UI
router.get("/admin/partners", requireRole(["admin"]), async (req, res) => {
  try {
    const db = (await import("../../db.js")).default;
    const [{ data: schools }, { data: teachers }] = await Promise.all([
      db.from("schools").select("id, name, logo_url").order("name"),
      db.from("users").select("id, full_name, username, email, role").in("role", ["instructor", "admin"]).order("full_name"),
    ]);
    res.json({ schools: schools ?? [], teachers: teachers ?? [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/admin/tools/:id — fetch single tool
router.get("/admin/tools/:id", requireRole(["admin"]), async (req, res) => {
  try {
    const db = (await import("../../db.js")).default;
    const { data, error } = await db.from("dynamic_tools").select("*").eq("id", req.params.id).single();
    if (error || !data) return res.status(404).json({ error: "not found" });
    res.json({ tool: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Learner tasks are plans owned and completed by the learner. They must never
// enter the generic task-runner, which can call arbitrary task executors. Their
// only automatic behaviour is the separate, opt-in, due-time Agent Chat.
const LEARNER_ROLES = new Set(["student", "learner"]);
const isLearnerTask = (req) => LEARNER_ROLES.has(String(req.user?.role || "").toLowerCase());
const isPreciseDueAt = (value) => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())
  && Number.isFinite(new Date(value).getTime());

// ─── POST /api/tasks ──────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
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
      const db = (await import("../../db.js")).default;
      const { data: agent } = await db.from("user_agents").select("id").eq("user_id", req.user.id).eq("is_active", true).maybeSingle();
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
      try { await scheduleAutonomyReviewForTask(task); }
      catch (autonomyError) { console.warn("[tasks] autonomy schedule skipped:", autonomyError.message); }
      return res.status(201).json({ task: { ...task, bullJobId: null } });
    }

    const jobId = await scheduleTask(task);
    res.status(201).json({ task: { ...task, bullJobId: jobId } });
  } catch (err) {
    console.error("[tasks] Create error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tasks ───────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { status } = req.query;
    const tasks      = await TaskDB.listByCreator(req.user.id, status);
    res.json({ tasks, count: tasks.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══ Agent suggestions ════════════════════════════════════════════════════════
// Proactive ideas the agent files for the learner (the chat tool
// `suggest_help`). They are advice only: nothing executes and no task exists
// until the learner accepts one — accept creates the real task, dismiss
// closes the idea. Declared before /:taskId so "suggestions" is never read
// as a task id.

/** GET /api/tasks/suggestions — the learner's open suggestions, newest first. */
router.get("/suggestions", async (req, res) => {
  try {
    const { data, error } = await db.from("agent_suggestions")
      .select("*").eq("user_id", req.user.id).eq("status", "open")
      .order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    res.json({ suggestions: data ?? [], count: (data ?? []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/tasks/suggestions/:id/accept — turn one suggestion into a real task
    (this tab's contract; /api/agent/proposals/inbox accepts each kind as itself). */
router.post("/suggestions/:id/accept", async (req, res) => {
  try {
    res.json(await acceptChatSuggestion(req.user.id, req.params.id, { asTask: true }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** PATCH /api/tasks/suggestions/:id/dismiss — close one suggestion, with an optional reason. */
router.patch("/suggestions/:id/dismiss", async (req, res) => {
  try {
    res.json({ suggestion: await dismissChatSuggestion(req.user.id, req.params.id, req.body?.reason) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── GET /api/tasks/:taskId ───────────────────────────────────────────────────
router.get("/:taskId", async (req, res) => {
  try {
    const task = await TaskDB.findByIdWithRelations(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });
    res.json({ task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/tasks/:taskId ─────────────────────────────────────────────────
// Edits a task that has not started yet. Instructor tasks maintain their
// generic execution queue; learner tasks maintain only their opt-in chat review.
router.patch("/:taskId", async (req, res) => {
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
          if (updated.due_at) await scheduleAutonomyReviewForTask(updated);
          else await cancelAutonomyReviewForTask({ taskId: updated.id, userId: req.user.id });
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
});

// ─── DELETE /api/tasks/:taskId ────────────────────────────────────────────────
// Removes the task for good: the queued job, the recurring schedule, and the
// row (runs/outputs/files cascade). Pass ?cancel=1 to keep the record and just
// mark it cancelled instead.
router.delete("/:taskId", async (req, res) => {
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
});

// ─── POST /api/tasks/:taskId/trigger ─────────────────────────────────────────
router.post("/:taskId/trigger", async (req, res) => {
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
});

// ─── GET /api/tasks/:taskId/runs ──────────────────────────────────────────────
router.get("/:taskId/runs", async (req, res) => {
  try {
    const runs = await TaskRunDB.listByTask(req.params.taskId);
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tasks/:taskId/outputs ──────────────────────────────────────────
router.get("/:taskId/outputs", async (req, res) => {
  try {
    const outputs = await TaskOutputDB.listByTask(req.params.taskId);
    res.json({ outputs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/tasks/upload-url ───────────────────────────────────────────────
router.post("/upload-url", async (req, res) => {
  try {
    const { fileName, fileType, sizeBytes } = req.body;
    if (!fileName || !fileType) return res.status(400).json({ error: "fileName and fileType are required" });
    if (sizeBytes > 2 * 1024 * 1024 * 1024) return res.status(400).json({ error: "File too large (max 2GB)" });

    const result = await createPresignedUpload(fileName, fileType, req.user.id, { sizeBytes });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/tasks/files/confirm ───────────────────────────────────────────
router.post("/files/confirm", async (req, res) => {
  try {
    const { fileKey, fileName, fileType, sizeBytes, publicUrl } = req.body;
    const file = await TaskFileDB.create({
      teacher_id: req.user.id, file_key: fileKey,
      file_name: fileName, file_type: fileType,
      size_bytes: sizeBytes, file_url: publicUrl,
    });

    // OCR extract in background
    extractTextFromUrl(publicUrl, fileType, fileName).then(async (result) => {
      if (result.success) {
        const db = (await import("../../db.js")).default;
        await db.from("task_files").update({ ocr_text: result.text }).eq("id", file.id);
      }
    }).catch(() => {});

    res.status(201).json({ file });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tasks/files/:id ─────────────────────────────────────────────────
// Poll a file's OCR status/result (ocr_text is populated in the background).
router.get("/files/:id", async (req, res) => {
  try {
    const file = await TaskFileDB.findById(req.params.id);
    if (!file) return res.status(404).json({ error: "File not found" });
    if (file.teacher_id && file.teacher_id !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json({
      id:       file.id,
      fileName: file.file_name,
      fileUrl:  file.file_url,
      ocrText:  file.ocr_text ?? null,
      ocrReady: file.ocr_text != null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tasks/queue/health  (admin) ────────────────────────────────────
router.get("/queue/health", requireRole(["admin"]), async (req, res) => {
  try {
    const health = await getQueueHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/tasks/:taskId/toggle — mark done / reopen ──────────────────
router.patch("/:taskId/toggle", async (req, res) => {
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
      try { await cancelAutonomyReviewForTask({ taskId: updated.id, userId: req.user.id }); }
      catch (autonomyError) { console.warn("[tasks] autonomy cancellation skipped:", autonomyError.message); }
      // Event trigger: a finished task is fresh signal for the planner.
      emitAutonomyEvent(req.user.id, "task_done").catch(() => {});
    }
    res.json({ task: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/tasks/:taskId/create-challenge ─────────────────────────────────
// Convert a completed or pending task into a battle challenge
router.post("/:taskId/create-challenge", async (req, res) => {
  try {
    const task = await TaskDB.findById(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });

    const { opponentId, xpPrize = 100, hp_per_miss, min_xp, total_questions } = req.body;
    if (!opponentId) return res.status(400).json({ error: "opponentId required" });

    // The one battle path: questions written and paid for by the creator, both
    // seats set up, the opponent notified with the full challenge card, entry
    // gate and HP/XP rules. This route used to insert a battle with no
    // questions, which ended the moment it started.
    const { createNetworkBattle } = await import("../battle/networkBattle.js");
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
});

export default router;
