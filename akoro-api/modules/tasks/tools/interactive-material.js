// modules/tasks/tools/interactive-material.js
// Catalog tool: "Interactive Material" (key: interactive) — Gamma.app.
// Orchestration: topic → structured interactive deck content, then (if a Gamma
// API key is configured) kick off a Gamma generation and attach its URL.

import { z } from "zod";
import { TaskOutputDB } from "../lib/db.js";
import { llmJson, llmText } from "./_llm.js";
import { saveToolOutput } from "./_store.js";

export const interactiveMaterialDefinition = {
  name: "interactive_material",
  description:
    "Turn a lesson into interactive material — a structured slide deck with " +
    "activities and check-for-understanding questions, optionally published to " +
    "Gamma. Use when the teacher asks for interactive slides / presentation / deck.",
  input_schema: {
    type: "object",
    properties: {
      topic:     { type: "string", description: "Lesson topic for the deck" },
      subject:   { type: "string", description: "Subject" },
      slideCount:{ type: "number", description: "Approx number of slides (default 8)" },
      audience:  { type: "string", description: "Audience/level, e.g. 'SS2 Biology class'" },
    },
    required: ["topic"],
  },
};

const schema = z.object({
  topic:      z.string(),
  subject:    z.string().default("General"),
  slideCount: z.number().min(3).max(25).default(8),
  audience:   z.string().default("secondary school class"),
});

// Best-effort Gamma generation. Returns { generationId, url } or null.
async function tryGamma(topic, deckText) {
  const key = process.env.GAMMA_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://public-api.gamma.app/v0.2/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": key },
      body: JSON.stringify({
        inputText: deckText,
        format: "presentation",
        textMode: "preserve",
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return { generationId: data.generationId || data.id || null, url: data.gammaUrl || data.url || null };
  } catch {
    return null;
  }
}

export async function executeInteractiveMaterial(rawInput, ctx) {
  const input = schema.parse(rawInput);

  const deck = await llmJson(
    `Design an interactive slide deck.
Topic: "${input.topic}" · Subject: ${input.subject} · Audience: ${input.audience}
Target ~${input.slideCount} slides.

Return JSON:
{
  "title": "<deck title>",
  "slides": [
    { "n": 1, "heading": "<slide title>", "bullets": ["<point>", ...],
      "activity": "<optional interactive activity>", "checkQuestion": "<optional CFU question>" }
  ]
}`,
    { maxTokens: 3000 }
  );

  // Build a plain-text outline Gamma can consume, then try to publish.
  const deckText = `# ${deck.title}\n\n` +
    (deck.slides || []).map((s) =>
      `## ${s.heading}\n${(s.bullets || []).map((b) => `- ${b}`).join("\n")}` +
      (s.activity ? `\nActivity: ${s.activity}` : "") +
      (s.checkQuestion ? `\nCheck: ${s.checkQuestion}` : "")
    ).join("\n\n");

  const gamma = await tryGamma(input.topic, deckText);

  await TaskOutputDB.create({
    runId: ctx.runId, taskId: ctx.taskId,
    outputType: "interactive",
    content: {
      type: "interactive", tool: "interactive_material",
      subject: input.subject, ...deck,
      gamma: gamma || null,
      gammaPending: !!(gamma && gamma.generationId && !gamma.url),
    },
    delivered: false,
  });

  const savedId = await saveToolOutput({
    ctx, tool: "interactive_material", kind: "interactive",
    title: deck.title, subject: input.subject,
    content: { ...deck, gamma: gamma || null },
  });

  return { success: true, id: savedId, title: deck.title, slides: deck.slides?.length ?? 0, gamma: !!gamma };
}

// Exported in case a delivery step wants a narrative summary.
export async function summariseDeck(deck) {
  return llmText(`Summarise this lesson deck in 2 sentences for the teacher:\n${JSON.stringify(deck).slice(0, 2000)}`, { maxTokens: 200 });
}
