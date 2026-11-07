/**
 * study-prep LLM agent (production): the shared runtime agent
 * (agent-runtime/llm-agent.js) with Study Prep's catalogue, billing feature
 * and limits. Propose actions arrive as a call to the matching tool name
 * (propose_plan, advance_topic, defer_topic, conclude_session,
 * offer_strategy, topic.flag, session.replan).
 */
import { makeLlmAgent as makeRuntimeAgent, providerToolName } from "../../agent-runtime/llm-agent.js";
import { llmFacingTools } from "../tools/registry.js";
import { POLICY } from "./state-machine.js";
import { pickFields } from "../../workflows/modelPicks.js";

export { providerToolName };

/**
 * workflowId: the Study Prep workflow — its learner's model pick (Scenario K,
 * workflows/modelPicks.js) is asked before each decision and billed at its price.
 * pick: an injected pick source (tests); defaults to the app's.
 */
export function makeLlmAgent({ system, contentSearchEnabled = false, learnerId = null, feature = "study_prep_planning", maxTokens = 1600, finishHint = null, payer = null, ref = null, workflowId = null, pick = null }) {
  return makeRuntimeAgent({
    system, learnerId,
    pick: pick || (learnerId && payer !== "platform" ? () => pickFields({ learnerId, workflow: workflowId, role: "controller" }) : null),
    catalogue: llmFacingTools({ includeContentSearch: contentSearchEnabled }),
    // Think (2026-10-19): it reasons before each of its (up to 10) decisions.
    feature, payer, ref, timeoutMs: 60_000, maxRetries: 1, maxTokens, think: true, talk: true,
    intentMaxChars: POLICY.INTENT_MAX_CHARS,
    finishHint: finishHint || "This is your last step: finish now with the best plan you can make from what you found.",
  });
}
