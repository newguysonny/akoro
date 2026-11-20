/**
 * study-prep harness I/O — the read models the card and the agent observe.
 *
 * Session view, next-step derivation, topic notes and the coins ledger. All
 * of it is deterministic from recorded state; nothing here writes.
 */

import { HarnessRejection } from "../../agent-runtime/index.js";
import { pendingStrategyOffer } from "./harness-rules.js";
import { getStrategy } from "../strategies/library.js";
import { autoStartFor, checkBudget, spentOnChecks } from "./wake.js";

export function makeIoOps({ store, topicWorkflow, agentCheck, reject, ownedSession, activeTopic, publicSession, publicTopic }) {
  /** topic.get_notes — how much the learner has taught the agent on a topic (no charge). */
  async function topicNotes({ sessionId, learnerId, topicId = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const topics = await store.getTopics(session.id);
    const topic = topics.find((row) => row.id === topicId) || activeTopic(topics);
    if (!topic) return reject(session, "invalid_state_transition", "No topic is active");
    const coverage = agentCheck ? await agentCheck.coverage({ learnerId, topic: topic.label, subject: session.subject }).catch(() => null) : null;
    return { topic: topic.label, notes: coverage?.notes ?? null, strength: coverage?.strength || "unknown" };
  }

  /** What the session has charged: its charges by ref when the store can sum them, else its checks' events. */
  async function coinsSpent(session, events = null) {
    if (store.sessionCoinsSpent) return store.sessionCoinsSpent(session.id);
    return spentOnChecks(events || await store.listEvents(session.id, { limit: 500 }));
  }

  /** The coins the learner approved (estimate + any approved since), and what is spent. */
  async function budgetFor(session, events = null) {
    return checkBudget(session, await coinsSpent(session, events));
  }

  /** The single learner-visible session view (topics + replayable events). */
  async function getSessionView({ sessionId, learnerId, eventLimit = 200 }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const [topics, events] = await Promise.all([
      store.getTopics(session.id),
      store.listEvents(session.id, { limit: eventLimit }),
    ]);
    // agentCheck: practice is the Agent Check (D45) — the card words its
    // buttons for it before the learner taps anything.
    const view = { session: publicSession(session, topics), topics: topics.map(publicTopic), events, agentCheck: !!agentCheck };
    // The agent's open strategy offer, answered on the card with Allow / Reject / Later.
    const offer = pendingStrategyOffer(events, topics, getStrategy);
    if (offer) view.strategyOffer = offer;
    // When the next check starts by itself (the card's countdown), or that it needs the learner's OK.
    const active = view.topics.find((t) => t.status === "active");
    if (agentCheck && active && session.status === "topic_active") {
      const policy = await topicWorkflow.policyFor({ examBoard: session.exam_board, subject: session.subject }).catch(() => null);
      const spent = await coinsSpent(session, eventLimit >= 200 ? events : null).catch(() => spentOnChecks(events));
      const due = autoStartFor(active, view.session, { spent, maxAttempts: policy?.max_attempts ?? Infinity });
      // The approved coins and what's spent: the card asks for more when the agent can't go on.
      view.coins = checkBudget(view.session, spent);
      if (due) view.nextCheck = { topicId: active.id, mode: due.mode, at: due.at || null, overEstimate: due.blocked === "over_estimate", coinsLeft: due.budget?.left ?? null, coins: due.budget?.next ?? null };
    }
    return view;
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
      if (current.state === "awaiting_teaching") return "awaiting_teaching";
      if (current.state === "retest_ready") return "retest_ready";
      if (!current.examPrepRunId && !current.checkBattleId) return "start_practice";
      const run = current.learnerConfirmedReady ? "retest_ready" : "awaiting_submission_or_teach_back";
      return run;
    })();
    return { session, topics, step, activeTopic: current || null };
  }

  return { topicNotes, coinsSpent, budgetFor, getSessionView, sessionNext };
}
