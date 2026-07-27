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

export const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export { InsufficientCoins };

/**
 * meteredChat — a coin-metered wrapper around openai.chat.completions.create.
 * Pass { userId, feature } to hard-block on empty balance and debit the coin
 * wallet by the completion's real token usage × markup. Without a userId it
 * behaves like a plain call (internal/system usage). Returns the full response.
 */
export async function meteredChat({ userId, feature = "ai", ...params }) {
  if (userId) {
    const { ok, total } = await hasCoins(userId, 1);
    if (!ok) throw new InsufficientCoins(1, total);
  }
  const res = await openai.chat.completions.create(params);
  if (userId && res?.usage) {
    await chargeForAI({ userId, feature, model: params.model || OPENAI_MODEL, usage: res.usage })
      .catch((e) => { if (!(e instanceof InsufficientCoins)) console.warn("[coins] charge failed:", e.message); });
  }
  return res;
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
