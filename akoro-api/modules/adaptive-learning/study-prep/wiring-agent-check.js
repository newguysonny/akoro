/**
 * study-prep/wiring-agent-check.js — the Agent Check wiring, extracted from
 * wiring.js: the battle-backed check and its journaled steps, the check's own
 * workflow run, the learner's live plan/check reads, and the battle worker's
 * end hook. wiring.js composes these; the workflow definition stays there.
 */

import db from "../../../db.js";
import { outsideAction, undoOutsideAction } from "../../../lib/outbox.js";
import { appLink } from "../../../lib/urls.js";
import { STUDY_PREP_COST } from "./education-engine.js";
import { createHarness } from "./harness.js";
import { supabaseStore as store } from "./store.js";
import { makeAgentCheckRun } from "./agent-check-run.js";
import { workflowEngineEnabled } from "./workflow.js";
import { teachingView } from "../teaching-session/workflow.js";
import {
  findOpenTeaching, getHarness, openRunMessage, syllabus, teachingFor, teachingHandoff,
  topicWorkflow, wakeStudyPrep, workflowEngine, workflowMirror, workflowRows,
} from "./wiring.js";

/** The Agent Check behind the harness (battle/agentCheck.js + the learner's notes). */
export const makeAgentCheck = ({ questions, secondsPerQuestion } = {}) => ({
  async coverage({ learnerId, topic, subject }) {
    const { embedQuestion, recall } = await import("../../battle/index.js");
    const embedding = await embedQuestion(topic);
    // Deciding whether there is anything to check is the platform's, not a charge.
    const notes = await recall({ studentId: learnerId, embedding, topic, queryText: topic, subject, limit: 4, payer: "platform" });
    const n = notes?.length || 0;
    return { notes: n, strength: n === 0 ? "none" : n < 3 ? "thin" : "good" };
  },
  async start({ learnerId, subject, topic, studyPrepTopicId, mode, basedOn = [], fromNotes = [] }) {
    const { createCheckBattle } = await import("../../battle/index.js");
    return createCheckBattle({ learnerId, subject, topic, studyPrepTopicId, mode, basedOn, fromNotes,
      ...(questions ? { total: questions } : {}), ...(secondsPerQuestion ? { secondsPerQuestion } : {}) });
  },
  async results(battleId) {
    const { checkResults } = await import("../../battle/index.js");
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
export const steps = {
  once: (spec) => outsideAction(spec),
  undo: (key) => undoOutsideAction(key),
};
export const agentCheck = makeAgentCheck();

/** The protégé's messages: one chat thread per Study Prep session, carrying the battle to watch. */
export const protege = {
  async say({ learnerId, session, text, battle }) {
    const { postIntoChat } = await import("../../self-tooling/index.js");
    return postIntoChat({
      userId: learnerId, conversationId: null, createId: session.id,
      title: `Study Prep: ${session.goal || session.subject || "your plan"}`.slice(0, 80),
      text, kind: "agent_check", meta: { battle },
    });
  },
};

// ── The Agent Check's own workflow and run (2026-10-20) ─────────────────────
let _checkRun = null;
export const agentCheckRun = () => (_checkRun ||= makeAgentCheckRun({
  engine: workflowEngine(),
  findByBattle: (battleId) => findCheckByBattle(battleId),
  studyPrep: { openWake: (m) => openRunMessage({ ...m, createThread: m.threadTitle || "Study Prep" }) },
}));
export const checkRunOrNull = () => (workflowEngineEnabled() ? agentCheckRun() : null);

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
      nextCheck: view.nextCheck || null, link: appLink("tab=agent"),
    } : null;
    if (active?.checkBattleId && !active.checkScoredAt) {
      const check = await findCheckByBattle(active.checkBattleId).catch(() => null);
      out.agentChecks.push({
        topic: active.label, mode: active.checkMode, battleId: active.checkBattleId,
        answered: Number(check?.metadata?.answered) || 0, total: Number(check?.metadata?.total) || null,
        link: appLink(`tab=battles&battle=${active.checkBattleId}`),
        markdown: `[Watch in Battles](${appLink(`tab=battles&battle=${active.checkBattleId}`)})`,
      });
    }
  }
  // Only the live plan's: a teaching session whose plan has ended (or was removed) isn't running.
  out.teachingSessions = row ? (await teachingHandoff().listOpen(learnerId).catch(() => []))
    .filter((t) => t.from?.sessionId === row.id)
    .map((t) => ({
      topic: t.topic, state: t.state, focus: t.focus, progress: t.progress, link: appLink("tab=sessions"),
      markdown: `[Open your sessions](${appLink("tab=sessions")})`,
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
