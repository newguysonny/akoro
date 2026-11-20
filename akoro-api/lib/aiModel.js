/**
 * lib/aiModel.js
 * Single source of truth for the LLM the agent loops use — task tools, battle
 * question generation, adaptive chat tools, instructor tools and agentService.
 *
 * The platform standardises on OpenAI (the same key that already powers voice,
 * the tutor chat and the trained adaptive agents). Override the model with
 * OPENAI_MODEL; it defaults to the tutor-chat model.
 */
import { isSelfHostedModel } from "./embeddingProvider.js";
import { singleTextKey, cacheModel, embeddingCacheGet, embeddingCachePut } from "./embeddingCache.js";
import OpenAI from "openai";
import { AsyncLocalStorage } from "node:async_hooks";
import { coinsAvailable, chargeForAI, InsufficientCoins } from "./coins.js";
import { makeAiBreakers } from "./aiBreakers.js";
import { aiContext } from "./aiContext.js";
import { usdCost, cachedTokensOf, reportedCostUsd } from "./aiPricing.js";
import { recordAiCall, errorKindOf } from "./aiTelemetry.js";
import { modelRegistry, forcedModelFor, availabilityOf, ROLES } from "./modelRegistry.js";
import { createMetering } from "./aiBilling.js";
import { makeOpenAICompatibleAdapter } from "./providers/openaiCompatible.js";
import { makeAnthropicAdapter } from "./providers/anthropic.js";
import { makeOpenCodeAdapter } from "./providers/opencode.js";

// The default model (lib/modelRegistry.js: AI_MODEL_DEFAULT, legacy OPENAI_MODEL,
// else gpt-4o-mini; a disabled choice falls back to DeepSeek). New code names a
// role (`__role`) instead of importing this.
export const OPENAI_MODEL = modelRegistry.defaultId;

// Providers other than OpenAI, behind the same call path (§7.11.4).
const adapters = { openai_compatible: makeOpenAICompatibleAdapter(), anthropic: makeAnthropicAdapter(), opencode: makeOpenCodeAdapter() };
export { InsufficientCoins };

// Stand-in providers for the code that runs inside runWithProviders only (a
// Verification Gate check forcing a refusal, contract tests). Every other call
// — the rest of the server's traffic — keeps the real providers.
const providerOverrides = new AsyncLocalStorage();
/** Run fn with { openai?, anthropic?, openai_compatible?, opencode? } adapters ({ create(params, reqOpts, entry) }) in place of the real ones. */
/** Kinds worth trying on the fallback model (transport/quota, not a bad request). */
const RETRYABLE = new Set(["rate_limited", "auth", "upstream_5xx", "timeout", "connection", "http_402", "http_429", "http_500", "http_502", "http_503", "http_504"]);
function retryableFailure(err) {
  const kind = errorKindOf(err);
  return RETRYABLE.has(kind) || /rate.?limit|quota|balance|capacity|overload|insufficient/i.test(String(err?.message || ""));
}

/**
 * The ordered failover ladder for a model: its own fallbackModel, then the
 * runtime/env global fallback, then the default — and each of those model's
 * own fallback (so GLM → DeepSeek OpenCode → DeepSeek direct). Only models
 * this server can actually call are included; the starting model is never a
 * target. Bounded to 4 hops.
 */
