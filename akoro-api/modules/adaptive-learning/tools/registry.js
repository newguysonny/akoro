/**
 * study-prep tool registry (Master Plan §4.2). The union catalogue from the
 * two v2.1 docs, organised by permission level:
 *
 *   read     — agent may call freely (bounded, no state change, no cost)
 *   propose  — agent proposes; the harness validates and executes
 *   execute  — harness-executed only when a hard gate passes (cost / caps)
 *
 * Harness-only operations (practice.score, wallet.charge, session.transition,
 * evidence.append) are deliberately ABSENT from the registry the model sees —
 * the agent can request practice; only the harness charges and transitions.
 *
 * The registry is a definition list + a binder: buildRegistry({readTools,
 * harness}) wires db-backed handlers. Definitions are pure (testable without
 * db); handlers throw HarnessRejection with stable codes on denial.
 */

import { bindRegistry } from "../../agent-runtime/tools.js";
import { RULES } from "../../agent-runtime/actionBasis.js";
import { STRATEGY_LIBRARY } from "../study-prep/education-engine.js";

// Study Prep's levels (the runtime adds `persona`; Study Prep has none yet).
export const TOOL_LEVELS = Object.freeze(["read", "propose", "execute"]);

const str = (description) => ({ type: "string", description });
const TOPIC_ID = str("A topic id exactly as syllabus.resolve returned it.");
const TOPIC_LIST = { type: "array", items: { type: "string" }, description: "Topic ids exactly as syllabus.resolve returned them, in teaching order." };
const obj = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });

/**
 * The arguments each tool reads (what `execute` below passes on). The model
 * is given these — without them it guessed names ("level" for classLevel)
 * and was never told propose_plan takes `topics`, so no plan was ever made.
 */
export const TOOL_ARGS = Object.freeze({
  // In a session the harness resolves for the session's own subject and class, so none is required.
  "syllabus.resolve": obj({ subject: str("The school subject, e.g. 'Basic Science'."), classLevel: str("The class, e.g. 'JSS1'."), exam: str("Exam board, e.g. 'WAEC'. Optional.") }),
  "learner.get_state": obj({ subject: str("The school subject."), topics: TOPIC_LIST }, ["subject"]),
  "learner.get_history": obj({ subject: str("The school subject.") }),
  "learner.get_relevant_memory": obj({ subject: str("The school subject.") }),
  "concept.get_prerequisites": obj({ subject: str("The school subject.") }, ["subject"]),
  "topic.related_covered": obj({ subject: str("The school subject."), topic: str("The topic about to be planned or started.") }, ["subject", "topic"]),
  "content.search": obj({ subject: str("The school subject."), query: str("What to search for.") }, ["query"]),
  "session.get_state": obj(),
  "syllabus.generate": obj(),
  "plan.validate": obj({ topics: TOPIC_LIST }, ["topics"]),
  "propose_plan": obj({ topics: TOPIC_LIST }, ["topics"]),
  "offer_strategy": obj({ topicId: TOPIC_ID, strategy: { type: "string", enum: [...STRATEGY_LIBRARY] } }, ["topicId", "strategy"]),
  "request_teaching": obj({ topicId: TOPIC_ID, strategy: { type: "string", enum: [...STRATEGY_LIBRARY] }, focusGaps: { type: "array", items: { type: "string" }, description: "What the check found missing, in a few words each (default: the check's gaps)." }, peerExplanations: { type: "array", items: { type: "string" }, description: "Optional: short explanations from peers who overcame the same struggle." } }, ["topicId", "strategy"]),
  "advance_topic": obj(),
  "defer_topic": obj({ topicId: TOPIC_ID, reasonCode: str("Why, e.g. 'attempt_cap_reached'.") }, ["topicId", "reasonCode"]),
  "topic.flag": obj({ topicId: TOPIC_ID, reason: str("A short reason.") }, ["topicId", "reason"]),
  "session.replan": obj({ topics: TOPIC_LIST }, ["topics"]),
  "conclude_session": obj(),
  "topic.get_notes": obj({ topicId: str("The topic's id from session.get_state (default: the active topic).") }),
  "wait_for_learner": obj({ waitingFor: str("What you are waiting for, e.g. 'the Agent Check' or 'their approval'.") }),
  "practice.generate": obj({ topicId: TOPIC_ID, mode: { type: "string", enum: ["diagnostic", "retest"] } }, ["topicId", "mode"]),
  "practice.submit": obj({ topicId: TOPIC_ID, answers: { type: "array", items: obj({ questionId: str("Question id."), answerIndex: { type: "integer" } }, ["questionId", "answerIndex"]) } }, ["topicId", "answers"]),
  // Agent Check names (§7.12) — the same operations as practice.generate / topic.get_notes.
  "practice.run_agent_check": obj({ topicId: TOPIC_ID, mode: { type: "string", enum: ["diagnostic", "retest"] } }, ["topicId", "mode"]),
  "agent.get_knowledge_coverage": obj({ topicId: str("The topic's id from session.get_state (default: the active topic).") }),
  // §8.8 the learner's own files and non-school goals.
  "materials.list": obj(),
  "materials.search": obj({ query: str("What to look for in the learner's files.") }, ["query"]),
  "syllabus.from_documents": obj({ folderId: str("A materials folder id from materials.list (default: the session's folder, else the learner's newest upload).") }),
  "learner.request_materials": obj({ reason: str("One sentence the learner will see: why their syllabus or past questions would help.") }, ["reason"]),
});

