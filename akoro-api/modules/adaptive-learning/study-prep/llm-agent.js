/**
 * study-prep LLM agent adapter (production). Wraps the OpenAI client into
 * the `agent` interface the loop expects: ONE structured tool call (or
 * action) + a bounded intent per iteration. Malformed responses become
 * malformed iterations the loop records and moves on from — the model never
 * gets to freestyle state.
 */

import { OPENAI_MODEL, openai } from "../../../lib/aiModel.js";
import { llmFacingTools } from "../tools/registry.js";
import { POLICY } from "./state-machine.js";

/**
 * makeLlmAgent({ system }) → { next(step) }.
 * The tool catalogue is passed to the model as OpenAI function tools; the
 * model's tool_call is parsed into { tool, args, intent }. Propose actions
 * arrive as a call to the matching tool name (propose_plan, advance_topic,
 * defer_topic, conclude_session, offer_strategy, topic.flag, session.replan).
 * The one-sentence intent rides in `intent` (≤ 240 chars, harness-shaped).
 */
export function makeLlmAgent({ system, contentSearchEnabled = false }) {
  const catalogue = llmFacingTools({ includeContentSearch: contentSearchEnabled });
  const tools = catalogue.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: {
          intent: { type: "string", description: `One short sentence stating why you are doing this (max ${POLICY.INTENT_MAX_CHARS} characters).` },
          args: { type: "object", description: "The tool arguments." },
        },
        required: ["intent", "args"],
      },
    },
  }));

  return {
    catalogue,
    async next({ iteration, goal, observations }) {
      const messages = [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            `Goal: ${String(goal || "").slice(0, 300)}`,
            `Iteration: ${iteration}.`,
            observations.length
              ? `Observations so far:\n${observations.map((observation, index) => `${index + 1}. ${JSON.stringify(observation)}`).join("\n").slice(0, 6000)}`
              : "No observations yet — start by inspecting what you need.",
            "Choose exactly one tool for this iteration.",
          ].join("\n\n"),
        },
      ];
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL, max_tokens: 700, messages, tools, tool_choice: "required",
      });
      const call = response.choices?.[0]?.message?.tool_calls?.[0];
      if (!call?.function?.name) return { tool: null, action: null, args: {}, intent: null };
      let args = {};
      try {
        const parsed = JSON.parse(call.function.arguments || "{}");
        args = parsed?.args && typeof parsed.args === "object" ? parsed.args : parsed || {};
        return {
          tool: call.function.name,
          action: call.function.name, // propose actions ARE tool names in this registry
          args,
          intent: typeof parsed?.intent === "string" ? parsed.intent.slice(0, POLICY.INTENT_MAX_CHARS) : null,
        };
      } catch {
        return { tool: call.function.name, action: call.function.name, args: {}, intent: null };
      }
    },
  };
}
