/**
 * Server-side safeguards for requests that must be grounded in a real Akoro
 * tool result. This is not browser routing and it never authors the response:
 * every learner request still reaches the one /agent prompt/tool loop.
 */
const CAPABILITY_QUESTION = /\b(?:can\s+you\s+(?:research|search|access|browse|communicate\s+with|talk\s+to)|do\s+you\s+have\s+(?:access\s+to|any\s+way\s+to)|what\s+(?:can|do)\s+(?:you|the\s+agent|akoro)\s+do|what\s+(?:abilit(?:y|ies)|capabilit(?:y|ies)|features?)\s+(?:does|can)\s+(?:the\s+agent|akoro|you)\s+(?:have|offer|do)|what(?:'s|\s+is|\s+are)\s+(?:your|the\s+agent(?:'s)?|akoro(?:'s)?)?\s*(?:abilit(?:y|ies)|capabilit(?:y|ies)|features?)|(?:your|the\s+agent(?:'s)?|akoro(?:'s)?)\s*(?:abilit(?:y|ies)|capabilit(?:y|ies)|features?)|what\s+are\s+you\s+able\s+to\s+do|how\s+can\s+(?:you|the\s+agent|akoro)\s+help)\b/i;

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

/* Three kinds of message that are NOT a request for a new activity draft,
   though they can look like one (found by the instructor-chat gate scenarios:
   each used to start a stray draft alongside the right tool):
     · a Library resource for the teaching tools — "make a lesson plan…",
       "give me lesson hooks…" (run_teaching_tool, saved to the Library);
     · a recurring ask — "every Friday, prepare…" (schedule_activity_routine);
     · managing a draft or routine that exists — "show me that draft",
       "cancel that routine", "discard it". */
const TEACHING_RESOURCE_RE = /\b(?:lesson\s+plans?|lesson\s+hooks?|vocab(?:ulary)?\s+(?:list|builder)|podcast|misconceptions?|homework\s+sheets?|work\s?sheets?|handouts?|real[-\s]?world\s+connections?|essay\s+grad(?:er|ing)|grade\s+(?:this|these|the)\s+essays?)\b/i;
const RECURRING_RE = /\b(?:every|each)\s+(?:day|week|weekday|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|\bweekly\b/i;
const DRAFT_MANAGE_RE = /^\s*(?:please\s+)?(?:show|open|read|view|list|display|see|cancel|discard|scrap|stop|pause|resume|delete|remove|drop)\b[^.?!]{0,40}\b(?:drafts?|routines?|it|that|this|them)\b/i;
// A resource request that also names an activity for learners ("an assignment from my lesson plan") is
// still an activity. "questions" alone doesn't make one: "a homework sheet with 10 questions" is a resource.
const STRONG_ACTIVITY_NOUN_RE = /\b(?:assignments?|quiz(?:zes)?|tests?|projects?|self[-\s]?study|live\s+(?:course|class|lesson|session)|battles?|journeys?|multi[-\s]?stage)\b/i;
// Whichever is asked for FIRST decides: "lesson hooks … direction: a journey through time" is hooks
// (the later words describe them); "an assignment from my lesson plan" is an assignment.
const isTeachingResource = (text) => {
  const r = String(text).search(TEACHING_RESOURCE_RE);
  if (r < 0) return false;
  const a = String(text).search(STRONG_ACTIVITY_NOUN_RE);
  return a < 0 || r < a;
};
// "Make it a hard battle", "turn this into…": the pronoun points at the pending draft, so it is an edit
// even when the sentence also names an activity ("a hard battle" is not a NEW one).
const POINTS_AT_DRAFT_RE = /^\s*(?:(?:please|now|also|and|then|ok(?:ay)?|can\s+you|could\s+you)[\s,!.]+)*(?:make|turn|change|set|keep|use)\s+(?:it|this|that|the\s+draft)\b/i;

export function requiresActivityPreparation(message, history = []) {
  const text = String(message || "").trim();
  if (!text) return false;
  // "Quiz me on Algebra" is tutoring in chat, not a draft request.
  if (/^\s*(?:quiz|test)\s+me\b/i.test(text)) return false;
  if (isTeachingResource(text) || RECURRING_RE.test(text) || DRAFT_MANAGE_RE.test(text)) return false;
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

/* Follow-ups on a draft the instructor already has. "Add a new part with 2
   true or false questions" names "questions", so the prepare force above
   started a SECOND draft for every follow-up (verify authoring run
   98993a9f): version 2 never existed. An edit-shaped message — an editing
   verb, or a pointer at a question/part/version — while a draft is pending
   revises it instead; a message that asks for a new activity still prepares. */
const NEW_ACTIVITY_RE = /\b(?:a|an|another|new|second|fresh|separate)\s+(?:[\w-]+\s+){0,2}(?:assignments?|quiz(?:zes)?|tests?|projects?|activit(?:y|ies)|self[-\s]?study|battles?|journeys?|live\s+(?:course|class|lesson|session))\b/i;
const DRAFT_EDIT_RE = /^\s*(?:(?:please|now|also|and|then|ok(?:ay)?|great|good|nice|thanks|thank\s+you|next|can\s+you|could\s+you)[\s,!.]+)*(?:add|make|change|turn|convert|remove|delete|drop|replace|swap|rewrite|reword|rephrase|shorten|simplify|increase|reduce|lower|raise|give|set|move|put|split|merge|include|revert|undo|fix|correct|edit|update|use|go\s+back|bring\s+back|keep|let'?s\s+(?:add|make|change|remove|replace|go\s+back))\b/i;
const DRAFT_POINTER_RE = /\b(?:question|q|number|no\.)\s*\d+\b|\bversion\s*\d+\b|\bv\d+\b|\bpart\s+[a-e]\b/i;

export function isDraftFollowUp(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  if (POINTS_AT_DRAFT_RE.test(text) && !isTeachingResource(text)) return true;
  if (ACTIVITY_QUERY_RE.test(text) || NEW_ACTIVITY_RE.test(text)) return false;
  // A new Library resource, or a discard/cancel, is not an edit of the pending draft.
  if (isTeachingResource(text) || /^\s*(?:please\s+)?(?:cancel|discard|scrap)\b/i.test(text)) return false;
  return DRAFT_EDIT_RE.test(text) || DRAFT_POINTER_RE.test(text);
}

/* A follow-up on a pending TEACHING-RESOURCE draft. "Make the hooks more playful" names the
   resource ("hooks") so the general check above reads it as a NEW request; with a resource draft
   pending it is an edit of that draft — unless the instructor asks for another one ("make a
   podcast on …", "give me a new lesson plan"). */
const NEW_RESOURCE_ASK_RE = /\b(?:make|create|give|write|generate|build|prepare|run|do)\s+(?:me\s+|us\s+)?(?:a|an|another|new|some|\d+)\b/i;
export function isToolDraftFollowUp(message) {
  const text = String(message || "").trim();
  if (!text || NEW_RESOURCE_ASK_RE.test(text)) return false;
  if (/^\s*(?:please\s+)?(?:cancel|discard|scrap)\b/i.test(text)) return false;
  return DRAFT_EDIT_RE.test(text) || DRAFT_POINTER_RE.test(text) || POINTS_AT_DRAFT_RE.test(text);
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
   feature gate keeps the tools in the list.

   2026-10-03 — the live WASSCE transcript: "I have WASSCE Physics in three
   weeks, help me prepare" forced nothing, because the patterns only knew
   the generic test/exam/paper nouns and tomorrow/this/next week. Learners
   name the exam (WASSCE, WAEC, NECO, JAMB/UTME, GCE, NABTEB, IGCSE, BECE,
   common entrance) and the time ("in three weeks", "in 2 weeks", "in a
   month"). The nouns and timings are shared fragments now, and an
   exam-noun-first request frame ("…WASSCE…, help me prepare") forces too.
   SAT/ACT stay out: as bare English words they over-match. */

// The exam nouns learners actually use. "sat"/"act" deliberately excluded.
const EXAM_NOUN = String.raw`(?:test|exam|paper|wassce|waec|neco|jamb|utme|gce|nabteb|igcse|jsce|bece|common\s+entrance|toefl|ielts)`;
// Real timing phrasings, not just tomorrow/this/next week.
const EXAM_TIMING = String.raw`(?:tomorrow|this\s+week|next\s+week|next\s+month|coming\s+up|in\s+(?:[0-9]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|a\s+few|couple\s+of)\s*(?:days?|weeks?|months?|fortnights?))`;
const PREP_VERB = String.raw`(?:plan|prepare|prep|revise|revision|study|practise|practice|get\s+ready)`;

const STUDY_PREP_READ_RE = new RegExp(String.raw
  `\b(?:study[\s-]?prep|exam[\s-]?prep|prep\s+session|(?:wassce|waec|neco|jamb|utme|gce|nabteb|igcse)[\s-]?prep)\b[^.?!]{0,48}\b(?:status|progress|going|update|left off|where were we)\b`
  + String.raw`|\b(?:how|where)\b[^.?!]{0,40}\b(?:study[\s-]?prep|exam[\s-]?prep)\b`
  + String.raw`|\b(?:continue|resume|back to|carry on with)\b[^.?!]{0,40}\b(?:study[\s-]?prep|exam[\s-]?prep|my\s+prep|(?:wassce|waec|neco|jamb|utme|gce|nabteb|igcse)[\s-]?prep)\b`, "i");
// Request shapes: prep verb before the exam noun; the explicit compounds;
// noun → timing → verb ("my exam is coming up, help me plan"); and the
// noun-first explicit request frame ("I have WASSCE Physics in three weeks,
// help me prepare"). Bare mentions never match — the offer + confirmation
// force below catches the yes.
const STUDY_PREP_REQUEST_RE = new RegExp(String.raw
  `\b${PREP_VERB}\b[^.?!]{0,64}\b${EXAM_NOUN}s?\b`
  + String.raw`|\b(?:exam|test)[\s-]?prep\b`
  + String.raw`|\b${EXAM_NOUN}\b[^.?!]{0,40}\b${EXAM_TIMING}\b[^.?!]{0,40}\b(?:plan|prepare|prep|study|help|revise|start)\b`
  + String.raw`|\b${EXAM_NOUN}s?\b[^.?!]{0,80}\b(?:help\s+me\s+${PREP_VERB}|(?:want|need)\s+to\s+${PREP_VERB}|let's\s+${PREP_VERB}|can\s+you\s+(?:help\s+me\s+)?(?:prep|prepare|revise))\b`, "i");
// "How do/should I prepare for my exam?" is a prep request in question form,
// not a factual query — the session's plan is the real answer to it.
const STUDY_PREP_HOW_RE = new RegExp(String.raw`^how\s+(?:do|should|can|would)\s+(?:i|we)\b[^.?!]{0,64}\b${EXAM_NOUN}s?\b`, "i");
// Pure factual queries about tests never start a session ("When is my exam?").
const STUDY_PREP_QUERY_RE = /^\s*(?:when|who|where|show|list|see|view|check|did|has|have|is|are|was|were)\b/i;
// A bare mention ("I have a Biology test tomorrow", "my JAMB is in 2 weeks")
// never forces on its own — the agent offers the session and the
// confirmation force below catches the yes.
const UPCOMING_TEST_MENTION_RE = new RegExp(String.raw
  `\b${EXAM_NOUN}s?\b[^.?!]{0,48}\b${EXAM_TIMING}\b`
  + String.raw`|\b${EXAM_NOUN}\b[^.?!]{0,32}\b(?:tomorrow|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b`, "i");

// "Cancel the plan" / "stop my study prep" — never read as a yes to starting one (2026-10-19).
const STUDY_PREP_CANCEL_RE = /\b(?:cancel|stop|end|delete|remove|discard|scrap|drop|get\s+rid\s+of)\b[^.?!]{0,32}\b(?:(?:study\s+)?plan|study[\s-]?prep|exam[\s-]?prep|prep\s+session|session)\b/i;

export function requiredStudyPrepTool(message, history = []) {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (STUDY_PREP_CANCEL_RE.test(text)) return "cancel_study_prep_session";
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

/** The class an exam is usually taken in, when the learner didn't say (study prep's syllabus needs one). */
export function classForExam(examBoard) {
  const exam = String(examBoard || "").trim().toUpperCase();
  if (["WAEC", "WASSCE", "NECO", "JAMB", "UTME", "GCE", "NABTEB"].includes(exam)) return "SS3";
  if (["BECE", "JSCE"].includes(exam)) return "JSS3";
  return null;
}
