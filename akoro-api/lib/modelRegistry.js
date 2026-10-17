/**
 * lib/modelRegistry.js — which model a call runs on (Grand Plan §7.11, D23).
 *
 *   resolveModel({ role, learnerChoice, allowedModels }) → catalogue entry
 *   { id, provider, apiModel, label, price, caps, selectable, enabled, fallbackModel }
 *
 * The catalogue comes from AI_MODELS (JSON array) — unset, it is today's
 * built-in price table (lib/aiPricing.js), all OpenAI, so nothing changes.
 * Every entry needs a price: a model without one fails boot, so a learner on
 * an expensive model can never be billed at the gpt-4o-mini fallback.
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

function defaultCatalogue() {
  return Object.entries(DEFAULT_MODEL_PRICES).filter(([id]) => !EMBEDDING.test(id)).map(([id, price]) => ({
    id, provider: "openai", apiModel: id, label: id === "gpt-4o-mini" ? "Akoro Standard" : id,
    price, caps: { tools: true, stream: true, json: true }, selectable: false, enabled: true,
  }));
}

/** Check one entry; throws with the reason (boot fails on a bad catalogue). */
export function checkEntry(raw) {
  const where = `AI_MODELS entry ${JSON.stringify(raw?.id ?? raw)}`;
  if (!raw || typeof raw !== "object" || !raw.id) throw new Error(`${where}: an id is required`);
  if (!PROVIDERS.includes(raw.provider)) throw new Error(`${where}: provider must be one of ${PROVIDERS.join(", ")}`);
  const price = raw.price || {};
  if (!(Number(price.in) >= 0) || !(Number(price.out) >= 0) || price.in == null || price.out == null) {
    throw new Error(`${where}: a price { in, out } in USD per 1M tokens is required — a model without a price can't be billed correctly`);
  }
  if (raw.provider === "openai_compatible" && !raw.baseURL) throw new Error(`${where}: an openai_compatible provider needs a baseURL`);
  return Object.freeze({
    id: String(raw.id), provider: raw.provider, apiModel: String(raw.apiModel || raw.id), label: String(raw.label || raw.id),
    description: raw.description || null,
    price: Object.freeze({ in: Number(price.in), out: Number(price.out), ...(price.cachedIn != null ? { cachedIn: Number(price.cachedIn) } : {}) }),
    caps: Object.freeze({ tools: !!raw.caps?.tools, stream: !!raw.caps?.stream, json: !!raw.caps?.json }),
    selectable: !!raw.selectable, enabled: raw.enabled !== false, tier: raw.tier || null,
    fallbackModel: raw.fallbackModel || null,
    // openai_compatible: where it lives and which env var holds its key.
    baseURL: raw.baseURL || null, apiKeyEnv: raw.apiKeyEnv || null,
    effort: raw.effort || null,
  });
}

/**
 * Build a registry from an env-like object (tests pass their own). → { catalogue,
 * get(id), resolveModel({ role, learnerChoice, allowedModels }), defaultId }
 */
export function createModelRegistry(env = process.env) {
  let entries;
  if (env.AI_MODELS) {
    let parsed;
    try { parsed = JSON.parse(env.AI_MODELS); } catch (e) { throw new Error(`AI_MODELS is not valid JSON: ${e.message}`); }
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("AI_MODELS must be a non-empty JSON array");
    // The built-in OpenAI models stay available alongside the env catalogue.
    const byId = new Map(defaultCatalogue().map((e) => [e.id, checkEntry(e)]));
    for (const raw of parsed) byId.set(String(raw?.id), checkEntry(raw));
    entries = [...byId.values()];
  } else {
    entries = defaultCatalogue().map(checkEntry);
  }
  const byId = new Map(entries.map((e) => [e.id, e]));
  for (const e of entries) registerModelPrice([e.id, e.apiModel], e.price);

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
    selectable: (allowedModels = null) => entries.filter((e) => e.enabled && e.selectable && (!Array.isArray(allowedModels) || allowedModels.includes(e.id))),
  };
}

// The app's registry, built once at boot — a bad AI_MODELS fails here, loudly.
export const modelRegistry = createModelRegistry();
export const resolveModel = (opts) => modelRegistry.resolveModel(opts);
