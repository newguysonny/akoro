// modules/tasks/tools/explain-concept.js
// Student-facing concept explainer.

import { z }                    from "zod";
import { TaskDB, TaskOutputDB } from "../lib/db.js";
import db                       from "../../../db.js";
import Anthropic                from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const explainConceptDefinition = {
  name: "explain_concept",
  description:
    "Explain a concept clearly to the student with an example. " +
    "Use this when the student asks to explain something, asks 'what is X', " +
    "'help me understand', or 'teach me'.",
  input_schema: {
    type: "object",
    properties: {
      concept: {
        type: "string",
        description: "The concept to explain, e.g. 'osmosis', 'the chain rule'",
      },
      level: {
        type: "string",
        description: "The education level to pitch the explanation at (default: 'secondary')",
      },
      style: {
        type: "string",
        enum: ["simple", "detailed", "exam-focused"],
        description: "Explanation style (default: simple)",
      },
    },
    required: ["concept"],
  },
};

const paramsSchema = z.object({
  concept: z.string(),
  level:   z.string().default("secondary"),
  style:   z.enum(["simple", "detailed", "exam-focused"]).default("simple"),
});

export async function executeExplainConcept(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  const task = await TaskDB.findById(ctx.taskId);
  const studentId = task?.creator_id;

  const text = await callLlmForExplanation(input);

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "explanation",
    content: {
      type:    "explanation",
      concept: input.concept,
      text,
      studentId,
    },
    delivered: false,
  });

  return { success: true, explanation: text };
}

async function callLlmForExplanation(input) {
  const styleInstructions =
    input.style === "detailed"
      ? "Give a thorough, detailed explanation."
      : input.style === "exam-focused"
      ? "Focus on what is needed to answer exam questions, including key terms and common pitfalls."
      : "Keep it simple and easy to understand.";

  const prompt = `Explain the concept "${input.concept}" to a ${input.level}-level student.
${styleInstructions}
Include at least one clear, concrete example.
Respond with the explanation text only — no preamble, no markdown headings.`;

  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 2048,
    messages:   [{ role: "user", content: prompt }],
  });

  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
