/**
 * study-prep/agent-check-run.js — the Agent Check as its own workflow, with its
 * battle in Battles and its run in the chat (2026-10-20).
 *
 *   started   start_agent_check made the battle (your teaching guide asks, your
 *             agent answers only from your notes): a `practice` workflow (child
 *             of the Study Prep one) and ONE run in the Study Prep chat — the
 *             tool row, what it means, and the check's own card (meta.agentCheck
 *             on the run's message: one tracking line + "Watch in Battles")
 *   question  each question as Sergeant marks it (from the battle worker): a
 *             tool row in that run — answered from your notes / guessed / wrong
 *   scored    the battle ended and Study Prep marked it: the result row, the run
 *             closes, the workflow completes with its outcome; Study Prep's own
 *             wake (check_scored) then says what happens next
 *
 * A retest is a new battle, a new workflow and a new run (with its own card).
 * Every line is code-written from the battle's facts — no model call, no cost.
 * Injectable; wiring.js supplies the engine, the queries and the chat.
 */
// The `practice` type is shared with the proctored assessment (Phase 9): one definition, in
// practice/workflow.js. An Agent Check run is created straight in `running`, as before.
import { practiceWorkflow } from "../practice/workflow.js";

export const agentCheckWorkflow = practiceWorkflow;

export const START_CHECK_TOOL = "study_prep.start_agent_check";
export const CHECK_QUESTION_TOOL = "study_prep.check_question";
export const CHECK_MARKED_TOOL = "study_prep.check_marked";

const OUTCOME_LINE = {
  correct: (p) => [`Q${p.order} of ${p.total} · answered from your notes`, p.note ? `From your notes on ${p.note}` : "Correct"],
  guessed_right: (p) => [`Q${p.order} of ${p.total} · guessed (right, but a guess doesn't count)`, "Nothing in your notes on it"],
  guessed: (p) => [`Q${p.order} of ${p.total} · guessed`, p.gap ? `Nothing in your notes on ${p.gap}` : "Nothing in your notes on it"],
  wrong: (p) => [`Q${p.order} of ${p.total} · answered wrong`, p.note ? `From your notes on ${p.note} — they didn't cover it right` : "From your notes — they didn't cover it right"],
  unknown: (p) => [`Q${p.order} of ${p.total} · no answer`, "Out of time, or nothing to answer from"],
};
/** PURE: a marked question as its tool row. outcome: correct | guessed | guessed_right | wrong | unknown */
export function questionRow({ order, total, outcome, note = null, gap = null }) {
  const [headline, resultLine] = (OUTCOME_LINE[outcome] || OUTCOME_LINE.unknown)({ order, total, note, gap });
  return { headline, resultLine, ok: outcome === "correct" };
}

/** PURE: the result as the run's last row. */
export function markedRow({ correct, total, outcome, thresholdPercentage = null }) {
  const verdict = outcome === "understood" ? "passed" : outcome === "capped_out" ? "below the pass mark — last try" : `below the pass mark${thresholdPercentage ? ` (${thresholdPercentage}%)` : ""}`;
  return { headline: `Marked: ${correct} of ${total} · ${verdict}`, resultLine: outcome === "understood" ? "Topic understood" : outcome === "capped_out" ? "Out of tries" : "A teaching session is offered next" };
}

