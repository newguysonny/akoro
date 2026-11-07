/**
 * study-prep production wiring (Master Plan §4.15 step 7-8). Composes the
 * harness with the supabase store, the exam-prep topic workflow, the
 * syllabus resolver, read tools and the LLM agent behind
 * AKORO_STUDY_PREP_ENABLED. Everything above this line is injectable and
 * contract-tested; this module is the only place with real dependencies.
 */

import {
  examPrepPolicyFor, publicAttempt, publicRun, startExamPrepRetest, startExamPrepRun, submitStudyPrepAttempt,
} from "../exam-prep-service.js";
import { InsufficientBalanceError, createHarness } from "./harness.js";
import { STUDY_PREP_COST } from "./education-engine.js";
import { supabaseStore as store } from "./store.js";
import { prerequisiteEdges, resolveTopics, resolveSyllabusChain, topicsForSource } from "./syllabus-resolver.js";
import { generateOutline, generatedTopics } from "./syllabus-generator.js";
import { materialQuestions } from "../../materials/studySource.js";
import { documentTopics, studyPrepMaterials } from "./materials-source.js";
import { goalTypeHint } from "./goal-type.js";
import * as readToolsModule from "./read-tools.js";
import { makeLlmAgent } from "./llm-agent.js";
import { buildRegistry } from "../tools/registry.js";
import { buildAgentContext, contextSetFor } from "./context-manager.js";
import { runAgentStep } from "./agent-loop.js";
import { pauseCopy } from "./narration.js";
import { planReadyMessage } from "./planReady.js";

export { planReadyMessage };
import db from "../../../db.js";
import { outsideAction, undoOutsideAction } from "../../../lib/outbox.js";
import { createWorkflowEngine } from "../../workflows/engine.js";
import { makeSupabaseWorkflowStore } from "../../workflows/store.js";
import { publishLiveDeveloper } from "../../workflows/bus.js";
import { keepFactual } from "../../agent-runtime/factFilter.js";
import { aiContext } from "../../../lib/aiContext.js";
import { makeWorkflowMirror, studyPrepWorkflow, workflowEngineEnabled } from "./workflow.js";
import { TOPIC_STARTABLE_STATES } from "./state-machine.js";
import { registerWorkflow } from "../../workflows/registry.js";
import { makeTeachingHandoff } from "./teaching-handoff.js";
import { makeAgentCheckRun } from "./agent-check-run.js";
import { HANDOFF_AUTO_APPROVE_MS, teachingView } from "../teaching-session/workflow.js";
import { AUTO_START_MS, WAKE_DECISIONS, WAKE_FINAL_ACTIONS, WAKE_LABELS, autoStartFor, settleStep, spentOnChecks, wakeGoal } from "./wake.js";
import { TERMINAL_ACTIONS } from "./agent-loop.js";

// Default-on kill switch: study-prep ships enabled; =false removes every surface.
export const studyPrepEnabled = () => String(process.env.AKORO_STUDY_PREP_ENABLED ?? "true").toLowerCase() !== "false";

/** The topic workflow: the extracted exam-prep service, harness-driven. */
const topicWorkflow = {
  policyFor: async ({ examBoard, subject }) => examPrepPolicyFor(examBoard, subject),
  // prepaid: the harness charged the flat practice price first (and refunds it
  // if generation fails), so generation tokens are not billed again.
  startRun: async ({ learnerId, studyPrepTopicId, request }) => startExamPrepRun({ learnerId, request, studyPrepTopicId, prepaid: true }),
  // One transaction (edu.study_prep_submit_attempt): score + run record + topic outcome, once.
  submitAttempt: async ({ learnerId, sessionId, topicId, runId, answers }) => submitStudyPrepAttempt({ learnerId, sessionId, topicId, runId, answers }),
  retest: async ({ learnerId, runId, learnerConfirmedReady }) => startExamPrepRetest({ learnerId, runId, learnerConfirmedReady, prepaid: true }),
  publicRun, publicAttempt,
};

// generateOutline / generatedTopics: the AI-drafted outline fallback (§8.7).
// materialTopics / materialQuestions: a learner's own materials folder as the syllabus (§7.17.3).
// materials (§8.8): the learner's files as agent tools; a documents session's topics fall back to its drawn outline.
const syllabus = { resolveTopics, prerequisiteEdges, generateOutline, generatedTopics, resolveSyllabusChain, topicsForSource, materialTopics: documentTopics, materialQuestions, materials: studyPrepMaterials };

/**
 * D45: practice as an Agent Check battle — ON by default, no env needed.
 * AKORO_STUDY_PREP_AGENT_CHECK=false is only an off switch, back to the
 * human-answered practice.
 */
export const agentCheckEnabled = () => String(process.env.AKORO_STUDY_PREP_AGENT_CHECK ?? "true").toLowerCase() !== "false";

