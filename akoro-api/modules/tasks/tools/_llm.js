// modules/tasks/tools/_llm.js
// Small shared OpenAI helper for tool executors — keeps each tool concise.

import { openai, OPENAI_MODEL } from "../../../lib/aiModel.js";
import { parseJsonLoose } from "./_json.js";

const MODEL = OPENAI_MODEL;

export async function llmText(prompt, { system, maxTokens = 2048, model = MODEL } = {}) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const resp = await openai.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages,
  });
  return resp.choices?.[0]?.message?.content ?? "";
}

export async function llmJson(prompt, opts = {}) {
  const text = await llmText(
    prompt + "\n\nRespond with valid JSON only — no markdown fences, no preamble.",
    opts
  );
  return parseJsonLoose(text);
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
