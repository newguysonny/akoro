/**
 * lib/modelRegistry.js — which model a call runs on (Grand Plan §7.11, D23).
 *
 *   resolveModel({ role, learnerChoice, allowedModels }) → catalogue entry
 *   { id, provider, apiModel, label, price, caps, selectable, enabled, fallbackModel }
 *
 * The catalogue: the plan's models (§7.11.1 — GPT-4o mini, GPT-4.1, Claude
 * Haiku/Sonnet/Opus/Fable, Grok, DeepSeek), then every other model the price
 * table knows (not pickable). AI_MODELS (JSON array) merges over it by id —
 * a partial entry ({ "id": "gpt-4.1", "enabled": false }) changes just that.
 * An AI_MODELS model that is switched on and has no price fails boot, so a
 * learner on an expensive model is never billed at the gpt-4o-mini fallback.
 * Grok and DeepSeek ids and prices change: they come from env (XAI_MODEL /
 * DEEPSEEK_MODEL and an AI_MODELS price) and are unavailable until set.
 *
 * The Agent Chat's model switch lists the pickable models and says which can
 * be used here (lib/modelCatalogue.js reads this registry).
 *
 * Resolution (§7.11.3), first that applies:
 *   1. the role is locked (assessor and evidence always; AI_MODEL_LOCKED_ROLES
 *      adds more) → the role's env model, else the default
 *   2. the learner's choice — only with AI_MODEL_PICKER_ENABLED, a model that
 *      is enabled and selectable, in the payer's allowed list, and has the
 *      role's required capabilities
 *   3. the role's env default (AI_MODEL_ROLE_<ROLE>)
 *   4. AI_MODEL_DEFAULT (legacy OPENAI_MODEL honoured), else gpt-4o-mini
 *
 * API keys stay per provider in env (OPENAI_API_KEY, ANTHROPIC_API_KEY,
 * XAI_API_KEY, DEEPSEEK_API_KEY …), never in the catalogue.
 *
 * Example AI_MODELS entry:
 *   { "id": "claude-sonnet", "provider": "anthropic", "apiModel": "claude-sonnet-5-5",
 *     "label": "Claude Sonnet", "price": { "in": 2, "out": 10, "cachedIn": 0.2 },
 *     "caps": { "tools": true, "stream": true, "json": true }, "selectable": true }
 */
import { DEFAULT_MODEL_PRICES, registerModelPrice } from "./aiPricing.js";

export const PROVIDERS = Object.freeze(["openai", "openai_compatible", "anthropic"]);