/** Pure catalogue — names, levels, and what the model is told. */
export const TOOL_DEFINITIONS = Object.freeze([
  { name: "syllabus.resolve", level: "read", description: "List the syllabus topics for the session's subject, most specific first: the learner's own class syllabus at their school (with each topic's term and whether it was covered), else their school's, else Akoro's platform syllabus. Says which (source). A plan may only contain topics from this list." },
  { name: "syllabus.generate", level: "execute", description: "ONLY when syllabus.resolve returned no topics (no class, school or platform syllabus): draft an outline for the session's subject and class from the national curriculum (reused if one was drafted before). The plan is then made from these topics, and the learner sees it labelled as an AI-drafted outline. Refused when a real syllabus exists." },
  { name: "learner.get_state", level: "read", description: "Read the learner's recorded 0-1 mastery estimates for the subject's topics. Missing topics have no evidence yet." },
  { name: "learner.get_history", level: "read", description: "Read a bounded list of the learner's recent exam-prep runs: topic, status, score, attempts." },
  { name: "learner.get_relevant_memory", level: "read", description: "Retrieve a few relevant recorded learning memories (evidence kinds and summaries) — targeted retrieval, never a full history dump." },
  { name: "concept.get_prerequisites", level: "read", description: "Read approved prerequisite edges between topics. Prerequisite order is a hard constraint on plans." },
  { name: "topic.related_covered", level: "read", description: "Topics this learner has already covered that connect to a topic (its prerequisites, and topics sharing its ideas), how well each is held, and prerequisites not covered yet — to decide where to start and whether to warm up one step lower." },
  { name: "content.search", level: "read", description: "Search approved educational content grounded on the syllabus (internal stores only, never the open web). Disabled in the first loop release." },
  { name: "session.get_state", level: "read", description: "Read the current study session: status, goal, topics with their states, and recent activity. The agent sees the same state the harness does." },
  { name: "plan.validate", level: "read", description: "Dry-run the harness plan checks on an ordered topic list: syllabus membership, duplicates, prerequisite order, size cap, and the cost estimate." },
  { name: "propose_plan", level: "propose", description: "Propose the ordered study plan (terminal action during planning). The harness validates hard constraints; the LEARNER confirms on the plan card before anything is charged." },
  { name: "offer_strategy", level: "propose", description: `Offer one strategy from the Strategy Library (${STRATEGY_LIBRARY.join(", ")}) for the active topic. The learner chooses whether to use it.` },
  { name: "request_teaching", level: "propose", description: `After a missed check (topic state intervention_required): hand the topic to a teaching session (D15) with one strategy from the Strategy Library (${STRATEGY_LIBRARY.join(", ")}) and the gaps to focus on. The learner teaches you there; the retest unlocks when it is finished (terminal action). If it is refused with teaching_unavailable, use offer_strategy instead.` },
  { name: "advance_topic", level: "propose", description: "Propose moving to the next queued topic (terminal action). Only valid when the active topic is settled." },
  { name: "defer_topic", level: "propose", description: "Propose deferring the active topic with a reason code (terminal action). One deferred retry per session, attempts reset." },
  { name: "topic.flag", level: "propose", description: "Propose flagging the active topic as a knowledge gap with a short reason." },
  { name: "session.replan", level: "propose", description: "Propose replanning the remaining topics from the current session state." },
  { name: "conclude_session", level: "propose", description: "Propose concluding the session with a summary of what was understood (terminal action)." },
  { name: "topic.get_notes", level: "read", description: "How much the learner has taught you on a topic (the notes the Agent Check answers from): a count and a strength (none, thin, good). No charge." },
  { name: "wait_for_learner", level: "propose", description: "End this turn: you have said what happens next and are waiting for the learner (or for the Agent Check that starts by itself). Use it whenever there is nothing more to do now." },
  { name: "practice.generate", level: "execute", description: "Generate practice for the active topic (mode: diagnostic or retest). Costs coins — charged by the harness BEFORE generation; a retest additionally requires the learner's teach-back confirmation." },
  { name: "practice.submit", level: "execute", description: "Submit the learner's answers for the open practice. The Education Engine scores deterministically; the LLM never scores." },
  // Agent Check (§7.12): the plan's names. NaNa asks, the learner's agent answers ONLY from their notes, Sergeant judges.
  { name: "practice.run_agent_check", level: "execute", description: "Run an Agent Check on the active topic (mode: diagnostic or retest): NaNa asks, the learner's agent answers only from what they taught it, Sergeant judges. Costs coins — charged by the harness first; a retest also needs the learner's teach-back. If agent.get_knowledge_coverage says none, teach first instead." },
  { name: "agent.get_knowledge_coverage", level: "read", description: "How much the learner has taught their agent on a topic (the notes the Agent Check answers from): a count and a strength (none, thin, good). No model call, no charge. Check it before an Agent Check." },
  // §8.8 files and non-traditional goals.
  { name: "materials.list", level: "read", description: "The learner's uploaded materials for this session (or their newest uploads if the session has none yet): each file, what kind it is (past paper, notes, syllabus) and whether it has been read." },
  { name: "materials.search", level: "read", description: "Search inside the learner's uploaded materials for a word or idea; returns short passages with the file name and page. Use it to ground a plan or a question in their own files." },
  { name: "syllabus.from_documents", level: "execute", description: "Build the session's outline from the learner's uploaded files (their topics, most-tested first; drafted from the text when the files have no topic list). The plan is then made from these topics and labelled 'Outline drawn from your files'. Use before syllabus.generate whenever materials.list shows files." },
  { name: "learner.request_materials", level: "propose", description: "Ask the learner ONCE per session for their syllabus, handbook or past questions (for a goal that is not a school exam and has no syllabus on Akoro). Puts an upload request in their Suggestions; then tell them and call wait_for_learner." },
]);

