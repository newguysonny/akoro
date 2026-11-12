/**
 * lib/aiModel.js
 * Single source of truth for the LLM the agent loops use — task tools, battle
 * question generation, adaptive chat tools, instructor tools and agentService.
 *
 * The platform standardises on OpenAI (the same key that already powers voice,
 * the tutor chat and the trained adaptive agents). Override the model with
 * OPENAI_MODEL; it defaults to the tutor-chat model.
 */
import { embeddingsProvider, isSelfHostedModel, runpodEmbeddings } from "./embeddingProvider.js";
import { singleTextKey, cacheModel, embeddingCacheGet, embeddingCachePut } from "./embeddingCache.js";
import OpenAI from "openai";
import { AsyncLocalStorage } from "node:async_hooks";
import { coinsAvailable, chargeForAI, InsufficientCoins } from "./coins.js";
import { makeAiBreaker } from "./circuitBreaker.js";
import { aiContext } from "./aiContext.js";
import { AI_DEFAULT_MAX_TOKENS, usdCost, cachedTokensOf, reportedCostUsd } from "./aiPricing.js";
import { recordAiCall, errorKindOf } from "./aiTelemetry.js";
import { modelRegistry, forcedModelFor, availabilityOf, ROLES } from "./modelRegistry.js";
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
const RETRYABLE = new Set(["rate_limited", "auth", "upstream_5xx", "timeout", "http_402", "http_429", "http_500", "http_502", "http_503", "http_504"]);
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

// One breaker per endpoint family. Every model call in the app — chat,
// streaming chat, embeddings, voice, tasks, training — funnels through these
// two call sites, so provider trouble fails fast everywhere at once instead of
// hanging each request on its own SDK timeout.
const chatBreaker = makeAiBreaker(
  "openai-chat",
  (params, reqOpts) => rawClient.chat.completions.create(params, reqOpts),
);
const responsesBreaker = makeAiBreaker(
  "openai-responses",
  (params, reqOpts) => rawClient.responses.create(params, reqOpts),
);
// Our own RunPod endpoint when EMBEDDINGS_PROVIDER=runpod (lib/embeddingProvider.js), else OpenAI — never both.
const embeddingsBreaker = makeAiBreaker(
  "openai-embeddings",
  (params) => (embeddingsProvider() === "runpod" ? runpodEmbeddings(params) : rawClient.embeddings.create(params)),
);

// baseURL is overridable so the golden-path tests can point the whole platform
// at a local stand-in and exercise every tool path end to end without a live
// key. Unset in every real environment, where the SDK's default applies.
const rawClient = new OpenAI({
  apiKey:  process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}),
});

/**
 * Metered chat completion. The acting user comes from (in order): explicit
 * __userId on the params, else the AsyncLocalStorage request context. When a
 * user is resolved we HARD-BLOCK on an empty balance and debit the wallet by
 * the completion's real token usage × markup. No user (system/cron) → plain
 * call, unbilled. Charging is centralised HERE so no call site double-charges.
 */
