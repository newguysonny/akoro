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

/* ── Instructor activity preparation ────────────────────────────────────────
   An instructor's activity request must produce a prepare_activity call, but
   a small model left on tool_choice:auto detours into writing sample
   questions as chat prose or inventing extra requirements ("how many
   questions?"), and a bare "Proceed" then loses the thread entirely. These
   guards let the route FORCE the tool on the first iteration for exactly two
   shapes: a fresh request, or a short confirmation/answer continuing one.
   Instructor-only (never consulted for learners), and a forced call is
   HITL-safe anyway — worst case it clarifies or creates a discardable draft. */
const ACTIVITY_NOUN_RE = /\b(?:assignments?|quiz(?:zes)?|tests?|projects?|self[-\s]?study|live\s+(?:course|class|lesson|session)|battles?|activit(?:y|ies)|journeys?|multi[-\s]?stage|questions?)\b/i;
// Query-shaped messages ABOUT activities are reads, not creation requests.
const ACTIVITY_QUERY_RE = /^\s*(?:show|list|see|view|check|open|display|what|which|where|how|when|who|did|has|have\s+i|do\s+i|results?|outcomes?)\b/i;
const SHORT_CONFIRM_RE = /^\s*(?:yes|yeah|yep|yup|ok(?:ay)?|proceed|go\s+ahead|continue|do\s+it|sure|please\s+do|use\s+(?:that|the)\s+class|that'?s\s+(?:fine|good|correct|right)|correct|exactly|sounds\s+good|perfect)[\s!.]*$/i;
const SHORT_ANSWER_RE = /^(?:\w+[\s,.!?]*){1,6}$/;

export function requiresActivityPreparation(message, history = []) {
  const text = String(message || "").trim();
  if (!text) return false;
  // "Quiz me on Algebra" is tutoring in chat, not a draft request.
  if (/^\s*(?:quiz|test)\s+me\b/i.test(text)) return false;
  if (!ACTIVITY_QUERY_RE.test(text) && ACTIVITY_NOUN_RE.test(text)) return true;
  // A short confirmation/answer only ever CONTINUES a request that exists in
  // recent conversation — it can never start one.
  const pending = (Array.isArray(history) ? history : []).slice(-10)
    .some((m) => m?.role === "user" && ACTIVITY_NOUN_RE.test(String(m.content || ""))
      && !ACTIVITY_QUERY_RE.test(String(m.content || "").trim()));
  if (!pending) return false;
  if (SHORT_CONFIRM_RE.test(text)) return true;
  return !text.includes("?") && SHORT_ANSWER_RE.test(text);
}
