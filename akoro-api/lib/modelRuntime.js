/**
 * lib/modelRuntime.js — the persisted admin override for the global default
 * model (and its global fallback). One row in edu.ai_runtime_settings, read
 * once at boot, cached in memory and updated by the admin API.
 *
 * Another stream owns resolution precedence; this module only stores the
 * override. Callers read runtimeDefaultModel()/runtimeFallbackModel() after
 * awaiting loadRuntimeSettings() once at boot.
 */
const EMPTY = Object.freeze({
  defaultModel: null,
  fallbackModel: null,
  roleModels: Object.freeze({}),
  featureModels: Object.freeze({}),
  updatedBy: null,
  updatedAt: null,
});
const cleanMap = (value) => (value && typeof value === "object" && !Array.isArray(value))
  ? Object.fromEntries(Object.entries(value).map(([k, v]) => [String(k), text(v)]).filter(([, v]) => v))
  : {};

let cache = EMPTY;
let loaded = false;
let loadedAt = 0;
let inflight = null;
// Other instances may switch the default; re-read at most every 30 seconds so
// a runtime change propagates without a restart (and without a read per call).
const TTL_MS = 30_000;

const text = (value) => (value == null ? null : String(value));

function shape(row) {
  if (!row) return { ...EMPTY };
  return {
    defaultModel: text(row.default_model),
    fallbackModel: text(row.fallback_model),
    roleModels: cleanMap(row.role_models),
    featureModels: cleanMap(row.feature_models),
    updatedBy: text(row.updated_by),
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
  };
}

async function getDb() {
  const { default: db } = await import("../db.js");
  return db;
}

export async function loadRuntimeSettings({ force = false } = {}) {
  if (loaded && !force && Date.now() - loadedAt < TTL_MS) return { ...cache };
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const db = await getDb();
      const { data, error } = await db.schema("edu").from("ai_runtime_settings")
        .select("*").eq("id", 1).maybeSingle();
      if (error) {
        console.error("[ai-runtime] could not load settings:", error.message);
        cache = { ...EMPTY };
      } else {
        cache = shape(data);
      }
    } catch (e) {
      console.error("[ai-runtime] could not load settings:", e?.message || e);
      cache = { ...EMPTY };
    } finally {
      loaded = true;
      loadedAt = Date.now();
      inflight = null;
    }
    return { ...cache };
  })();
  return inflight;
}

function refreshIfStale() {
  if (loaded && Date.now() - loadedAt >= TTL_MS && !inflight) void loadRuntimeSettings().catch(() => {});
}

export function runtimeSettings() {
  refreshIfStale();
  return { ...cache };
}

export function runtimeDefaultModel() {
  refreshIfStale();
  return cache.defaultModel;
}

export function runtimeFallbackModel() {
  refreshIfStale();
  return cache.fallbackModel;
}

export function runtimeRoleModel(role) {
  refreshIfStale();
  return cache.roleModels?.[String(role)] || null;
}

export function runtimeFeatureModel(key) {
  refreshIfStale();
  return cache.featureModels?.[String(key)] || null;
}

export function runtimeRoleModels() { refreshIfStale(); return { ...(cache.roleModels || {}) }; }
export function runtimeFeatureModels() { refreshIfStale(); return { ...(cache.featureModels || {}) }; }

