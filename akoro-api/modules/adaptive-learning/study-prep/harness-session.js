/**
 * study-prep harness session operations — the session and topic lifecycle
 * moves around the run: strategies, advancing/deferring/flagging, pausing,
 * resuming, concluding and approving more coins.
 */

import { HarnessRejection } from "../../agent-runtime/index.js";
import { canTransitionSession, canTransitionTopic, isTopicInProgress } from "./state-machine.js";
import { deliberate } from "./narration.js";
import { STUDY_PREP_COST, STRATEGY_LIBRARY, isPermittedStrategy } from "./education-engine.js";

export function makeSessionOps({ store, strategyRun, check, reject, log, ownedSession, publicSession, publicTopic, activeTopic, moveTopic, pause, now, budgetFor }) {
  /** The learner's Reject on an offered strategy: recorded, nothing runs, the card stops offering it. */
  async function declineStrategy({ sessionId, learnerId, topicId, strategy }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId) || null;
    await log(session.id, topic?.id || null, {
      eventType: "harness_decision", origin: "learner", decisionNode: "strategy_declined",
      facts: { strategy, topic: topic?.label || null },
      narrative: deliberate("strategy_declined", { strategy, topicLabel: topic?.label })?.narrative,
    });
    return { strategy, declined: true, topic: topic ? publicTopic(topic) : null };
  }

  /**
   * offer_strategy — propose level, curated library only (Decision 3). The
   * learner's acceptance (`accepted`, from the route) runs the harness
   * strategy (replan / schedule / offline export) and starts its outcome.
   */
  async function offerStrategy({ sessionId, learnerId, topicId, strategy, intent = null, accepted = false }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (!isPermittedStrategy(strategy)) {
      return reject(session, "strategy_not_permitted", `“${strategy}” is not in the approved strategy list`, { strategy });
    }
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId) || activeTopic(topics);
    // Strategy Library (Phase 4a): limits.maxUsesPerTopic, ranked candidates, execution on acceptance.
    const run = (await strategyRun({ strategy, accepted, learnerId, session, topic, topics, store, now })) || {};
    if (run.refusal) return reject(session, "strategy_not_permitted", run.message || `“${strategy}” cannot be used here now`, { strategy, reason: run.refusal });
    if (intent != null) {
      await log(session.id, topic?.id || null, {
        eventType: "agent_action", origin: "agent_stated_intent", action: "offer_strategy",
        agentIntent: intent, facts: { strategy },
      });
    }
    await log(session.id, topic?.id || null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "strategy_offered",
      facts: { strategy, topic: topic?.label || null, ...(run.accepted ? { accepted: true, executed: !!run.execution?.executed, operation: run.execution?.operation || null, executionReason: run.execution?.reason || null } : {}) },
      narrative: deliberate("strategy_offered", { strategy, topicLabel: topic?.label })?.narrative,
    });
    return {
      strategy, topic: topic ? publicTopic(topic) : null, library: STRATEGY_LIBRARY,
      ...(run.recommended ? { recommended: run.recommended } : {}),
      ...(run.accepted ? { accepted: true, execution: run.execution || null } : {}),
    };
  }

  /** advance_topic — terminal action; the next queued topic becomes active. */
  async function advanceTopic({ sessionId, learnerId, intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    await check("advance_topic", { session });
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
    // Only a running session concludes — not one still planning, or already over.
    if (!canTransitionSession(session.status, "completed")) {
      return reject(session, "invalid_state_transition", `A ${session.status.replace(/_/g, " ")} session can't be concluded`);
    }
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
    await check("resume_session", { session });
    // A paused session resumes into topic_active when a topic exists,
    // planning when the plan never completed (agent_loop_cap during planning).
    const topics = await store.getTopics(session.id);
    const to = topics.some((row) => isTopicInProgress(row.status) || row.status === "queued") ? "topic_active" : "planning";
    const updated = await store.updateSessionConditional(session.id, "paused", { status: to, paused_reason: null, updated_at: now() });
    if (!updated) return reject(session, "invalid_state_transition", "The session moved on — refresh and try again");
    return { session: publicSession(updated, topics) };
  }

  async function cancelSession({ sessionId, learnerId }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (!canTransitionSession(session.status, "cancelled")) return reject(session, "invalid_state_transition", "The session already ended");
    const updated = await store.updateSessionConditional(session.id, session.status, { status: "cancelled", updated_at: now() });
    if (!updated) return reject(session, "invalid_state_transition", "The session already ended");
    return { session: publicSession(updated) };
  }

  /** "Approve N more": the learner lets the session go past its estimate by a fixed amount. */
  async function approveMoreCoins({ sessionId, learnerId }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    if (!["topic_active", "paused"].includes(session.status) || !session.estimate) {
      return reject(session, "invalid_state_transition", "More coins can only be approved for a running plan");
    }
    const add = STUDY_PREP_COST.APPROVE_MORE_COINS;
    const estimate = { ...session.estimate, extraCoins: (Number(session.estimate.extraCoins) || 0) + add };
    const updated = await store.updateSessionConditional(session.id, session.status, { estimate, updated_at: now() });
    if (!updated) return reject(session, "invalid_state_transition", "The session moved on — refresh and try again");
    const budget = await budgetFor(updated);
    await log(session.id, null, {
      eventType: "human_gate", origin: "harness", decisionNode: "coins_approved",
      facts: { coins: add, approved: budget.approved },
      narrative: deliberate("coins_approved", { coins: add, approved: budget.approved })?.narrative,
    });
    return { session: publicSession(updated), coins: budget };
  }

  return {
    declineStrategy, offerStrategy, advanceTopic, deferTopic, retryDeferredTopic, flagTopic,
    concludeSession, pauseSession, resumeSession, cancelSession, approveMoreCoins,
  };
}
