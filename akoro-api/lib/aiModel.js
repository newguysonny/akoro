/**
 * lib/aiModel.js
 * Single source of truth for the LLM the agent loops use — task tools, battle
 * question generation, adaptive chat tools, instructor tools and agentService.
 *
 * The platform standardises on OpenAI (the same key that already powers voice,
 * the tutor chat and the trained adaptive agents). Override the model with
 * OPENAI_MODEL; it defaults to the tutor-chat model.
 */
import OpenAI from "openai";
import { hasCoins, chargeForAI, InsufficientCoins } from "./coins.js";
import { aiContext } from "./aiContext.js";

export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
export { InsufficientCoins };

const rawClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Metered chat completion. The acting user comes from (in order): explicit
 * __userId on the params, else the AsyncLocalStorage request context. When a
 * user is resolved we HARD-BLOCK on an empty balance and debit the wallet by
 * the completion's real token usage × markup. No user (system/cron) → plain
 * call, unbilled. Charging is centralised HERE so no call site double-charges.
 */
async function meteredCreate(params = {}) {
  const store   = aiContext.getStore() || {};
  const userId  = params.__userId  ?? store.userId  ?? null;
  const feature = params.__feature ?? store.feature ?? "ai";
  const ref     = params.__ref     ?? null;
  const clean = { ...params };
  delete clean.__userId; delete clean.__feature; delete clean.__ref;

  if (userId) {
    const { ok, total } = await hasCoins(userId, 1);
    if (!ok) throw new InsufficientCoins(1, total);
  }

  const model = clean.model || OPENAI_MODEL;
  const charge = (usage) => chargeForAI({ userId, feature, model, usage, ref })
    .catch((e) => { if (!(e instanceof InsufficientCoins)) console.warn("[coins] charge failed:", e.message); });

  // Streamed calls: ask OpenAI for exact usage in a final chunk, then tee it
  // out of the stream and charge when iteration completes. Falls back to an
  // estimate if no usage chunk arrives (e.g. early abort).
  if (userId && clean.stream) {
    const source = await rawClient.chat.completions.create({
      ...clean,
      stream_options: { include_usage: true, ...(clean.stream_options || {}) },
    });
    const fallback = { prompt_tokens: estimateTokens(clean.messages), completion_tokens: Math.min(clean.max_tokens || 700, 700) };
    return meterStreamUsage(source, (usage) => charge(usage || fallback));
  }

  const res = await rawClient.chat.completions.create(clean);
  if (userId && res?.usage) charge(res.usage);
  return res;
}

// Passthrough async iterable that captures the stream's final usage chunk and
// charges once iteration ends. Forwards `.controller` for barge-in/abort.
function meterStreamUsage(source, onDone) {
  let usage = null;
  const gen = (async function* () {
    try {
      for await (const chunk of source) {
        if (chunk?.usage) usage = chunk.usage;   // final include_usage chunk
        yield chunk;
      }
    } finally {
      try { onDone(usage); } catch { /* billing must not break the stream */ }
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

// Proxy the client so `openai.chat.completions.create(...)` is metered
// everywhere it's already used, while embeddings/audio/etc. pass through.
export const openai = new Proxy(rawClient, {
  get(target, prop) {
    if (prop === "chat") return { completions: { create: meteredCreate } };
    const v = target[prop];
    return typeof v === "function" ? v.bind(target) : v;
  },
});

/** Convenience wrapper for background jobs that must name the payer explicitly. */
export async function meteredChat({ userId, feature = "ai", ref = null, ...params }) {
  return meteredCreate({ ...params, __userId: userId, __feature: feature, __ref: ref });
}

/**
 * llmComplete — one-shot chat completion returning plain text.
 * Mirrors the old Anthropic single-prompt helpers so call sites stay small.
 */
export async function llmComplete(prompt, { system, maxTokens = 2048, temperature, userId, feature = "ai" } = {}) {
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
