/**
 * modules/tasks/routes.js
 * All HTTP endpoints for the task system.
 * Converted from TypeScript to JS ESM.
 * Auth uses our JWT middleware (not separate auth).
 *
 * Route registration stays here; the handlers live in task-service.js,
 * task-admin-service.js and task-file-service.js.
 */

import { Router } from "express";
import { authenticateToken, requireRole } from "../auth/index.js";
import {
  createTask,
  listTasks,
  listSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  getTask,
  updateTask,
  deleteTask,
  triggerTask,
  listTaskRuns,
  listTaskOutputs,
  toggleTask,
  createChallenge,
} from "./task-service.js";
import {
  health,
  listAdminTools,
  createAdminTool,
  updateAdminTool,
  deleteAdminTool,
  adminPartners,
  getAdminTool,
  queueHealth,
} from "./task-admin-service.js";
import { uploadUrl, confirmFile, getFile } from "./task-file-service.js";

const router = Router();

// Public diagnostic — declared BEFORE authenticateToken so it's curl-able.
router.get("/health", health);

router.use(authenticateToken);

// ═══════════════════════════════════════════════════════════════════════════════
// FDE / admin: config-only tool management (no code deploy)
// Mounted under /api/tasks/admin/tools — admin role only.
// ═══════════════════════════════════════════════════════════════════════════════
router.get("/admin/tools", requireRole(["admin"]), listAdminTools);
router.post("/admin/tools", requireRole(["admin"]), createAdminTool);
router.patch("/admin/tools/:id", requireRole(["admin"]), updateAdminTool);
router.delete("/admin/tools/:id", requireRole(["admin"]), deleteAdminTool);
router.get("/admin/partners", requireRole(["admin"]), adminPartners);
router.get("/admin/tools/:id", requireRole(["admin"]), getAdminTool);

// ─── Tasks ───────────────────────────────────────────────────────────────────
router.post("/", createTask);
router.get("/", listTasks);

// ═══ Agent suggestions ════════════════════════════════════════════════════════
// Proactive ideas the agent files for the learner (the chat tool
// `suggest_help`). They are advice only: nothing executes and no task exists
// until the learner accepts one — accept creates the real task, dismiss
// closes the idea. Declared before /:taskId so "suggestions" is never read
// as a task id.
router.get("/suggestions", listSuggestions);
router.post("/suggestions/:id/accept", acceptSuggestion);
router.patch("/suggestions/:id/dismiss", dismissSuggestion);

router.get("/:taskId", getTask);
router.patch("/:taskId", updateTask);
router.delete("/:taskId", deleteTask);
router.post("/:taskId/trigger", triggerTask);
router.get("/:taskId/runs", listTaskRuns);
router.get("/:taskId/outputs", listTaskOutputs);

router.post("/upload-url", uploadUrl);
router.post("/files/confirm", confirmFile);
router.get("/files/:id", getFile);

router.get("/queue/health", requireRole(["admin"]), queueHealth);

router.patch("/:taskId/toggle", toggleTask);
router.post("/:taskId/create-challenge", createChallenge);

export default router;