/** The Agent Check behind the harness (battle/agentCheck.js + the learner's notes). */
const makeAgentCheck = ({ questions, secondsPerQuestion } = {}) => ({
  async coverage({ learnerId, topic, subject }) {
    const { embedQuestion, recall } = await import("../../battle/agentRecall.js");
    const embedding = await embedQuestion(topic);
    // Deciding whether there is anything to check is the platform's, not a charge.
    const notes = await recall({ studentId: learnerId, embedding, topic, queryText: topic, subject, limit: 4, payer: "platform" });
    const n = notes?.length || 0;
    return { notes: n, strength: n === 0 ? "none" : n < 3 ? "thin" : "good" };
  },
  async start({ learnerId, subject, topic, studyPrepTopicId, mode, basedOn = [], fromNotes = [] }) {
    const { createCheckBattle } = await import("../../battle/agentCheck.js");
    return createCheckBattle({ learnerId, subject, topic, studyPrepTopicId, mode, basedOn, fromNotes,
      ...(questions ? { total: questions } : {}), ...(secondsPerQuestion ? { secondsPerQuestion } : {}) });
  },
  async results(battleId) {
    const { checkResults } = await import("../../battle/agentCheck.js");
    return checkResults(battleId);
  },
  /** Recovery (Phase 18 item 5): the check battle an interrupted start already made for this topic. */
  async find({ studyPrepTopicId, since }) {
    const { data } = await db.from("battles").select("id, total_questions, title").eq("study_prep_topic_id", studyPrepTopicId)
      .eq("battle_type", "check").gte("created_at", since).neq("status", "cancelled").order("created_at", { ascending: false }).limit(1);
    const b = data?.[0];
    return b ? { battleId: b.id, placed: b.total_questions, title: b.title } : null;
  },
});
/** Outside steps journaled in the outbox (lib/outbox.js): done once, resumed after a restart. */
const steps = {
  once: (spec) => outsideAction(spec),
  undo: (key) => undoOutsideAction(key),
};
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

// Phase 1: the generic workflow engine, dual-written behind WORKFLOW_ENGINE_ENABLED.
let _engine = null;
const workflowEngine = () => (_engine ||= createWorkflowEngine({ store: makeSupabaseWorkflowStore(db) }));
let _mirror = null;
const workflowMirror = () => (_mirror ||= makeWorkflowMirror(workflowEngine(), {
  // A topic or a plan that moves on closes its open teaching session (Phase 6).
  hooks: {
    topicLeft: (parentId, topic) => teachingHandoff().cancelFor({ parentId, topicId: topic.id }),
    sessionEnded: (parentId, to) => closeTeachingFor(parentId, `study_prep_${to}`),
  },
}));

// ── Study Prep → Teaching → Study Prep (Phase 6, 2026-10-20) ────────────────
const OPEN_STATUSES = ["created", "active", "waiting_learner", "waiting_child", "paused"];
const workflowRows = () => db.schema("edu").from("workflow_instances");

/** The open teaching session a Study Prep topic handed over, if any. */
async function findOpenTeaching(parentId, topicId) {
  const { data, error } = await workflowRows().select("*").eq("workflow_type", "teaching")
    .eq("source_workflow_id", parentId).eq("source_topic_id", topicId).in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}
async function closeTeachingFor(parentId, reason) {
  const { data } = await workflowRows().select("id").eq("workflow_type", "teaching").eq("source_workflow_id", parentId).in("status", OPEN_STATUSES);
  for (const row of data || []) await workflowEngine().cancel(row.id, reason).catch(() => null);
}
let _handoff = null;
export const teachingHandoff = () => (_handoff ||= makeTeachingHandoff({
  engine: workflowEngine(),
  findOpen: findOpenTeaching,
  async listDueProposals(nowIso) {
    const cutoff = new Date(Date.parse(nowIso) - HANDOFF_AUTO_APPROVE_MS).toISOString();
    const { data, error } = await workflowRows().select("*").eq("workflow_type", "teaching").eq("state", "proposed").lte("created_at", cutoff).limit(25);
    if (error) throw error;
    return data || [];
  },
  // Approved before `beforeIso` with no session row yet: a step a restart cut off (resumed by the sweep).
  async listStalled(beforeIso) {
    const { data, error } = await workflowRows().select("*").eq("workflow_type", "teaching").eq("state", "scheduled")
      .is("metadata->>adaptiveSessionId", null).lte("metadata->>approvedAt", beforeIso).limit(10);
    if (error) throw error;
    return data || [];
  },
  studyPrep: {
    openWake: openRunMessage,
    // TEACHING_COMPLETED: awaiting_teaching → retest_ready (§8.3); abandoned: the topic waits or needs a new intervention.
    teachingCompleted: ({ sessionId, learnerId, topicId, workflowId, objectiveMet }) => getHarness().completeTeaching({ sessionId, learnerId, topicId, workflowId, objectiveMet }),
    teachingAbandoned: ({ sessionId, learnerId, topicId, reofferedWorkflowId }) => getHarness().teachingAbandoned({ sessionId, learnerId, topicId, reofferedWorkflowId }),
    // start_teaching_session's row: an ordinary teaching session in the dashboard's list, with one
    // opening note (so the list offers it to continue, and the modal opens it by id).
    async createSessionRow({ learnerId, workflowId, topic, subject, focus }) {
      // Check what already happened (Phase 18 item 5): a resumed approval reuses the row it made.
      const { data: made } = await db.schema("edu").from("adaptive_sessions").select("id")
        .eq("student_id", learnerId).eq("objectives->studyPrep->>workflowId", String(workflowId)).limit(1);
      if (made?.[0]?.id) return made[0].id;
      const what = focus.length ? ` — teach me ${focus.map((f) => f.toLowerCase()).join(" and ")}` : "";
      const at = new Date().toISOString();
      const { data, error } = await db.schema("edu").from("adaptive_sessions").insert({
        student_id: learnerId, topic: topic || "Untitled session", subject: subject || "General",
        subtopics: focus, objectives: { studyPrep: { workflowId } }, current_subtopic_idx: 0, current_phase: "1",
        status: "active", started_at: at, updated_at: at, session_history: [], objectives_covered: {}, confidence_by_subtopic: {},
        block_history: [{ type: "guide", text: `From your Study Prep${what}. When you finish, my retest starts a minute later.`, source: "study_prep_handoff" }],
      }).select("id").single();
      if (error) throw error;
      return data?.id || null;
    },
    wake: (args) => wakeStudyPrep(args),
  },
}));
// The engine hands a finished teaching session's outcome to Study Prep through this.
registerWorkflow(studyPrepWorkflow, { onChildOutcome: (parent, args) => teachingHandoff().controller.onChildOutcome(parent, args) });

