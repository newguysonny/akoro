/**
 * modules/admin/aiModel.js — the live AI default model switch.
 *
 * Mounted at /api/admin, all routes admin-only.
 *
 *   GET    /ai/model    env default, runtime override, effective values, catalogue
 *   PUT    /ai/model    { defaultModel, fallbackModel? } — apply and persist
 *   DELETE /ai/model    clear the override, back to env defaults
 *
 * The store is lib/modelRuntime.js (edu.ai_runtime_settings); resolution
 * precedence elsewhere is unchanged. Provider names appear only here.
 */
import { Router } from "express";
import db from "../../db.js";
import { authenticateToken, requireRole } from "../auth/routes.js";
import { serverError } from "../../lib/httpError.js";
import { modelRegistry, availabilityOf, ROLES } from "../../lib/modelRegistry.js";
import { featureModels } from "../../lib/aiFeatureModels.js";
import {
  loadRuntimeSettings, runtimeSettings, runtimeDefaultModel, runtimeFallbackModel,
  setRuntimeSettings, clearRuntimeSettings, validateModelChange,
} from "../../lib/modelRuntime.js";

const router = Router();
const adminOnly = [authenticateToken, requireRole(["admin"])];
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const envFallbackModel = () => String(process.env.AI_MODEL_FALLBACK || "").trim() || null;
const actorId = (req) => req.user?.email || req.user?.id || null;
const runtimeEnabled = () => !["off", "false", "0"].includes(String(process.env.AI_RUNTIME_OVERRIDE || "on").toLowerCase());
const runtimeDisabled = (res) => res.status(403).json({
  success: false, code: "runtime_override_disabled",
  error: "The runtime model switch is off (AI_RUNTIME_OVERRIDE). Change the env or turn it on.",
  message: "The runtime model switch is off (AI_RUNTIME_OVERRIDE). Change the env or turn it on.",
});

async function writeAudit(req, action, before, after) {
  try {
    await db.from("admin_audit_log").insert({
      actor: req.user?.id ?? null,
      actor_label: req.user?.fullName || req.user?.email || "admin",
      action, entity_type: "ai_model", entity_id: "default",
      before: before ?? null, after: after ?? null,
    });
  } catch (e) {
    console.error("[admin:aiModel] audit insert failed:", e?.message || e);
  }
}

function state() {
  const runtime = runtimeSettings();
  const envDefault = modelRegistry.envDefaultId;
  const envFallback = envFallbackModel();
  return {
    env: { defaultModel: envDefault, fallbackModel: envFallback },
    runtime,
    effective: {
      defaultModel: runtime.defaultModel || envDefault,
      fallbackModel: runtime.fallbackModel || envFallback || modelRegistry.fallbackId,
    },
  };
}

router.get("/ai/model", adminOnly, asyncHandler(async (req, res) => {
  await loadRuntimeSettings();
  // The pickable models plus any hidden entry used as a failover route
  // (e.g. deepseek-direct); the 150-row price table is not an admin choice.
  const fallbackTargets = new Set(modelRegistry.catalogue.map((e) => e.fallbackModel).filter(Boolean));
  const shown = modelRegistry.catalogue.filter((e) => e.selectable || fallbackTargets.has(e.id));
  const models = shown.map((entry) => ({
    id: entry.id,
    label: entry.label,
    enabled: entry.enabled,
    selectable: entry.selectable,
    provider: entry.provider,
    fallbackModel: entry.fallbackModel,
    availability: availabilityOf(entry),
  }));
  const roles = Object.keys(ROLES).map((role) => {
    const r = modelRegistry.resolve({ role });
    return { role, model: r.model.id, label: r.model.label, source: r.source, locked: !!ROLES[role].locked };
  });
  const features = featureModels(process.env, modelRegistry.envDefaultId);
  return res.json({ success: true, ...state(), runtimeOverrideEnabled: runtimeEnabled(), models, roles, features });
}));

router.put("/ai/model", adminOnly, asyncHandler(async (req, res) => {
  if (!runtimeEnabled()) return runtimeDisabled(res);
  const result = validateModelChange(req.body ?? {}, {
    getEntry: (id) => modelRegistry.get(id),
    isAvailable: (entry) => availabilityOf(entry),
  });
  if (!result.ok) {
    return res.status(400).json({
      success: false, error: result.message, message: result.message,
      code: result.code, field: result.field,
    });
  }

  await loadRuntimeSettings();
  const before = runtimeSettings();
  const settings = await setRuntimeSettings(result.values, { by: actorId(req) });
  console.log(`[admin:aiModel] default=${settings.defaultModel} fallback=${settings.fallbackModel ?? "-"} by ${actorId(req) || "admin"}`);
  await writeAudit(req, "ai_model.override_set", before, settings);
  return res.json({ success: true, ...state() });
}));

router.delete("/ai/model", adminOnly, asyncHandler(async (req, res) => {
  if (!runtimeEnabled()) return runtimeDisabled(res);
  await loadRuntimeSettings();
  const before = runtimeSettings();
  await clearRuntimeSettings({ by: actorId(req) });
  console.log(`[admin:aiModel] override cleared by ${actorId(req) || "admin"}`);
  await writeAudit(req, "ai_model.override_cleared", before, null);
  return res.json({ success: true, ...state() });
}));

export default router;