async function meteredCreate(params = {}) {
  const store   = aiContext.getStore() || {};
  // __payer: "platform" — the app pays (e.g. Sergeant judging a battle), whoever's request it runs in.
  const platform = params.__payer === "platform";
  const userId  = platform ? null : params.__userId  ?? store.userId  ?? null;
  const feature = params.__feature ?? store.feature ?? "ai";
  const ref     = params.__ref     ?? null;
  const billTo  = platform ? null : params.__billTo  ?? store.billTo  ?? null;   // e.g. school funds it
  const clean = { ...params };
  delete clean.__userId; delete clean.__feature; delete clean.__ref; delete clean.__billTo; delete clean.__payer;
  delete clean.__timeoutMs; delete clean.__maxRetries;
  delete clean.__role; delete clean.__learnerChoice; delete clean.__allowedModels;
  // Which model (§7.11.3): the caller's own `model`, else resolved from the
  // role and the learner's choice. Either way the catalogue says who serves it.
  // A call site's own model is its default: a learner's pick that resolves
  // for the call's role (never a locked one) still wins (Scenario K).
  const picked = clean.model && params.__learnerChoice
    ? modelRegistry.resolve({ role: params.__role || "chat", learnerChoice: params.__learnerChoice, allowedModels: params.__allowedModels || null })
    : null;
  let entry = picked?.source === "learner" ? picked.model : clean.model
    ? (modelRegistry.get(clean.model) || modelRegistry.catalogue.find((e) => e.apiModel === clean.model) || null)
    : modelRegistry.resolveModel({ role: params.__role || "chat", learnerChoice: params.__learnerChoice || null, allowedModels: params.__allowedModels || null });
  // AI_FORCE_MODEL (a test sandbox switch, e.g. OpenAI out of credit): every
  // chat call that would go to OpenAI is served by this catalogue model instead.
  // A check's stand-in providers can ask to see the unforced choice (`noForce`).
  const overrides = providerOverrides.getStore() || null;
  const forced = overrides?.noForce ? null : forcedModelFor(entry, clean.model);
  if (forced) entry = forced;
  if (entry) clean.model = entry.apiModel;
  const serve = (e, body, opts) => {
    const provider = e?.provider || "openai";
    // A stand-in for the OpenAI shape also serves the OpenCode transport (both
    // are chat-completions) — the golden-path and contract tests run keyless.
    const stub = overrides?.[provider] || (provider === "opencode" ? overrides?.openai : null);
    if (stub) return stub.create(body, opts, e);
    return provider !== "openai" && adapters[provider] ? adapters[provider].create(body, opts, e) : chatBreaker.fire(body, opts);
  };
  const fire = (body, opts) => serve(entry, body, opts);
  // Per-call SDK bounds (`__timeoutMs` / `__maxRetries`). The SDK's defaults
  // are a 10-MINUTE timeout with 2 retries — a single stalled provider call
  // once hung a chat turn for minutes while the browser had long given up.
  // Only calls that opt in are bounded; long streams elsewhere keep the
  // SDK defaults.
  // Read from `params`: `clean` has already had them removed above.
  const reqOpts = (params.__timeoutMs != null || params.__maxRetries != null)
    ? {
        ...(params.__timeoutMs != null ? { timeout: params.__timeoutMs } : {}),
        ...(params.__maxRetries != null ? { maxRetries: params.__maxRetries } : {}),
      }
    : undefined;
  // Cost guardrail: bound output when a caller omits max_tokens (0 = off).
  if (AI_DEFAULT_MAX_TOKENS > 0 && clean.max_tokens == null && clean.max_completion_tokens == null) {
    clean.max_tokens = AI_DEFAULT_MAX_TOKENS;
  }

  const bills = Boolean(userId || billTo);
  if (bills) {
    const { ok, total } = await coinsAvailable({ userId, billTo, min: 1 });
    if (!ok) throw new InsufficientCoins(1, total);
  }

  // Billed and recorded under the catalogue id, priced at its own rate.
  const model = entry?.id || clean.model || OPENAI_MODEL;
  const charge = (usage, m = entry?.id || model) => chargeForAI({
    userId, feature, model: m, usage, ref, billTo,
    // Decision A: bill the provider's reported cost when it gives one,
    // unless AI_BILL_PROVIDER_COST is switched off (static price wins).
    costUsd: process.env.AI_BILL_PROVIDER_COST === "false" ? null : reportedCostUsd(usage),
  }).catch((e) => { if (!(e instanceof InsufficientCoins)) console.warn("[coins] charge failed:", e.message); });

  // Every call is TIMED, whether or not it is billed. Cost and tokens used to
  // be recorded only by the wallet debit, so a system or cron call — no payer,
  // no debit — left no trace at all, and latency was recorded nowhere.
  const started = Date.now();
  const report = (usage, { ttfbMs = null, streamed = false, ok = true, errorKind = null, as = entry?.id || model } = {}) => {
    const tokensIn  = usage?.prompt_tokens ?? 0;
    const tokensOut = usage?.completion_tokens ?? 0;
    const cachedIn  = usage ? cachedTokensOf(usage) : 0;
    const entryFor = modelRegistry.get(as) || entry;
    const oc = usage?.opencode || {};
    const providerCost = reportedCostUsd(usage);
    recordAiCall({
      feature, model: as, ms: Date.now() - started, ttfbMs,
      tokensIn, tokensOut, cachedIn,
      costUsd: providerCost ?? (usage ? usdCost(as, tokensIn, tokensOut, cachedIn) : null),
      userId, ref, streamed, ok, errorKind,
      provider: entryFor?.provider || null,
      lane: entryFor?.lane || null,
      billingSource: oc.billing_source ?? null,
      providerCostUsd: providerCost,
      listCostUsd: oc.list_cost ?? null,
      allowanceUsd: oc.allowance ?? null,
      cacheRead: usage?.prompt_tokens_details?.cached_tokens ?? oc.cache_read ?? null,
      cacheWrite: oc.cache_write ?? null,
    });
  };

  // Streamed calls: ask OpenAI for exact usage in a final chunk, then tee it
  // out of the stream and charge when iteration completes. Falls back to an
  // estimate if no usage chunk arrives (e.g. early abort).
  if (clean.stream) {
    let source;
    try {
      source = await fire({
        ...clean,
        ...(bills ? { stream_options: { include_usage: true, ...(clean.stream_options || {}) } } : {}),
      }, reqOpts);
    } catch (e) {
      report(null, { streamed: true, ok: false, errorKind: errorKindOf(e) });
      const ladder = entry && retryableFailure(e) ? fallbackLadder(entry, { role: params.__role || "chat", ROLES }) : [];
      let lastError = e;
      let started = false;
      for (const target of ladder) {
        console.warn(`[ai] ${entry.id} failed (${errorKindOf(e)}) — streaming from ${target.id}`);
        try {
          source = await serve(target, {
            ...clean, model: target.apiModel,
            ...(bills ? { stream_options: { include_usage: true, ...(clean.stream_options || {}) } } : {}),
          }, reqOpts);
          entry = target;
          started = true;
          break;
        } catch (e2) {
          lastError = e2;
          report(null, { streamed: true, ok: false, errorKind: errorKindOf(e2), as: target.id });
        }
      }
      if (!started) throw lastError;
    }

    const fallback = { prompt_tokens: estimateTokens(clean.messages), completion_tokens: Math.min(clean.max_tokens || 700, 700) };
    const metered = meterStreamUsage(source, (usage, ttfbMs) => {
      // Time to FIRST chunk is the number a user feels; total is what the bill
      // is made of. Kept apart, because averaging them hides the difference.
      report(usage || (bills ? fallback : null), { ttfbMs, streamed: true });
      if (bills) charge(usage || fallback);
    });
    if (!entry) return metered;
    // A streamed refusal (§7.11.4): refused before any text → the fallback model's stream
    // takes over (billed at its own price); refused mid-reply → it ends with the marker.
    return withStreamRefusal(metered, {
      entry,
      target: () => refusalFallbackFor(entry, { noForce: !!overrides?.noForce, role: params.__role || "chat", ROLES }),
      second: async (target) => meterStreamUsage(
        await serve(target, { ...clean, model: target.apiModel, ...(bills ? { stream_options: { include_usage: true, ...(clean.stream_options || {}) } } : {}) }, reqOpts),
        (usage, ttfbMs) => { report(usage || (bills ? fallback : null), { ttfbMs, streamed: true, as: target.id }); if (bills) charge(usage || fallback, target.id); }),
    });
  }

  let res;
  try {
    res = await fire(clean, reqOpts);
  } catch (e) {
    report(null, { ok: false, errorKind: errorKindOf(e) });
    const ladder = entry && retryableFailure(e) ? fallbackLadder(entry, { role: params.__role || "chat", ROLES }) : [];
    if (!ladder.length) throw e;
    const tried = [];
    let lastError = e;
    for (const target of ladder) {
      tried.push(target.id);
      console.warn(`[ai] ${entry.id} failed (${errorKindOf(e)}) — trying ${target.id} (${tried.length}/${ladder.length})`);
      try {
        const second = await serve(target, { ...clean, model: target.apiModel }, reqOpts);
        report(second?.usage ?? null, { as: target.id });
        if (bills && second?.usage) charge(second.usage, target.id);
        return Object.assign(second || {}, {
          model_fallback: { model: entry.id, fallbackModel: target.id, tried, reason: errorKindOf(e) },
        });
      } catch (e2) {
        lastError = e2;
        report(null, { ok: false, errorKind: errorKindOf(e2), as: target.id });
      }
    }
    throw lastError;
  }

  report(res?.usage ?? null);
  if (bills && res?.usage) charge(res.usage);

  // A refusal is not a crash (§7.11.4): the refused call is billed as it ran,
  // then the same request goes once to the fallback model (the entry's
  // fallbackModel, else the default). The answer carries `model_refusal` so
  // an agent loop records a model_refusal observation, never a malformed one.
  const refused = entry ? refusalOf(res) : null;
  if (refused) {
    const target = refusalFallbackFor(entry, { noForce: !!overrides?.noForce, role: params.__role || "chat", ROLES });
    const note = { model: entry.id, reason: refused.reason, category: refused.category, fallbackModel: target?.id || null };
    console.warn(`[ai] model_refusal on ${entry.id} (${feature})${target ? ` — retrying on ${target.id}` : ""}`);
    if (!target) return Object.assign(res, { model_refusal: note });
    let second;
    try {
      second = await serve(target, { ...clean, model: target.apiModel }, reqOpts);
    } catch (e) {
      report(null, { ok: false, errorKind: errorKindOf(e), as: target.id });
      return Object.assign(res, { model_refusal: { ...note, fallbackError: String(e?.message || e).slice(0, 200) } });
    }
    report(second?.usage ?? null, { as: target.id });
    if (bills && second?.usage) charge(second.usage, target.id);
    return Object.assign(second || {}, { model_refusal: note });
  }
  return res;
}

