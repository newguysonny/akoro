// modules/tasks/tools/_llm.js
// Small shared Anthropic helper for tool executors — keeps each tool concise.

import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_MODEL } from "../../../lib/aiModel.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = ANTHROPIC_MODEL;

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

// Shared pedagogy enrichment — appended to teaching-content prompts so outputs
// drive active participation and varied learning experiences.
export const ENRICHMENT =
  "Enrich the content with practical activities that ensure students' active " +
  "participation in class and provide various learning experiences. Explicitly " +
  "include: Real World Connections (where this applies in everyday life), Lesson " +
  "Hooks (an engaging way to spark curiosity at the start), and Common " +
  "Misconceptions (mistakes students often make and how to address them).";

export { MODEL };
