/**
 * study-prep production wiring (Master Plan §4.15 step 7-8). Composes the
 * harness with the supabase store, the exam-prep topic workflow, the
 * syllabus resolver, read tools and the LLM agent behind
 * AKORO_STUDY_PREP_ENABLED. Everything above this line is injectable and
 * contract-tested; this module is the only place with real dependencies.
 */

import {
  examPrepPolicyFor, publicAttempt, publicRun, startExamPrepRetest, startExamPrepRun, submitExamPrepAttempt,
} from "../exam-prep-service.js";
import { InsufficientBalanceError, createHarness } from "./harness.js";
import { supabaseStore as store } from "./store.js";
import { prerequisiteEdges, resolveTopics } from "./syllabus-resolver.js";
import { generateOutline, generatedTopics } from "./syllabus-generator.js";
import * as readToolsModule from "./read-tools.js";
import { makeLlmAgent } from "./llm-agent.js";
import { buildRegistry } from "../tools/registry.js";
import { buildAgentContext } from "./context-manager.js";
import { runAgentStep } from "./agent-loop.js";
import { pauseCopy } from "./narration.js";

// Default-on kill switch: study-prep ships enabled; =false removes every surface.
export const studyPrepEnabled = () => String(process.env.AKORO_STUDY_PREP_ENABLED ?? "true").toLowerCase() !== "false";

/** The topic workflow: the extracted exam-prep service, harness-driven. */
const topicWorkflow = {
  policyFor: async ({ examBoard, subject }) => examPrepPolicyFor(examBoard, subject),
  // prepaid: the harness charged the flat practice price first (and refunds it
  // if generation fails), so generation tokens are not billed again.
  startRun: async ({ learnerId, studyPrepTopicId, request }) => startExamPrepRun({ learnerId, request, studyPrepTopicId, prepaid: true }),
  submit: async ({ learnerId, runId, answers }) => submitExamPrepAttempt({ learnerId, runId, answers }),
  retest: async ({ learnerId, runId, learnerConfirmedReady }) => startExamPrepRetest({ learnerId, runId, learnerConfirmedReady, prepaid: true }),
  publicRun, publicAttempt,
};

// generateOutline / generatedTopics: the AI-drafted outline fallback (§8.7).
const syllabus = { resolveTopics, prerequisiteEdges, generateOutline, generatedTopics };

/**
 * D45: practice as an Agent Check battle. OFF until the learner UI for it is
 * reviewed — the current Study Prep card renders the human-answered practice,
 * and turning this on without the new card would change what learners see.
 * AKORO_STUDY_PREP_AGENT_CHECK=true turns it on.
 */
export const agentCheckEnabled = () => String(process.env.AKORO_STUDY_PREP_AGENT_CHECK ?? "false").toLowerCase() === "true";

/** The Agent Check behind the harness (battle/agentCheck.js + the learner's notes). */
const makeAgentCheck = ({ questions, secondsPerQuestion } = {}) => ({
  async coverage({ learnerId, topic, subject }) {
    const { embedQuestion, recall } = await import("../../battle/agentRecall.js");
    const embedding = await embedQuestion(topic);
    const notes = await recall({ studentId: learnerId, embedding, topic, queryText: topic, subject, limit: 4 });
    const n = notes?.length || 0;
    return { notes: n, strength: n === 0 ? "none" : n < 3 ? "thin" : "good" };
  },
  async start({ learnerId, subject, topic, studyPrepTopicId, mode }) {
    const { createCheckBattle } = await import("../../battle/agentCheck.js");
    return createCheckBattle({ learnerId, subject, topic, studyPrepTopicId, mode,
      ...(questions ? { total: questions } : {}), ...(secondsPerQuestion ? { secondsPerQuestion } : {}) });
  },
  async results(battleId) {
    const { checkResults } = await import("../../battle/agentCheck.js");
    return checkResults(battleId);
  },
});
const agentCheck = makeAgentCheck();

/** The protégé's messages: one chat thread per Study Prep session, carrying the battle to watch. */
const protege = {
  async say({ learnerId, session, text, battle }) {
    const { postIntoChat } = await import("../../self-tooling/escalation.js");
    return postIntoChat({
      userId: learnerId, conversationId: null, createId: session.id,
      title: `Study Prep: ${session.goal || session.subject || "your plan"}`.slice(0, 80),
      text, kind: "agent_check", meta: { battle },
    });
  },
};

export function getHarness() {
  return createHarness({ store, topicWorkflow, syllabus, ...(agentCheckEnabled() ? { agentCheck, protege } : {}) });
}

/**
 * The Agent Check harness regardless of the switch — for the gate's
 * scenario (a test learner), never for a learner's request.
 * `questions` / `secondsPerQuestion` shorten the battle for a gate run.
 */
export function getAgentCheckHarness({ questions, secondsPerQuestion } = {}) {
  return createHarness({ store, topicWorkflow, syllabus, agentCheck: makeAgentCheck({ questions, secondsPerQuestion }), protege });
}

/** The battle worker's hook when an Agent Check ends. Scores even if the switch was turned off meanwhile. */
export async function completeAgentCheckBattle(battleId) {
  return createHarness({ store, topicWorkflow, syllabus, agentCheck, protege }).completeAgentCheck({ battleId });
}

const readTools = {
  resolveSyllabus: readToolsModule.resolveSyllabusTool,
  getLearnerState: readToolsModule.getLearnerState,
  getLearnerHistory: readToolsModule.getLearnerHistory,
  getRelevantMemory: readToolsModule.getRelevantMemory,
  getPrerequisites: readToolsModule.getPrerequisites,
  searchContent: async () => ({ disabled: true, reason: "content.search is not enabled in this loop" }),
  getSessionState: null, // bound per session below
};

/**
 * Run one agent step for a session (planning by default). No LLM call is
 * made when the flag is off or the session is not in a planning state.
 */
export async function runStudyPrepPlanningStep({ sessionId, learnerId }) {
  const harness = getHarness();
  const view = await harness.getSessionView({ sessionId, learnerId, eventLimit: 10 });
  if (!["planning", "replanning"].includes(view.session.status)) return view;
  const context = await buildAgentContext({
    setName: "planning",
    goal: view.session.goal,
    session: view.session,
    dynamic: { hint: "Inspect the syllabus and the learner's state, then propose one plan." },
  });
  const sessionReadTools = {
    ...readTools,
    getSessionState: readToolsModule.makeSessionStateReader(harness).bind(null),
  };
  const registry = buildRegistry({ readTools: sessionReadTools, harness, learnerId, sessionId });
  const agent = makeLlmAgent({ system: context.system, learnerId });
  const step = await runAgentStep({
    sessionId, goal: view.session.goal, agent, registry, store, harness, contextSetName: "planning",
  });
  const after = await harness.getSessionView({ sessionId, learnerId });
  return { ...after, loop: { ended: step.ended, iterations: step.iterations, terminal: step.terminal } };
}

/** Start a session and run one planning step (the chat tool + REST entry). */
export async function startStudyPrepSession({ learnerId, goal, subject, classLevel, examBoard }) {
  const harness = getHarness();
  const session = await harness.createSession({ learnerId, goal, subject, classLevel, examBoard });
  const view = await runStudyPrepPlanningStep({ sessionId: session.id, learnerId });
  return view;
}

export { InsufficientBalanceError, pauseCopy };
