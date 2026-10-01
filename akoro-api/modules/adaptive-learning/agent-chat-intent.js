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

/* ── Learner-data identity questions ────────────────────────────────────────
   The live hallucination transcript (2026-10-01): asked "What subjects do we
   have in the class?", the model answered from general knowledge — tools=0 —
   and invented a subject list. A question about the learner's OWN school,
   class, subjects, teachers, or progress is a fact question about data the
   model cannot see: the reply must come from a tool result. These guards let
   the route FORCE the matching read tool on iteration 0, exactly like the
   capabilities force. Conversation that merely MENTIONS a topic ("my teacher
   said…", "I hate my subjects") never forces — only identity questions do. */
// Checked BEFORE the school-catalogue question: "what subjects have I LEARNT"
// is about the learner's own teaching/learning history with their agent, not
// the school's subject catalogue — conflating the two produced the 2026-10-01
// "subjects you have learned" reply that listed the school catalogue instead.
const MY_LEARNING_HISTORY_QUESTION = /\b(?:what|which)\s+subjects?\s+(?:have\s+i|i['\u2019]ve)\s+(?:learnt|learned|studied|covered|taught)\b|\bwhat\s+have\s+i\s+(?:learnt|learned|studied)\b|\btopics?\s+have\s+i\s+(?:learnt|learned|covered|studied)\b|\bmy\s+learning\s+(?:sessions?|history)\b/i;
const SCHOOL_SUBJECTS_QUESTION = /\b(?:what|which)\s+subjects?\b|\bsubjects?\s+(?:do|does|are|have|has)\b|\bsubjects?\s+in\s+(?:my|our|the)\s+(?:class|school)\b|\blist\s+(?:the\s+|all\s+)?subjects\b/i;
const MY_TEACHERS_QUESTION = /\bwho\s+(?:is|are)\s+my\s+teacher|\bwho\s+teaches\b|\bwhich\s+teacher\b|\bwhat(?:'s|\s+is)\s+my\s+teacher\b|\blist\s+my\s+teachers\b/i;
const MY_SCHOOL_QUESTION = /\bmy\s+school\b(?!\s+fees?)|\bwhich\s+school\b|\bwhat\s+school\b|\bschool\s+(?:name|info|profile|details)\b|\babout\s+(?:my|the|our)\s+school\b/i;
const MY_PROGRESS_QUESTION = /\bhow\s+am\s+i\s+doing\b|\bmy\s+progress\b|\bhow\s+(?:is|was)\s+my\s+progress\b/i;

export function requiredLearnerDataTool(message) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (MY_LEARNING_HISTORY_QUESTION.test(text)) return "get_my_learning_sessions";
  if (SCHOOL_SUBJECTS_QUESTION.test(text)) return "list_school_subjects";
  if (MY_TEACHERS_QUESTION.test(text)) return "list_my_teachers";
  if (MY_SCHOOL_QUESTION.test(text)) return "get_my_school";
  if (MY_PROGRESS_QUESTION.test(text)) return "check_progress";
  return null;
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
