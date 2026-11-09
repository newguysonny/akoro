// modules/tasks/tools/submit-capability-request.js
// The surfacing half of the capability-request loop for the teacher/instructor
// task agent: when a task needs an executor the platform lacks, the agent offers
// to file a structured request for engineering. Submits only on confirmation.

import { z }                    from "zod";
import { TaskDB, TaskOutputDB } from "../lib/db.js";
import db                       from "../../../db.js";

export const submitCapabilityRequestDefinition = {
  name: "submit_capability_request",
  description:
    "File a feature request for a capability the platform does not have yet " +
    "(a missing tool executor or learning component). Use ONLY when the user " +
    "asks for something your tools genuinely cannot do and you cannot honestly " +
    "approximate it. First explain what is missing and offer to file the " +
    "request; only submit after the user explicitly confirms.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        description: "One line: what the user wanted.",
      },
      source: {
        type: "string",
        enum: ["executor", "component", "other"],
        description: "Which registry is missing the capability.",
      },
      missing_capability: {
        type: "string",
        description: "What the platform lacks, specifically.",
      },
      closest_match: {
        type: "string",
        description: "Closest existing tools/components you found.",
      },
      description: {
        type: "string",
        description: "The user's fuller request or context.",
      },
      user_confirmed: {
        type: "boolean",
        description: "True only if the user explicitly agreed to file the request.",
      },
    },
    required: ["intent", "missing_capability", "user_confirmed"],
  },
};

const paramsSchema = z.object({
  intent:             z.string().min(1).max(300),
  source:             z.enum(["executor", "component", "other"]).default("other"),
  missing_capability: z.string().min(1).max(2000),
  closest_match:      z.string().max(1000).optional(),
  description:        z.string().max(5000).optional(),
  user_confirmed:     z.boolean(),
});

export async function executeSubmitCapabilityRequest(rawInput, ctx) {
  const input = paramsSchema.parse(rawInput);

  if (!input.user_confirmed) {
    return { success: false, message: "Not filed — the user has not confirmed." };
  }

  const task   = await TaskDB.findById(ctx.taskId);
  const userId = task?.creator_id ?? null;

  const { error } = await db.from("capability_requests").insert({
    user_id:            userId,
    agent_id:           task?.agent_id ?? null,
    source:             input.source,
    intent:             input.intent,
    missing_capability: input.missing_capability,
    closest_match:      input.closest_match ?? null,
    description:        input.description ?? null,
  });
  if (error) return { success: false, message: error.message };

  await TaskOutputDB.create({
    runId:      ctx.runId,
    taskId:     ctx.taskId,
    outputType: "message",
    content: {
      type: "message",
      text:  `Feature request filed: "${input.intent}". The Akoro team will review it.`,
      tool:  "submit_capability_request",
    },
    delivered: false,
  });

  return { success: true };
}
