import db from "../../db.js";
import { DynamicToolDB } from "./lib/db.js";
import { taskQueue, getQueueHealth } from "./scheduler.js";
import { ALL_TOOLS } from "./tools/index.js";
import { OPENAI_MODEL } from "../../lib/aiModel.js";
import { VALID_EXECUTORS, VALID_SCOPES } from "./task-rules.js";
import { partners, dynamicToolById } from "./task-store.js";

// ─── GET /api/tasks/health — public diagnostic (no auth) ─────────────────────
// A one-curl snapshot of whether the task system can actually run tasks:
// worker/Redis connectivity, model config, tool registry, and recent
// completion coverage (are created tasks producing outputs?). Mirrors the
// battle /health endpoint. Declared BEFORE authenticateToken so it's curl-able.
export async function health(_req, res) {
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
}

// GET /api/tasks/admin/tools — list (optional ?scope= &ownerUserId= &schoolId=)
export async function listAdminTools(req, res) {
  try {
    const { scope, ownerUserId, schoolId } = req.query;
    const tools = await DynamicToolDB.list({ scope, ownerUserId, schoolId });
    res.json({ tools, count: tools.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// POST /api/tasks/admin/tools — create a config-only tool
export async function createAdminTool(req, res) {
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
}

// PATCH /api/tasks/admin/tools/:id — update / enable / disable
export async function updateAdminTool(req, res) {
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
}

// DELETE /api/tasks/admin/tools/:id
export async function deleteAdminTool(req, res) {
  try {
    await DynamicToolDB.remove(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/tasks/admin/partners — list schools + teachers for scoping UI
export async function adminPartners(_req, res) {
  try {
    const { schools, teachers } = await partners();
    res.json({ schools: schools ?? [], teachers: teachers ?? [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// GET /api/tasks/admin/tools/:id — fetch single tool
export async function getAdminTool(req, res) {
  try {
    const { data, error } = await dynamicToolById(req.params.id);
    if (error || !data) return res.status(404).json({ error: "not found" });
    res.json({ tool: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── GET /api/tasks/queue/health  (admin) ────────────────────────────────────
export async function queueHealth(_req, res) {
  try {
    const health = await getQueueHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
