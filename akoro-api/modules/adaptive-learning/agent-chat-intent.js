/**
 * Server-side safeguards for requests that must be grounded in a real Akoro
 * tool result. This is not browser routing and it never authors the response:
 * every learner request still reaches the one /agent prompt/tool loop.
 */
const CAPABILITY_QUESTION = /\b(?:what\s+(?:can|do)\s+(?:you|the\s+agent|akoro)\s+do|what\s+(?:abilit(?:y|ies)|capabilit(?:y|ies)|features?)\s+(?:does|can)\s+(?:the\s+agent|akoro|you)\s+(?:have|offer|do)|what(?:'s|\s+is|\s+are)\s+(?:your|the\s+agent(?:'s)?|akoro(?:'s)?)?\s*(?:abilit(?:y|ies)|capabilit(?:y|ies)|features?)|(?:your|the\s+agent(?:'s)?|akoro(?:'s)?)\s*(?:abilit(?:y|ies)|capabilit(?:y|ies)|features?)|what\s+are\s+you\s+able\s+to\s+do|how\s+can\s+(?:you|the\s+agent|akoro)\s+help)\b/i;

/**
 * Capability answers must be based on the live feature-aware catalogue instead
 * of a model's general recollection. The resulting learner-facing prose still
 * comes from the model after it has received the tool result.
 */
export function requiresAgentCapabilitiesTool(message) {
  return CAPABILITY_QUESTION.test(String(message || "").replace(/\s+/g, " ").trim());
}