/**
 * Older names the agent may still call (wake prompts, saved plans): accepted
 * and run as their §7.12 name, but not offered in the catalogue twice.
 */
export const TOOL_ALIASES = Object.freeze({
  "practice.generate": "practice.run_agent_check",
  "topic.get_notes": "agent.get_knowledge_coverage",
});

/** Names the MODEL may never see or call — harness-internal by design (S2 §8). */
export const HARNESS_ONLY_OPERATIONS = Object.freeze([
  "practice.score", "wallet.charge", "session.transition", "evidence.append",
]);

export function toolByName(name) {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name) || null;
}

/** The LLM-facing catalogue: every definition EXCEPT harness-only (which are
 *  not definitions at all) — content.search stays listed but is gated off
 *  in the loop config until enabled (Decision 14). */
export function llmFacingTools({ includeContentSearch = false } = {}) {
  return TOOL_DEFINITIONS
    .filter((tool) => tool.name !== "content.search" || includeContentSearch)
    .filter((tool) => !TOOL_ALIASES[tool.name])
    .map((tool) => ({ name: tool.name, level: tool.level, description: tool.description, args: TOOL_ARGS[tool.name] || obj() }));
}

/**
 * Bind handlers. `readTools` are the db-backed read functions; `harness` is
 * the study-prep harness; `learnerId`/`sessionId` scope every call. Returns
 * the shared runtime registry (agent-runtime/tools.js): { catalogue,
 * validate, execute(toolName, args, intent), display } — one dispatcher the
 * agent loop uses, with the generic checks in front of every handler.
 */
