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

/* ── Study-prep session requests ─────────────────────────────────────────────
   The live 2026-10-01 transcript: the learner asked "let's plan for a test"
   twice; start_study_prep_session was in the tool list both times and the
   model never called it — tools=0, a generic four-question planning
   questionnaire instead, no session, no plan card. Exam preparation is the
   study-prep workflow (Master Plan §4.8–4.9); left on tool_choice:auto a
   small model interviews the learner instead of starting it. These guards
   force the matching study-prep tool on iteration 0, exactly like the
   learner-data force. The route must apply them only while the study_prep
   feature gate keeps the tools in the list. */
const STUDY_PREP_READ_RE = /\b(?:study[\s-]?prep|exam[\s-]?prep|prep\s+session)\b[^.?!]{0,48}\b(?:status|progress|going|update|left off|where were we)\b|\b(?:how|where)\b[^.?!]{0,40}\b(?:study[\s-]?prep|exam[\s-]?prep)\b|\b(?:continue|resume|back to|carry on with)\b[^.?!]{0,40}\b(?:study[\s-]?prep|exam[\s-]?prep|my\s+prep)\b/i;
const STUDY_PREP_REQUEST_RE = /\b(?:plan|prepare|prep|revise|revision|study|practise|practice|get\s+ready)\b[^.?!]{0,64}\b(?:test|exam|paper)s?\b|\b(?:exam|test)[\s-]?prep\b|\b(?:test|exam)\b[^.?!]{0,40}\b(?:coming\s+up|next\s+week|next\s+month|tomorrow|this\s+week)\b[^.?!]{0,40}\b(?:plan|prepare|prep|study|help|revise|start)\b/i;
// "How do/should I prepare for my exam?" is a prep request in question form,
// not a factual query — the session's plan is the real answer to it.
const STUDY_PREP_HOW_RE = /^how\s+(?:do|should|can|would)\s+(?:i|we)\b[^.?!]{0,64}\b(?:test|exam|paper)s?\b/i;
// Pure factual queries about tests never start a session ("When is my exam?").
const STUDY_PREP_QUERY_RE = /^\s*(?:when|who|where|show|list|see|view|check|did|has|have|is|are|was|were)\b/i;
// A bare mention ("I have a Biology test tomorrow") never forces on its own —
// the agent offers the session and the confirmation force below catches the yes.
const UPCOMING_TEST_MENTION_RE = /\b(?:test|exam|paper)s?\b[^.?!]{0,48}\b(?:coming\s+up|next\s+week|next\s+month|tomorrow|this\s+week)\b|\b(?:test|exam)\b[^.?!]{0,32}\b(?:tomorrow|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b/i;

export function requiredStudyPrepTool(message, history = []) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  // "Quiz me on Algebra" / "test me on this" is tutoring in chat.
  if (/^\s*(?:quiz|test)\s+me\b/i.test(text)) return null;
  if (STUDY_PREP_READ_RE.test(text)) return "get_study_prep_session";
  if (!STUDY_PREP_QUERY_RE.test(text) && (STUDY_PREP_REQUEST_RE.test(text) || STUDY_PREP_HOW_RE.test(text))) {
    return "start_study_prep_session";
  }
  // A short confirmation/answer only ever CONTINUES an upcoming-test mention
  // already in the conversation — it can never start one on its own.
  const pending = (Array.isArray(history) ? history : []).slice(-10)
    .some((m) => m?.role === "user" && UPCOMING_TEST_MENTION_RE.test(String(m.content || ""))
      && !/^\s*(?:quiz|test)\s+me\b/i.test(String(m.content || "").trim()));
  if (!pending) return null;
  // Apostrophes ("let's do it") must not break the short-answer shapes.
  const plain = text.replace(/['\u2019]/g, "");
  // A short tutoring imperative or question ("explain photosynthesis",
  // "what is osmosis") is a different need, not a confirmation of the offer.
  if (/^\s*(?:explain|define|describe|teach|tell|quiz|solve|calculate|compute|what|why|how|when|where|who)\b/i.test(plain)) return null;
  if (SHORT_CONFIRM_RE.test(plain)) return "start_study_prep_session";
  return !plain.includes("?") && SHORT_ANSWER_RE.test(plain) ? "start_study_prep_session" : null;
}
