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
  startRun: async ({ learnerId, studyPrepTopicId, request }) => startExamPrepRun({ learnerId, request, studyPrepTopicId }),
  submit: async ({ learnerId, runId, answers }) => submitExamPrepAttempt({ learnerId, runId, answers }),
  retest: async ({ learnerId, runId, learnerConfirmedReady }) => startExamPrepRetest({ learnerId, runId, learnerConfirmedReady }),
  publicRun, publicAttempt,
};

const syllabus = { resolveTopics, prerequisiteEdges };

export function getHarness() {
  return createHarness({ store, topicWorkflow, syllabus });
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
  const agent = makeLlmAgent({ system: context.system });
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
