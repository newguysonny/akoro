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
  updatedBy: null,
  updatedAt: null,
});

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

export async function setRuntimeSettings({ defaultModel, fallbackModel } = {}, { by = null } = {}) {
  const db = await getDb();
  const row = {
    id: 1,
    default_model: text(defaultModel),
    fallback_model: text(fallbackModel),
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
export function validateModelChange({ defaultModel, fallbackModel } = {}, { getEntry, isAvailable } = {}) {
  const defaultId = String(defaultModel ?? "").trim();
  if (!defaultId) {
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

  const defaultProblem = check(defaultId, "defaultModel");
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

  return { ok: true, values: { defaultModel: defaultId, fallbackModel: fallbackId || null } };
}
