/**
 * lib/aiModel.js
 * Single source of truth for the LLM the agent loops use — task tools, battle
 * question generation, adaptive chat tools, instructor tools and agentService.
 *
 * The platform standardises on OpenAI (the same key that already powers voice,
 * the tutor chat and the trained adaptive agents). Override the model with
 * OPENAI_MODEL; it defaults to the tutor-chat model.
 */
import { embeddingsProvider, runpodEmbeddings, SELF_HOSTED_MODEL } from "./embeddingProvider.js";
import OpenAI from "openai";
import { coinsAvailable, chargeForAI, InsufficientCoins } from "./coins.js";
import { makeAiBreaker } from "./circuitBreaker.js";
import { aiContext } from "./aiContext.js";
import { AI_DEFAULT_MAX_TOKENS, usdCost, cachedTokensOf } from "./aiPricing.js";
import { recordAiCall, errorKindOf } from "./aiTelemetry.js";
import { modelRegistry, forcedModelFor } from "./modelRegistry.js";
import { makeOpenAICompatibleAdapter } from "./providers/openaiCompatible.js";
import { makeAnthropicAdapter } from "./providers/anthropic.js";

// The default model (lib/modelRegistry.js: AI_MODEL_DEFAULT, legacy OPENAI_MODEL,
// else gpt-4o-mini). New code names a role (`__role`) instead of importing this.
export const OPENAI_MODEL = modelRegistry.defaultId;

// Providers other than OpenAI, behind the same call path (§7.11.4).
const adapters = { openai_compatible: makeOpenAICompatibleAdapter(), anthropic: makeAnthropicAdapter() };
export { InsufficientCoins };

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
  let entry = clean.model
    ? (modelRegistry.get(clean.model) || modelRegistry.catalogue.find((e) => e.apiModel === clean.model) || null)
    : modelRegistry.resolveModel({ role: params.__role || "chat", learnerChoice: params.__learnerChoice || null, allowedModels: params.__allowedModels || null });
  // AI_FORCE_MODEL (a test sandbox switch, e.g. OpenAI out of credit): every
  // chat call that would go to OpenAI is served by this catalogue model instead.
  const forced = forcedModelFor(entry, clean.model);
  if (forced) entry = forced;
  if (entry) clean.model = entry.apiModel;
  const adapter = entry && entry.provider !== "openai" ? adapters[entry.provider] : null;
  const fire = (body, opts) => (adapter ? adapter.create(body, opts, entry) : chatBreaker.fire(body, opts));
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
  const charge = (usage) => chargeForAI({ userId, feature, model, usage, ref, billTo })
    .catch((e) => { if (!(e instanceof InsufficientCoins)) console.warn("[coins] charge failed:", e.message); });

  // Every call is TIMED, whether or not it is billed. Cost and tokens used to
  // be recorded only by the wallet debit, so a system or cron call — no payer,
  // no debit — left no trace at all, and latency was recorded nowhere.
  const started = Date.now();
  const report = (usage, { ttfbMs = null, streamed = false, ok = true, errorKind = null } = {}) => {
    const tokensIn  = usage?.prompt_tokens ?? 0;
    const tokensOut = usage?.completion_tokens ?? 0;
    const cachedIn  = usage ? cachedTokensOf(usage) : 0;
    recordAiCall({
      feature, model, ms: Date.now() - started, ttfbMs,
      tokensIn, tokensOut, cachedIn,
      costUsd: usage ? usdCost(model, tokensIn, tokensOut, cachedIn) : null,
      userId, ref, streamed, ok, errorKind,
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
    } catch (e) { report(null, { streamed: true, ok: false, errorKind: errorKindOf(e) }); throw e; }

    const fallback = { prompt_tokens: estimateTokens(clean.messages), completion_tokens: Math.min(clean.max_tokens || 700, 700) };
    return meterStreamUsage(source, (usage, ttfbMs) => {
      // Time to FIRST chunk is the number a user feels; total is what the bill
      // is made of. Kept apart, because averaging them hides the difference.
      report(usage || (bills ? fallback : null), { ttfbMs, streamed: true });
      if (bills) charge(usage || fallback);
    });
  }

  let res;
  try {
    res = await fire(clean, reqOpts);
  } catch (e) { report(null, { ok: false, errorKind: errorKindOf(e) }); throw e; }

  report(res?.usage ?? null);
  if (bills && res?.usage) charge(res.usage);
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
  const res = await embeddingsBreaker.fire(clean);
  if ((userId || billTo) && res?.usage) {
    chargeForAI({ userId, feature, billTo, model: res.model === SELF_HOSTED_MODEL ? SELF_HOSTED_MODEL : clean.model || "text-embedding-3-small", usage: { prompt_tokens: res.usage.prompt_tokens ?? res.usage.total_tokens ?? 0, completion_tokens: 0 } })
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
