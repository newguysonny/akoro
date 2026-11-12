/**
 * lib/modelRegistry.js — which model a call runs on (Grand Plan §7.11, D23).
 *
 *   resolveModel({ role, learnerChoice, allowedModels }) → catalogue entry
 *   { id, provider, apiModel, label, price, caps, selectable, enabled, fallbackModel }
 *
 * The catalogue: the public models (DeepSeek, GLM, Qwen, Claude Haiku, GPT Luna,
 * Grok) served through the OpenCode Go transport, then the legacy OpenAI/Claude
 * rows kept so old ids resolve (disabled), then every other model the price
 * table knows (not pickable). AI_MODELS (JSON array) merges over it by id —
 * a partial entry ({ "id": "grok", "enabled": false }) changes just that.
 * An AI_MODELS model that is switched on and has no price fails boot, so a
 * learner on an expensive model is never billed at the gpt-4o-mini fallback.
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
 *   4. AI_MODEL_DEFAULT (legacy OPENAI_MODEL honoured), else gpt-4o-mini —
 *      a disabled choice falls back to DeepSeek
 *
 * API keys stay per provider in env (OPENAI_API_KEY, ANTHROPIC_API_KEY,
 * OPENCODE_API_KEY …), never in the catalogue.
 *
 * Example AI_MODELS entry:
 *   { "id": "deepseek", "provider": "opencode", "lane": "go", "family": "chat",
 *     "apiModel": "deepseek-v4.1-flash", "price": { "in": 0.30, "out": 1.20 },
 *     "caps": { "tools": true, "stream": true, "json": true }, "selectable": true }
 */
import { DEFAULT_MODEL_PRICES, registerModelPrice } from "./aiPricing.js";
import { runtimeDefaultModel, runtimeFallbackModel, runtimeRoleModel } from "./modelRuntime.js";

/** AI_MODEL_PICKER_ENABLED — on by default (2026-11-07); "false" / "0" / "off" / "no" turns it off. */
export const pickerFlag = (env = process.env) => !["false", "0", "off", "no"].includes(String(env.AI_MODEL_PICKER_ENABLED ?? "true").trim().toLowerCase());

export const PROVIDERS = Object.freeze(["openai", "openai_compatible", "anthropic", "opencode"]);

/** OpenCode lanes: Go (subscription) and Console (pay as you go). */
export const LANES = Object.freeze(["go", "console"]);
/** How a model is served: OpenAI chat, OpenAI responses, Anthropic messages. */
export const FAMILIES = Object.freeze(["chat", "responses", "messages"]);
const OPENCODE_BASE = "https://opencode.ai/inference";

