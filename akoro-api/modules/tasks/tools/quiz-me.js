// modules/tasks/tools/quiz-me.js
// Student-facing self-study quiz generator.

import { z }                       from "zod";
import { TaskDB, TaskOutputDB }    from "../lib/db.js";
import db                          from "../../../db.js";
import Anthropic                   from "@anthropic-ai/sdk";
import { v4 as uuid }              from "uuid";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const quizMeDefinition = {
  name: "quiz_me",
  description:
    "Generate self-study practice questions for the student on a given topic. " +
    "Use this when the student says 'quiz me', 'test me', or asks for practice questions.",
  input_schema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The topic to practise, e.g. 'photosynthesis', 'quadratic equations'",
      },
      count: {
        type: "number",
        description: "Number of questions to generate (default: 5)",
      },
      difficulty: {
        type: "string",
        enum: ["easy", "medium", "hard", "mixed"],
        description: "Difficulty level (default: mixed)",
      },
    },
    required: ["topic"],
  },
};

const paramsSchema = z.object({
  topic:      z.string(),
  count:      z.number().min(1).max(50).default(5),
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
});

export async function executeQuizMe(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  const task = await TaskDB.findById(ctx.taskId);
  const studentId = task?.creator_id;

  const questions = await callLlmForQuestions(input);

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "quiz",
    content: {
      type:      "quiz",
      questions,
      topic:     input.topic,
      studentId,
    },
    delivered: false,
  });

  return { success: true, questionCount: questions.length, questions };
}

async function callLlmForQuestions(input) {
  const difficultyInstructions =
    input.difficulty === "mixed"
      ? "Mix difficulties: roughly 30% easy, 50% medium, 20% hard."
      : `All questions should be ${input.difficulty} difficulty.`;

  const prompt = `Generate ${input.count} self-study practice questions on the topic: "${input.topic}".

${difficultyInstructions}

Respond with a JSON array only — no markdown, no preamble:
[
  {
    "id": "<uuid>",
    "question": "<question text>",
    "type": "mcq" | "short_answer" | "true_false",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
    "answer": "<correct answer or full model answer>",
    "explanation": "<why this is the answer>",
    "difficulty": "easy" | "medium" | "hard"
  }
]`;

  const response = await anthropic.messages.create({
    model:      "claude-sonnet-4-6",
    max_tokens: 4096,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = JSON.parse(text);
  return parsed.map((q) => ({ ...q, id: q.id || uuid() }));
}
