/**
 * study-prep/wake.js — the agent keeps working after the plan is ready
 * (2026-10-19). PURE — no db, no LLM, no clock reads (`now` is passed in).
 *
 * Each learner action or result that moves the session WAKES the agent for
 * a short run (WAKE_DECISIONS decisions: thought → tool → message), shown in
 * the chat as its own agent message. What must happen deterministically
 * (confirming, charging, scoring, the 1-minute auto-start) is code; the wake
 * explains it and decides what the agent may decide (move on, set a topic
 * aside, conclude).
 *
 *   WAKE_TRIGGERS          what wakes the agent, and the goal it gets
 *   wakeGoal(trigger, f)   the wake's goal line for the agent
 *   checkBudget(s, spent)  the approved estimate for Agent Checks vs. what's spent
 *   autoStartFor(t, s, o)  when (and how) the next Agent Check starts by itself
 *   settleStep(view)       the deterministic next step after a wake, if any
 */
import { STUDY_PREP_COST } from "./education-engine.js";

/** About what one decision of a wake costs (measured 2026-10-19 on the sandbox: ~3 coins). */
export const COINS_PER_DECISION = 3;

/** Decisions per wake (the user's call, 2026-10-19 — adjustable later). */
export const WAKE_DECISIONS = 4;
/** An Agent Check starts by itself after this long without a tap (first checks and retests). */
export const AUTO_START_MS = 60_000;

/** The actions that end a wake (the terminal actions + waiting for the learner). */
export const WAKE_FINAL_ACTIONS = Object.freeze(["wait_for_learner", "advance_topic", "defer_topic", "conclude_session"]);

const GOALS = {
  plan_adjusted: "The learner adjusted the plan. Check the new plan (plan.validate on the new order) and tell them what changed and what it now costs. Then wait for them to approve it.",
  plan_confirmed: "The learner approved the plan. Look at the first topic (session.get_state, topic.get_notes) and tell them how it will start: the Agent Check starts by itself in a minute, or when they tap Start now. Then wait.",
  topic_started: "A new topic just started. Review what the learner has taught you on it (topic.get_notes) and their past practice, tell them what to expect from the Agent Check (it starts by itself in a minute), then wait.",
  check_scored: "An Agent Check was just marked. Read the result (session.get_state). Passed: say so and advance_topic (or conclude_session when no topic is left). Below the pass mark with tries left: a teaching session on what you missed has been offered on the card (session.get_state shows it) — name what you missed, and say the session is set up by itself in a minute if they don't confirm, then waits on their dashboard; the retest starts when they finish teaching. Then wait. Out of tries: defer_topic (one deferred retry per session) or advance_topic, and say why.",
  teach_back: "The learner says they taught you what you missed. Acknowledge it in one line: the new Agent Check starts by itself in a minute, or when they tap Start now. Then wait.",
  over_estimate: "The next Agent Check would go past the coins the learner approved. Tell them how many coins are left of the estimate and that the next check needs their OK (the card has the button). Then wait.",
  coins_approved: "The learner approved more coins. Say what happens next with them (the check that was waiting starts by itself), then wait.",
  teaching_done: "The learner finished the teaching session on this topic (from their dashboard). Read what it covered (session.get_state, topic.get_notes): name one or two things they taught you, in their words where you can. The retest starts by itself in a minute, or when they tap Start now. Then wait.",
};
export const WAKE_TRIGGERS = Object.freeze(Object.keys(GOALS));

/** What the learner did (or what happened), as the wake's opening line in the chat. */
export const WAKE_LABELS = Object.freeze({
  plan_adjusted: "You adjusted the plan", plan_confirmed: "You approved the plan", topic_started: "A new topic started",
  check_scored: "An Agent Check was marked", teach_back: "You taught it back", over_estimate: "The estimate is used up",
  coins_approved: "You approved more coins", teaching_done: "You finished teaching",
});

export function wakeGoal(trigger, facts = {}) {
  const base = GOALS[trigger] || GOALS.topic_started;
  const topic = facts.topic ? ` Topic: ${String(facts.topic).slice(0, 120)}.` : "";
  return `${base}${topic} You have ${WAKE_DECISIONS} decisions; talk to the learner at each one, and end with wait_for_learner unless you moved the session on.`;
}

/**
 * The coins the learner approved for the session (the plan's estimate, plus
 * any "Approve N more") against what the session has charged: its Agent
 * Checks and the agent's wakes. Neither goes past it without asking.
 */
export function checkBudget(session, spent = 0) {
  const approved = (Number(session?.estimate?.totalCoins ?? 0) || 0) + (Number(session?.estimate?.extraCoins ?? 0) || 0);
  const coins = STUDY_PREP_COST.COINS_PER_PRACTICE;
  const used = Math.max(0, Number(spent) || 0);
  const left = Math.max(0, approved - used);
  return { approved, spent: used, left, next: coins, withinEstimate: used + coins <= approved,
    // The decisions the agent can take in a wake inside what's left (0 = it asks first).
    wakeDecisions: Math.min(WAKE_DECISIONS, Math.floor(left / COINS_PER_DECISION)) };
}

/** Coins charged by the checks this session started (from its events). */
export function spentOnChecks(events = []) {
  return (events || []).reduce((sum, e) => {
    const node = e.decision_node || e.decisionNode;
    if (node !== "agent_check_started" && node !== "practice_generated") return sum;
    return sum + (Number(e.facts?.coins) || 0);
  }, 0);
}

/**
 * When the active topic's next Agent Check starts by itself: a first check
 * a minute after the topic started, a retest a minute after the learner
 * taught it back. Never while one runs, after a marked check that is waiting
 * for a teach-back, past the attempt cap, or past the approved estimate
 * (then the learner is asked). → { at, mode } | { blocked } | null
 */
export function autoStartFor(topic, session, { spent = 0, maxAttempts = Infinity } = {}) {
  if (!topic || topic.status !== "active" || session?.status !== "topic_active") return null;
  const running = topic.checkBattleId && !topic.checkScoredAt;
  if (running) return null;
  if (Number(topic.attemptsUsed || 0) >= Number(maxAttempts)) return null;
  const firstCheck = !topic.checkBattleId && !topic.examPrepRunId && topic.checkMode !== "skipped";
  const retest = Boolean(topic.learnerConfirmedReady);
  if (!firstCheck && !retest) return null;
  const mode = retest ? "retest" : "diagnostic";
  const budget = checkBudget(session, spent);
  if (!budget.withinEstimate) return { blocked: "over_estimate", mode, budget };
  const since = Date.parse(topic.updatedAt || "") || 0;
  return { at: new Date(since + AUTO_START_MS).toISOString(), mode, budget };
}

/**
 * After a wake: what code does if the agent left the session without a next
 * step (a settled topic and nothing active). → "advance" | "conclude" | null
 */
export function settleStep(view) {
  const session = view?.session;
  if (!session || session.status !== "topic_active") return null;
  const topics = view.topics || [];
  if (topics.some((t) => t.status === "active")) return null;
  return topics.some((t) => t.status === "queued") ? "advance" : "conclude";
}
