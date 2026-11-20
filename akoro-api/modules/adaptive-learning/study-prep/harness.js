/**
 * study-prep harness (Master Plan §4.4). The SOLE writer of session, topic
 * and run state. The agent proposes; this module validates → executes →
 * narrates → records. The Education Engine scores; this module never
 * second-guesses a score, and the model can never change a policy number.
 *
 * Dependency-injected so contract tests run with an in-memory store and a
 * stubbed topic workflow — no db, no LLM, no clock reads (a `now` fn is
 * injected). Production wiring lives in store.js + wiring.js.
 *
 * Write discipline: every state change is a CONDITIONAL update through the
 * store (expected status checked in the WHERE clause); race losers no-op
 * without duplicating events. The database is the referee.
 *
 * Split by responsibility (Phase 19 item 4): harness-rules (pure rules),
 * harness-context (shared log/views/moves), harness-plan (syllabus + plan),
 * harness-run (practice / Agent Check / teaching), harness-session (lifecycle
 * moves) and harness-io (read models). This file composes them and keeps the
 * public exports.
 */

import { HarnessRejection, createChecker, createRejector } from "../../agent-runtime/index.js";
import { deliberate } from "./narration.js";
import { guardStudyPrepStore } from "./workflow.js";
import { makeMaterialsOps } from "./materials-ops.js";
import { HTTP_FOR_CODE, STUDY_PREP_CHECKS } from "./harness-rules.js";
import { makeHarnessContext } from "./harness-context.js";
import { makePlanOps } from "./harness-plan.js";
import { makeIoOps } from "./harness-io.js";
import { makeRunOps } from "./harness-run.js";
import { makeSessionOps } from "./harness-session.js";

// The rejection type and check runner are the generic harness core (Phase 2);
// Study Prep plugs in its codes (HTTP_FOR_CODE) and checks (STUDY_PREP_CHECKS).
export { HarnessRejection };
export {
  InsufficientBalanceError, STUDY_PREP_CHECKS, GENERATED_OUTLINE_LABEL, pendingStrategyOffer, documentsPlanLabel,
} from "./harness-rules.js";

/**
 * agentCheck (D45, §7.12) — when given, practice IS the Agent Check: a battle
 * the learner watches, where their protégé answers only from their notes.
 *   coverage({ learnerId, topic, subject }) → { notes, strength: none|thin|good }
 *   start({ learnerId, subject, topic, studyPrepTopicId, mode }) → { battleId, placed, title }
 *   results(battleId) → { total, correct, guessed, wrong, unknown, score, perQuestion, gaps, studyPrepTopicId }
 *   protege.say({ learnerId, session, text, battle }) — the protégé's message in chat.
 * Without agentCheck the legacy human-answered practice (topicWorkflow) runs.
 */
/** Without a journal: an outside step just runs (the behaviour before Phase 18 item 5). */
const runDirectly = { once: async ({ act }) => ({ result: await act() }), undo: async () => {} };

/**
 * teaching (D15) — when given, every intervention is a Teaching Workflow:
 *   request({ session, topic, strategy, gaps, peerExplanations }) → view { workflowId, state, … } | null
 * Without it (Teaching off) the inline path stays: offer_strategy, the
 * learner's teach-back, the retest.
 *
 * topicWorkflow.submitAttempt({ learnerId, sessionId, topicId, runId, answers })
 * is the single-transaction submit (edu.study_prep_submit_attempt): score,
 * run record and topic outcome in one write, idempotent —
 *   → { ok, applied, duplicate?, code?, score, correct, total, passed, capped, topic }
 */

/**
 * The Strategy Library's offer/accept step (strategies/executors.js, Phase
 * 4a): per-topic limit, ranked candidates, and on acceptance the harness
 * executor + a pending outcome. Loaded lazily; with no database configured it
 * does nothing (the offer stands as before).
 */