/** Older AI_MODELS spelling: Grok / DeepSeek as their own providers → openai_compatible. */
const COMPAT = Object.freeze({
  xai: { baseURL: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY", apiModelEnv: "XAI_MODEL" },
  deepseek: { baseURL: "https://api.deepseek.com", apiKeyEnv: "DEEPSEEK_API_KEY", apiModelEnv: "DEEPSEEK_MODEL" },
});

/** Where each provider's key lives (never in the catalogue). */
const KEY_ENV = { openai: ["OPENAI_API_KEY"], anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"], opencode: ["OPENCODE_API_KEY"] };

const ALL = { tools: true, stream: true, json: true, vision: false, reasoning: false, responses: true };
const VISION = { tools: true, stream: true, json: true, vision: true, reasoning: false, responses: true };
const NO_VISION = { tools: true, stream: true, json: true, vision: false, reasoning: false, responses: true };
// Go chat models reason internally (probed: reasoning_tokens > 0) but are not
// served through our Responses path, so `responses` stays false.
const GO_PLAIN = { tools: true, stream: true, json: true, vision: false, reasoning: false, responses: false };
const GO_REASON = { ...GO_PLAIN, reasoning: true, reasoningExposed: true };
const GO_VISION = { ...GO_PLAIN, vision: true, reasoning: true, reasoningExposed: true };
// GPT Luna reasons, but the gateway returns no reasoning text.
const GO_VISION_PRIVATE = { ...GO_PLAIN, vision: true, reasoning: true };
const GO_VISION_PLAIN = { ...GO_PLAIN, vision: true };

/**
 * The final Go set (2026-11-12): the public models a learner can pick, all
 * served through the OpenCode Go transport. Prices are USD / 1M tokens; a
 * DeepSeek static fallback uses its peak rate so a missing reported cost is
 * never under-billed.
 */
const GO_MODELS = [
  { id: "deepseek", label: "DeepSeek", provider: "opencode", lane: "go", family: "chat", apiModel: "deepseek-v4.1-flash", price: { in: 0.30, out: 1.20, cachedIn: 0.006 }, caps: GO_VISION, selectable: true, tier: "freemium", fallbackModel: "deepseek-direct" },
  { id: "glm-5-3-flash", label: "GLM 5.3 Flash", provider: "opencode", lane: "go", family: "chat", apiModel: "glm-5.3-flash", price: { in: 0.15, out: 0.50, cachedIn: 0.03 }, caps: GO_REASON, selectable: true, tier: "freemium", fallbackModel: "deepseek" },
  { id: "qwen3-8-flash", label: "Qwen3.8 Flash", provider: "opencode", lane: "go", family: "chat", apiModel: "qwen3.8-flash", price: { in: 0.15, out: 0.47, cachedIn: 0.016 }, caps: GO_VISION, selectable: true, tier: "freemium", fallbackModel: "deepseek" },
  { id: "claude-haiku", label: "Claude Haiku", provider: "opencode", lane: "go", family: "chat", apiModel: "claude-haiku-5-5", price: { in: 0.10, out: 0.50, cachedIn: 0.01 }, caps: GO_VISION_PLAIN, selectable: true, tier: "trial", fallbackModel: "deepseek" },
  { id: "gpt-6-luna", label: "GPT 6 Luna", provider: "opencode", lane: "go", family: "chat", apiModel: "gpt-6-luna", price: { in: 0.10, out: 0.50, cachedIn: 0.01 }, caps: GO_VISION_PRIVATE, selectable: true, tier: "freemium", fallbackModel: "deepseek" },
  { id: "gpt-5-6-luna", label: "GPT 5.6 Luna", provider: "opencode", lane: "go", family: "chat", apiModel: "gpt-5.6-luna", price: { in: 0.20, out: 1.20, cachedIn: 0.02 }, caps: GO_VISION_PRIVATE, selectable: true, tier: "freemium", fallbackModel: "deepseek" },
  { id: "grok", label: "Grok", provider: "opencode", lane: "go", family: "chat", apiModel: "grok-4.7", price: { in: 2.00, out: 6.00, cachedIn: 0.50 }, caps: GO_REASON, selectable: true, tier: "premium", fallbackModel: "deepseek" },
];

/** Legacy rows kept (hidden, off) so old wallet/telemetry ids still resolve. */
const LEGACY_MODELS = [
  { id: "gpt-4o-mini", provider: "openai", apiModel: "gpt-4o-mini", label: "GPT-4o mini", price: { in: 0.15, out: 0.60 } },
  { id: "gpt-4.1", provider: "openai", apiModel: "gpt-4.1", label: "GPT-4.1", price: { in: 2.00, out: 8.00 } },
  { id: "gpt-4.1-mini", provider: "openai", apiModel: "gpt-4.1-mini", label: "GPT-4.1 mini", price: { in: 0.40, out: 1.60 } },
  { id: "gpt-4o", provider: "openai", apiModel: "gpt-4o", label: "GPT-4o", price: { in: 2.50, out: 10.00 } },
  { id: "claude-sonnet", provider: "anthropic", apiModel: "claude-sonnet-5-5", label: "Claude Sonnet", price: { in: 2.00, out: 10.00, cachedIn: 0.20 } },
  { id: "claude-opus", provider: "anthropic", apiModel: "claude-opus-5-5", label: "Claude Opus", price: { in: 4.00, out: 20.00, cachedIn: 0.20 } },
  { id: "claude-fable", provider: "anthropic", apiModel: "claude-fable-5-1", label: "Claude Fable", price: { in: 10.00, out: 50.00, cachedIn: 0.25 } },
].map((m) => ({ ...m, caps: ALL, selectable: false, enabled: false }));

/* Same model, other transport: the public DeepSeek id runs on OpenCode Go and
   fails over to DeepSeek's own API. Hidden from the picker (selectable:false),
   callable only as a fallback; availability needs DEEPSEEK_API_KEY +
   DEEPSEEK_MODEL (apiModel comes from that env, as with the legacy alias). */
const DIRECT_FALLBACKS = [
  { id: "deepseek-direct", label: "DeepSeek (direct)", provider: "deepseek", apiModelEnv: "DEEPSEEK_MODEL",
    price: { in: 0.30, out: 1.20, cachedIn: 0.028 }, caps: VISION, selectable: false, enabled: true, fallbackModel: null },
];

const PLAN_MODELS = [...GO_MODELS, ...DIRECT_FALLBACKS, ...LEGACY_MODELS];

/** Every role a call can name, and what its model must be able to do. */
export const ROLES = Object.freeze({
  chat: { caps: ["stream"] },
  controller: { caps: ["tools"] },          // workflow agent loops: tool calling required
  persona: { caps: [] },                    // protégé, NaNa
  assessor: { caps: [], locked: true },     // Sargeant: grading stays consistent across learners
  evidence: { caps: [], locked: true },     // evidence analysis
  // Agent Check (§7.12.2, D23): the learner's agent answering from its notes, and NaNa's
  // questions. A stronger model would answer from general knowledge, and question
  // difficulty must not change with the learner's plan — scores stay comparable.
  agent_recall: { caps: [], locked: true },
  question_generator: { caps: [], locked: true },
  // Helpers that used to pin a model. They now resolve through the platform
  // default, with capability checks: a vision step can't land on DeepSeek, and
  // a JSON step can't land on a model without JSON.
  suggestions: { caps: ["json"] },
  vision: { caps: ["vision"], prefer: ["gpt-6-luna", "claude-haiku", "qwen3-8-flash"], preferOverDefault: true },
  builder: { caps: ["json"], prefer: ["deepseek", "glm-5-3-flash"] },
  rerank: { caps: ["json"] },
  battle_answer: { caps: [] },
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
  const lane = provider === "opencode" ? String(raw.lane || "go") : null;
  if (lane && !LANES.includes(lane)) throw new Error(`${where}: lane must be one of ${LANES.join(", ")}`);
  const family = provider === "opencode" ? String(raw.family || "chat") : null;
  if (family && !FAMILIES.includes(family)) throw new Error(`${where}: family must be one of ${FAMILIES.join(", ")}`);
  const baseURL = provider === "opencode"
    ? raw.baseURL || openCodeBaseURL(lane, env)
    : raw.baseURL || compat?.baseURL || null;
  if (provider === "openai_compatible" && !baseURL) throw new Error(`${where}: an openai_compatible provider needs a baseURL`);
  const apiModelEnv = raw.apiModelEnv || raw.envModel || compat?.apiModelEnv || null;
  const apiModel = raw.apiModel ? String(raw.apiModel) : (apiModelEnv && env[apiModelEnv]) || (compat || apiModelEnv || provider === "opencode" ? null : String(raw.id));
  if (provider === "opencode" && !apiModel) throw new Error(`${where}: an opencode model needs an apiModel (the vendor id; there is no id fallback)`);
  const price = raw.price || null;
  const priced = !!price && Number(price.in) >= 0 && Number(price.out) >= 0 && price.in != null && price.out != null;
  if (!priced && strict && enabled && apiModel) {
    throw new Error(`${where}: a price { in, out } in USD per 1M tokens is required — a model without a price can't be billed correctly`);
  }
  return Object.freeze({
    id: String(raw.id), provider, apiModel,
    label: String(raw.label || raw.id), description: raw.description || null,
    price: priced ? Object.freeze({ in: Number(price.in), out: Number(price.out), ...(price.cachedIn != null ? { cachedIn: Number(price.cachedIn) } : {}) }) : null,
    caps: Object.freeze({ tools: !!raw.caps?.tools, stream: !!raw.caps?.stream, json: !!raw.caps?.json,
      vision: !!raw.caps?.vision, reasoning: !!raw.caps?.reasoning, reasoningExposed: !!raw.caps?.reasoningExposed, responses: !!raw.caps?.responses }),
    selectable: !!raw.selectable, enabled, tier: raw.tier || null,
    fallbackModel: raw.fallbackModel || null,
    baseURL, apiKeyEnv: raw.apiKeyEnv || compat?.apiKeyEnv || (provider === "opencode" ? "OPENCODE_API_KEY" : null),
    lane, family,
    effort: raw.effort || null,
  });
}

/** OpenCode's provider base for a lane: `OPENCODE_BASE_URL` (default opencode.ai/inference) + `/<lane>`. */
export function openCodeBaseURL(lane = "go", env = {}) {
  const root = String(env.OPENCODE_BASE_URL || OPENCODE_BASE).replace(/\/+$/, "");
  return root.endsWith(`/${lane}`) ? root : `${root}/${lane}`;
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

  let defaultId = env.AI_MODEL_DEFAULT || env.OPENAI_MODEL || "gpt-4o-mini";
  if (!byId.has(defaultId)) {
    // A legacy OPENAI_MODEL the table doesn't price (e.g. a new OpenAI model): run it, billed at the default.
    const legacy = checkEntry({ id: defaultId, provider: "openai", apiModel: defaultId, price: DEFAULT_MODEL_PRICES["gpt-4o-mini"], caps: { tools: true, stream: true, json: true } });
    byId.set(defaultId, legacy);
    entries.push(legacy);
  }
  // A chosen default that was switched off (the legacy models) is not defaultable:
  // fall back to the locked global fallback, DeepSeek, when the catalogue defines it.
  if (!byId.get(defaultId)?.enabled) {
    const deepseek = byId.get("deepseek");
    if (deepseek?.enabled) defaultId = deepseek.id;
  }
  // The admin override (lib/modelRuntime.js) replaces the env default without a
  // restart; invalid/disabled overrides are ignored. Per-role envs and locked
  // roles keep their precedence (§6.3 of the plan).
  const envDefaultId = defaultId;
  const activeDefault = () => {
    const id = runtimeDefaultModel();
    return id && byId.get(id)?.enabled ? id : envDefaultId;
  };
  const activeFallback = () => runtimeFallbackModel() || env.AI_MODEL_FALLBACK || activeDefault();
  const locked = new Set([
    ...Object.entries(ROLES).filter(([, r]) => r.locked).map(([name]) => name),
    ...String(env.AI_MODEL_LOCKED_ROLES || "").split(",").map((s) => s.trim()).filter(Boolean),
  ]);
  const pickerOn = pickerFlag(env);
  const roleEnv = (role) => env[`AI_MODEL_ROLE_${String(role).toUpperCase()}`] || null;
  const hasCaps = (entry, role) => (ROLES[role]?.caps || []).every((c) => entry.caps[c]);
  // The platform default is only usable for a role whose capabilities it has.
  const defaultFor = (role) => {
    const e = byId.get(activeDefault());
    return e && e.enabled && hasCaps(e, role) ? e : null;
  };
  const firstWithCaps = (role) => {
    const preferred = (ROLES[role]?.prefer || []).map((id) => byId.get(id)).filter(Boolean);
    return [...preferred, ...entries].find((e) => e.enabled && hasCaps(e, role) && availabilityOf(e, env).available) || null;
  };
  /** → { model: entry, source: "locked"|"learner"|"role"|"default"|"fallback", notice? } */
  function resolve({ role = "chat", learnerChoice = null, allowedModels = null } = {}) {
    if (!ROLES[role]) throw new Error(`Unknown model role "${role}"`);
    const usable = (id) => { const e = id && byId.get(id); return e && e.enabled && hasCaps(e, role) ? e : null; };
    // An admin override for THIS role wins over its env value; an override that
    // is unavailable or lacks the role's capabilities is ignored (env/default).
    const runtimeRole = (() => {
      const id = runtimeRoleModel(role);
      const entry = id && byId.get(id);
      return entry && entry.enabled && hasCaps(entry, role) && availabilityOf(entry, env).available ? entry : null;
    })();
    const roleModel = runtimeRole || usable(roleEnv(role));
    const labelEntry = () => roleModel
      || (ROLES[role]?.preferOverDefault ? firstWithCaps(role) : null)
      || defaultFor(role) || firstWithCaps(role) || byId.get(activeDefault());
    if (locked.has(role)) return { model: roleModel || defaultFor(role) || firstWithCaps(role) || byId.get(defaultId), source: "locked" };
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
      notice = `Using ${labelEntry().label}: ${why}.`;
    }
    if (roleModel) return { model: roleModel, source: "role", ...(notice ? { notice } : {}) };
    // Capability roles with an explicit preference (vision) keep it even when
    // the platform default is technically capable — cost/latency wins.
    if (ROLES[role]?.preferOverDefault) {
      const preferred = firstWithCaps(role);
      if (preferred) return { model: preferred, source: "fallback", ...(notice ? { notice } : {}) };
    }
    const def = defaultFor(role);
    if (def) return { model: def, source: "default", ...(notice ? { notice } : {}) };
    // The default lacks this step's capability (vision, JSON): use the first
    // capable model this server can call, and say why if it replaced a pick.
    const alt = firstWithCaps(role);
    if (alt) {
      const why = `the default can't do this step`;
      return { model: alt, source: "fallback", notice: notice ? `Using ${alt.label}: ${why}.` : undefined };
    }
    return { model: byId.get(activeDefault()), source: "default", ...(notice ? { notice } : {}) };
  }

  return {
    catalogue: entries,
    get defaultId() { return activeDefault(); },
    get envDefaultId() { return envDefaultId; },
    get fallbackId() { return activeFallback(); },
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

/** The AI_FORCE_MODEL stand-in for an OpenAI-bound chat call, or null (unset, unknown, unavailable). */
export function forcedModelFor(entry, requestedModel, { registry, env = process.env } = {}) {
  registry ||= modelRegistry;
  const id = String(env.AI_FORCE_MODEL || "").trim();
  if (!id) return null;
  const goesToOpenAI = entry ? entry.provider === "openai" : Boolean(requestedModel);
  if (!goesToOpenAI) return null;
  const target = registry.get(id);
  if (!target || !availabilityOf(target, env).available) {
    if (!forcedModelFor.warned) { forcedModelFor.warned = true; console.warn(`[ai] AI_FORCE_MODEL=${id} is not callable here (its API key, DEEPSEEK_MODEL or AI_MODELS price is missing) — not forcing`); }
    return null;
  }
  return target;
}
