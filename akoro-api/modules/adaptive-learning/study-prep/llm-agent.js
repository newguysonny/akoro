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
/**
 * Registry names are dotted ("syllabus.resolve"); OpenAI function names must
 * match ^[a-zA-Z0-9_-]{1,64}$ or the whole call is rejected with a 400 — which
 * left every planning step dead. The model sees safe names; replies are
 * mapped back to the registry's own names.
 */
export function providerToolName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export function makeLlmAgent({ system, contentSearchEnabled = false, learnerId = null }) {
  const catalogue = llmFacingTools({ includeContentSearch: contentSearchEnabled });
  const toRegistry = new Map(catalogue.map((tool) => [providerToolName(tool.name), tool.name]));
  if (toRegistry.size !== catalogue.length) throw new Error("study-prep tool names collide once made provider-safe");
  const tools = catalogue.map((tool) => ({
    type: "function",
    function: {
      name: providerToolName(tool.name),
      description: tool.description,
      parameters: {
        type: "object",
        properties: {
          intent: { type: "string", description: `One short sentence stating why you are doing this (max ${POLICY.INTENT_MAX_CHARS} characters).` },
          args: { ...(tool.args || { type: "object" }), description: "The tool arguments." },
        },
        required: ["intent", "args"],
      },
    },
  }));

  return {
    catalogue,
    async next({ iteration, maxIterations = null, goal, observations, finalOnly = null }) {
      // Last iteration: only the actions that end the step are offered, so a
      // planner that spent its budget reading still proposes instead of
      // being cut off by the loop cap.
      const offered = finalOnly
        ? tools.filter((t) => finalOnly.includes(toRegistry.get(t.function.name)))
        : tools;
      const messages = [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            `Goal: ${String(goal || "").slice(0, 300)}`,
            maxIterations
              ? `Iteration ${iteration} of ${maxIterations}.${finalOnly ? " This is your last step: finish now with the best plan you can make from what you found." : " Read only what you need, then act — the step ends at the last iteration."}`
              : `Iteration: ${iteration}.`,
            observations.length
              ? `Observations so far:\n${observations.map((observation, index) => `${index + 1}. ${JSON.stringify(observation)}`).join("\n").slice(0, 6000)}`
              : "No observations yet — start by inspecting what you need.",
            "Choose exactly one tool for this iteration.",
          ].join("\n\n"),
        },
      ];
      const response = await openai.chat.completions.create({
        model: OPENAI_MODEL, max_tokens: 700, messages, tools: offered.length ? offered : tools, tool_choice: "required",
        __feature: "study_prep_planning", __timeoutMs: 45_000, __maxRetries: 1,
        ...(learnerId ? { __userId: learnerId } : {}),
      });
      const call = response.choices?.[0]?.message?.tool_calls?.[0];
      if (!call?.function?.name) return { tool: null, action: null, args: {}, intent: null };
      // An unknown name stays as sent: the registry rejects it as an observation.
      const name = toRegistry.get(call.function.name) || call.function.name;
      let args = {};
      try {
        const parsed = JSON.parse(call.function.arguments || "{}");
        args = parsed?.args && typeof parsed.args === "object" ? parsed.args : parsed || {};
        return {
          tool: name,
          action: name, // propose actions ARE tool names in this registry
          args,
          intent: typeof parsed?.intent === "string" ? parsed.intent.slice(0, POLICY.INTENT_MAX_CHARS) : null,
        };
      } catch {
        return { tool: name, action: name, args: {}, intent: null };
      }
    },
  };
}
