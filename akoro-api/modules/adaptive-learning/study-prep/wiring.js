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
import { prerequisiteEdges, resolveTopics, resolveSyllabusChain, topicsForSource } from "./syllabus-resolver.js";
import { generateOutline, generatedTopics } from "./syllabus-generator.js";
import { materialQuestions, materialTopics } from "../../materials/studySource.js";
import * as readToolsModule from "./read-tools.js";
import { makeLlmAgent } from "./llm-agent.js";
import { buildRegistry } from "../tools/registry.js";
import { buildAgentContext } from "./context-manager.js";
import { runAgentStep } from "./agent-loop.js";
import { pauseCopy } from "./narration.js";
import { planReadyMessage } from "./planReady.js";

export { planReadyMessage };
import db from "../../../db.js";
import { createWorkflowEngine } from "../../workflows/engine.js";
import { makeSupabaseWorkflowStore } from "../../workflows/store.js";
import { publishLiveDeveloper } from "../../workflows/bus.js";
import { keepFactual } from "../../agent-runtime/factFilter.js";
import { aiContext } from "../../../lib/aiContext.js";
import { makeWorkflowMirror, workflowEngineEnabled } from "./workflow.js";
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
  submit: async ({ learnerId, runId, answers }) => submitExamPrepAttempt({ learnerId, runId, answers }),
  retest: async ({ learnerId, runId, learnerConfirmedReady }) => startExamPrepRetest({ learnerId, runId, learnerConfirmedReady, prepaid: true }),
  publicRun, publicAttempt,
};