/**
 * D15: the harness's way to Teaching — request_teaching makes the teaching
 * session (a child of the Study Prep workflow) through the handoff. Only with
 * the workflow engine; without it the harness has no `teaching` and the
 * inline strategy path is the fallback.
 */
const teachingPort = {
  request: async ({ session, topic, strategy, gaps, peerExplanations }) => {
    const row = session?.workflow_id ? session : await store.getSession(session.id).catch(() => null);
    if (!row?.workflow_id) return null;
    return teachingHandoff().propose({ session: row, topic, outcome: "retest_offered", gaps, strategy, peerExplanations });
  },
};
const teachingFor = (on) => (on ? { teaching: teachingPort } : {});

/** A code-written run's own message in the chat the plan lives in (like a wake's); extraMeta rides along (a check's card). */
async function openRunMessage({ sessionId, learnerId, wakeId, trigger, label, extraMeta = null, createThread = null }) {
  const meta = { studyPrepWake: { sessionId, wakeId, trigger, label }, ...(extraMeta || {}) };
  const conversationId = await conversationOf(sessionId, learnerId).catch(() => null);
  if (conversationId) return postToConversation({ learnerId, conversationId, text: label, meta });
  // No chat thread for this plan yet: the protégé's Study Prep thread (as protege.say makes it).
  if (!createThread) return null;
  const { postIntoChat } = await import("../../self-tooling/escalation.js");
  return postIntoChat({ userId: learnerId, conversationId: null, createId: sessionId, title: createThread.slice(0, 80), text: label, kind: "agent_check", meta: { ...meta, studyPrepSessionId: sessionId } });
}

// ── The Agent Check's own workflow and run (2026-10-20) ─────────────────────
let _checkRun = null;
export const agentCheckRun = () => (_checkRun ||= makeAgentCheckRun({
  engine: workflowEngine(),
  findByBattle: (battleId) => findCheckByBattle(battleId),
  studyPrep: { openWake: (m) => openRunMessage({ ...m, createThread: m.threadTitle || "Study Prep" }) },
}));
const checkRunOrNull = () => (workflowEngineEnabled() ? agentCheckRun() : null);

