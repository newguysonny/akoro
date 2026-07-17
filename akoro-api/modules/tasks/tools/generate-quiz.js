// modules/tasks/tools/generate-quiz.js
// Generates quiz questions for a given topic and course.
// The agent calls this tool when the task type is "generate_quiz"
// or when the teacher asks for practice questions in a general task.

import Anthropic          from "@anthropic-ai/sdk";
import { z }              from "zod";
import { TaskOutputDB }   from "../lib/db.js";

import { v4 as uuid }     from "uuid";
import { ANTHROPIC_MODEL } from "../../../lib/aiModel.js";
import { parseJsonLoose } from "./_json.js";

// ─── Tool definition ──────────────────────────────────────────────────────────
// This is the shape the Anthropic API sees.

export const generateQuizDefinition = {
  name: "generate_quiz",
  description:
    "Generate quiz questions for a specific topic or module. " +
    "Produces MCQ, short answer, or mixed format questions with answer keys. " +
    "Use this whenever the teacher asks for a quiz, test, assessment, or practice questions.",
  input_schema: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The topic or concept to test, e.g. 'chain rule', 'integration by parts'",
      },
      courseId: {
        type: "string",
        description: "The course this quiz belongs to",
      },
      count: {
        type: "number",
        description: "Number of questions to generate (default: 10)",
      },
      difficulty: {
        type: "string",
        enum: ["easy", "medium", "hard", "mixed"],
        description: "Difficulty level (default: mixed)",
      },
      format: {
        type: "string",
        enum: ["mcq", "short_answer", "mixed"],
        description: "Question format (default: mcq)",
      },
      marksPerQuestion: {
        type: "number",
        description: "Marks per question (default: 2)",
      },
    },
    required: ["topic", "courseId"],
  },
};

// ─── Tool parameters ──────────────────────────────────────────────────────────

const paramsSchema = z.object({
  topic:            z.string(),
  courseId:         z.string(),
  count:            z.number().min(1).max(50).default(10),
  difficulty:       z.enum(["easy", "medium", "hard", "mixed"]).default("mixed"),
  format:           z.enum(["mcq", "short_answer", "mixed"]).default("mcq"),
  marksPerQuestion: z.number().default(2),
});

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeGenerateQuiz(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  // Call the LLM to actually write the questions
  const questions = await callLlmForQuestions(input);

  // Persist as a task output so delivery can pick it up
  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "quiz",
    content: {
      type:      "quiz",
      questions,
      topic:     input.topic,
      courseId:  input.courseId,
      totalMarks: questions.reduce((s, q) => s + q.marks, 0),
    },
    delivered: false,
  });

  return { success: true, questionCount: questions.length, questions };
}

// ─── LLM call to write the actual questions ────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function callLlmForQuestions(input) {
  const formatInstructions =
    input.format === "mcq"
      ? "All questions must be multiple-choice with exactly 4 options (A–D)."
      : input.format === "short_answer"
      ? "All questions must be short-answer requiring a written response of 1–3 sentences."
      : "Mix of multiple-choice and short-answer questions.";

  const difficultyInstructions =
    input.difficulty === "mixed"
      ? `Mix difficulties: roughly 30% easy, 50% medium, 20% hard.`
      : `All questions should be ${input.difficulty} difficulty.`;

  const prompt = `Generate ${input.count} quiz questions on the topic: "${input.topic}".

${formatInstructions}
${difficultyInstructions}
Each question is worth ${input.marksPerQuestion} marks.

Respond with a JSON array only — no markdown, no preamble:
[
  {
    "id": "<uuid>",
    "question": "<question text>",
    "type": "mcq" | "short_answer" | "true_false",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],  // mcq only, omit for short_answer
    "answer": "<correct answer or full model answer>",
    "explanation": "<why this is the answer>",
    "difficulty": "easy" | "medium" | "hard",
    "marks": ${input.marksPerQuestion}
  }
]`;

  const response = await anthropic.messages.create({
    model:      ANTHROPIC_MODEL,
    max_tokens: 4096,
    messages:   [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = parseJsonLoose(text);

  // Ensure all questions have valid UUIDs
  return parsed.map((q) => ({ ...q, id: q.id || uuid() }));
}