/** Older AI_MODELS spelling: Grok / DeepSeek as their own providers → openai_compatible. */
const COMPAT = Object.freeze({
  xai: { baseURL: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY", apiModelEnv: "XAI_MODEL" },
  deepseek: { baseURL: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY", apiModelEnv: "DEEPSEEK_MODEL" },
});

/** Where each provider's key lives (never in the catalogue). */
const KEY_ENV = { openai: ["OPENAI_API_KEY"], anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] };

const ALL = { tools: true, stream: true, json: true };
/** The plan's catalogue (§7.11.1). Prices are USD / 1M tokens, Anthropic first-party rates as of 2026-10-06 — re-check when a model is added. */
const PLAN_MODELS = [
  { id: "gpt-4o-mini", provider: "openai", apiModel: "gpt-4o-mini", label: "GPT-4o mini", description: "Akoro Standard — quick, grounded answers.", price: { in: 0.15, out: 0.60 } },
  { id: "gpt-4.1", provider: "openai", apiModel: "gpt-4.1", label: "GPT-4.1", description: "Stronger writing and reasoning at a higher price.", price: { in: 2.00, out: 8.00 } },
  { id: "claude-haiku", provider: "anthropic", apiModel: "claude-haiku-5-5", label: "Claude Haiku", description: "Fast and inexpensive Claude.", price: { in: 0.10, out: 0.50 } },
  { id: "claude-sonnet", provider: "anthropic", apiModel: "claude-sonnet-5-5", label: "Claude Sonnet", description: "Balanced Claude for most study work.", price: { in: 2.00, out: 10.00, cachedIn: 0.20 } },
  { id: "claude-opus", provider: "anthropic", apiModel: "claude-opus-5-5", label: "Claude Opus", description: "Claude's strongest everyday model.", price: { in: 4.00, out: 20.00, cachedIn: 0.20 } },
  { id: "claude-fable", provider: "anthropic", apiModel: "claude-fable-5-1", label: "Claude Fable", description: "Most capable; slower on hard turns.", price: { in: 10.00, out: 50.00, cachedIn: 0.25 } },
  { id: "grok", provider: "xai", apiModel: null, label: "Grok", description: "xAI's model.", price: null },
  { id: "deepseek", provider: "deepseek", apiModel: null, label: "DeepSeek", description: "DeepSeek's model.", price: null },
].map((m) => ({ ...m, caps: ALL, selectable: true }));

/** Every role a call can name, and what its model must be able to do. */
export const ROLES = Object.freeze({
  chat: { caps: ["stream"] },
  controller: { caps: ["tools"] },          // workflow agent loops: tool calling required
  persona: { caps: [] },                    // protégé, NaNa
  assessor: { caps: [], locked: true },     // Sargeant: grading stays consistent across learners
  evidence: { caps: [], locked: true },     // evidence analysis
  background: { caps: [] },                 // schedulers, prewarm, tasks — no learner chose them
});

const EMBEDDING = /embedding/;

/** Every other model the price table knows (embeddings aside): callable by name, not pickable. */
function priceTableModels() {
  return Object.entries(DEFAULT_MODEL_PRICES).filter(([id]) => !EMBEDDING.test(id)).map(([id, price]) => ({
    id, provider: "openai", apiModel: id, label: id, price, caps: ALL, selectable: false,
  }));
}

/**
 * Normalise and check one entry. `strict` (an AI_MODELS entry): one that is
 * on and callable (it has an API model) must have a price — boot fails
 * without one. A model without a price is never callable: listed, unavailable.
 */
export function checkEntry(raw, { env = {}, strict = true } = {}) {
  const where = `AI_MODELS entry ${JSON.stringify(raw?.id ?? raw)}`;
  if (!raw || typeof raw !== "object" || !raw.id) throw new Error(`${where}: an id is required`);
  const compat = COMPAT[raw.provider];
  const provider = compat ? "openai_compatible" : raw.provider;
  if (!PROVIDERS.includes(provider)) throw new Error(`${where}: provider must be one of ${PROVIDERS.join(", ")}`);
  const enabled = raw.enabled !== false;
  const baseURL = raw.baseURL || compat?.baseURL || null;
  if (provider === "openai_compatible" && !baseURL) throw new Error(`${where}: an openai_compatible provider needs a baseURL`);
  const apiModelEnv = raw.apiModelEnv || raw.envModel || compat?.apiModelEnv || null;
  const apiModel = raw.apiModel ? String(raw.apiModel) : (apiModelEnv && env[apiModelEnv]) || (compat || apiModelEnv ? null : String(raw.id));
  const price = raw.price || null;
  const priced = !!price && Number(price.in) >= 0 && Number(price.out) >= 0 && price.in != null && price.out != null;
  if (!priced && strict && enabled && apiModel) {
    throw new Error(`${where}: a price { in, out } in USD per 1M tokens is required — a model without a price can't be billed correctly`);
  }
  return Object.freeze({
    id: String(raw.id), provider, apiModel,
    label: String(raw.label || raw.id), description: raw.description || null,
    price: priced ? Object.freeze({ in: Number(price.in), out: Number(price.out), ...(price.cachedIn != null ? { cachedIn: Number(price.cachedIn) } : {}) }) : null,
    caps: Object.freeze({ tools: !!raw.caps?.tools, stream: !!raw.caps?.stream, json: !!raw.caps?.json }),
    selectable: !!raw.selectable, enabled, tier: raw.tier || null,
    fallbackModel: raw.fallbackModel || null,
    baseURL, apiKeyEnv: raw.apiKeyEnv || compat?.apiKeyEnv || null,
    effort: raw.effort || null,
  });
}

/** Can this server call the model right now? → { available, reason } */
export function availabilityOf(entry, env = process.env) {
  if (!entry.enabled) return { available: false, reason: "Turned off on this server." };
  const keys = entry.provider === "openai_compatible" ? [entry.apiKeyEnv] : KEY_ENV[entry.provider] || [];
  if (!keys.some((k) => k && env[k]) || !entry.apiModel || !entry.price) return { available: false, reason: "Coming soon — not set up on this server yet." };
  return { available: true, reason: null };
}

/**
 * Build a registry from an env-like object (tests pass their own). → { catalogue,
 * get(id), resolveModel({ role, learnerChoice, allowedModels }), defaultId }
 */
export function createModelRegistry(env = process.env) {
  // Built-ins first (plan models, then the price table), AI_MODELS merged over them by id.
  const merged = new Map();
  for (const m of [...PLAN_MODELS, ...priceTableModels()]) if (!merged.has(m.id)) merged.set(m.id, { ...m, builtIn: true });
  if (env.AI_MODELS) {
    let parsed;
    try { parsed = JSON.parse(env.AI_MODELS); } catch (e) { throw new Error(`AI_MODELS is not valid JSON: ${e.message}`); }
    if (!Array.isArray(parsed)) throw new Error("AI_MODELS must be a JSON array");
    for (const raw of parsed) {
      if (!raw || typeof raw.id !== "string") throw new Error(`AI_MODELS entry ${JSON.stringify(raw)}: an id is required`);
      const base = merged.get(raw.id);
      merged.set(raw.id, { ...(base || {}), ...raw, caps: raw.caps || base?.caps || ALL, builtIn: false, fromEnv: true });
    }
  }
  const entries = [...merged.values()].map((m) => checkEntry(m, { env, strict: !!m.fromEnv }));
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const e of entries) if (e.price) registerModelPrice([e.id, e.apiModel], e.price);

  const defaultId = env.AI_MODEL_DEFAULT || env.OPENAI_MODEL || "gpt-4o-mini";
  if (!byId.has(defaultId)) {
    // A legacy OPENAI_MODEL the table doesn't price (e.g. a new OpenAI model): run it, billed at the default.
    const legacy = checkEntry({ id: defaultId, provider: "openai", apiModel: defaultId, price: DEFAULT_MODEL_PRICES["gpt-4o-mini"], caps: { tools: true, stream: true, json: true } });
    byId.set(defaultId, legacy);
    entries.push(legacy);
  }
  const locked = new Set([
    ...Object.entries(ROLES).filter(([, r]) => r.locked).map(([name]) => name),
    ...String(env.AI_MODEL_LOCKED_ROLES || "").split(",").map((s) => s.trim()).filter(Boolean),
  ]);
  const pickerOn = String(env.AI_MODEL_PICKER_ENABLED || "false").toLowerCase() === "true";
  const roleEnv = (role) => env[`AI_MODEL_ROLE_${String(role).toUpperCase()}`] || null;
  const hasCaps = (entry, role) => (ROLES[role]?.caps || []).every((c) => entry.caps[c]);

  /** → { model: entry, source: "locked"|"learner"|"role"|"default", notice? } */
  function resolve({ role = "chat", learnerChoice = null, allowedModels = null } = {}) {
    if (!ROLES[role]) throw new Error(`Unknown model role "${role}"`);
    const usable = (id) => { const e = id && byId.get(id); return e && e.enabled && hasCaps(e, role) ? e : null; };
    const roleModel = usable(roleEnv(role));
    if (locked.has(role)) return { model: roleModel || byId.get(defaultId), source: "locked" };
    let notice = null;
    if (learnerChoice) {
      const e = byId.get(learnerChoice);
      const why = !pickerOn ? "model choice is off"
        : !e ? "that model isn't offered"
          : !e.enabled ? "that model is switched off"
            : !e.selectable ? "that model can't be chosen"
              : !availabilityOf(e, env).available ? "that model isn't set up here yet"
              : Array.isArray(allowedModels) && !allowedModels.includes(e.id) ? "that model isn't in your plan"
                : !hasCaps(e, role) ? "that model can't do this step"
                  : null;
      if (!why) return { model: e, source: "learner" };
      notice = `Using ${(roleModel || byId.get(defaultId)).label}: ${why}.`;
    }
    if (roleModel) return { model: roleModel, source: "role", ...(notice ? { notice } : {}) };
    return { model: byId.get(defaultId), source: "default", ...(notice ? { notice } : {}) };
  }

  return {
    catalogue: entries,
    defaultId,
    get: (id) => byId.get(id) || null,
    resolveModel: (opts) => resolve(opts).model,
    resolve,
    /** The models a learner may pick (picker API, §7.11.5). */
    /** What the picker may offer as usable here: pickable, set up on this server, in the plan's list. */
    selectable: (allowedModels = null) => entries.filter((e) => e.selectable && availabilityOf(e, env).available && (!Array.isArray(allowedModels) || allowedModels.includes(e.id))),
  };
}

// The app's registry, built once at boot — a bad AI_MODELS fails here, loudly.
export const modelRegistry = createModelRegistry();
export const resolveModel = (opts) => modelRegistry.resolveModel(opts);
