// modules/tasks/tools/_llm.js
// Small shared Anthropic helper for tool executors — keeps each tool concise.

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-sonnet-4-6";

export async function llmText(prompt, { system, maxTokens = 2048, model = MODEL } = {}) {
  const resp = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  return resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

export async function llmJson(prompt, opts = {}) {
  const text = await llmText(
    prompt + "\n\nRespond with valid JSON only — no markdown fences, no preamble.",
    opts
  );
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

export { MODEL };
