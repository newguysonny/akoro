/**
 * modules/tasks/routes.js
 * All HTTP endpoints for the task system.
 * Converted from TypeScript to JS ESM.
 * Auth uses our JWT middleware (not separate auth).
 */

import { Router }                         from "express";
import { TaskDB, TaskFileDB, TaskRunDB, TaskOutputDB, TaskScheduleDB } from "./lib/db.js";
import { scheduleTask, cancelTask, triggerNow, getQueueHealth }        from "./scheduler.js";
import { extractIntent }                  from "./lib/context.js";
import { createPresignedUpload }          from "./lib/storage.js";
import { extractTextFromUrl }             from "./lib/ocr.js";
import { authenticateToken, requireRole } from "../auth/routes.js";

const router = Router();
router.use(authenticateToken);

// ─── POST /api/tasks ──────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { title, description, priority = "medium", agentId, courseId, dueAt, isRecurring = false, cronExpr, timezone = "Africa/Lagos", fileIds = [] } = req.body;

    if (!title || !agentId) return res.status(400).json({ error: "title and agentId are required" });
    if (isRecurring && !cronExpr) return res.status(400).json({ error: "cronExpr required for recurring tasks" });

    const teacherId             = req.user.id;
    const { taskType, payload } = await extractIntent(title, description);

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
router.patch("/:taskId", async (req, res) => {
  try {
    const task = await TaskDB.findById(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });
    if (!["pending", "queued"].includes(task.status)) return res.status(400).json({ error: "Cannot edit a running or completed task" });

    const { title, description, priority, dueAt } = req.body;
    const updates = {};
    if (title)       updates.title       = title;
    if (description) updates.description = description;
    if (priority)    updates.priority    = priority;
    if (dueAt)       updates.due_at      = dueAt;

    const updated = await TaskDB.update(req.params.taskId, updates);
    res.json({ task: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/tasks/:taskId (cancel) ───────────────────────────────────────
router.delete("/:taskId", async (req, res) => {
  try {
    const task = await TaskDB.findById(req.params.taskId);
    if (!task || task.creator_id !== req.user.id) return res.status(404).json({ error: "Task not found" });
    if (task.status === "running") return res.status(400).json({ error: "Cannot cancel a running task" });

    await cancelTask(task.bull_job_id);
    await TaskDB.cancel(req.params.taskId);
    res.json({ success: true });
  } catch (err) {
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

    const result = await createPresignedUpload(fileName, fileType, req.user.id);
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
    res.json({ task: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