async function defaultStrategyRun(args) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return {};
  try {
    const { runStrategyOffer, defaultExecutorDeps } = await import("../strategies/executors.js");
    return await runStrategyOffer({ ...args, deps: defaultExecutorDeps(args) });
  } catch (e) {
    console.warn("[study-prep] strategy run:", e?.message || e);
    return {};
  }
}

export function createHarness({ store: rawStore, topicWorkflow, syllabus, agentCheck = null, protege = null, workflowMirror = null, checkRun = null, teaching = null, steps = runDirectly, strategyRun = defaultStrategyRun, now = () => new Date().toISOString() }) {
  // Every session and topic status write is checked against the workflow
  // definition (F7) and, with a mirror, dual-written to the engine (Phase 1).
  const store = guardStudyPrepStore(rawStore, { mirror: workflowMirror });
  const context = makeHarnessContext({ store, now });
  const reject = createRejector({
    httpFor: HTTP_FOR_CODE,
    onReject: (session, code, facts) => context.log(session.id, null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "harness_rejection",
      facts: { code, ...facts }, narrative: deliberate("harness_rejection", { code })?.narrative,
    }),
  });
  const check = createChecker({ checks: STUDY_PREP_CHECKS, reject });

  const plan = makePlanOps({
    store, syllabus, check, reject, log: context.log,
    ownedSession: context.ownedSession, publicSession: context.publicSession, publicTopic: context.publicTopic, now,
  });
  const io = makeIoOps({
    store, topicWorkflow, agentCheck, reject,
    ownedSession: context.ownedSession, activeTopic: context.activeTopic,
    publicSession: context.publicSession, publicTopic: context.publicTopic,
  });
  const run = makeRunOps({
    store, topicWorkflow, syllabus, agentCheck, protege, checkRun, teaching, steps, now, log: context.log,
    publicSession: context.publicSession, publicTopic: context.publicTopic, check, reject,
    ownedSession: context.ownedSession, activeTopic: context.activeTopic, moveTopic: context.moveTopic,
    pause: context.pause, budgetFor: io.budgetFor,
  });
  const session = makeSessionOps({
    store, strategyRun, check, reject, log: context.log,
    ownedSession: context.ownedSession, publicSession: context.publicSession, publicTopic: context.publicTopic,
    activeTopic: context.activeTopic, moveTopic: context.moveTopic, pause: context.pause, now,
    budgetFor: io.budgetFor,
  });

  // §8.8 files: materials.list / materials.search / syllabus.from_documents / learner.request_materials.
  const materialsOps = makeMaterialsOps({ store, materials: syllabus?.materials || null, log: context.log, reject, check, ownedSession: context.ownedSession, now });

  return {
    // The guarded store (definition checks + workflow mirror): the agent loop writes through it too.
    store,
    ...materialsOps,
    createSession: plan.createSession, proposePlan: plan.proposePlan, confirmPlan: plan.confirmPlan, adjustPlan: plan.adjustPlan,
    startTopicPractice: run.startTopicPractice, submitPractice: run.submitPractice, completeAgentCheck: run.completeAgentCheck,
    confirmTeachBack: run.confirmTeachBack, offerStrategy: session.offerStrategy, declineStrategy: session.declineStrategy,
    requestTeaching: run.requestTeaching, completeTeaching: run.completeTeaching, teachingAbandoned: run.teachingAbandoned,
    advanceTopic: session.advanceTopic, deferTopic: session.deferTopic, retryDeferredTopic: session.retryDeferredTopic, flagTopic: session.flagTopic,
    concludeSession: session.concludeSession, pauseSession: session.pauseSession, resumeSession: session.resumeSession, cancelSession: session.cancelSession,
    validateProposedPlan: plan.validateProposedPlan, getSessionView: io.getSessionView, sessionNext: io.sessionNext,
    generateSyllabus: plan.generateSyllabus, resolveSyllabus: plan.resolveSyllabus,
    publicSession: context.publicSession, publicTopic: context.publicTopic, pause: context.pause, log: context.log,
    topicNotes: io.topicNotes, budgetFor: io.budgetFor, approveMoreCoins: session.approveMoreCoins,
  };
}