export function makeAgentCheckRun({ engine, findByBattle, studyPrep, now = () => new Date().toISOString(), log = console }) {
  const quiet = (what) => (error) => { log.warn?.(`[agent-check] ${what} failed: ${error?.message || error}`); return null; };
  const toParent = (parentId, event) => (parentId ? engine.appendEvent(parentId, { actor: "agent", visibility: "learner", ...event }).catch(quiet(event.event_type)) : null);
  const toolPair = async (parentId, runId, { tool, headline, resultLine, ok = true }) => {
    await toParent(parentId, { event_type: "tool.started", category: "assessment", payload: { tool, runId, headline, narrative: headline } });
    // A miss is a row that finished with a bad result (ok:false) — not a step that failed to run.
    await toParent(parentId, { event_type: "tool.completed", category: "assessment", payload: { tool, runId, headline, narrative: headline, resultLine, ...(ok === false ? { ok: false } : {}) } });
  };

  /** start_agent_check made the battle. session: the row; topic: { id, label }. → the check's view | null */
  async function started({ session, topic, battleId, mode = "diagnostic", questions = 5, coins = 2, auto = false, charge = null }) {
    const parentId = session?.workflow_id || null;
    if (!parentId || !battleId) return null;
    const retest = mode === "retest";
    const made = await engine.create({
      workflowType: "practice", learnerId: session.learner_id, entryMode: "agent_check", state: "running",
      parent: parentId, source: { workflowId: parentId, topicId: topic.id, reason: `agent_check_${mode}` },
      idempotencyKey: `agent_check:${battleId}`,
      // charge: what was debited, so a stopped check is refunded exactly.
      metadata: { kind: "agent_check", battleId, mode, topic: topic.label, topicId: topic.id, total: questions, answered: 0, coins, studyPrepSessionId: session.id, startedAt: now(), ...(Array.isArray(charge) && charge.length ? { charge } : {}) },
    }).catch(quiet("create"));
    const child = made?.instance;
    if (!child) return null;
    if (!made.created) return checkView(child);
    const runId = `check:${battleId}`;
    const title = `${retest ? "Retest" : "Agent Check"}: ${topic.label}`;
    const label = auto ? (retest ? "The retest started by itself" : "The Agent Check started by itself") : (retest ? "You started the retest" : "You started the Agent Check");
    // The run's message carries the check's own card.
    await studyPrep.openWake?.({ sessionId: session.id, learnerId: session.learner_id, wakeId: runId, trigger: "check_started", label,
      threadTitle: `Study Prep: ${session.goal || session.subject || "your plan"}`,
      extraMeta: { agentCheck: { workflowId: child.id, battleId, topic: topic.label, mode, total: questions, title } } }).catch(quiet("run message"));
    await toParent(parentId, { event_type: "operation.started", category: "action", operation: "wake", payload: { operation: "wake", wakeId: runId, trigger: "check_started", label } });
    await toolPair(parentId, runId, { tool: START_CHECK_TOOL, headline: `Agent Check created: ${topic.label}${retest ? " (retest)" : ""}`, resultLine: `In Battles · ${questions} questions · ${coins} coins` });
    await toParent(parentId, { event_type: "activity", category: "synthesis", payload: { runId, message: `My teaching guide is asking me ${questions} questions on ${topic.label} in Battles. I can only answer from what you've taught me — I'll tell you here how each one goes.` } });
    return checkView(child);
  }

  /** Sergeant marked a question (the battle worker). */
  async function question({ battleId, order, total, outcome, note = null, gap = null }) {
    const child = await findByBattle(battleId).catch(() => null);
    if (!child || child.state !== "running") return null;
    const answered = Math.max(Number(child.metadata?.answered) || 0, Number(order) || 0);
    await engine.annotate(child.id, { answered }).catch(quiet("progress"));
    const row = questionRow({ order, total: total || child.metadata?.total, outcome, note, gap });
    await toolPair(child.parent_workflow_id, `check:${battleId}`, { tool: CHECK_QUESTION_TOOL, ...row });
    return { answered, ...row };
  }

  /** Study Prep marked it: the result row, the run closes, the workflow completes. */
  async function scored({ battleId, result, outcome, thresholdPercentage = null }) {
    const child = await findByBattle(battleId).catch(() => null);
    if (!child || child.state !== "running") return null;
    const runId = `check:${battleId}`;
    const row = markedRow({ correct: result?.correct ?? 0, total: result?.total ?? child.metadata?.total ?? 0, outcome, thresholdPercentage });
    await toolPair(child.parent_workflow_id, runId, { tool: CHECK_MARKED_TOOL, ...row });
    await toParent(child.parent_workflow_id, { event_type: "operation.completed", category: "action", operation: "wake", payload: { operation: "wake", wakeId: runId, trigger: "check_started" } });
    const outcomeFacts = { outcome, correct: result?.correct ?? null, total: result?.total ?? null, guessed: result?.guessed ?? null, gaps: (result?.gaps || []).slice(0, 4) };
    const done = await engine.transition(child.id, { from: "running", to: "completed", patch: { metadata: { result: outcomeFacts, answered: result?.total ?? child.metadata?.answered, endedAt: now() } } }).catch(quiet("complete"));
    if (done) await engine.appendEvent(done.id, { event_type: "workflow.completed", actor: "system", visibility: "learner", payload: { outcome: outcomeFacts, narrative: row.headline } }).catch(quiet("child completed"));
    return done ? checkView(done) : null;
  }

  /** The check was stopped (the learner, from the chat or the card): the run closes; Study Prep may start a new one. */
  async function stopped({ battleId, reason = "stopped_by_learner" }) {
    const child = await findByBattle(battleId).catch(() => null);
    if (!child || child.state !== "running") return null;
    const runId = `check:${battleId}`;
    await toolPair(child.parent_workflow_id, runId, { tool: CHECK_MARKED_TOOL, headline: `Agent Check stopped: ${child.metadata?.topic || "this topic"}`, resultLine: "Not marked — your coins were refunded", ok: true });
    await toParent(child.parent_workflow_id, { event_type: "operation.completed", category: "action", operation: "wake", payload: { operation: "wake", wakeId: runId, trigger: "check_started" } });
    const done = await engine.transition(child.id, { from: "running", to: "stopped", reason, patch: { metadata: { stoppedAt: now(), stopReason: reason } } }).catch(quiet("stop"));
    return done ? checkView(done) : null;
  }

  return { started, question, scored, stopped };
}

/** The check card's (and the chat tools') view of one Agent Check. */
export function checkView(instance) {
  if (!instance) return null;
  const m = instance.metadata || {};
  return {
    workflowId: instance.id, state: instance.state, battleId: m.battleId || null, topic: m.topic || null, topicId: m.topicId || null,
    mode: m.mode || "diagnostic", total: m.total || null, answered: m.answered || 0, result: m.result || null,
    studyPrepSessionId: m.studyPrepSessionId || null, startedAt: m.startedAt || null,
  };
}
