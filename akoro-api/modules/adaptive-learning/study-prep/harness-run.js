/**
 * study-prep harness run operations — practice, Agent Check and teaching.
 *
 * The execute level (Master Plan §4.2, §7.12, D15/D45): the wallet is charged
 * first, the deterministic topic state machine decides what may start, and
 * the Education Engine scores. The model never changes a policy number.
 */

import { HarnessRejection } from "../../agent-runtime/index.js";
import { TOPIC_CHECKING_STATES, attemptCapGate, practiceStart, topicStateAfterScore } from "./state-machine.js";
import { deliberate } from "./narration.js";
import { STUDY_PREP_COST, applyThreshold, isPermittedStrategy, masteryWriteBack } from "./education-engine.js";
import { InsufficientBalanceError } from "./harness-rules.js";

export function makeRunOps({ store, topicWorkflow, syllabus, agentCheck, protege, checkRun, teaching, steps, now, log, publicSession, publicTopic, check, reject, ownedSession, activeTopic, moveTopic, pause, budgetFor }) {
  /**
   * practice.generate — EXECUTE level, cost: true (Master Plan §4.2).
   * Wallet charged FIRST; on failure the session pauses resumable and
   * nothing else changes. mode 'diagnostic' starts a run, 'retest' requires
   * the learner's own teach-back confirmation (hard gate).
   */
  async function startTopicPractice({ sessionId, learnerId, topicId, mode = "diagnostic", intent = null, withinEstimateOnly = false }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId);
    if (!topic) return reject(session, "invalid_state_transition", "That topic is not part of this session");
    await check("start_practice", { session, topic });

    const policy = await topicWorkflow.policyFor({ examBoard: session.exam_board, subject: session.subject });
    const cap = attemptCapGate({ attemptsUsed: topic.attempts_used, maxAttempts: policy.max_attempts });
    if (!cap.ok) {
      // The agent OBSERVES this and may offer a strategy or defer (S2 §10-11).
      return reject(session, cap.code, cap.message, { topic: topic.label, attemptsUsed: topic.attempts_used });
    }
    // The topic's state says what may start (§8.3): a retest only once taught (retest_ready).
    const start = practiceStart({ state: topic.status, attemptsUsed: topic.attempts_used }, mode);
    if (!start.ok) return reject(session, start.code, start.message, { topic: topic.label, state: topic.status });
    mode = start.mode;
    // The agent and the auto-start stay inside the coins the learner approved;
    // past it, only the learner's own tap goes on (they were asked).
    if (withinEstimateOnly && session.estimate) {
      const budget = await budgetFor(session);
      if (!budget.withinEstimate) return reject(session, "over_estimate", `The next check needs ${budget.next} coins and ${budget.left} are left of the approved estimate — ask the learner first`, { left: budget.left });
    }

    if (agentCheck) return startAgentCheck({ session, topic, learnerId, mode, start, auto: withinEstimateOnly === true });

    // Ready first (diagnostic_ready / retest_ready): a failed charge leaves the topic ready, nothing else.
    const ready = topic.status === start.ready ? topic : await moveTopic(topic, start.ready);
    if (!ready) return reject(session, "invalid_state_transition", "The topic moved on — refresh and try again");

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
      // The attempt is out: diagnostic / retest until it is scored. A retest spends the teach-back.
      const updatedTopic = await moveTopic(ready, start.running, {
        attempts_used: Number(topic.attempts_used) + 1,
        exam_prep_run_id: result.run.id, learner_confirmed_ready: false,
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
  async function startAgentCheck({ session, topic, learnerId, mode, start, auto = false }) {
    if (TOPIC_CHECKING_STATES.includes(topic.status) || (topic.check_battle_id && !topic.check_scored_at)) {
      return reject(session, "invalid_state_transition", "An Agent Check on this topic is still running — watch it finish first");
    }
    const coverage = await agentCheck.coverage({ learnerId, topic: topic.label, subject: session.subject });
    if (!coverage || coverage.strength === "none") {
      // Already found empty (the sweep and the learner's device can both try): said once.
      if (topic.check_mode === "skipped") return { session: publicSession(session), topic: publicTopic(topic), skipped: { reason: "no_notes", next: "teach", already: true } };
      await log(session.id, topic.id, {
        eventType: "harness_decision", origin: "harness", decisionNode: "agent_check_skipped",
        facts: { topic: topic.label, notes: 0 },
        narrative: deliberate("agent_check_skipped", { topicLabel: topic.label })?.narrative,
      });
      // Nothing to check yet (§8.3: no notes → intervention_required): no auto-start until they teach it.
      const toIntervene = ["active", "diagnostic_ready"].includes(topic.status);
      const waiting = await (toIntervene ? moveTopic(topic, "intervention_required", { check_mode: "skipped" })
        : store.updateTopicConditional(topic.id, topic.status, { check_mode: "skipped", updated_at: now() })).catch(() => null);
      return { session: publicSession(session), topic: publicTopic(waiting || topic), skipped: { reason: "no_notes", next: "teach" } };
    }
    // Notes to check: ready (diagnostic_ready / retest_ready) before the charge.
    const ready = topic.status === start.ready ? topic : await moveTopic(topic, start.ready);
    if (!ready) return reject(session, "invalid_state_transition", "The topic moved on — refresh and try again");
    topic = ready;

    const coins = STUDY_PREP_COST.COINS_PER_PRACTICE;
    // Store first (Phase 18 item 5): this attempt's charge and battle are journaled steps, so a
    // restart mid-step resumes — the charge is not taken twice and a battle already made is reused.
    // The topic row's updated_at: unchanged while this attempt is mid-step, new after a stop or a
    // deferred retry (which reset attempts_used) — so each real attempt has its own key.
    const stepKey = `study_prep_check:${topic.id}:${Number(topic.attempts_used) + 1}:${topic.updated_at || ""}`;
    let charge;
    try {
      charge = (await steps.once({ kind: "study_prep_charge", key: `${stepKey}:charge`, userId: learnerId,
        act: () => store.chargeCoins({ learnerId, coins, feature: "study_prep_practice", ref: `study_prep:${session.id}` }) })).result;
    } catch (error) {
      if (error instanceof InsufficientBalanceError || error?.code === "insufficient_balance") {
        await pause(session, "insufficient_balance", { topic: topic.label });
        throw new HarnessRejection("insufficient_balance", "Not enough coins for another Agent Check — the session is paused and resumable", 402);
      }
      throw error;
    }

    let check;
    try {
      // Planned from the learner's papers: the check asks what those papers ask (§7.17.3).
      const basedOn = session.syllabus_source === "documents" && session.syllabus_ref && syllabus.materialQuestions
        ? await syllabus.materialQuestions({ folderId: session.syllabus_ref, learnerId, topic: topic.label }).catch(() => [])
        : [];
      // Files the learner linked to this session (chat uploads, §8.8): the check's facts come from their own notes first.
      const fromNotes = (session.material_record_ids || []).length && syllabus.materials?.search
        ? (await syllabus.materials.search({ learnerId, recordIds: session.material_record_ids, query: topic.label, limit: 4 }).catch(() => [])).map((p) => p.snippet).filter(Boolean)
        : [];
      check = (await steps.once({ kind: "study_prep_check", key: `${stepKey}:battle`, userId: learnerId,
        act: () => agentCheck.start({ learnerId, subject: session.subject, topic: topic.label, studyPrepTopicId: topic.id, mode, ...(basedOn.length ? { basedOn } : {}), ...(fromNotes.length ? { fromNotes } : {}) }),
        // Interrupted mid-step: the battle this attempt already made, if any — never a second one.
        check: (journal) => agentCheck.find?.({ studyPrepTopicId: topic.id, since: journal.created_at }) ?? null,
      })).result;
    } catch (error) {
      // The check never ran — refund, keep the session intact (the next try charges afresh).
      await store.refundCoins({ charge, feature: "study_prep_practice", ref: `study_prep:${session.id}` });
      await steps.undo(`${stepKey}:charge`).catch(() => {});
      throw error;
    }
    // The check is out: diagnostic / retest until it is marked.
    const updatedTopic = await moveTopic(topic, start.running, {
      attempts_used: Number(topic.attempts_used) + 1,
      check_battle_id: check.battleId, check_mode: mode, check_scored_at: null, check_result: null,
      // A retest spends the learner's teach-back; the next one needs a new one.
      ...(mode === "retest" ? { learner_confirmed_ready: false } : {}),
    });
    await log(session.id, topic.id, {
      eventType: "harness_decision", origin: "harness", decisionNode: "agent_check_started",
      facts: { topic: topic.label, mode, battleId: check.battleId, questions: check.placed, coins, attemptNumber: Number(topic.attempts_used) + 1 },
      narrative: deliberate("agent_check_started", { topicLabel: topic.label, mode, coins })?.narrative,
    });
    // The check's own run in the Study Prep chat (its card, each question, the result) — or, without
    // the workflow engine, the protégé's message as before.
    const ran = checkRun
      ? await checkRun.started({ session, topic: { id: topic.id, label: topic.label }, battleId: check.battleId, mode, questions: check.placed, coins, auto, charge: charge?.applied || null }).catch(() => null)
      : null;
    if (!ran) {
      await protege?.say({
        learnerId, session,
        text: `I've asked my teaching guide to check what you taught me about ${topic.label}${mode === "retest" ? " again" : ""}. I can only answer from your notes, and Sergeant judges every answer. Watch me answer.`,
        battle: { id: check.battleId, kind: "agent_check", topic: topic.label, mode },
      }).catch(() => {});
    }
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
  async function completeAgentCheck({ battleId, teachingHandoff = false }) {
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
    // The topic machine follows the score (§8.3): understood | capped_out | intervention_required.
    // A check that was out (diagnostic / retest) moves; a row from before the topic states
    // (still "active" with its check out) walks the legal path to it.
    let updatedTopic = claimed;
    const settledState = topicStateAfterScore(threshold);
    let from = claimed;
    if (from.status === "active") from = (await moveTopic(from, "diagnostic_ready")) || from;
    if (from.status === "diagnostic_ready") from = (await moveTopic(from, "diagnostic")) || from;
    if (TOPIC_CHECKING_STATES.includes(from.status)) updatedTopic = (await moveTopic(from, settledState)) || from;

    const next = outcome === "understood" ? "That's above the pass mark — this topic is understood."
      : outcome === "capped_out" ? "That was the last attempt on this topic, so we'll move on and come back to it."
        : teachingHandoff
          // Phase 6: a teaching session on the gaps is offered on the card (study-prep/teaching-handoff.js).
          ? `That's below the ${thresholdPercentage}% pass mark. I've set up a teaching session on what I missed — confirm it on the card (it's set up by itself in a minute), then teach me from your dashboard. My retest starts when you finish.`
          : `That's below the ${thresholdPercentage}% pass mark. Teach me what I missed, then tap "I've taught it" and I'll be checked again.`;
    // The check's run closes with its result (the agent's wake then says what's next); the protégé's
    // message is for a session without the workflow engine.
    if (checkRun && await checkRun.scored({ battleId, result, outcome, thresholdPercentage }).catch(() => null)) {
      return { session: publicSession(session), topic: publicTopic(updatedTopic), result, outcome, mastery };
    }
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
    await check("submit_practice", { session });
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId);
    if (!topic || !TOPIC_CHECKING_STATES.includes(topic.status) || !topic.exam_prep_run_id) {
      return reject(session, "invalid_state_transition", "That topic has no open practice");
    }
    // One transaction (edu.study_prep_submit_attempt): the attempt's score, the
    // run record and the topic's §8.3 outcome are written together or not at
    // all, and only once — a second submit (or a race loser) changes nothing
    // and is a recorded rejection, never a 500 or a second score.
    let result;
    try {
      result = await topicWorkflow.submitAttempt({ learnerId, sessionId: session.id, topicId: topic.id, runId: topic.exam_prep_run_id, answers });
    } catch (error) {
      if (error?.code === "invalid_answers" || /invalid_answers|too_many_answers/.test(String(error?.message))) {
        return reject(session, "tool_schema_invalid", "Those answers are not valid for this practice", { topic: topic.label });
      }
      throw error;
    }
    if (!result || result.notFound) return reject(session, "invalid_state_transition", "That topic's practice was not found", { topic: topic.label });
    if (!result.ok || !result.applied) {
      return reject(session, "invalid_state_transition", "This practice was already submitted", { topic: topic.label, cause: result.code || (result.duplicate ? "attempt_already_submitted" : "not_applied") });
    }
    const policy = await topicWorkflow.policyFor({ examBoard: session.exam_board, subject: session.subject });
    const threshold = applyThreshold({
      score: result.score, passThreshold: policy.pass_threshold,
      attemptsUsed: Number(topic.attempts_used), maxAttempts: policy.max_attempts,
    });
    // The outcome is what the transaction wrote (its own threshold read, in the same write).
    const settledState = result.topic?.status || topicStateAfterScore(result);
    const outcome = settledState === "understood" ? "understood" : settledState === "capped_out" ? "capped_out" : "retest_offered";
    threshold.passed = outcome === "understood";
    const settled = result.topic || null;
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
    // retest_offered: intervention_required — Teaching (D15) or the inline teach-back unlocks the retest.
    return { session: publicSession(session), topic: publicTopic(settled || topic), result, outcome, mastery };
  }

  /**
   * The inline human gate (the fallback when Teaching is off, or taught
   * elsewhere): only the learner's own confirmation unlocks a retest —
   * intervention_required | awaiting_teaching → retest_ready.
   */
  async function confirmTeachBack({ sessionId, learnerId, topicId }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId);
    if (topic?.status === "retest_ready") return reject(session, "invalid_state_transition", "The teach-back was already confirmed");
    if (!topic || !["intervention_required", "awaiting_teaching"].includes(topic.status)) {
      return reject(session, "invalid_state_transition", "That topic is not waiting for a teach-back");
    }
    const updated = await moveTopic(topic, "retest_ready", { learner_confirmed_ready: true });
    if (!updated) return reject(session, "invalid_state_transition", "The teach-back was already confirmed");
    await log(session.id, topic.id, {
      eventType: "human_gate", origin: "harness", decisionNode: "teach_back_confirmed",
      facts: { topic: topic.label },
      narrative: deliberate("teach_back_confirmed", { topicLabel: topic.label })?.narrative,
    });
    return { session: publicSession(session), topic: publicTopic(updated) };
  }

  /**
   * request_teaching (D15, §8.4 strategy_selection) — every intervention is a
   * Teaching Workflow: the agent picks the strategy (and the gaps to focus on),
   * the harness checks the state, the strategy and idempotency, creates the
   * teaching session (child of the Study Prep workflow) and moves the topic
   * intervention_required → awaiting_teaching. Asking again while it waits is
   * idempotent (the same session; a new strategy is recorded on it).
   * Teaching off → teaching_unavailable: the agent falls back to offer_strategy.
   */
  async function requestTeaching({ sessionId, learnerId, topicId = null, strategy = "teach_back", focusGaps = null, peerExplanations = null, intent = null, origin = "agent" }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    await check("request_teaching", { session });
    if (!isPermittedStrategy(strategy)) {
      return reject(session, "strategy_not_permitted", `“${strategy}” is not in the approved strategy list`, { strategy });
    }
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId) || activeTopic(topics);
    if (!topic || !["intervention_required", "awaiting_teaching"].includes(topic.status)) {
      return reject(session, "invalid_state_transition", "Only a topic that needs an intervention can be handed to a teaching session", { state: topic?.status || null });
    }
    if (!teaching?.request) return reject(session, "teaching_unavailable", "Teaching sessions are not available — offer an inline strategy instead", { topic: topic.label });
    if (intent != null) {
      await log(session.id, topic.id, {
        eventType: "agent_action", origin: "agent_stated_intent", action: "request_teaching", agentIntent: intent, facts: { strategy },
      });
    }
    const gaps = (Array.isArray(focusGaps) && focusGaps.length ? focusGaps : topic.check_result?.gaps || [])
      .map((g) => String(g || "").trim().slice(0, 120)).filter(Boolean).slice(0, 4);
    const peers = Array.isArray(peerExplanations) ? peerExplanations.map((p) => String(p || "").trim().slice(0, 240)).filter(Boolean).slice(0, 3) : [];
    const view = await teaching.request({
      session, strategy, gaps, peerExplanations: peers,
      topic: { id: topic.id, label: topic.label, attemptsUsed: Number(topic.attempts_used || 0) },
    }).catch(() => null);
    if (!view?.workflowId) return reject(session, "teaching_unavailable", "The teaching session couldn't be set up — offer an inline strategy instead", { topic: topic.label });
    const reused = topic.status === "awaiting_teaching";
    const updated = reused
      ? (topic.teaching_workflow_id === view.workflowId ? topic : await store.updateTopicConditional(topic.id, "awaiting_teaching", { teaching_workflow_id: view.workflowId, updated_at: now() }))
      : await moveTopic(topic, "awaiting_teaching", { teaching_workflow_id: view.workflowId, learner_confirmed_ready: false });
    if (!updated) return reject(session, "invalid_state_transition", "The topic moved on — refresh and try again");
    await log(session.id, topic.id, {
      eventType: "harness_decision", origin: "harness", decisionNode: "teaching_requested",
      facts: { topic: topic.label, strategy, focus: gaps.length, teachingWorkflowId: view.workflowId, reused, requestedBy: origin },
      narrative: deliberate("teaching_requested", { topicLabel: topic.label, strategy })?.narrative,
    });
    return { session: publicSession(session), topic: publicTopic(updated), teaching: view, strategy, reused };
  }

  /**
   * TEACHING_COMPLETED (the handoff's outcome hook): awaiting_teaching →
   * retest_ready, and the retest unlocks (it starts by itself a minute later).
   * A topic handed over before the topic states (still active /
   * intervention_required) walks the legal path. Idempotent.
   */
  async function completeTeaching({ sessionId, learnerId, topicId, workflowId = null, objectiveMet = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    let topic = topics.find((row) => row.id === topicId);
    if (!topic) return reject(session, "invalid_state_transition", "That topic is not part of this session");
    if (topic.status === "retest_ready") return { session: publicSession(session), topic: publicTopic(topic), already: true };
    if (topic.status === "active") topic = (await moveTopic(topic, "intervention_required")) || topic;
    if (topic.status === "intervention_required") topic = (await moveTopic(topic, "awaiting_teaching", workflowId ? { teaching_workflow_id: workflowId } : {})) || topic;
    if (topic.status !== "awaiting_teaching") {
      return reject(session, "invalid_state_transition", `A ${String(topic.status).replace(/_/g, " ")} topic is not waiting for teaching`);
    }
    const updated = await moveTopic(topic, "retest_ready", { learner_confirmed_ready: true });
    if (!updated) return reject(session, "invalid_state_transition", "The topic moved on — refresh and try again");
    await log(session.id, topic.id, {
      eventType: "harness_decision", origin: "harness", decisionNode: "teaching_completed",
      facts: { topic: topic.label, teachingWorkflowId: workflowId || topic.teaching_workflow_id || null, objectiveMet },
      narrative: deliberate("teaching_completed", { topicLabel: topic.label })?.narrative,
    });
    return { session: publicSession(session), topic: publicTopic(updated) };
  }

  /** The teaching session ended with nothing taught: offered again → the topic keeps waiting; else it needs a new intervention. */
  async function teachingAbandoned({ sessionId, learnerId, topicId, reofferedWorkflowId = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId);
    if (!topic || topic.status !== "awaiting_teaching") return { session: publicSession(session), topic: topic ? publicTopic(topic) : null };
    const updated = reofferedWorkflowId
      ? await store.updateTopicConditional(topic.id, "awaiting_teaching", { teaching_workflow_id: reofferedWorkflowId, updated_at: now() })
      : await moveTopic(topic, "intervention_required");
    return { session: publicSession(session), topic: publicTopic(updated || topic) };
  }

  return {
    startTopicPractice, completeAgentCheck, submitPractice, confirmTeachBack,
    requestTeaching, completeTeaching, teachingAbandoned,
  };
}