export function fallbackLadder(entry, { registry = modelRegistry, env = process.env, max = 4, role = null, ROLES: roleTable = null } = {}) {
  if (!entry) return [];
  const roleCaps = roleTable?.[role]?.caps || null;
  const capsOk = (e) => !roleCaps || roleCaps.every((c) => e.caps[c]);
  const out = [];
  const seen = new Set([entry.id]);
  const add = (candidate) => {
    if (!candidate || out.length >= max) return;
    if (seen.has(candidate.id) || !candidate.enabled) return;
    if (!capsOk(candidate)) return;
    if (!availabilityOf(candidate, env).available) return;
    seen.add(candidate.id);
    out.push(candidate);
  };
  // 1) Follow the entry's explicit fallback chain (GLM → DeepSeek → direct).
  const chain = (from, depth) => {
    if (!from || depth > 3 || out.length >= max) return;
    const next = from.fallbackModel && registry.get(from.fallbackModel);
    if (!next) return;
    add(next);
    chain(next, depth + 1);
  };
  chain(entry, 0);
  // 2) No usable explicit chain: the runtime/env global fallback, then the
  //    default, each with its own chain.
  if (!out.length) {
    const seeds = [registry.get(registry.fallbackId), registry.get(registry.defaultId)];
    for (const seed of seeds) { add(seed); if (out.length >= max) break; }
    for (const seed of [...out]) chain(seed, 0);
  }
  // A capability role (vision) may have no capable hop in its chain — the
  // default is text-only. Fall through to the role's capable models rather
  // than sending an image to a model that cannot see it.
  if (!out.length && roleCaps) {
    const preferred = (roleTable?.[role]?.prefer || []).map((id) => registry.get(id)).filter(Boolean);
    for (const candidate of [...preferred, ...registry.catalogue]) {
      if (out.length >= max) break;
      add(candidate);
    }
  }
  return out;
}

/** The first fallback for a failed call (kept for callers/tests). */
export function errorFallbackFor(entry, opts = {}) {
  return fallbackLadder(entry, opts)[0] || null;
}

export function runWithProviders(overrides, fn) {
  return providerOverrides.run(overrides || {}, fn);
}

/** A refused reply (Claude stop_reason "refusal", an OpenAI refusal): { reason, category } | null. */
export function refusalOf(res) {
  const choice = res?.choices?.[0];
  const msg = choice?.message || {};
  if (msg.refusal) return { reason: String(msg.refusal).slice(0, 300), category: msg.refusal_category ?? null };
  if (choice?.finish_reason === "content_filter" && !msg.tool_calls?.length && !msg.content) return { reason: "The model declined this request.", category: null };
  return null;
}

/**
 * Where a refused call goes next: the entry's fallbackModel, else the default —
 * never itself — and, like every call, AI_FORCE_MODEL applies (a sandbox with
 * OpenAI off retries on the forced model). noForce: a check's stand-ins.
 */
export function refusalFallbackFor(entry, { registry = modelRegistry, env = process.env, noForce = false, role = "chat", ROLES: roleTable = ROLES } = {}) {
  // Prefer the entry's own failover hop, but only if it can do this step
  // (a vision call must never fall back to a text-only model).
  const base = (entry?.fallbackModel && registry.get(entry.fallbackModel))
    || registry.get(registry.fallbackId || registry.defaultId);
  const caps = roleTable?.[role]?.caps || [];
  const target = base && entry && base.id !== entry.id && base.enabled
    && caps.every((c) => base.caps[c])
    && availabilityOf(base, env).available ? base : null;
  if (!target || noForce) return target;
  const forced = forcedModelFor(target, target.apiModel, { registry, env });
  return forced && forced.id !== entry.id ? forced : target;
}

// baseURL is overridable so the golden-path tests can point the whole platform
// at a local stand-in and exercise every tool path end to end without a live
// key. Unset in every real environment, where the SDK's default applies.
let _rawClient = null;   // lazy: importing this module must not throw without a key
const rawClient = new Proxy({}, { get(_t, k) { _rawClient ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}) });
  const v = _rawClient[k]; return typeof v === "function" ? v.bind(_rawClient) : v; } });
const { chat: chatBreaker, responses: responsesBreaker, embeddings: embeddingsBreaker } = makeAiBreakers(rawClient);

const { meteredCreate, withStreamRefusal, estimateTokens } = createMetering({
  OPENAI_MODEL, adapters, chatBreaker, fallbackLadder,
  refusalFallbackFor, refusalOf, retryableFailure, ROLES,
  getOverrides: () => providerOverrides.getStore() || null,
});
export { withStreamRefusal };

/**
 * Responses-API usage in the chat-completions shape the wallet and telemetry
 * already price: input → prompt, output (reasoning tokens included — OpenAI
 * bills them as output) → completion, cached input kept for the cache discount.
 */
