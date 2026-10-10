/**
 * lib/modelCatalogue.js — the models a learner can pick in the Agent Chat
 * (Grand Plan §7.11.1, D23). Env-driven: AI_MODELS (JSON array) adds or
 * overrides entries by id; API keys stay in env per provider.
 *
 * A model is AVAILABLE only when both hold:
 *   • its provider is configured here (the provider's key is set, and for
 *     Grok / DeepSeek the model id too — those change, so env names them), and
 *   • this server can call that provider. Only OpenAI is wired today;
 *     Anthropic / xAI / DeepSeek adapters land with §7.11.4.
 * Anything else is listed as "coming soon", so the picker never offers a
 * model the chat would silently not use.
 *
 * The browser sends a catalogue id; resolveChatModel() maps it to the API
 * model — or null, and the chat keeps its default.
 */

/** Providers this server can actually call. */
export const SUPPORTED_PROVIDERS = Object.freeze(["openai"]);

const PROVIDER_KEYS = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", xai: "XAI_API_KEY", deepseek: "DEEPSEEK_API_KEY" };

/** The plan's catalogue (prices are USD / 1M tokens, re-checked when a model is added). */
const BASE = [
  { id: "gpt-4o-mini",  provider: "openai",    apiModel: "gpt-4o-mini",      label: "GPT-4o mini",   description: "Akoro Standard — quick, grounded answers.", default: true },
  { id: "gpt-4.1",      provider: "openai",    apiModel: "gpt-4.1",          label: "GPT-4.1",       description: "Stronger writing and reasoning at a higher price." },
  { id: "claude-haiku", provider: "anthropic", apiModel: "claude-haiku-5-5", label: "Claude Haiku",  description: "Fast and inexpensive Claude." },
  { id: "claude-sonnet",provider: "anthropic", apiModel: "claude-sonnet-5-5",label: "Claude Sonnet", description: "Balanced Claude for most study work." },
  { id: "claude-opus",  provider: "anthropic", apiModel: "claude-opus-5-5",  label: "Claude Opus",   description: "Claude's strongest everyday model." },
  { id: "claude-fable", provider: "anthropic", apiModel: "claude-fable-5-1", label: "Claude Fable",  description: "Most capable; slower on hard turns." },
  { id: "grok",         provider: "xai",       apiModel: null, envModel: "XAI_MODEL",      label: "Grok",     description: "xAI's model." },
  { id: "deepseek",     provider: "deepseek",  apiModel: null, envModel: "DEEPSEEK_MODEL", label: "DeepSeek", description: "DeepSeek's model." },
];

function parseEnvModels(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((m) => m && typeof m.id === "string") : [];
  } catch {
    console.warn("[models] AI_MODELS is not valid JSON — using the built-in catalogue");
    return [];
  }
}

/** The catalogue: built-ins with AI_MODELS merged over them by id. */
export function modelCatalogue(env = process.env) {
  const byId = new Map(BASE.map((m) => [m.id, { ...m }]));
  for (const m of parseEnvModels(env.AI_MODELS)) byId.set(m.id, { ...(byId.get(m.id) || {}), ...m });
  return [...byId.values()].filter((m) => m.selectable !== false);
}

/** Can this server use the model right now? → { available, reason } */
export function modelAvailability(m, env = process.env) {
  if (m.enabled === false) return { available: false, reason: "Turned off on this server." };
  const apiModel = m.apiModel || (m.envModel ? env[m.envModel] : null);
  if (!SUPPORTED_PROVIDERS.includes(m.provider)) return { available: false, reason: "Coming soon." };
  if (!env[PROVIDER_KEYS[m.provider]]) return { available: false, reason: "Coming soon — not set up on this server yet." };
  if (!apiModel) return { available: false, reason: "Coming soon — not set up on this server yet." };
  return { available: true, reason: null };
}

/** What the picker gets: no keys, no provider internals beyond the name. */
export function publicModelList(env = process.env) {
  return modelCatalogue(env).map((m) => {
    const { available, reason } = modelAvailability(m, env);
    return { id: m.id, label: m.label, provider: m.provider, description: m.description || "", default: !!m.default, available, note: reason };
  });
}

/** A learner's pick → the API model to call, or null (keep the default). */
export function resolveChatModel(id, env = process.env) {
  if (typeof id !== "string" || !id) return null;
  const m = modelCatalogue(env).find((x) => x.id === id);
  if (!m || !modelAvailability(m, env).available) return null;
  return m.apiModel || env[m.envModel] || null;
}