// Passthrough async iterable that captures the stream's final usage chunk and
// charges once iteration ends. Forwards `.controller` for barge-in/abort.
function meterStreamUsage(source, onDone) {
  let usage = null;
  let ttfbMs = null;
  const t0 = Date.now();
  const gen = (async function* () {
    try {
      for await (const chunk of source) {
        // First chunk with actual content — a leading role-only delta is not
        // the moment anything appears on screen.
        if (ttfbMs == null && chunk?.choices?.[0]?.delta?.content) ttfbMs = Date.now() - t0;
        if (chunk?.usage) usage = chunk.usage;   // final include_usage chunk
        yield chunk;
      }
    } finally {
      try { onDone(usage, ttfbMs); } catch { /* billing must not break the stream */ }
    }
  })();
  if (source && source.controller) gen.controller = source.controller;
  return gen;
}

/**
 * A refused stream (finish_reason "content_filter"): yields a `{ choices: [],
 * model_refusal }` marker chunk; if nothing had been written yet, the fallback
 * model's stream follows in its place. Never throws past the caller's loop.
 */
export function withStreamRefusal(source, { entry, target, second }) {
  const gen = (async function* () {
    let wrote = false;
    for await (const chunk of source) {
      const choice = chunk?.choices?.[0];
      if (choice?.delta?.content) wrote = true;
      if (choice?.finish_reason !== "content_filter") { yield chunk; continue; }
      const to = !wrote ? target() : null;
      const note = { model: entry.id, reason: String(choice.delta?.refusal || "The model declined this request.").slice(0, 300), fallbackModel: to?.id || null, streamed: true, ...(wrote ? { partial: true } : {}) };
      console.warn(`[ai] model_refusal (stream) on ${entry.id}${to ? ` — continuing on ${to.id}` : ""}`);
      yield { choices: [], model_refusal: note };
      if (!to) { yield chunk; continue; }
      try { for await (const c of await second(to)) yield c; }
      catch (e) { yield { choices: [], model_refusal: { ...note, fallbackError: String(e?.message || e).slice(0, 200) } }; yield chunk; }
    }
  })();
  if (source && source.controller) gen.controller = source.controller;
  return gen;
}

// Rough token estimate for streamed prompts (~4 chars/token).
function estimateTokens(messages) {
  try {
    const text = (messages || []).map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content || "")).join(" ");
    return Math.max(1, Math.ceil(text.length / 4));
  } catch { return 500; }
}

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