export function responsesUsageToChat(usage) {
  if (!usage) return null;
  return {
    prompt_tokens: usage.input_tokens ?? 0,
    completion_tokens: usage.output_tokens ?? 0,
    prompt_tokens_details: { cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0 },
  };
}

/**
 * Metered Responses API call (reasoning models: Think mode). The same contract
 * as meteredCreate — payer from __userId or the request context, hard block on
 * an empty wallet, debit by real usage × markup, every call timed. Usage comes
 * from the final `response.completed` (or incomplete/failed) event on a
 * stream, or `response.usage` otherwise; an abandoned stream is charged an
 * estimate so a stopped Think turn is never free.
 */
async function meteredResponses(params = {}) {
  const store   = aiContext.getStore() || {};
  // __payer: "platform" — the app pays (e.g. Sergeant judging a battle), whoever's request it runs in.
  const platform = params.__payer === "platform";
  const userId  = platform ? null : params.__userId  ?? store.userId  ?? null;
  const feature = params.__feature ?? store.feature ?? "ai";
  const ref     = params.__ref     ?? null;
  const billTo  = platform ? null : params.__billTo  ?? store.billTo  ?? null;
  const clean = { ...params };
  delete clean.__userId; delete clean.__feature; delete clean.__ref; delete clean.__billTo; delete clean.__payer;

  const bills = Boolean(userId || billTo);
  if (bills) {
    const { ok, total } = await coinsAvailable({ userId, billTo, min: 1 });
    if (!ok) throw new InsufficientCoins(1, total);
  }
  const model = clean.model || OPENAI_MODEL;
  const started = Date.now();
  const settle = (usage, { ttfbMs = null, streamed = false, ok = true, errorKind = null } = {}) => {
    const tokensIn  = usage?.prompt_tokens ?? 0;
    const tokensOut = usage?.completion_tokens ?? 0;
    const cachedIn  = usage ? cachedTokensOf(usage) : 0;
    recordAiCall({
      feature, model, ms: Date.now() - started, ttfbMs,
      tokensIn, tokensOut, cachedIn,
      costUsd: usage ? usdCost(model, tokensIn, tokensOut, cachedIn) : null,
      userId, ref, streamed, ok, errorKind,
    });
    if (bills && usage) {
      chargeForAI({ userId, feature, model, usage, ref, billTo })
        .catch((e) => { if (!(e instanceof InsufficientCoins)) console.warn("[coins] charge failed:", e.message); });
    }
  };

  let source;
  try { source = await responsesBreaker.fire(clean); }
  catch (e) { settle(null, { streamed: Boolean(clean.stream), ok: false, errorKind: errorKindOf(e) }); throw e; }

  if (!clean.stream) {
    settle(responsesUsageToChat(source?.usage));
    return source;
  }

  // Abandoned stream (stop, error): estimate input from the prompt and output
  // from what streamed, floored so hidden reasoning tokens are not free.
  // Capped: inline image data URLs would otherwise read as huge prompts.
  const promptEstimate = Math.min(32_000, estimateTokens([{ content: clean.input }, { content: clean.instructions || "" }]));
  const gen = (async function* () {
    let usage = null;
    let ttfbMs = null;
    let streamedChars = 0;
    const t0 = Date.now();
    try {
      for await (const ev of source) {
        if (typeof ev?.delta === "string") {
          streamedChars += ev.delta.length;
          if (ttfbMs == null) ttfbMs = Date.now() - t0;
        }
        if (ev?.response?.usage) usage = ev.response.usage;   // completed / incomplete / failed
        yield ev;
      }
    } finally {
      try {
        const fallback = { prompt_tokens: promptEstimate, completion_tokens: Math.max(Math.ceil(streamedChars / 4), 300) };
        settle(responsesUsageToChat(usage) || fallback, { ttfbMs, streamed: true });
      } catch { /* billing must not break the stream */ }
    }
  })();
  if (source && source.controller) gen.controller = source.controller;
  return gen;
}

