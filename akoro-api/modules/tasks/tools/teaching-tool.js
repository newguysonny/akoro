// modules/tasks/tools/teaching-tool.js
//
// Bridges the eight teaching tools (Podcast, Misconceptions, Real-World
// Connections, Lesson Hooks, Vocabulary Builder, Lesson Plan,
// Assignment Creator) into the task engine, so a teacher can SCHEDULE them —
// "every Sunday, draft next week's lesson hooks for JSS1 Basic Science" —
// instead of only running them by hand in the workbench.
//
// It is one tool with a `tool` enum rather than eight definitions, for two
// reasons: the model picks better from a short list with one clear description
// than from eight near-identical ones, and a ninth teaching tool added to the
// catalog appears here automatically with no code change.
//
// The actual run goes through runTeachingTool() — the same function the HTTP
// route uses — so lock checks, charge-after billing and saving to the teacher's
// tool library behave identically whether a human or a schedule triggered it.

import { z }             from "zod";
import { TaskOutputDB }  from "../lib/db.js";
import { TOOLS, ToolError, getTeachingToolRunner } from "../../../lib/teachingTools.js";

const KEYS = TOOLS.map((t) => t.key);

// Every field any teaching tool accepts, so the model can fill in what a given
// tool needs without us maintaining a per-tool schema. runTeachingTool()
// validates required fields against the real catalog and ignores the rest.
const FIELD_HINTS = TOOLS
  .map((t) => `  • ${t.key} — ${t.name}: ${t.blurb} (fields: ${t.fields.map((f) => f.name).join(", ")})`)
  .join("\n");

export const teachingToolDefinition = {
  name: "run_teaching_tool",
  description:
    "Run one of the platform's teaching tools and save the result to the teacher's " +
    "tool library. Use this when the teacher asks for a podcast, common misconceptions, " +
    "real-world connections, lesson hooks, a vocabulary list, a lesson " +
    "plan, or an assignment.\n\nAvailable tools:\n" + FIELD_HINTS,
  input_schema: {
    type: "object",
    properties: {
      tool:    { type: "string", enum: KEYS, description: "Which teaching tool to run" },
      topic:   { type: "string", description: "The topic" },
      subject: { type: "string", description: "Subject, e.g. Basic Science" },
      class:   { type: "string", description: "Class or year group, e.g. JSS1" },
      notes:   { type: "string", description: "Any extra direction from the teacher" },
      // Tool-specific extras. Unknown keys are ignored by the runner, so listing
      // the common ones here costs nothing and lets the model be specific.
      minutes: { type: "string", description: "Podcast length in minutes: 3, 5 or 10" },
      hosts:   { type: "string", description: "Podcast format: 'Two hosts' or 'Single narrator'" },
    },
    required: ["tool"],
  },
};

const paramsSchema = z.object({
  tool: z.enum(KEYS),
}).passthrough();

export async function executeTeachingTool(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);
  const { tool, ...body } = input;

  let result;
  try {
    result = await getTeachingToolRunner()({ key: tool, body, userId: ctx.teacherId });
  } catch (e) {
    if (e instanceof ToolError) {
      // These are the teacher's problem to fix, not a crash: say which, so the
      // failed run reads as an instruction rather than a stack trace.
      const advice = {
        INSUFFICIENT_COINS: "Top up coins, then run this task again.",
        MISSING_FIELD:      "Add the missing detail to the task description.",
      }[e.code];
      return { success: false, tool, error: e.message, ...(advice ? { whatToDo: advice } : {}) };
    }
    throw e;
  }

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "teaching_tool",
    content:    { type: "teaching_tool", ...result },
    delivered:  false,
  });

  return {
    success:  true,
    tool,
    name:     result.name,
    title:    result.title ?? result.topic ?? result.name,
    // The full artifact is in the task output; the model only needs to know it
    // worked, so don't push a 3,000-token script back into the conversation.
    savedTo:  "the teacher's tool library",
    coinsCharged: result.coinsCharged ?? 0,
  };
}