async function findCheckByBattle(battleId) {
  const { data, error } = await workflowRows().select("*").eq("workflow_type", "practice").eq("metadata->>battleId", String(battleId))
    .order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

/** The learner's live Study Prep session row (one at a time), if any. */
async function liveStudyPrepSession(learnerId) {
  const { data } = await db.schema("edu").from("study_prep_sessions").select("*").eq("learner_id", learnerId)
    .in("status", ["topic_active", "awaiting_confirmation", "planning", "replanning", "paused"]).order("created_at", { ascending: false }).limit(1);
  return data?.[0] || null;
}

/**
 * Stop the running Agent Check (the learner asked — in the chat, through the agent): the
 * battle is cancelled (the worker stops at its next step; a cancelled battle is never marked),
 * its coins are refunded, the try isn't counted, and the topic waits — a stopped check never
 * restarts by itself. restart: a new check right away (a new battle, its own card; charged).
 */
export async function stopAgentCheck({ learnerId, restart = false }) {
  const row = await liveStudyPrepSession(learnerId);
  if (!row) return { stopped: false, reason: "no_study_plan_running" };
  const harness = getHarness();
  const view = await harness.getSessionView({ sessionId: row.id, learnerId, eventLimit: 1 });
  const topic = view.topics.find((t) => t.status === "active" && t.checkBattleId && !t.checkScoredAt);
  if (!topic) return { stopped: false, reason: "no_check_running", topic: view.topics.find((t) => t.status === "active")?.label || null };
  const battleId = topic.checkBattleId;
  const { data: halted } = await db.from("battles").update({ status: "cancelled" }).eq("id", battleId).in("status", ["lobby", "scheduled", "live"]).select("id");
  if (!halted?.length) return { stopped: false, reason: "already_finished", topic: topic.label };
  try { global.io?.to(`battle:${battleId}`).emit("battle:cancelled", { battleId, reason: "stopped_by_learner" }); } catch { /* the modal sees the status on its next read */ }
  const check = await findCheckByBattle(battleId).catch(() => null);
  const charge = check?.metadata?.charge;
  const refundFailed = charge?.length ? await store.refundCoins({ charge: { applied: charge }, feature: "study_prep_practice", ref: `study_prep:${row.id}` }).catch(() => 1) : 0;
  const coins = charge?.length && !refundFailed ? Number(check?.metadata?.coins) || STUDY_PREP_COST.COINS_PER_PRACTICE : 0;
  const wasRetest = topic.checkMode === "retest";
  // §8.3: a stopped check goes back to ready (diagnostic → diagnostic_ready, retest → retest_ready).
  await store.updateTopicConditional(topic.id, topic.state, {
    status: wasRetest ? "retest_ready" : "diagnostic_ready",
    check_battle_id: null, check_mode: "stopped", check_scored_at: null, check_result: null,
    attempts_used: Math.max(0, Number(topic.attemptsUsed || 0) - 1),
    // A stopped retest keeps the teach-back it used, so it can start again.
    ...(wasRetest ? { learner_confirmed_ready: true } : {}),
    updated_at: new Date().toISOString(),
  });
  await agentCheckRun().stopped({ battleId }).catch(() => null);
  await harness.log(row.id, topic.id, {
    eventType: "human_gate", origin: "harness", decisionNode: "agent_check_stopped",
    facts: { topic: topic.label, battleId, refunded: coins, restart },
    narrative: `The learner stopped the Agent Check on ${topic.label}${coins ? ` — ${coins} coins refunded` : ""}.`,
  }).catch(() => null);
  let restarted = null;
  if (restart) {
    restarted = await harness.startTopicPractice({ sessionId: row.id, learnerId, topicId: topic.id, mode: wasRetest ? "retest" : "diagnostic" })
      .then((r) => (r?.check ? { battleId: r.check.battleId, mode: r.check.mode, questions: r.check.questions } : { skipped: r?.skipped || null }))
      .catch((e) => ({ error: e?.message || String(e) }));
  }
  return { stopped: true, topic: topic.label, battleId, refunded: coins, wasRetest, restarted };
}

/** What's running for a learner right now: their plan, its Agent Check (with the battle's link), its teaching sessions. */
export async function runningWork(learnerId) {
  const row = await liveStudyPrepSession(learnerId);
  const out = { studyPlan: null, agentChecks: [], teachingSessions: [] };
  if (row) {
    const view = await getHarness().getSessionView({ sessionId: row.id, learnerId, eventLimit: 1 }).catch(() => null);
    const active = view?.topics?.find((t) => t.status === "active") || null;
    out.studyPlan = view ? {
      sessionId: row.id, subject: view.session.subject, status: view.session.status, goal: view.session.goal,
      activeTopic: active?.label || null, topicsUnderstood: view.topics.filter((t) => t.status === "understood").length, topics: view.topics.length,
      nextCheck: view.nextCheck || null, link: "/app?tab=agent",
    } : null;
    if (active?.checkBattleId && !active.checkScoredAt) {
      const check = await findCheckByBattle(active.checkBattleId).catch(() => null);
      out.agentChecks.push({
        topic: active.label, mode: active.checkMode, battleId: active.checkBattleId,
        answered: Number(check?.metadata?.answered) || 0, total: Number(check?.metadata?.total) || null,
        link: `/app?tab=battles&battle=${active.checkBattleId}`,
        markdown: `[Watch in Battles](/app?tab=battles&battle=${active.checkBattleId})`,
      });
    }
  }
  // Only the live plan's: a teaching session whose plan has ended (or was removed) isn't running.
  out.teachingSessions = row ? (await teachingHandoff().listOpen(learnerId).catch(() => []))
    .filter((t) => t.from?.sessionId === row.id)
    .map((t) => ({
      topic: t.topic, state: t.state, focus: t.focus, progress: t.progress, link: "/app?tab=sessions",
      markdown: "[Open your sessions](/app?tab=sessions)",
    })) : [];
  return out;
}

/** The battle worker: Sergeant marked a question of an Agent Check. */
export function reportCheckQuestion(args) {
  if (!workflowEngineEnabled()) return Promise.resolve(null);
  return agentCheckRun().question(args);
}

/** The teaching session on a topic (offered, waiting or under way) — for the card. */
export async function teachingForTopic(workflowId, topicId) {
  if (!workflowId || !topicId) return null;
  return teachingView(await findOpenTeaching(workflowId, topicId).catch(() => null));
}

/** The session's workflow id, made (and its events backfilled) on first ask — owner only. */
export async function ensureStudyPrepWorkflow(sessionId, learnerId) {
  const session = await store.getSession(sessionId).catch(() => null);
  if (!session || session.learner_id !== learnerId) return null;
  return workflowMirror().ensure(session, store);
}

/** Backfill every Study Prep session without a workflow (idempotent; admin). */
export async function backfillStudyPrepWorkflows({ limit = 200 } = {}) {
  const { data, error } = await db.schema("edu").from("study_prep_sessions").select("*").is("workflow_id", null)
    .order("created_at", { ascending: true }).limit(Math.max(1, Math.min(Number(limit) || 200, 1000)));
  if (error) throw error;
  let done = 0;
  for (const session of data || []) if (await workflowMirror().ensure(session, store).catch(() => null)) done += 1;
  return { checked: (data || []).length, backfilled: done };
}

export function getHarness() {
  return createHarness({ store, topicWorkflow, syllabus, steps,
    ...(agentCheckEnabled() ? { agentCheck, protege, checkRun: checkRunOrNull() } : {}),
    ...(workflowEngineEnabled() ? { workflowMirror: workflowMirror(), ...teachingFor(true) } : {}) });
}

/**
 * The harness WITH the workflow dual-write regardless of the switch — for the
 * gate's scenario (a test learner), never for a learner's request.
 */
export function getWorkflowHarness() {
  return createHarness({ store, topicWorkflow, syllabus, steps, ...(agentCheckEnabled() ? { agentCheck, protege, checkRun: agentCheckRun() } : {}), workflowMirror: workflowMirror(), ...teachingFor(true) });
}

/**
 * The Agent Check harness regardless of the switch — for the gate's
 * scenario (a test learner), never for a learner's request.
 * `questions` / `secondsPerQuestion` shorten the battle for a gate run.
 */
export function getAgentCheckHarness({ questions, secondsPerQuestion } = {}) {
  return createHarness({ store, topicWorkflow, syllabus, steps, agentCheck: makeAgentCheck({ questions, secondsPerQuestion }), protege,
    checkRun: agentCheckRun(), workflowMirror: workflowMirror(), ...teachingFor(true) });
}

/**
 * The human-answered practice regardless of the switch (what
 * AKORO_STUDY_PREP_AGENT_CHECK=false gives) — for the gate's scenario.
 */
export function getPracticeHarness({ teaching = false } = {}) {
  // teaching: with the workflow engine and Teaching (D15) — the human-answered practice on the full topic machine (gate only).
  return createHarness({ store, topicWorkflow, syllabus, ...(teaching ? { workflowMirror: workflowMirror(), ...teachingFor(true) } : {}) });
}

/** The battle worker's hook when an Agent Check ends. Scores even if the switch was turned off meanwhile. */
export async function completeAgentCheckBattle(battleId) {
  const harness = createHarness({ store, topicWorkflow, syllabus, agentCheck, protege, checkRun: checkRunOrNull(),
    ...(workflowEngineEnabled() ? { workflowMirror: workflowMirror(), ...teachingFor(true) } : {}) });
  const done = await harness.completeAgentCheck({ battleId, teachingHandoff: workflowEngineEnabled() });
  // Below the mark with tries left (intervention_required): D15 — the intervention is a teaching
  // session on what it missed, offered at once (teach_back until the agent picks another strategy
  // with request_teaching), so the wake can talk about it. Teaching off: the inline path.
  if (done?.outcome === "retest_offered" && workflowEngineEnabled()) {
    const row = await store.getSession(done.session.id).catch(() => null);
    const asked = row ? await harness.requestTeaching({ sessionId: row.id, learnerId: row.learner_id, topicId: done.topic.id, strategy: "teach_back", focusGaps: done.result?.gaps || [], origin: "harness" }).catch(() => null) : null;
    if (asked) { done.teaching = asked.teaching; done.topic = asked.topic; }
  }
  // The agent wakes on the result: explains it, and moves on, sets the topic aside or points to the teaching session.
  if (done?.session?.id) wakeStudyPrep({ sessionId: done.session.id, learnerId: done.session.learnerId || null, trigger: "check_scored", facts: { topic: done.topic?.label } });
  return done;
}

const readTools = {
  resolveSyllabus: readToolsModule.resolveSyllabusTool,
  getLearnerState: readToolsModule.getLearnerState,
  getLearnerHistory: readToolsModule.getLearnerHistory,
  getRelevantMemory: readToolsModule.getRelevantMemory,
  getPrerequisites: readToolsModule.getPrerequisites,
  getRelatedCovered: readToolsModule.getRelatedCovered,
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
  // Operation → set (§7.4): the session's state names the operation; the
  // mapping (agent-context/operations.mjs) names the set. A context that
  // can't be built ends the step with context_unavailable, state unchanged.
  const operation = view.session.status;
  const setName = contextSetFor("study_prep", operation);
  let context;
  try {
    context = await buildAgentContext({
      setName,
      goal: view.session.goal,
    session: view.session,
      dynamic: { hint: `Research before you plan: the syllabus, the learner's state, their practice history, what earlier sessions showed (memory) and the prerequisites. Then validate and propose one plan, ordered weakest-first within the prerequisites. ${goalTypeHint(view.session.goalType)}` },
    });
  } catch (error) {
    console.warn(`[study-prep] context_unavailable for ${sessionId} (${operation}): ${error?.message || error}`);
    return { ...view, loop: { ended: "context_unavailable", iterations: 0, terminal: null } };
  }
  const sessionReadTools = {
    ...readTools,
    getSessionState: readToolsModule.makeSessionStateReader(harness).bind(null),
  };
  const registry = buildRegistry({ readTools: sessionReadTools, harness, learnerId, sessionId });
  const agent = makeLlmAgent({ system: context.system, learnerId, workflowId: view.session.workflowId || null });
  // Through the harness's guarded store, so every step reaches the workflow
  // stream (the card) — the raw store skipped the mirror. Deep research: the
  // planner reads the syllabus, the learner's state, history, memory and the
  // prerequisites before it may propose (on its last decision it always may).
  const step = await runAgentStep({
    sessionId, goal: view.session.goal, agent, registry, store: harness.store || store, harness, contextSetName: setName,
    requireReads: PLANNING_READS,
    // Developer view: the planner's notes per decision, pushed live to its workflow stream, never stored.
    onThought: view.session.workflowId ? (t) => publishLiveDeveloper(view.session.workflowId, t) : null,
    // It talks to the learner at each decision (D27): fact-filtered, then posted to the workflow stream.
    onMessage: async ({ iteration, text, seen }) => {
      const kept = keepFactual(text, `${seen} ${view.session.subject || ""} ${view.session.goal || ""}`);
      if (kept) await workflowMirror().agentMessage(sessionId, store, { iteration, text: kept });
    },
  });
  const after = await harness.getSessionView({ sessionId, learnerId });
  return { ...after, loop: { ended: step.ended, iterations: step.iterations, terminal: step.terminal } };
}

/**
 * Start a session and run one planning step (the chat tool + REST entry).
 * background: the step runs after this returns (the chat tool) — the card
 * streams it live, and the plan-ready message lands in `conversationId`.
 */
export async function startStudyPrepSession({ learnerId, goal, subject, classLevel, examBoard, materials = null, background = false, conversationId = null, goalType = null }) {
  const harness = getHarness();
  const session = await harness.createSession({ learnerId, goal, subject, classLevel, examBoard, materials, goalType });
  if (background) {
    planInBackground({ sessionId: session.id, learnerId, conversationId });
    return harness.getSessionView({ sessionId: session.id, learnerId, eventLimit: 10 });
  }
  return runStudyPrepPlanningStep({ sessionId: session.id, learnerId });
}

/** What the planner reads before proposing (deep research, 2026-10-19). */
export const PLANNING_READS = Object.freeze(["syllabus.resolve", "learner.get_state", "learner.get_history", "learner.get_relevant_memory", "concept.get_prerequisites", "topic.related_covered"]);

const planning = new Set();
/**
 * Run the planning step without holding the chat turn. One run per session at
 * a time. When it ends, the agent says so in the chat (after the turn's own
 * reply is saved, so the order reads right) and the open chat is told.
 */
export function planInBackground({ sessionId, learnerId, conversationId = null }) {
  if (planning.has(sessionId)) return false;
  planning.add(sessionId);
  setImmediate(async () => {
    let view = null;
    try { view = await runStudyPrepPlanningStep({ sessionId, learnerId }); }
    catch (error) { console.warn(`[study-prep] background planning failed for ${sessionId}: ${error?.message || error}`); }
    finally { planning.delete(sessionId); }
    if (conversationId) rememberConversation(sessionId, conversationId);
    if (!conversationId) return;
    if (!view) view = await getHarness().getSessionView({ sessionId, learnerId, eventLimit: 1 }).catch(() => null);
    await postToConversation({ learnerId, conversationId, text: planReadyMessage(view?.session) }).catch(() => null);
  });
  return true;
}
export const planningInBackground = (sessionId) => planning.has(sessionId);

async function postToConversation({ learnerId, conversationId, text, meta = { studyPrepReady: true } }) {
  // The turn that started the plan saves its reply when it ends: wait for it (≤ 30s).
  for (let i = 0; i < 15; i += 1) {
    const { data: last } = await db.from("chat_messages").select("role").eq("session_id", conversationId).eq("user_id", learnerId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!last || last.role !== "user") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const { data: msg } = await db.from("chat_messages")
    .insert({ session_id: conversationId, user_id: learnerId, role: "agent", text, meta }).select("id").single();
  if (!msg) return null;
  await db.from("chat_sessions").update({ last_message_at: new Date().toISOString() }).eq("id", conversationId).eq("user_id", learnerId);
  try { global.io?.to(`user:${learnerId}`).emit("chat_follow_up_ready", { sessionId: conversationId }); } catch { /* opening the chat shows it */ }
  return msg;
}

export { InsufficientBalanceError, pauseCopy };

// ── The agent after the plan is ready (wakes, 2026-10-19) ──────────────────

const conversations = new Map();   // session id → the chat it lives in
const rememberConversation = (sessionId, conversationId) => { if (sessionId && conversationId) conversations.set(sessionId, conversationId); };

/** The chat a session lives in: remembered, else the chat whose turn started it. */
async function conversationOf(sessionId, learnerId) {
  if (conversations.has(sessionId)) return conversations.get(sessionId);
  const { data } = await db.from("chat_messages").select("session_id").eq("user_id", learnerId)
    .contains("meta", { studyPrepSessionId: sessionId }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (data?.session_id) conversations.set(sessionId, data.session_id);
  return data?.session_id || null;
}

const wakes = new Map();   // session id → { running, queue }
/**
 * Wake the agent for a session (fire and forget). One wake runs per session
 * at a time; triggers that arrive meanwhile run after it, in order.
 */
export function wakeStudyPrep({ sessionId, learnerId = null, trigger, facts = {}, conversationId = null }) {
  if (!studyPrepEnabled() || !sessionId || !trigger) return false;
  if (conversationId) rememberConversation(sessionId, conversationId);
  const entry = wakes.get(sessionId) || { running: false, queue: [] };
  wakes.set(sessionId, entry);
  if (!entry.queue.some((q) => q.trigger === trigger)) entry.queue.push({ learnerId, trigger, facts });
  if (entry.running) return true;
  entry.running = true;
  // Outside the request that woke it: the wake bills its own model calls to the learner by name
  // (study_prep_wake); the request's context would also bill its platform-paid reads (the notes search).
  aiContext.exit(() => setImmediate(async () => {
    try {
      while (entry.queue.length) {
        const next = entry.queue.shift();
        try { await runStudyPrepWake({ sessionId, ...next }); }
        catch (error) { console.warn(`[study-prep] wake ${next.trigger} failed for ${sessionId}: ${error?.message || error}`); }
      }
    } finally { entry.running = false; wakes.delete(sessionId); }
  }));
  return true;
}
export const wakeRunning = (sessionId) => Boolean(wakes.get(sessionId)?.running);

/**
 * One wake: a chat message opens it (what the learner did), the agent runs up
 * to WAKE_DECISIONS decisions (thought → tool → message each, streamed on the
 * session's workflow), then code takes any step the agent left undone.
 */
export async function runStudyPrepWake({ sessionId, learnerId = null, trigger, facts = {} }) {
  const owner = learnerId || (await store.getSession(sessionId).catch(() => null))?.learner_id;
  if (!owner) return null;
  const harness = getHarness();
  const view = await harness.getSessionView({ sessionId, learnerId: owner, eventLimit: 10 });
  const live = trigger === "plan_adjusted" ? ["awaiting_confirmation"] : ["topic_active"];
  if (!live.includes(view.session.status)) return null;

  // Inside the coins the learner approved (2026-10-19): after approval a wake takes only the
  // decisions what's left can pay for; none left → it asks first, and runs when they approve more.
  const approved = view.session.status === "topic_active" && view.session.estimate;
  const budget = approved ? await harness.budgetFor({ id: sessionId, estimate: view.session.estimate }).catch(() => null) : null;
  const decisions = budget ? budget.wakeDecisions : WAKE_DECISIONS;

  const wakeId = `${trigger}:${Date.now().toString(36)}`;
  const label = WAKE_LABELS[trigger] || "Working on your plan";
  const conversationId = await conversationOf(sessionId, owner).catch(() => null);
  if (conversationId) await postToConversation({ learnerId: owner, conversationId, text: label, meta: { studyPrepWake: { sessionId, wakeId, trigger, label } } }).catch(() => null);
  await workflowMirror().wakeMark(sessionId, store, { wakeId, trigger, label, phase: "started" });
  let step = null;
  const heldForCoins = decisions < 1;
  if (heldForCoins) {
    held.set(sessionId, { learnerId: owner, trigger, facts });
    await workflowMirror().agentMessage(sessionId, store, { text: askForCoinsLine(budget) });
  } else try {
    const context = await buildAgentContext({
      // The wake doctrine (reasoning/WAKES.md): its rules, what runs by itself, what to do after a check.
      setName: contextSetFor("study_prep", "wake"), goal: view.session.goal, session: view.session,
      dynamic: { hint: wakeGoal(trigger, facts) },
    });
    const registry = buildRegistry({ readTools: { ...readTools, getSessionState: readToolsModule.makeSessionStateReader(harness).bind(null) }, harness, learnerId: owner, sessionId });
    // Billed to the learner, like planning: a wake is part of their session (study_prep_wake).
    // ref: its charges count against the session's approved coins (with its checks).
    const agent = makeLlmAgent({ system: context.system, learnerId: owner, feature: "study_prep_wake", maxTokens: 1200, ref: `study_prep:${sessionId}`, workflowId: view.session.workflowId || null,
      finishHint: "This is your last decision: end the turn — wait_for_learner, or move the session on if that is what the result calls for." });
    step = await runAgentStep({
      sessionId, goal: wakeGoal(trigger, facts), agent, registry, store: harness.store || store, harness, contextSetName: contextSetFor("study_prep", "wake"),
      maxIterations: decisions, terminalActions: [...TERMINAL_ACTIONS, "wait_for_learner"], finalActions: WAKE_FINAL_ACTIONS, pauseOnCap: false,
      // Developer view: its notes per decision, tagged with the wake (iterations restart at 1 each wake).
      onThought: view.session.workflowId ? (t) => publishLiveDeveloper(view.session.workflowId, { ...t, wakeId }) : null,
      onMessage: async ({ iteration, text, seen }) => {
        const kept = keepFactual(text, `${seen} ${view.session.subject || ""} ${view.session.goal || ""} ${facts.topic || ""}`);
        if (kept) await workflowMirror().agentMessage(sessionId, store, { iteration, text: kept });
      },
    });
  } catch (error) {
    console.warn(`[study-prep] wake agent failed for ${sessionId}: ${error?.message || error}`);
  }

  // Code takes the step the session needs if the agent didn't: the next topic, or the end.
  const after = await harness.getSessionView({ sessionId, learnerId: owner, eventLimit: 1 });
  const settle = settleStep(after);
  let moved = step?.terminal === "advance_topic" ? "advance" : step?.terminal === "conclude_session" ? "conclude" : null;
  if (!moved && settle === "advance") moved = (await harness.advanceTopic({ sessionId, learnerId: owner }).catch(() => null)) ? "advance" : null;
  if (!moved && settle === "conclude") {
    const done = await harness.concludeSession({ sessionId, learnerId: owner }).catch(() => null);
    if (done) {
      moved = "conclude";
      await workflowMirror().agentMessage(sessionId, store, { text: sessionSummaryLine(done) });
    }
  }
  await workflowMirror().wakeMark(sessionId, store, { wakeId, trigger, label, phase: "completed" });
  // A new topic is a new wake (its own message in the chat).
  if (moved === "advance") {
    const view = await harness.getSessionView({ sessionId, learnerId: owner, eventLimit: 1 }).catch(() => null);
    const active = view?.topics?.find((t) => t.status === "active");
    wakeStudyPrep({ sessionId, learnerId: owner, trigger: "topic_started", facts: { topic: active?.label } });
    outreachOnTopicStart({ learnerId: owner, topic: active?.label, conceptId: active?.conceptId || active?.concept_id || null, subject: view?.subject || null });
  }
  return { wakeId, ended: step?.ended || null, terminal: step?.terminal || null, moved, ...(heldForCoins ? { held: true, budget } : {}) };
}

const held = new Map();   // session id → the wake waiting for the learner's OK on more coins

/** The agent asks before going past the approved coins (code-written, no model call — it costs nothing). */
export function askForCoinsLine(budget) {
  const spent = budget?.spent ?? 0;
  const approved = budget?.approved ?? 0;
  return `You've used ${spent} of the ${approved} coins you approved for this plan, so I've stopped here instead of going past them. Tap "Approve ${STUDY_PREP_COST.APPROVE_MORE_COINS} more" on the card and I'll carry on from where I stopped.`;
}

/** The learner approved more coins: the held wake (if any) runs now. */
export function resumeHeldWake({ sessionId, learnerId, conversationId = null }) {
  const pending = held.get(sessionId);
  held.delete(sessionId);
  return wakeStudyPrep({ sessionId, learnerId, trigger: pending?.trigger || "coins_approved", facts: pending?.facts || {}, conversationId });
}

/** The session's end, in one code-written line (when code concluded it). */
export function sessionSummaryLine(done) {
  const topics = done?.session?.topics || [];
  const understood = topics.filter((t) => t.status === "understood").map((t) => t.label);
  const left = topics.filter((t) => t.status !== "understood").map((t) => t.label);
  return [
    `That's the plan done: ${understood.length} of ${topics.length} topic${topics.length === 1 ? "" : "s"} understood.`,
    left.length ? `Still to work on: ${left.slice(0, 4).join(", ")}.` : null,
  ].filter(Boolean).join(" ");
}

/**
 * The learner did something on the card (approve, adjust, taught it back):
 * the agent wakes on it. conversationId: the chat the card is in.
 */
export function afterLearnerAction({ sessionId, learnerId, action, conversationId = null, facts = {} }) {
  const trigger = { confirm: "plan_confirmed", adjust: "plan_adjusted", teach_back: "teach_back", advance: "topic_started" }[action];
  if (!trigger) return false;
  if (trigger === "topic_started" && facts?.topic) outreachOnTopicStart({ learnerId, topic: facts.topic, conceptId: facts.conceptId || null, subject: facts.subject || null });
  return wakeStudyPrep({ sessionId, learnerId, trigger, facts, conversationId });
}

/**
 * Phase 21 part 2: a topic starting — the agent asks a FRIEND's agent who has
 * mastered it how they were taught it (never a stranger, never a card).
 * Fire-and-forget; the outreach rules decide (Online, quiet hours, daily cap).
 */
export function outreachOnTopicStart({ learnerId, topic, conceptId = null, subject = null, force = false }) {
  if (!learnerId || !topic) return Promise.resolve(null);
  return import("../../agent-network/outreach.js")
    .then((o) => o.reachOut({ learnerId, trigger: "topic_start", purpose: "study_question", topic, conceptId, subject, friendsOnly: true, force }))
    .catch(() => null);
}

/**
 * The 1-minute auto-start (2026-10-19): every few seconds, an active topic
 * whose next Agent Check is due (a first check a minute after the topic
 * started, a retest a minute after the teach-back) starts it — inside the
 * approved estimate only. Past the estimate the agent asks, once.
 */
const asked = new Set();
const failedAt = new Map();
export async function autoStartDueChecks({ nowMs = Date.now(), sessionId = null } = {}) {
  if (!studyPrepEnabled() || !agentCheckEnabled()) return { started: 0, skipped: 0 };
  const cutoff = new Date(nowMs - AUTO_START_MS).toISOString();
  // sessionId: one session only (the gate's, run with a later clock).
  let query = db.schema("edu").from("study_prep_topics").select("id, session_id")
    .in("status", TOPIC_STARTABLE_STATES).lte("updated_at", cutoff);
  if (sessionId) query = query.eq("session_id", sessionId);
  const { data: rows, error } = await query.order("updated_at", { ascending: true }).limit(25);
  if (error) throw error;
  let started = 0;
  let skipped = 0;
  for (const row of rows || []) {
    if (nowMs - (failedAt.get(row.id) || 0) < 10 * 60_000) continue;
    const session = await store.getSession(row.session_id).catch(() => null);
    if (!session || session.status !== "topic_active" || wakeRunning(session.id)) continue;
    const harness = getHarness();
    const view = await harness.getSessionView({ sessionId: session.id, learnerId: session.learner_id, eventLimit: 500 }).catch(() => null);
    const topic = view?.topics?.find((t) => t.id === row.id);
    if (!topic) continue;
    const policy = await topicWorkflow.policyFor({ examBoard: session.exam_board, subject: session.subject }).catch(() => null);
    const due = autoStartFor(topic, view.session, { spent: spentOnChecks(view.events), maxAttempts: policy?.max_attempts ?? Infinity });
    if (!due) continue;
    if (due.blocked === "over_estimate") {
      const key = `${topic.id}:${topic.attemptsUsed}`;
      if (!asked.has(key)) { asked.add(key); wakeStudyPrep({ sessionId: session.id, learnerId: session.learner_id, trigger: "over_estimate", facts: { topic: topic.label } }); }
      continue;
    }
    if (Date.parse(due.at) > nowMs) continue;
    try {
      const done = await harness.startTopicPractice({ sessionId: session.id, learnerId: session.learner_id, topicId: topic.id, mode: due.mode, withinEstimateOnly: true });
      if (done?.skipped) { skipped += 1; if (!done.skipped.already) await sayNothingToCheck(session.id, topic.label); } else started += 1;
    } catch (error) {
      failedAt.set(row.id, nowMs);
      console.warn(`[study-prep] auto-start failed for topic ${row.id}: ${error?.message || error}`);
    }
  }
  return { started, skipped };
}

/** An Agent Check found no notes to check: the agent says so in the chat (code-written, no model call). */
export async function sayNothingToCheck(sessionId, topicLabel) {
  if (!workflowEngineEnabled()) return;
  await workflowMirror().agentMessage(sessionId, store, {
    text: `I went to start the Agent Check on ${topicLabel || "this topic"}, but you haven't taught me anything on it yet — so there's nothing to check, and nothing was charged. Teach me about it here, then tap Start Agent Check on the card.`,
  }).catch(() => null);
}

let autoStartTimer = null;
export function startStudyPrepAutoStart({ everyMs = 15_000 } = {}) {
  if (autoStartTimer) return autoStartTimer;
  autoStartTimer = setInterval(() => {
    autoStartDueChecks().catch((e) => console.warn(`[study-prep] auto-start sweep: ${e?.message || e}`));
    // A teaching session nobody confirmed for a minute is set up by itself.
    if (studyPrepEnabled() && workflowEngineEnabled()) teachingHandoff().autoApproveDue().catch((e) => console.warn(`[study-prep] teaching auto-approve: ${e?.message || e}`));
  }, everyMs);
  autoStartTimer.unref?.();
  return autoStartTimer;
}