export function buildRegistry({ readTools, harness, learnerId, sessionId, contentSearchEnabled = false }) {
  const s = { sessionId, learnerId };
  const handlers = {
    // In a session the harness resolves it (class → school → platform) and records the source.
    "syllabus.resolve": (args) => (sessionId && harness?.resolveSyllabus
      ? harness.resolveSyllabus(s)
      : readTools.resolveSyllabus({ subject: args.subject, classLevel: args.classLevel, exam: args.exam })),
    "syllabus.generate": (_args, intent) => harness.generateSyllabus({ ...s, intent }),
    "learner.get_state": (args) => readTools.getLearnerState({ learnerId, subject: args.subject, topicIds: args.topics }),
    "learner.get_history": (args) => readTools.getLearnerHistory({ learnerId, subject: args.subject }),
    "learner.get_relevant_memory": (args) => readTools.getRelevantMemory({ learnerId, subject: args.subject }),
    "concept.get_prerequisites": (args) => readTools.getPrerequisites({ subject: args.subject }),
    "topic.related_covered": (args) => readTools.getRelatedCovered ? readTools.getRelatedCovered({ learnerId, subject: args.subject, topic: args.topic }) : { related: [], prerequisitesNotCovered: [] },
    "content.search": (args) => readTools.searchContent({ subject: args.subject, query: args.query }),
    "session.get_state": () => readTools.getSessionState(s),
    "plan.validate": (args) => harness.validateProposedPlan({ ...s, topicIds: args.topics }),
    "propose_plan": (args, intent) => harness.proposePlan({ ...s, topicIds: args.topics, intent }),
    "offer_strategy": (args, intent) => harness.offerStrategy({ ...s, topicId: args.topicId, strategy: args.strategy, intent }),
    "request_teaching": (args, intent) => harness.requestTeaching({ ...s, topicId: args.topicId, strategy: args.strategy, focusGaps: args.focusGaps, peerExplanations: args.peerExplanations, intent }),
    "advance_topic": (_args, intent) => harness.advanceTopic({ ...s, intent }),
    "defer_topic": (args, intent) => harness.deferTopic({ ...s, topicId: args.topicId, reasonCode: args.reasonCode, intent }),
    "topic.flag": (args, intent) => harness.flagTopic({ ...s, topicId: args.topicId, reason: args.reason, intent }),
    "session.replan": (args, intent) => harness.proposePlan({ ...s, topicIds: args.topics, intent }),
    "conclude_session": (_args, intent) => harness.concludeSession({ ...s, intent }),
    // The agent stays inside the coins the learner approved; past it, the learner is asked.
    "practice.generate": (args, intent) => harness.startTopicPractice({ ...s, topicId: args.topicId, mode: args.mode, intent, withinEstimateOnly: true }),
    "topic.get_notes": (args) => harness.topicNotes({ ...s, topicId: args.topicId || null }),
    // §7.12 names for the same operations: the Agent Check (charged by the harness) and the free coverage read.
    "practice.run_agent_check": (args, intent) => harness.startTopicPractice({ ...s, topicId: args.topicId, mode: args.mode, intent, withinEstimateOnly: true }),
    "agent.get_knowledge_coverage": (args) => harness.topicNotes({ ...s, topicId: args.topicId || null }),
    // §8.8: every one loads the session as its owner first (harness ownedSession).
    "materials.list": () => harness.listMaterials(s),
    "materials.search": (args) => harness.searchMaterials({ ...s, query: args.query }),
    "syllabus.from_documents": (args, intent) => harness.syllabusFromDocuments({ ...s, folderId: args.folderId || null, intent }),
    "learner.request_materials": (args, intent) => harness.requestMaterials({ ...s, reason: args.reason, intent }),
    "wait_for_learner": (args) => ({ waiting: true, for: String(args.waitingFor || "the learner").slice(0, 80) }),
    "practice.submit": (args, intent) => harness.submitPractice({ ...s, topicId: args.topicId, answers: args.answers, intent }),
  };
  const registry = bindRegistry({
    definitions: TOOL_DEFINITIONS, args: TOOL_ARGS, harnessOnly: HARNESS_ONLY_OPERATIONS, handlers,
    // content.search stays a definition but is offered only once enabled (Decision 14).
    isEnabled: (name) => name !== "content.search" || contentSearchEnabled,
    // The agent's own moves (Phase 18 item 6): inferred, allowed by Study Prep's workflow policy —
    // the learner started the session and confirms the plan card; coins and gates stay the harness's.
    basis: { basis: "inferred", rule: RULES.workflow("study_prep") },
  });
  // The aliases stay callable; the agent is shown each operation once, under its §7.12 name.
  return { ...registry, catalogue: registry.catalogue.filter((tool) => !TOOL_ALIASES[tool.name]) };
}
