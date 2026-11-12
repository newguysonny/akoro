/**
 * lib/modelCatalogue.js — the models a learner can pick in the Agent Chat's
 * model switch (Grand Plan §7.11.1, D23): a view over the one catalogue,
 * lib/modelRegistry.js (the plan's models, AI_MODELS merged over them by id).
 *
 * A model is AVAILABLE only when this server can call it: switched on, its
 * provider's key set (Grok / DeepSeek also need their model id from env, as
 * those change), and priced. Anything else is listed as "coming soon", so the
 * picker never offers a model the chat would silently not use.
 *
 * The browser sends a catalogue id; resolveChatModel() maps it to the API
 * model — or null, and the chat keeps its default. meteredCreate then sends
 * the call to that model's provider (OpenAI, Claude, or an OpenAI-compatible one).
 *
 * The §7.11.5 picker (Phase 11) is behind AI_MODEL_PICKER_ENABLED. With it on,
 * a pick goes through the registry's full resolution (§7.11.3: enabled,
 * selectable, set up here, in the payer's allowed list, the chat role's caps)
 * and an invalid pick comes back with the notice the learner sees; each model
 * carries a cost hint against the default. With it off, today's switch is
 * unchanged. Grading never follows a pick: the assessor and evidence roles
 * are locked in the registry, and only the chat's standard mode reads it.
 */
import { availabilityOf, createModelRegistry, PROVIDERS, pickerFlag } from "./modelRegistry.js";
import { runtimeDefaultModel } from "./modelRuntime.js";

/** Providers this server can call (lib/aiModel.js adapters). */
export const SUPPORTED_PROVIDERS = PROVIDERS;

const registryFor = (env) => createModelRegistry(env);

/** The public fields of a catalogue entry — never provider/apiModel/baseURL/apiKeyEnv. */
export function publicModel(entry) {
  return {
    id: entry.id,
    label: entry.label ?? entry.id,
    description: entry.description ?? null,
    price: entry.price ?? null,
    caps: entry.caps ?? null,
    selectable: !!entry.selectable,
    enabled: entry.enabled !== false,
    tier: entry.tier ?? null,
  };
}

/** The pickable catalogue, in the plan's order (AI_MODELS additions after). */
export function modelCatalogue(env = process.env) {
  const registry = registryFor(env);
  return registry.catalogue.filter((m) => m.selectable).map((m) => ({ ...publicModel(m), default: m.id === registry.defaultId }));
}

/** Can this server use the model right now? → { available, reason } */
export function modelAvailability(m, env = process.env) {
  return availabilityOf({ enabled: m.enabled !== false, caps: {}, ...m, price: m.price === undefined ? { in: 0, out: 0 } : m.price }, env);
}

/** Is the §7.11.5 picker switched on here? */
export const pickerEnabled = (env = process.env) => pickerFlag(env);   // on by default (2026-11-07)

// A typical chat message reads about three tokens for each one it writes.
const blended = (price) => (price ? 3 * Number(price.in) + Number(price.out) : null);

/** { multiple, hint } against the default model: "≈ 30× coins per message"; hint null for the default or unpriced. */
export function costHint(entry, defaultEntry) {
  if (entry?.id && entry.id === defaultEntry?.id) return { multiple: 1, hint: null };
  const a = blended(entry?.price); const b = blended(defaultEntry?.price);
  if (!a || !b) return { multiple: null, hint: null };
  const multiple = a / b;
  const shown = multiple >= 10 ? Math.round(multiple) : Math.round(multiple * 10) / 10;
  return { multiple: Math.round(multiple * 100) / 100, hint: multiple < 0.95 ? "Fewer coins per message" : multiple < 1.05 ? "About the same coins" : `≈ ${shown}× coins per message` };
}

/**
 * What the picker gets: public fields only — no provider, API model, keys or base URLs.
 * allowedModels: the payer's tier list (§7.11.5a), when known — a model
 * outside it is listed as locked to a plan, not offered.
 */
export function publicModelList(env = process.env, { allowedModels = null } = {}) {
  const registry = registryFor(env);
  const def = registry.get(registry.defaultId);
  return registry.catalogue.filter((m) => m.selectable).map((m) => {
    const { available, reason } = availabilityOf(m, env);
    const inPlan = !Array.isArray(allowedModels) || m.id === registry.defaultId || allowedModels.includes(m.id);
    const { multiple, hint } = costHint(m, def);
    return {
      id: m.id, label: m.label, description: m.description || "", default: m.id === registry.defaultId,
      available: available && inPlan, note: reason || (inPlan ? null : "Not in your plan."),
      ...(inPlan ? {} : { locked: "plan" }), costMultiple: multiple, costHint: hint,
      // Which chat modes THIS model can actually run. Thinking needs real
      // reasoning (or a Responses surface); Research needs tool calling.
      modes: { default: true, think: !!(m.caps?.reasoning || m.caps?.responses), research: !!m.caps?.tools, thinkExposed: !!m.caps?.reasoningExposed },
    };
  });
}

/** The /models answer's picker block: whether the picker is on here, and the default. */
export function pickerInfo(env = process.env) {
  return { enabled: pickerEnabled(env), defaultId: registryFor(env).defaultId };
}

/**
 * A learner's pick for the chat → { apiModel, notice }; apiModel null keeps
 * the default. Picker on: the registry's resolution for the "chat" role, with
 * the notice when the pick can't be used. Picker off: today's switch.
 */
export function resolveChatChoice(id, env = process.env, { allowedModels = null } = {}) {
  if (typeof id !== "string" || !id) return { apiModel: null, notice: null };
  const registry = registryFor(env);
  if (pickerEnabled(env)) {
    const r = registry.resolve({ role: "chat", learnerChoice: id, allowedModels });
    return r.source === "learner" ? { apiModel: r.model.apiModel, notice: null } : { apiModel: null, notice: r.notice || null };
  }
  const m = registry.get(id);
  if (!m || !m.selectable || !availabilityOf(m, env).available) return { apiModel: null, notice: null };
  return { apiModel: m.apiModel, notice: null };
}

/** A learner's pick → the API model to call, or null (keep the default). */
export function resolveChatModel(id, env = process.env, opts = {}) {
  return resolveChatChoice(id, env, opts).apiModel;
}
