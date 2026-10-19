/**
 * agent-runtime/llm-agent.js — the production `agent` for the runtime loop
 * (Grand Plan §7.2). Wraps the model client into { next(step) }: ONE
 * structured tool call + a bounded intent per iteration. A malformed reply
 * becomes a malformed iteration the loop records and moves on from — the
 * model never gets to freestyle state.
 *
 *   makeLlmAgent({ system, catalogue, feature, learnerId, learnerChoice,
 *                  intentMaxChars, maxTokens, timeoutMs, finishHint, think })
 *
 * think: before each decision the agent writes its reasoning (what it knows,
 * what is missing, what this step should establish). Model-agnostic: it is a
 * field of the call, not a provider's reasoning API. The notes go back to the
 * agent with the next observations, so the analysis builds across the step's
 * decisions; they are never stored in events or shown (only the intent is).
 *
 * The model is the `controller` role's (lib/modelRegistry.js): the learner's
 * choice when they may make one, else the role's env default, else the
 * platform default. Safety lives in the harness, whichever model decides.
 *
 * Each workflow passes its own catalogue (agent-runtime/tools.js) and the
 * feature name it is billed under.
 */
import { openai } from "../../lib/aiModel.js";

/**
 * Registry names are dotted ("syllabus.resolve"); OpenAI function names must
 * match ^[a-zA-Z0-9_-]{1,64}$ or the whole call is rejected with a 400. The
 * model sees safe names; replies are mapped back to the registry's own names.
 */
export function providerToolName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export function makeLlmAgent({
  system, catalogue, feature, learnerId = null, learnerChoice = null, intentMaxChars = 240,
  maxTokens = 700, timeoutMs = 45_000, maxRetries = 1,
  finishHint = "This is your last step: finish now with the best you can make from what you found.",
  think = false, thinkMaxChars = 900,
}) {
  const toRegistry = new Map(catalogue.map((tool) => [providerToolName(tool.name), tool.name]));
  if (toRegistry.size !== catalogue.length) throw new Error(`${feature}: tool names collide once made provider-safe`);
  const tools = catalogue.map((tool) => ({
    type: "function",
    function: {
      name: providerToolName(tool.name),
      description: tool.description,
      parameters: {
        type: "object",
        properties: {
          ...(think ? { thinking: { type: "string", description: `Think it through first (max ${thinkMaxChars} characters): what you know so far, what is still missing or uncertain, and what this step should establish. Your notes come back to you on the next step.` } } : {}),
          intent: { type: "string", description: `One short sentence stating why you are doing this (max ${intentMaxChars} characters).` },
          args: { ...(tool.args || { type: "object" }), description: "The tool arguments." },
        },
        required: think ? ["thinking", "intent", "args"] : ["intent", "args"],
      },
    },
  }));

  return {
    catalogue,
    async next({ iteration, maxIterations = null, goal, observations, finalOnly = null }) {
      // Last iteration: only the actions that end the step are offered, so an
      // agent that spent its budget reading still finishes instead of being
      // cut off by the loop cap.
      const offered = finalOnly ? tools.filter((t) => finalOnly.includes(toRegistry.get(t.function.name))) : tools;
      const messages = [
        { role: "system", content: system },
        {
          role: "user",
          content: [
            `Goal: ${String(goal || "").slice(0, 300)}`,
            maxIterations
              ? `Iteration ${iteration} of ${maxIterations}.${finalOnly ? ` ${finishHint}` : " Read only what you need, then act — the step ends at the last iteration."}`
              : `Iteration: ${iteration}.`,
            ...(think && !finalOnly ? ["Research properly before you act: each step should add something you didn't know. Use what your notes and the observations already establish; don't repeat a read."] : []),
            observations.length
              ? `Observations so far:\n${observations.map((observation, index) => `${index + 1}. ${JSON.stringify(observation)}`).join("\n").slice(0, 6000)}`
              : "No observations yet — start by inspecting what you need.",
            "Choose exactly one tool for this iteration.",
          ].join("\n\n"),
        },
      ];
      const response = await openai.chat.completions.create({
        __role: "controller", ...(learnerChoice ? { __learnerChoice: learnerChoice } : {}),
        max_tokens: maxTokens, messages, tools: offered.length ? offered : tools, tool_choice: "required",
        __feature: feature, __timeoutMs: timeoutMs, __maxRetries: maxRetries,
        ...(learnerId ? { __userId: learnerId } : {}),
      });
      const call = response.choices?.[0]?.message?.tool_calls?.[0];
      if (!call?.function?.name) return { tool: null, action: null, args: {}, intent: null };
      // An unknown name stays as sent: the registry rejects it as an observation.
      const name = toRegistry.get(call.function.name) || call.function.name;
      try {
        const parsed = JSON.parse(call.function.arguments || "{}");
        const args = parsed?.args && typeof parsed.args === "object" ? parsed.args : parsed || {};
        // Propose actions ARE tool names in these registries.
        return {
          tool: name, action: name, args, intent: typeof parsed?.intent === "string" ? parsed.intent.slice(0, intentMaxChars) : null,
          ...(think && typeof parsed?.thinking === "string" ? { thinking: parsed.thinking.slice(0, thinkMaxChars) } : {}),
        };
      } catch {
        return { tool: name, action: name, args: {}, intent: null };
      }
    },
  };
}