// Metered embeddings — charged by prompt tokens (cheap, but counted).
async function meteredEmbeddings(params = {}) {
  const store   = aiContext.getStore() || {};
  // __payer: "platform" — the app pays (e.g. Sergeant judging a battle), whoever's request it runs in.
  const platform = params.__payer === "platform";
  const userId  = platform ? null : params.__userId  ?? store.userId  ?? null;
  const feature = params.__feature ?? store.feature ?? "embedding";
  const billTo  = platform ? null : params.__billTo  ?? store.billTo  ?? null;
  const clean = { ...params }; delete clean.__userId; delete clean.__feature; delete clean.__ref; delete clean.__billTo; delete clean.__payer;

  // Lever 2 (token-cost plan): an embedding is a pure function of (provider, model,
  // text). Serve identical single-text embeddings from the content-hash cache — no
  // tokens, no latency — instead of paying to embed the same text again. Batch
  // (array) inputs bypass the cache; misses do the real call below and fill it.
  const cacheKey = singleTextKey(clean);
  if (cacheKey) {
    const hit = await embeddingCacheGet(cacheKey);
    if (hit) return {
      object: "list",
      data: [{ object: "embedding", embedding: hit, index: 0 }],
      model: cacheModel(clean),
      usage: { prompt_tokens: 0, total_tokens: 0 },
      cached: true,
    };
  }

  const res = await embeddingsBreaker.fire(clean);
  if (cacheKey) {
    const vec = res?.data?.[0]?.embedding;
    // Awaited so the very next identical call is a guaranteed hit (a cache that
    // races its own writer would re-embed). The upsert is one indexed row.
    if (Array.isArray(vec)) await embeddingCachePut(cacheKey, cacheModel(clean), vec);
  }
  if ((userId || billTo) && res?.usage) {
    chargeForAI({ userId, feature, billTo, model: isSelfHostedModel(res.model) ? res.model : clean.model || "text-embedding-3-small", usage: { prompt_tokens: res.usage.prompt_tokens ?? res.usage.total_tokens ?? 0, completion_tokens: 0 } })
      .catch((e) => { if (!(e instanceof InsufficientCoins)) console.warn("[coins] embed charge failed:", e.message); });
  }
  return res;
}

// Proxy the client so `openai.chat.completions.create(...)`,
// `openai.responses.create(...)` and `openai.embeddings.create(...)` are
// metered everywhere they're used, while
// audio/other endpoints pass through (voice meters itself).
export const openai = new Proxy(rawClient, {
  get(target, prop) {
    if (prop === "chat") return { completions: { create: meteredCreate } };
    if (prop === "embeddings") return { create: meteredEmbeddings };
    if (prop === "responses") return { create: meteredResponses };
    const v = target[prop];
    return typeof v === "function" ? v.bind(target) : v;
  },
});

/**
 * Convenience wrapper for background jobs that must name the payer explicitly.
 *
 * `feature` defaults to UNDEFINED, not "ai". meteredCreate resolves it as
 * `__feature ?? store.feature`, so a hardcoded default here does not fall back
 * to the ambient context — it OVERWRITES it. Every request-path call routed
 * through this helper was therefore relabelled from its real feature to the
 * catch-all, which is how "ai" became the joint-largest line on the dashboard.
 */
export async function meteredChat({ userId, feature, ref = null, ...params }) {
  return meteredCreate({ ...params, __userId: userId, __feature: feature, __ref: ref });
}

/**
 * llmComplete — one-shot chat completion returning plain text.
 * Mirrors the old Anthropic single-prompt helpers so call sites stay small.
 */
// feature is deliberately undefined by default — see meteredChat.
export async function llmComplete(prompt, { system, maxTokens = 2048, temperature, userId, feature } = {}) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const res = await meteredChat({
    userId, feature,
    model: OPENAI_MODEL,
    max_tokens: maxTokens,
    ...(temperature != null ? { temperature } : {}),
    messages,
  });
  return res.choices?.[0]?.message?.content ?? "";
}
