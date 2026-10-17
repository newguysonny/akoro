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
 */

import {
  POLICY, attemptCapGate, canTransitionSession, canTransitionTopic, teachBackGate, validatePlan,
} from "./state-machine.js";
import { makeEvent, stampThoughtType } from "./events.js";
import { deliberate } from "./narration.js";
import {
  STRATEGY_LIBRARY, STUDY_PREP_COST, applyThreshold, estimateSessionCost, isPermittedStrategy, masteryWriteBack,
} from "./education-engine.js";

/** Thrown/mapped when the wallet cannot cover a charge → session pauses. */
export class InsufficientBalanceError extends Error {
  constructor(coins, balance) { super(`Insufficient coins: need ${coins}, have ${balance}`); this.code = "insufficient_balance"; this.coins = coins; this.balance = balance; }
}

/** A harness rejection: stable machine-readable code + HTTP status + copy. */
export class HarnessRejection extends Error {
  constructor(code, message, httpStatus = 409) { super(message); this.code = code; this.httpStatus = httpStatus; }
}

const HTTP_FOR_CODE = {
  study_prep_disabled: 409, session_not_found: 404, tool_not_permitted: 403, tool_schema_invalid: 422,
  invalid_state_transition: 409, attempt_cap_exceeded: 409, strategy_not_permitted: 422,
  prerequisite_violation: 422, topic_not_in_syllabus: 422, plan_too_large: 422, duplicate_topic: 422,
  deferred_retry_used: 409, insufficient_balance: 402, teach_back_gate: 409, agent_loop_cap: 409,
  session_tool_call_cap: 409, unknown_action: 400, syllabus_exists: 409, outline_invalid: 502,
};

/** What the plan card says when the session plans against a generated outline (§8.7). */
export const GENERATED_OUTLINE_LABEL = "AI-drafted outline — not your school's official syllabus";

/**
 * agentCheck (D45, §7.12) — when given, practice IS the Agent Check: a battle
 * the learner watches, where their protégé answers only from their notes.
 *   coverage({ learnerId, topic, subject }) → { notes, strength: none|thin|good }
 *   start({ learnerId, subject, topic, studyPrepTopicId, mode }) → { battleId, placed, title }
 *   results(battleId) → { total, correct, guessed, wrong, unknown, score, perQuestion, gaps, studyPrepTopicId }
 * protege.say({ learnerId, session, text, battle }) — the protégé's message in chat.
 * Without agentCheck the legacy human-answered practice (topicWorkflow) runs.
 */