export async function setRuntimeSettings({ defaultModel, fallbackModel, roleModels, featureModels } = {}, { by = null } = {}) {
  const db = await getDb();
  // undefined keeps a value (patch semantics); null/"" clears it.
  const current = cache;
  const row = {
    id: 1,
    default_model: defaultModel === undefined ? current.defaultModel : text(defaultModel),
    fallback_model: fallbackModel === undefined ? current.fallbackModel : text(fallbackModel),
    role_models: roleModels === undefined ? (current.roleModels || {}) : cleanMap(roleModels),
    feature_models: featureModels === undefined ? (current.featureModels || {}) : cleanMap(featureModels),
    updated_by: text(by),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db.schema("edu").from("ai_runtime_settings")
    .upsert(row, { onConflict: "id" }).select("*").single();
  if (error) throw new Error(`Could not save the runtime model settings: ${error.message}`);
  cache = shape(data || row);
  loaded = true;
  loadedAt = Date.now();
  return { ...cache };
}

export async function clearRuntimeSettings({ by = null } = {}) {
  const db = await getDb();
  const { error } = await db.schema("edu").from("ai_runtime_settings").delete().eq("id", 1);
  if (error) throw new Error(`Could not clear the runtime model settings: ${error.message}`);
  cache = { ...EMPTY };
  loaded = true;
  loadedAt = Date.now();
  return { ...cache };
}

/**
 * Pure validation for a proposed change. `getEntry(id)` returns a catalogue
 * entry (or null); `isAvailable(entry)` returns a boolean or availabilityOf's
 * { available, reason }.
 */
export function validateModelChange({ defaultModel, fallbackModel, roleModels, featureModels } = {},
  { getEntry, isAvailable, roles = null, features = null } = {}) {
  const defaultId = String(defaultModel ?? "").trim();
  const hasRoleMap = roleModels && typeof roleModels === "object" && Object.keys(roleModels).length;
  const hasFeatureMap = featureModels && typeof featureModels === "object" && Object.keys(featureModels).length;
  if (!defaultId && !hasRoleMap && !hasFeatureMap) {
    return {
      ok: false, code: "default_model_required", field: "defaultModel",
      message: "Choose a default model.",
    };
  }

  const check = (id, field) => {
    const entry = getEntry(id);
    if (!entry) {
      return { ok: false, code: "unknown_model", field, message: `"${id}" is not a known model.` };
    }
    const label = entry.label || entry.id || id;
    if (!entry.enabled) {
      return { ok: false, code: "model_disabled", field, message: `"${label}" is turned off on this server.` };
    }
    const availability = isAvailable(entry);
    const available = typeof availability === "boolean" ? availability : !!availability?.available;
    if (!available) {
      const reason = typeof availability === "object" ? availability?.reason : null;
      return {
        ok: false, code: "model_unavailable", field,
        message: `"${label}" is not available on this server${reason ? ` — ${reason}` : "."}`,
      };
    }
    return null;
  };

  const defaultProblem = defaultId ? check(defaultId, "defaultModel") : null;
  if (defaultProblem) return defaultProblem;

  const fallbackId = String(fallbackModel ?? "").trim();
  if (fallbackId) {
    if (fallbackId === defaultId) {
      return {
        ok: false, code: "fallback_equals_default", field: "fallbackModel",
        message: "The fallback must be a different model from the default.",
      };
    }
    const fallbackProblem = check(fallbackId, "fallbackModel");
    if (fallbackProblem) return fallbackProblem;
  }

  const rolesOut = {};
  for (const [role, idRaw] of Object.entries(cleanMap(roleModels))) {
    if (roles && !roles[role]) {
      return { ok: false, code: "unknown_role", field: "roleModels", message: `"${role}" is not a known role.` };
    }
    const problem = check(idRaw, "roleModels");
    if (problem) return problem;
    const entry = getEntry(idRaw);
    const caps = roles?.[role]?.caps || [];
    const missing = caps.filter((c) => !entry.caps?.[c]);
    if (missing.length) {
      return { ok: false, code: "role_capability", field: "roleModels",
        message: `"${entry.label || entry.id}" can't serve the ${role} role (needs: ${missing.join(", ")}).` };
    }
    rolesOut[role] = idRaw;
  }
  const featuresOut = {};
  for (const [key, idRaw] of Object.entries(cleanMap(featureModels))) {
    if (features && !features[key]) {
      return { ok: false, code: "unknown_feature", field: "featureModels", message: `"${key}" is not a known feature.` };
    }
    const problem = check(idRaw, "featureModels");
    if (problem) return problem;
    const entry = getEntry(idRaw);
    const needs = features?.[key]?.requires || [];
    const missing = needs.filter((c) => !entry.caps?.[c]);
    if (missing.length) {
      return { ok: false, code: "feature_capability", field: "featureModels",
        message: `"${entry.label || entry.id}" can't serve ${key} (needs: ${missing.join(", ")}).` };
    }
    featuresOut[key] = idRaw;
  }

  const values = {};
  // Sending defaultModel keeps the original contract (fallback defaults to
  // null). A role/feature-only patch leaves the default and fallback alone.
  if (defaultModel !== undefined) values.defaultModel = defaultId || null;
  if (defaultModel !== undefined || fallbackModel !== undefined) values.fallbackModel = fallbackId || null;
  if (roleModels !== undefined) values.roleModels = rolesOut;
  if (featureModels !== undefined) values.featureModels = featuresOut;
  return { ok: true, values };
}