// generateOutline / generatedTopics: the AI-drafted outline fallback (§8.7).
// materialTopics / materialQuestions: a learner's own materials folder as the syllabus (§7.17.3).
const syllabus = { resolveTopics, prerequisiteEdges, generateOutline, generatedTopics, resolveSyllabusChain, topicsForSource, materialTopics, materialQuestions };

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
  async start({ learnerId, subject, topic, studyPrepTopicId, mode, basedOn = [] }) {
    const { createCheckBattle } = await import("../../battle/agentCheck.js");
    return createCheckBattle({ learnerId, subject, topic, studyPrepTopicId, mode, basedOn,
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

// Phase 1: the generic workflow engine, dual-written behind WORKFLOW_ENGINE_ENABLED.
let _mirror = null;
const workflowMirror = () => (_mirror ||= makeWorkflowMirror(createWorkflowEngine({ store: makeSupabaseWorkflowStore(db) })));

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
  return createHarness({ store, topicWorkflow, syllabus,
    ...(agentCheckEnabled() ? { agentCheck, protege } : {}),
    ...(workflowEngineEnabled() ? { workflowMirror: workflowMirror() } : {}) });
}

/**
 * The harness WITH the workflow dual-write regardless of the switch — for the
 * gate's scenario (a test learner), never for a learner's request.
 */
export function getWorkflowHarness() {
  return createHarness({ store, topicWorkflow, syllabus, ...(agentCheckEnabled() ? { agentCheck, protege } : {}), workflowMirror: workflowMirror() });
}

/**
 * The Agent Check harness regardless of the switch — for the gate's
 * scenario (a test learner), never for a learner's request.
 * `questions` / `secondsPerQuestion` shorten the battle for a gate run.
 */
export function getAgentCheckHarness({ questions, secondsPerQuestion } = {}) {
  return createHarness({ store, topicWorkflow, syllabus, agentCheck: makeAgentCheck({ questions, secondsPerQuestion }), protege });
}

/**
 * The human-answered practice regardless of the switch (what
 * AKORO_STUDY_PREP_AGENT_CHECK=false gives) — for the gate's scenario.
 */
export function getPracticeHarness() {
  return createHarness({ store, topicWorkflow, syllabus });
}

/** The battle worker's hook when an Agent Check ends. Scores even if the switch was turned off meanwhile. */
export async function completeAgentCheckBattle(battleId) {
  const done = await createHarness({ store, topicWorkflow, syllabus, agentCheck, protege,
    ...(workflowEngineEnabled() ? { workflowMirror: workflowMirror() } : {}) }).completeAgentCheck({ battleId });
  // The agent wakes on the result: explains it, and moves on, sets the topic aside or asks for a teach-back.
  if (done?.session?.id) wakeStudyPrep({ sessionId: done.session.id, learnerId: done.session.learnerId || null, trigger: "check_scored", facts: { topic: done.topic?.label } });
  return done;
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
    dynamic: { hint: "Research before you plan: the syllabus, the learner's state, their practice history, what earlier sessions showed (memory) and the prerequisites. Then validate and propose one plan, ordered weakest-first within the prerequisites." },
  });
  const sessionReadTools = {
    ...readTools,
    getSessionState: readToolsModule.makeSessionStateReader(harness).bind(null),
  };
  const registry = buildRegistry({ readTools: sessionReadTools, harness, learnerId, sessionId });
  const agent = makeLlmAgent({ system: context.system, learnerId });
  // Through the harness's guarded store, so every step reaches the workflow
  // stream (the card) — the raw store skipped the mirror. Deep research: the
  // planner reads the syllabus, the learner's state, history, memory and the
  // prerequisites before it may propose (on its last decision it always may).
  const step = await runAgentStep({
    sessionId, goal: view.session.goal, agent, registry, store: harness.store || store, harness, contextSetName: "planning",
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
export async function startStudyPrepSession({ learnerId, goal, subject, classLevel, examBoard, materials = null, background = false, conversationId = null }) {
  const harness = getHarness();
  const session = await harness.createSession({ learnerId, goal, subject, classLevel, examBoard, materials });
  if (background) {
    planInBackground({ sessionId: session.id, learnerId, conversationId });
    return harness.getSessionView({ sessionId: session.id, learnerId, eventLimit: 10 });
  }
  return runStudyPrepPlanningStep({ sessionId: session.id, learnerId });
}

/** What the planner reads before proposing (deep research, 2026-10-19). */
export const PLANNING_READS = Object.freeze(["syllabus.resolve", "learner.get_state", "learner.get_history", "learner.get_relevant_memory", "concept.get_prerequisites"]);

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

  const wakeId = `${trigger}:${Date.now().toString(36)}`;
  const label = WAKE_LABELS[trigger] || "Working on your plan";
  const conversationId = await conversationOf(sessionId, owner).catch(() => null);
  if (conversationId) await postToConversation({ learnerId: owner, conversationId, text: label, meta: { studyPrepWake: { sessionId, wakeId, trigger, label } } }).catch(() => null);
  await workflowMirror().wakeMark(sessionId, store, { wakeId, trigger, label, phase: "started" });

  let step = null;
  try {
    const context = await buildAgentContext({
      // The wake doctrine (reasoning/WAKES.md): its rules, what runs by itself, what to do after a check.
      setName: "wake", goal: view.session.goal, session: view.session,
      dynamic: { hint: wakeGoal(trigger, facts) },
    });
    const registry = buildRegistry({ readTools: { ...readTools, getSessionState: readToolsModule.makeSessionStateReader(harness).bind(null) }, harness, learnerId: owner, sessionId });
    // Billed to the learner, like planning: a wake is part of their session (study_prep_wake).
    const agent = makeLlmAgent({ system: context.system, learnerId: owner, feature: "study_prep_wake", maxTokens: 1200,
      finishHint: "This is your last decision: end the turn — wait_for_learner, or move the session on if that is what the result calls for." });
    step = await runAgentStep({
      sessionId, goal: wakeGoal(trigger, facts), agent, registry, store: harness.store || store, harness, contextSetName: "wake",
      maxIterations: WAKE_DECISIONS, terminalActions: [...TERMINAL_ACTIONS, "wait_for_learner"], finalActions: WAKE_FINAL_ACTIONS, pauseOnCap: false,
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
  if (moved === "advance") wakeStudyPrep({ sessionId, learnerId: owner, trigger: "topic_started", facts: { topic: (await harness.getSessionView({ sessionId, learnerId: owner, eventLimit: 1 }).catch(() => null))?.topics?.find((t) => t.status === "active")?.label } });
  return { wakeId, ended: step?.ended || null, terminal: step?.terminal || null, moved };
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
  return wakeStudyPrep({ sessionId, learnerId, trigger, facts, conversationId });
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
    .eq("status", "active").lte("updated_at", cutoff);
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
  autoStartTimer = setInterval(() => { autoStartDueChecks().catch((e) => console.warn(`[study-prep] auto-start sweep: ${e?.message || e}`)); }, everyMs);
  autoStartTimer.unref?.();
  return autoStartTimer;
}