export function createHarness({ store, topicWorkflow, syllabus, agentCheck = null, protege = null, now = () => new Date().toISOString() }) {
  const reject = async (session, code, message, facts = {}) => {
    if (session) {
      await log(session.id, null, {
        eventType: "harness_decision", origin: "harness", decisionNode: "harness_rejection",
        facts: { code, ...facts }, narrative: deliberate("harness_rejection", { code })?.narrative,
      });
    }
    throw new HarnessRejection(code, message, HTTP_FOR_CODE[code] ?? 409);
  };

  const log = async (sessionId, topicId, partial) => {
    const row = makeEvent({
      sequence: 0, // the store allocates the real sequence atomically
      topicId,
      thoughtType: stampThoughtType(partial),
      ...partial,
    });
    return store.appendEvents(sessionId, [row]).then((rows) => rows[0]);
  };

  const publicTopic = (row) => ({
    id: row.id, syllabusTopicId: row.syllabus_topic_id, position: Number(row.position), label: row.label,
    status: row.status, attemptsUsed: Number(row.attempts_used || 0), deferredRetryUsed: Boolean(row.deferred_retry_used),
    flaggedReason: row.flagged_reason || null, examPrepRunId: row.exam_prep_run_id || null,
    learnerConfirmedReady: Boolean(row.learner_confirmed_ready),
    checkBattleId: row.check_battle_id || null, checkMode: row.check_mode || null,
    checkScoredAt: row.check_scored_at || null, checkResult: row.check_result || null,
  });

  const publicSession = (row, topics = null) => ({
    id: row.id, goal: row.goal, subject: row.subject, classLevel: row.class_level, entryMode: row.entry_mode,
    examBoard: row.exam_board, status: row.status, pausedReason: row.paused_reason || null,
    plan: row.plan || null, estimate: row.estimate || null, policyVersion: row.policy_version,
    toolCallsUsed: Number(row.tool_calls_used || 0), createdAt: row.created_at, updatedAt: row.updated_at,
    completedAt: row.completed_at || null, topics: topics ? topics.map(publicTopic) : undefined,
    syllabusSource: row.syllabus_source || "platform",
    syllabusLabel: row.syllabus_source === "generated" ? GENERATED_OUTLINE_LABEL : null,
  });

  /** The topics this session plans against: its generated outline, else the platform syllabus. */
  const topicsFor = (session) => (session.syllabus_source === "generated" && session.syllabus_ref && syllabus.generatedTopics
    ? syllabus.generatedTopics(session.syllabus_ref)
    : syllabus.resolveTopics({ subject: session.subject, classLevel: session.class_level, exam: session.exam_board }));

  /**
   * syllabus.generate (§8.7): draft an outline ONLY when the real syllabus is
   * empty — a real syllabus always wins (`syllabus_exists`). The outline is
   * reused for the same scope; the session records it as its source.
   */
  async function generateSyllabus({ sessionId, learnerId, intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (session.status !== "planning" && session.status !== "replanning") {
      return reject(session, "invalid_state_transition", "An outline can only be drafted while planning");
    }
    if (!syllabus.generateOutline) return reject(session, "tool_not_permitted", "Outline drafting is not available");
    const real = await syllabus.resolveTopics({ subject: session.subject, classLevel: session.class_level, exam: session.exam_board });
    if (real.length) {
      return reject(session, "syllabus_exists", "A real syllabus exists for this subject and class — plan from syllabus.resolve", { topicCount: real.length });
    }
    let outline;
    try {
      outline = await syllabus.generateOutline({ subject: session.subject, classLevel: session.class_level, examBoard: session.exam_board, goal: session.goal, learnerId });
    } catch (error) {
      if (error?.code === "outline_invalid") return reject(session, "outline_invalid", "The drafted outline failed its checks — try again", { reason: String(error.message).slice(0, 200) });
      throw error;
    }
    const updated = await store.updateSessionConditional(session.id, session.status, {
      syllabus_source: "generated", syllabus_ref: outline.id, updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The session moved on — refresh and try again");
    await log(session.id, null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "syllabus_generated",
      agentIntent: intent, facts: { topicCount: outline.topics.length, reused: outline.reused, subject: session.subject, classLevel: session.class_level },
      narrative: deliberate("syllabus_generated", { subject: session.subject, classLevel: session.class_level, reused: outline.reused })?.narrative,
    });
    return {
      source: "generated", reused: outline.reused, label: GENERATED_OUTLINE_LABEL,
      topics: outline.topics.map((t) => ({ id: t.id, label: t.label })),
    };
  }

  async function ownedSession(sessionId, learnerId) {
    const session = await store.getSession(sessionId);
    if (!session || session.learner_id !== learnerId) return null;
    return session;
  }

  // ── Session lifecycle ────────────────────────────────────────────────────

  async function createSession({ learnerId, goal, subject, classLevel = "JSS1", examBoard = "WAEC", entryMode = "syllabus" }) {
    const active = await store.findActiveSession(learnerId);
    if (active) throw new HarnessRejection("invalid_state_transition", "You already have an active study-prep session — finish or cancel it first", 409);
    const session = await store.createSession({
      learner_id: learnerId, goal, subject, class_level: classLevel, entry_mode: entryMode,
      exam_board: examBoard, status: "planning", policy_version: "study-prep-v1",
    });
    await log(session.id, null, { eventType: "observation", origin: "harness", facts: { goal, subject, classLevel, entryMode } });
    return publicSession(session);
  }

  /** The plan-card estimate snapshot charged at proposal time (rounded loop cost included). */
  function estimateFor(topicCount) {
    const estimate = estimateSessionCost({ topicCount });
    return { practiceCoins: estimate.practiceCoins, loopCoins: estimate.loopCoins, totalCoins: estimate.totalCoins };
  }

  async function proposePlan({ sessionId, learnerId, topicIds, intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (session.status !== "planning" && session.status !== "replanning") {
      return reject(session, "invalid_state_transition", "A plan can only be proposed while planning");
    }
    if (intent != null) {
      await log(session.id, null, {
        eventType: "agent_action", origin: "agent_stated_intent", action: "propose_plan",
        agentIntent: intent, facts: { topicCount: Array.isArray(topicIds) ? topicIds.length : 0 },
      });
    }
    const [syllabusTopics, prerequisites] = await Promise.all([
      topicsFor(session),
      syllabus.prerequisiteEdges({ subject: session.subject }),
    ]);
    const validation = validatePlan({ proposedTopics: topicIds, syllabusTopics, prerequisites });
    if (!validation.ok) return reject(session, validation.code, validation.message, { topics: topicIds });

    const byId = new Map(syllabusTopics.map((topic) => [topic.id, topic]));
    const plan = (topicIds || []).map((id, index) => ({
      syllabusTopicId: id, label: byId.get(id)?.label || id, position: index + 1,
    }));
    const estimate = estimateFor(plan.length);
    const updated = await store.updateSessionConditional(session.id, session.status, {
      plan, estimate, status: "awaiting_confirmation", updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The session moved on — refresh and try again");
    await log(session.id, null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "plan_validated",
      facts: { topicCount: plan.length, totalCoins: estimate.totalCoins },
      narrative: deliberate("plan_validated", { topicCount: plan.length })?.narrative,
    });
    return { session: publicSession(updated), plan, estimate };
  }

  async function confirmPlan({ sessionId, learnerId }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (session.status !== "awaiting_confirmation") {
      return reject(session, "invalid_state_transition", "There is no plan waiting for confirmation");
    }
    // Concurrent confirm: exactly one winner flips awaiting_confirmation.
    const updated = await store.updateSessionConditional(session.id, "awaiting_confirmation", {
      status: "topic_active", paused_reason: null, updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The plan was already confirmed");
    const topics = await store.createTopics(session.id, session.plan || []);
    await log(session.id, null, {
      eventType: "human_gate", origin: "harness", decisionNode: "plan_confirmed",
      facts: { topicCount: topics.length, coinsCharged: 0 },
      narrative: deliberate("plan_confirmed", { topicCount: topics.length })?.narrative,
    });
    return { session: publicSession(updated, topics), topics: topics.map(publicTopic) };
  }

  async function adjustPlan({ sessionId, learnerId, dropTopicIds = [] }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (session.status !== "awaiting_confirmation") {
      return reject(session, "invalid_state_transition", "The plan can only be adjusted before it is confirmed");
    }
    const drop = new Set(dropTopicIds);
    const kept = (session.plan || []).filter((topic) => !drop.has(topic.syllabusTopicId));
    if (kept.length === 0) return reject(session, "tool_schema_invalid", "A plan needs at least one topic");
    const plan = kept.map((topic, index) => ({ ...topic, position: index + 1 }));
    const estimate = estimateFor(plan.length);
    const updated = await store.updateSessionConditional(session.id, "awaiting_confirmation", {
      plan, estimate, updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The plan changed — refresh and try again");
    await log(session.id, null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "plan_adjusted",
      facts: { dropped: dropTopicIds.length, topicCount: plan.length, totalCoins: estimate.totalCoins },
      narrative: deliberate("plan_adjusted", { dropped: dropTopicIds.length })?.narrative,
    });
    return { session: publicSession(updated), plan, estimate };
  }

  // ── Topic workflow: the harness drives the existing exam-prep service ────

  function activeTopic(topics) { return topics.find((topic) => topic.status === "active") || null; }

  async function pause(session, reason, extraFacts = {}) {
    const paused = await store.updateSessionConditional(session.id, session.status, {
      status: "paused", paused_reason: reason, updated_at: now(),
    });
    if (paused) {
      await log(session.id, null, {
        eventType: "harness_decision", origin: "harness", decisionNode: "session_paused",
        facts: { reason, ...extraFacts }, narrative: deliberate("session_paused", { reason })?.narrative,
      });
    }
    return paused;
  }

  /**
   * practice.generate — EXECUTE level, cost: true (Master Plan §4.2).
   * Wallet charged FIRST; on failure the session pauses resumable and
   * nothing else changes. mode 'diagnostic' starts a run, 'retest' requires
   * the learner's own teach-back confirmation (hard gate).
   */
  async function startTopicPractice({ sessionId, learnerId, topicId, mode = "diagnostic", intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId);
    if (!topic) return reject(session, "invalid_state_transition", "That topic is not part of this session");
    if (session.status !== "topic_active") return reject(session, "invalid_state_transition", "Practice can only start while a topic is active");
    if (topic.status !== "active") return reject(session, "invalid_state_transition", "That topic is not the active topic");

    const policy = await topicWorkflow.policyFor({ examBoard: session.exam_board, subject: session.subject });
    const cap = attemptCapGate({ attemptsUsed: topic.attempts_used, maxAttempts: policy.max_attempts });
    if (!cap.ok) {
      // The agent OBSERVES this and may offer a strategy or defer (S2 §10-11).
      return reject(session, cap.code, cap.message, { topic: topic.label, attemptsUsed: topic.attempts_used });
    }
    const gate = teachBackGate({ mode, learnerConfirmedReady: topic.learner_confirmed_ready });
    if (!gate.ok) return reject(session, gate.code, gate.message, { topic: topic.label });

    if (agentCheck) return startAgentCheck({ session, topic, learnerId, mode });

    // Charge first (§4.11). Never generate on credit.
    const coins = STUDY_PREP_COST.COINS_PER_PRACTICE;
    let charge;
    try {
      charge = await store.chargeCoins({ learnerId, coins, feature: "study_prep_practice", ref: `study_prep:${session.id}` });
    } catch (error) {
      if (error instanceof InsufficientBalanceError || error?.code === "insufficient_balance") {
        await pause(session, "insufficient_balance", { topic: topic.label });
        throw new HarnessRejection("insufficient_balance", "Not enough coins for another practice — the session is paused and resumable", 402);
      }
      throw error;
    }

    try {
      const result = mode === "retest"
        ? await topicWorkflow.retest({ learnerId, runId: topic.exam_prep_run_id, learnerConfirmedReady: true })
        : await topicWorkflow.startRun({
          learnerId, studyPrepTopicId: topic.id,
          request: { topic: topic.label, subject: session.subject, examBoard: session.exam_board, questionCount: 5 },
        });
      const updatedTopic = await store.updateTopicConditional(topic.id, "active", {
        attempts_used: Number(topic.attempts_used) + 1,
        exam_prep_run_id: result.run.id, updated_at: now(),
      });
      await log(session.id, topic.id, {
        eventType: "harness_decision", origin: "harness", decisionNode: "practice_generated",
        facts: { topic: topic.label, mode, attemptNumber: result.attempt?.attempt_number ?? Number(topic.attempts_used) + 1, coins },
        narrative: deliberate("practice_generated", { topicLabel: topic.label, coins })?.narrative,
      });
      return {
        session: publicSession(session), topic: publicTopic(updatedTopic || topic),
        run: topicWorkflow.publicRun(result.run),
        attempt: topicWorkflow.publicAttempt ? topicWorkflow.publicAttempt(result.attempt) : result.attempt,
      };
    } catch (error) {
      // Generation failed after the charge — refund, keep the session intact.
      await store.refundCoins({ charge, feature: "study_prep_practice", ref: `study_prep:${session.id}` });
      throw error;
    }
  }

  /**
   * The Agent Check (D45, §7.12): the protégé is checked in a battle the
   * learner watches. No notes on the topic → nothing to check, nothing
   * charged, go and teach. Otherwise: charge once (§7.12.2), create the
   * battle, and the protégé says so in chat with the battle to watch.
   */
  async function startAgentCheck({ session, topic, learnerId, mode }) {
    if (topic.check_battle_id && !topic.check_scored_at) {
      return reject(session, "invalid_state_transition", "An Agent Check on this topic is still running — watch it finish first");
    }
    const coverage = await agentCheck.coverage({ learnerId, topic: topic.label, subject: session.subject });
    if (!coverage || coverage.strength === "none") {
      await log(session.id, topic.id, {
        eventType: "harness_decision", origin: "harness", decisionNode: "agent_check_skipped",
        facts: { topic: topic.label, notes: 0 },
        narrative: deliberate("agent_check_skipped", { topicLabel: topic.label })?.narrative,
      });
      return { session: publicSession(session), topic: publicTopic(topic), skipped: { reason: "no_notes", next: "teach" } };
    }

    const coins = STUDY_PREP_COST.COINS_PER_PRACTICE;
    let charge;
    try {
      charge = await store.chargeCoins({ learnerId, coins, feature: "study_prep_practice", ref: `study_prep:${session.id}` });
    } catch (error) {
      if (error instanceof InsufficientBalanceError || error?.code === "insufficient_balance") {
        await pause(session, "insufficient_balance", { topic: topic.label });
        throw new HarnessRejection("insufficient_balance", "Not enough coins for another Agent Check — the session is paused and resumable", 402);
      }
      throw error;
    }

    let check;
    try {
      check = await agentCheck.start({ learnerId, subject: session.subject, topic: topic.label, studyPrepTopicId: topic.id, mode });
    } catch (error) {
      // The check never ran — refund, keep the session intact.
      await store.refundCoins({ charge, feature: "study_prep_practice", ref: `study_prep:${session.id}` });
      throw error;
    }
    const updatedTopic = await store.updateTopicConditional(topic.id, "active", {
      attempts_used: Number(topic.attempts_used) + 1,
      check_battle_id: check.battleId, check_mode: mode, check_scored_at: null, check_result: null,
      // A retest spends the learner's teach-back; the next one needs a new one.
      ...(mode === "retest" ? { learner_confirmed_ready: false } : {}),
      updated_at: now(),
    });
    await log(session.id, topic.id, {
      eventType: "harness_decision", origin: "harness", decisionNode: "agent_check_started",
      facts: { topic: topic.label, mode, battleId: check.battleId, questions: check.placed, coins, attemptNumber: Number(topic.attempts_used) + 1 },
      narrative: deliberate("agent_check_started", { topicLabel: topic.label, mode, coins })?.narrative,
    });
    await protege?.say({
      learnerId, session,
      text: `I've asked my teaching guide to check what you taught me about ${topic.label}${mode === "retest" ? " again" : ""}. I can only answer from your notes, and Sergeant judges every answer. Watch me answer.`,
      battle: { id: check.battleId, kind: "agent_check", topic: topic.label, mode },
    }).catch(() => {});
    return {
      session: publicSession(session), topic: publicTopic(updatedTopic || topic),
      check: { battleId: check.battleId, mode, questions: check.placed },
    };
  }

  /**
   * An Agent Check's battle ended (the battle worker calls this). The Engine
   * scores it — a guess is not demonstrated — the topic is settled or offered
   * a retest, mastery evidence is written as the agent's (agent_recall), and
   * the protégé reports in chat. Scored once per check.
   */
  async function completeAgentCheck({ battleId }) {
    if (!agentCheck) return null;
    const result = await agentCheck.results(battleId);
    if (!result?.studyPrepTopicId) return null;
    const topic = await store.getTopicById(result.studyPrepTopicId);
    if (!topic || topic.check_battle_id !== battleId) return null;
    const claimed = await store.claimCheckScore(topic.id, battleId, {
      correct: result.correct, guessed: result.guessed, wrong: result.wrong, unknown: result.unknown,
      total: result.total, score: result.score, perQuestion: result.perQuestion, gaps: result.gaps,
    }, now());
    if (!claimed) return null;   // already scored
    const session = await store.getSession(topic.session_id);
    if (!session) return null;

    const policy = await topicWorkflow.policyFor({ examBoard: session.exam_board, subject: session.subject });
    const threshold = applyThreshold({
      score: result.score, passThreshold: policy.pass_threshold,
      attemptsUsed: Number(topic.attempts_used), maxAttempts: policy.max_attempts,
    });
    const outcome = threshold.passed ? "understood" : threshold.capped ? "capped_out" : "retest_offered";
    const percentage = Math.round((result.score || 0) * 100);
    const thresholdPercentage = Math.round(Number(policy.pass_threshold) * 100);
    await log(session.id, topic.id, {
      eventType: "engine_result", origin: "engine",
      facts: {
        topic: topic.label, source: "agent_recall", battleId, score: result.score, correct: result.correct,
        guessed: result.guessed, total: result.total, percentage, passed: threshold.passed,
        attemptsRemaining: threshold.attemptsRemaining, outcome, gaps: result.gaps,
      },
      narrative: deliberate("agent_check_scored", {
        topicLabel: topic.label, correct: result.correct, total: result.total, guessed: result.guessed,
        percentage, passed: threshold.passed, thresholdPercentage,
      })?.narrative,
    });
    const mastery = masteryWriteBack({
      currentMastery: topic.mastery ?? null, score: result.score, passed: threshold.passed,
      attemptsUsed: Number(topic.attempts_used),
    });
    await store.recordMasteryEvidence({
      learnerId: session.learner_id, sessionRef: `study_prep:${session.id}`, topicLabel: topic.label, subject: session.subject,
      passed: threshold.passed, score: result.score, mastery, source: "agent_recall",
    });
    let updatedTopic = claimed;
    if (outcome !== "retest_offered") {
      updatedTopic = (await store.updateTopicConditional(topic.id, "active", { status: outcome, updated_at: now() })) || claimed;
    }

    const next = outcome === "understood" ? "That's above the pass mark — this topic is understood."
      : outcome === "capped_out" ? "That was the last attempt on this topic, so we'll move on and come back to it."
        : `That's below the ${thresholdPercentage}% pass mark. Teach me what I missed, then tap "I've taught it" and I'll be checked again.`;
    const gapLine = result.gaps.length ? ` I couldn't answer from your notes on: ${result.gaps.slice(0, 4).join("; ")}.` : "";
    const guessLine = result.guessed ? ` I had to guess on ${result.guessed} — a guess doesn't count.` : "";
    await protege?.say({
      learnerId: session.learner_id, session,
      text: `The check on ${topic.label} is done: I answered ${result.correct} of ${result.total} from your notes.${guessLine}${gapLine} ${next}`,
      battle: { id: battleId, kind: "agent_check", topic: topic.label, result: { correct: result.correct, total: result.total, outcome } },
    }).catch(() => {});
    return { session: publicSession(session), topic: publicTopic(updatedTopic), result, outcome, mastery };
  }

  /**
   * practice.submit — the Education Engine scores; the harness records the
   * deterministic outcome on the topic state machine and writes mastery
   * evidence. The LLM never scores (S1 §17, §4.5).
   */
  async function submitPractice({ sessionId, learnerId, topicId, answers, intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId);
    if (!topic || topic.status !== "active" || !topic.exam_prep_run_id) {
      return reject(session, "invalid_state_transition", "That topic has no open practice");
    }
    const result = await topicWorkflow.submit({ learnerId, runId: topic.exam_prep_run_id, answers });
    const policy = await topicWorkflow.policyFor({ examBoard: session.exam_board, subject: session.subject });
    const threshold = applyThreshold({
      score: result.score, passThreshold: policy.pass_threshold,
      attemptsUsed: Number(topic.attempts_used), maxAttempts: policy.max_attempts,
    });
    const outcome = threshold.passed ? "understood" : threshold.capped ? "capped_out" : "retest_offered";
    const percentage = result.total ? Math.round((result.score || 0) * 100) : 0;
    await log(session.id, topic.id, {
      eventType: "engine_result", origin: "engine",
      facts: {
        topic: topic.label, score: result.score, correct: result.correct, total: result.total,
        percentage, passed: threshold.passed, attemptsRemaining: threshold.attemptsRemaining, outcome,
      },
      narrative: deliberate("practice_scored", {
        topicLabel: topic.label, score: result.correct, total: result.total,
        percentage, passed: threshold.passed, thresholdPercentage: Math.round(Number(policy.pass_threshold) * 100),
      })?.narrative,
    });
    // Mastery write-back (§4.5) — deterministic, best-effort, never invented.
    const mastery = masteryWriteBack({
      currentMastery: topic.mastery ?? null, score: result.score, passed: threshold.passed,
      attemptsUsed: Number(topic.attempts_used),
    });
    await store.recordMasteryEvidence({
      learnerId, sessionRef: `study_prep:${session.id}`, topicLabel: topic.label, subject: session.subject,
      passed: threshold.passed, score: result.score, mastery,
    });
    if (outcome === "retest_offered") {
      // The topic stays active; the retest is gated on the teach-back confirm.
      return { session: publicSession(session), topic: publicTopic(topic), result, outcome, mastery };
    }
    const updatedTopic = await store.updateTopicConditional(topic.id, "active", {
      status: outcome, updated_at: now(),
    });
    return { session: publicSession(session), topic: publicTopic(updatedTopic || topic), result, outcome, mastery };
  }

  /** The human gate: only the learner's own confirmation unlocks a retest. */
  async function confirmTeachBack({ sessionId, learnerId, topicId }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId);
    if (!topic || topic.status !== "active") return reject(session, "invalid_state_transition", "That topic is not active");
    const updated = await store.updateTopicConditional(topic.id, "active", {
      learner_confirmed_ready: true, updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The teach-back was already confirmed");
    await log(session.id, topic.id, {
      eventType: "human_gate", origin: "harness", decisionNode: "teach_back_confirmed",
      facts: { topic: topic.label },
      narrative: deliberate("teach_back_confirmed", { topicLabel: topic.label })?.narrative,
    });
    return { session: publicSession(session), topic: publicTopic(updated) };
  }

  /** offer_strategy — propose level, curated library only (Decision 3). */
  async function offerStrategy({ sessionId, learnerId, topicId, strategy, intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (!isPermittedStrategy(strategy)) {
      return reject(session, "strategy_not_permitted", `“${strategy}” is not in the approved strategy list`, { strategy });
    }
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId) || activeTopic(topics);
    if (intent != null) {
      await log(session.id, topic?.id || null, {
        eventType: "agent_action", origin: "agent_stated_intent", action: "offer_strategy",
        agentIntent: intent, facts: { strategy },
      });
    }
    await log(session.id, topic?.id || null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "strategy_offered",
      facts: { strategy, topic: topic?.label || null },
      narrative: deliberate("strategy_offered", { strategy, topicLabel: topic?.label })?.narrative,
    });
    return { strategy, topic: topic ? publicTopic(topic) : null, library: STRATEGY_LIBRARY };
  }

  /** advance_topic — terminal action; the next queued topic becomes active. */
  async function advanceTopic({ sessionId, learnerId, intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (session.status !== "topic_active") return reject(session, "invalid_state_transition", "No topic is active");
    const topics = await store.getTopics(session.id);
    const current = activeTopic(topics);
    if (current && ["understood", "capped_out", "deferred", "flagged_gap"].includes(current.status)) {
      // already settled — fall through to the next queued topic
    } else if (current) {
      return reject(session, "invalid_state_transition", "Finish or settle the active topic before advancing");
    }
    const next = topics.find((row) => row.status === "queued");
    if (!next) return reject(session, "invalid_state_transition", "No queued topic remains — conclude the session");
    const activated = await store.updateTopicConditional(next.id, "queued", { status: "active", updated_at: now() });
    if (!activated) return reject(session, "invalid_state_transition", "The next topic moved on — refresh and try again");
    if (intent != null) {
      await log(session.id, next.id, {
        eventType: "agent_action", origin: "agent_stated_intent", action: "advance_topic", agentIntent: intent,
      });
    }
    await log(session.id, next.id, {
      eventType: "harness_decision", origin: "harness", decisionNode: "topic_started",
      facts: { topic: next.label },
      narrative: deliberate("topic_started", { topicLabel: next.label })?.narrative,
    });
    return { session: publicSession(session, topics), topic: publicTopic(activated) };
  }

  /**
   * defer_topic — terminal action with reason_code. ONE deferred retry per
   * session (Decision 5): a deferred topic is re-queued once with attempts
   * reset; a second deferral in the same session is rejected.
   */
  async function deferTopic({ sessionId, learnerId, topicId, reasonCode = "attempt_cap_reached", intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId) || activeTopic(topics);
    if (!topic) return reject(session, "invalid_state_transition", "That topic is not part of this session");
    if (topics.some((row) => row.deferred_retry_used)) {
      return reject(session, "deferred_retry_used", "The one deferred retry for this session is already used");
    }
    if (!canTransitionTopic(topic.status, "deferred")) {
      return reject(session, "invalid_state_transition", `A ${topic.status} topic cannot be deferred`);
    }
    const updated = await store.updateTopicConditional(topic.id, topic.status, { status: "deferred", updated_at: now() });
    if (!updated) return reject(session, "invalid_state_transition", "The topic moved on — refresh and try again");
    if (intent != null) {
      await log(session.id, topic.id, {
        eventType: "agent_action", origin: "agent_stated_intent", action: "defer_topic", agentIntent: intent,
      });
    }
    await log(session.id, topic.id, {
      eventType: "harness_decision", origin: "harness", decisionNode: "topic_deferred",
      facts: { topic: topic.label, reason: reasonCode },
      narrative: deliberate("topic_deferred", { topicLabel: topic.label, reason: reasonCode })?.narrative,
    });
    return { session: publicSession(session), topic: publicTopic(updated) };
  }

  /** Re-queue a deferred topic once — attempts reset (Decision 5). */
  async function retryDeferredTopic({ sessionId, learnerId, topicId }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId);
    if (!topic || topic.status !== "deferred") return reject(session, "invalid_state_transition", "That topic is not deferred");
    const updated = await store.updateTopicConditional(topic.id, "deferred", {
      status: "queued", attempts_used: 0, learner_confirmed_ready: false, deferred_retry_used: true, updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The topic moved on — refresh and try again");
    await log(session.id, topic.id, {
      eventType: "harness_decision", origin: "harness", decisionNode: "topic_deferred",
      facts: { topic: topic.label, requeued: true, attemptsReset: true },
      narrative: deliberate("topic_deferred", { topicLabel: topic.label, reason: "re-queued with attempts reset" })?.narrative,
    });
    return { session: publicSession(session), topic: publicTopic(updated) };
  }

  async function flagTopic({ sessionId, learnerId, topicId, reason = null, intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId) || activeTopic(topics);
    if (!topic || !canTransitionTopic(topic.status, "flagged_gap")) {
      return reject(session, "invalid_state_transition", "That topic cannot be flagged right now");
    }
    const updated = await store.updateTopicConditional(topic.id, topic.status, { status: "flagged_gap", flagged_reason: reason, updated_at: now() });
    if (!updated) return reject(session, "invalid_state_transition", "The topic moved on — refresh and try again");
    if (intent != null) {
      await log(session.id, topic.id, {
        eventType: "agent_action", origin: "agent_stated_intent", action: "topic_flag", agentIntent: intent,
      });
    }
    await log(session.id, topic.id, {
      eventType: "harness_decision", origin: "harness", decisionNode: "topic_flagged",
      facts: { topic: topic.label, reason },
      narrative: deliberate("topic_flagged", { topicLabel: topic.label, reason })?.narrative,
    });
    return { session: publicSession(session), topic: publicTopic(updated) };
  }

  // ── Session-level ops ────────────────────────────────────────────────────

  async function concludeSession({ sessionId, learnerId, intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const understood = topics.filter((row) => row.status === "understood").length;
    const updated = await store.updateSessionConditional(session.id, session.status, {
      status: "completed", paused_reason: null, completed_at: now(), updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The session moved on — refresh and try again");
    if (intent != null) {
      await log(session.id, null, {
        eventType: "agent_action", origin: "agent_stated_intent", action: "conclude_session", agentIntent: intent,
      });
    }
    await log(session.id, null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "session_concluded",
      facts: { understood, topics: topics.length },
      narrative: deliberate("session_concluded", { understood })?.narrative,
    });
    return { session: publicSession(updated, topics), summary: { understood, topics: topics.length } };
  }

  async function pauseSession({ sessionId, learnerId, reason = "learner_requested" }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (session.status === "paused") return { session: publicSession(session) };
    if (!canTransitionSession(session.status, "paused")) {
      return reject(session, "invalid_state_transition", "The session cannot be paused from its current state");
    }
    const paused = await pause(session, reason);
    return { session: publicSession(paused || session) };
  }

  async function resumeSession({ sessionId, learnerId }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (session.status !== "paused") return reject(session, "invalid_state_transition", "The session is not paused");
    // A paused session resumes into topic_active when a topic exists,
    // planning when the plan never completed (agent_loop_cap during planning).
    const topics = await store.getTopics(session.id);
    const to = topics.some((row) => row.status === "active" || row.status === "queued") ? "topic_active" : "planning";
    const updated = await store.updateSessionConditional(session.id, "paused", { status: to, paused_reason: null, updated_at: now() });
    if (!updated) return reject(session, "invalid_state_transition", "The session moved on — refresh and try again");
    return { session: publicSession(updated, topics) };
  }

  async function cancelSession({ sessionId, learnerId }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const updated = await store.updateSessionConditional(session.id, session.status, { status: "cancelled", updated_at: now() });
    if (!updated) return reject(session, "invalid_state_transition", "The session already ended");
    return { session: publicSession(updated) };
  }

  /** plan.validate dry-run — the agent sees exactly what the harness would check. */
  async function validateProposedPlan({ sessionId, learnerId, topicIds }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const [syllabusTopics, prerequisites] = await Promise.all([
      topicsFor(session),
      syllabus.prerequisiteEdges({ subject: session.subject }),
    ]);
    const validation = validatePlan({ proposedTopics: topicIds, syllabusTopics, prerequisites });
    return { ...validation, estimate: validation.ok ? estimateFor(topicIds.length) : null };
  }

  /** The single learner-visible session view (topics + replayable events). */
  async function getSessionView({ sessionId, learnerId, eventLimit = 200 }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const [topics, events] = await Promise.all([
      store.getTopics(session.id),
      store.listEvents(session.id, { limit: eventLimit }),
    ]);
    return { session: publicSession(session, topics), topics: topics.map(publicTopic), events };
  }

  /**
   * sessionNext — the harness's answer to "what happens now?" for the UI and
   * the agent (Master Plan §4.15 step 9). Deterministic from recorded state.
   */
  async function sessionNext({ sessionId, learnerId }) {
    const view = await getSessionView({ sessionId, learnerId });
    const { session, topics } = view;
    const current = activeTopic(topics);
    const step = (() => {
      if (session.status === "planning") return "planning";
      if (session.status === "awaiting_confirmation") return "plan_card";
      if (session.status === "paused") return `paused:${session.pausedReason || "learner_requested"}`;
      if (session.status === "completed" || session.status === "cancelled" || session.status === "abandoned") return "ended";
      if (!current) return "advance_or_conclude";
      if (current.checkBattleId && !current.checkScoredAt) return "agent_check_running";
      if (!current.examPrepRunId && !current.checkBattleId) return "start_practice";
      const run = current.learnerConfirmedReady ? "retest_ready" : "awaiting_submission_or_teach_back";
      return run;
    })();
    return { session, topics, step, activeTopic: current ? publicTopic(current) : null };
  }

  return {
    createSession, proposePlan, confirmPlan, adjustPlan,
    startTopicPractice, submitPractice, completeAgentCheck, confirmTeachBack, offerStrategy,
    advanceTopic, deferTopic, retryDeferredTopic, flagTopic,
    concludeSession, pauseSession, resumeSession, cancelSession,
    validateProposedPlan, getSessionView, sessionNext, generateSyllabus,
    publicSession, publicTopic, pause, log,
  };
}
