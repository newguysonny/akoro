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
  "content.search": obj({ subject: str("The school subject."), query: str("What to search for.") }, ["query"]),
  "session.get_state": obj(),
  "syllabus.generate": obj(),
  "plan.validate": obj({ topics: TOPIC_LIST }, ["topics"]),
  "propose_plan": obj({ topics: TOPIC_LIST }, ["topics"]),
  "offer_strategy": obj({ topicId: TOPIC_ID, strategy: { type: "string", enum: [...STRATEGY_LIBRARY] } }, ["topicId", "strategy"]),
  "advance_topic": obj(),
  "defer_topic": obj({ topicId: TOPIC_ID, reasonCode: str("Why, e.g. 'attempt_cap_reached'.") }, ["topicId", "reasonCode"]),
  "topic.flag": obj({ topicId: TOPIC_ID, reason: str("A short reason.") }, ["topicId", "reason"]),
  "session.replan": obj({ topics: TOPIC_LIST }, ["topics"]),
  "conclude_session": obj(),
  "topic.get_notes": obj({ topicId: str("The topic's id from session.get_state (default: the active topic).") }),
  "wait_for_learner": obj({ waitingFor: str("What you are waiting for, e.g. 'the Agent Check' or 'their approval'.") }),
  "practice.generate": obj({ topicId: TOPIC_ID, mode: { type: "string", enum: ["diagnostic", "retest"] } }, ["topicId", "mode"]),
  "practice.submit": obj({ topicId: TOPIC_ID, answers: { type: "array", items: obj({ questionId: str("Question id."), answerIndex: { type: "integer" } }, ["questionId", "answerIndex"]) } }, ["topicId", "answers"]),
});

/** Pure catalogue — names, levels, and what the model is told. */
export const TOOL_DEFINITIONS = Object.freeze([
  { name: "syllabus.resolve", level: "read", description: "List the syllabus topics for the session's subject, most specific first: the learner's own class syllabus at their school (with each topic's term and whether it was covered), else their school's, else Akoro's platform syllabus. Says which (source). A plan may only contain topics from this list." },
  { name: "syllabus.generate", level: "execute", description: "ONLY when syllabus.resolve returned no topics (no class, school or platform syllabus): draft an outline for the session's subject and class from the national curriculum (reused if one was drafted before). The plan is then made from these topics, and the learner sees it labelled as an AI-drafted outline. Refused when a real syllabus exists." },
  { name: "learner.get_state", level: "read", description: "Read the learner's recorded 0-1 mastery estimates for the subject's topics. Missing topics have no evidence yet." },
  { name: "learner.get_history", level: "read", description: "Read a bounded list of the learner's recent exam-prep runs: topic, status, score, attempts." },
  { name: "learner.get_relevant_memory", level: "read", description: "Retrieve a few relevant recorded learning memories (evidence kinds and summaries) — targeted retrieval, never a full history dump." },
  { name: "concept.get_prerequisites", level: "read", description: "Read approved prerequisite edges between topics. Prerequisite order is a hard constraint on plans." },
  { name: "content.search", level: "read", description: "Search approved educational content grounded on the syllabus (internal stores only, never the open web). Disabled in the first loop release." },
  { name: "session.get_state", level: "read", description: "Read the current study session: status, goal, topics with their states, and recent activity. The agent sees the same state the harness does." },
  { name: "plan.validate", level: "read", description: "Dry-run the harness plan checks on an ordered topic list: syllabus membership, duplicates, prerequisite order, size cap, and the cost estimate." },
  { name: "propose_plan", level: "propose", description: "Propose the ordered study plan (terminal action during planning). The harness validates hard constraints; the LEARNER confirms on the plan card before anything is charged." },
  { name: "offer_strategy", level: "propose", description: `Offer one strategy from the Strategy Library (${STRATEGY_LIBRARY.join(", ")}) for the active topic. The learner chooses whether to use it.` },
  { name: "advance_topic", level: "propose", description: "Propose moving to the next queued topic (terminal action). Only valid when the active topic is settled." },
  { name: "defer_topic", level: "propose", description: "Propose deferring the active topic with a reason code (terminal action). One deferred retry per session, attempts reset." },
  { name: "topic.flag", level: "propose", description: "Propose flagging the active topic as a knowledge gap with a short reason." },
  { name: "session.replan", level: "propose", description: "Propose replanning the remaining topics from the current session state." },
  { name: "conclude_session", level: "propose", description: "Propose concluding the session with a summary of what was understood (terminal action)." },
  { name: "topic.get_notes", level: "read", description: "How much the learner has taught you on a topic (the notes the Agent Check answers from): a count and a strength (none, thin, good). No charge." },
  { name: "wait_for_learner", level: "propose", description: "End this turn: you have said what happens next and are waiting for the learner (or for the Agent Check that starts by itself). Use it whenever there is nothing more to do now." },
  { name: "practice.generate", level: "execute", description: "Generate practice for the active topic (mode: diagnostic or retest). Costs coins — charged by the harness BEFORE generation; a retest additionally requires the learner's teach-back confirmation." },
  { name: "practice.submit", level: "execute", description: "Submit the learner's answers for the open practice. The Education Engine scores deterministically; the LLM never scores." },
]);

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
    "content.search": (args) => readTools.searchContent({ subject: args.subject, query: args.query }),
    "session.get_state": () => readTools.getSessionState(s),
    "plan.validate": (args) => harness.validateProposedPlan({ ...s, topicIds: args.topics }),
    "propose_plan": (args, intent) => harness.proposePlan({ ...s, topicIds: args.topics, intent }),
    "offer_strategy": (args, intent) => harness.offerStrategy({ ...s, topicId: args.topicId, strategy: args.strategy, intent }),
    "advance_topic": (_args, intent) => harness.advanceTopic({ ...s, intent }),
    "defer_topic": (args, intent) => harness.deferTopic({ ...s, topicId: args.topicId, reasonCode: args.reasonCode, intent }),
    "topic.flag": (args, intent) => harness.flagTopic({ ...s, topicId: args.topicId, reason: args.reason, intent }),
    "session.replan": (args, intent) => harness.proposePlan({ ...s, topicIds: args.topics, intent }),
    "conclude_session": (_args, intent) => harness.concludeSession({ ...s, intent }),
    // The agent stays inside the coins the learner approved; past it, the learner is asked.
    "practice.generate": (args, intent) => harness.startTopicPractice({ ...s, topicId: args.topicId, mode: args.mode, intent, withinEstimateOnly: true }),
    "topic.get_notes": (args) => harness.topicNotes({ ...s, topicId: args.topicId || null }),
    "wait_for_learner": (args) => ({ waiting: true, for: String(args.waitingFor || "the learner").slice(0, 80) }),
    "practice.submit": (args, intent) => harness.submitPractice({ ...s, topicId: args.topicId, answers: args.answers, intent }),
  };
  return bindRegistry({
    definitions: TOOL_DEFINITIONS, args: TOOL_ARGS, harnessOnly: HARNESS_ONLY_OPERATIONS, handlers,
    // content.search stays a definition but is offered only once enabled (Decision 14).
    isEnabled: (name) => name !== "content.search" || contentSearchEnabled,
    // The agent's own moves (Phase 18 item 6): inferred, allowed by Study Prep's workflow policy —
    // the learner started the session and confirms the plan card; coins and gates stay the harness's.
    basis: { basis: "inferred", rule: RULES.workflow("study_prep") },
  });
}
