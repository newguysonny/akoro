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
 */
import { availabilityOf, createModelRegistry, PROVIDERS } from "./modelRegistry.js";

/** Providers this server can call (lib/aiModel.js adapters). */
export const SUPPORTED_PROVIDERS = PROVIDERS;

const registryFor = (env) => createModelRegistry(env);

/** The pickable catalogue, in the plan's order (AI_MODELS additions after). */
export function modelCatalogue(env = process.env) {
  const registry = registryFor(env);
  return registry.catalogue.filter((m) => m.selectable).map((m) => ({ ...m, default: m.id === registry.defaultId }));
}

/** Can this server use the model right now? → { available, reason } */
export function modelAvailability(m, env = process.env) {
  return availabilityOf({ enabled: m.enabled !== false, caps: {}, ...m, price: m.price === undefined ? { in: 0, out: 0 } : m.price }, env);
}

/** What the picker gets: no keys, no provider internals beyond the name. */
export function publicModelList(env = process.env) {
  return modelCatalogue(env).map((m) => {
    const { available, reason } = availabilityOf(m, env);
    return { id: m.id, label: m.label, provider: m.provider, description: m.description || "", default: !!m.default, available, note: reason };
  });
}

/** A learner's pick → the API model to call, or null (keep the default). */
export function resolveChatModel(id, env = process.env) {
  if (typeof id !== "string" || !id) return null;
  const m = registryFor(env).get(id);
  if (!m || !m.selectable || !availabilityOf(m, env).available) return null;
  return m.apiModel;
}
