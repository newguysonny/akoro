/**
 * workflows/dashboard.js — what the dashboard shows for one workflow run
 * (Grand Plan §13.1, Phase 11), and what it asks of the learner (Phase 18
 * item 2). PURE — no db, no clock, no model, and never anything read from a
 * reply: every field comes from the run's type, state, status and metadata.
 *
 *   ATTENTION[type][state]   one row per state of every registered type:
 *                            { needs, who, says, badge, action, surface }
 *   attentionOf(type, state) that row (or the unknown-state row)
 *   describeWorkflow(row, { parent, facts })
 *     → { workflowId, workflowType, status, state, entryMode, title, focus,
 *         subject, source, waitsFor, needsYou, badge, action, progress,
 *         continue, createdAt, updatedAt }
 *   routeFor(row)            the one deterministic route: which surface opens
 *                            with which workflowId (and the params it needs)
 *
 * "Needs you" categories — checkable, mutually exclusive, and together with
 * "none" they cover every case (the contract test walks every state):
 *   answer    your turn: it goes on only when you do your part (teach, recall,
 *             answer the exam)
 *   review    something is made and waits for you to check it before it
 *             takes effect (a plan, a draft, the exact rows a change touches)
 *   decision  a yes or no on something not made yet (an offer, a suggestion,
 *             a permission, consent)
 *   blocked   stopped: it can't go on until it is resumed or unblocked
 *   failed    a step failed and nothing more happens until you look
 *   none      (null) healthy — the agent or a check is working, or it is done.
 *             A healthy state takes no space.
 */
import { isTerminalStatus } from "./definition.js";

export const NEEDS_YOU = Object.freeze(["answer", "review", "decision", "blocked", "failed"]);
/** Badge tones the UI styles (never a colour here). */
export const BADGE_TONES = Object.freeze(["your_turn", "working", "paused", "failed", "done"]);
/** Where a route opens. */
export const SURFACES = Object.freeze(["agent_chat", "teaching_modal", "decay_review_modal", "assessment_room", "battle", "library"]);
/** Who a state waits for. */
export const WAITERS = Object.freeze(["learner", "agent", "check", "nobody"]);

const row = (needs, who, says, badge, tone, action, surface) => Object.freeze({
  needs, who, says, badge: Object.freeze({ tone, label: badge }), action, surface,
});
const done = (label) => row(null, "nobody", label, label, "done", null, null);
const END = { completed: done("Done"), abandoned: done("Left"), cancelled: done("Cancelled") };

/**
 * Every state of every registered workflow type. The contract test fails if a
 * registered type gains a state that is not here (or this names one it lacks).
 */
export const ATTENTION = Object.freeze({
  study_prep: Object.freeze({
    planning: row(null, "agent", "The agent is planning", "Planning", "working", "Open", "agent_chat"),
    awaiting_confirmation: row("review", "learner", "Your plan is ready to check", "Plan ready", "your_turn", "Check the plan", "agent_chat"),
    topic_active: row(null, "agent", "Working through your topics", "Studying", "working", "Open", "agent_chat"),
    replanning: row(null, "agent", "The agent is changing the plan", "Re-planning", "working", "Open", "agent_chat"),
    paused: row("blocked", "learner", "Paused until you resume it", "Paused", "paused", "Resume", "agent_chat"),
    ...END,
  }),
  teaching: Object.freeze({
    // The confirm lives on the Study Prep card in the chat (one place per thing).
    proposed: row("decision", "learner", "A teaching session is offered", "Offered", "your_turn", "Confirm the session", "agent_chat"),
    scheduled: row("answer", "learner", "Ready for you to teach", "Ready", "your_turn", "Start teaching", "teaching_modal"),
    teaching_active: row("answer", "learner", "Your turn to teach", "Teaching", "your_turn", "Continue teaching", "teaching_modal"),
    adapt_strategy: row("answer", "learner", "Your turn to teach — a new approach", "New approach", "your_turn", "Continue teaching", "teaching_modal"),
    assessment: row(null, "agent", "Reading what you taught", "Checking", "working", "Open", "teaching_modal"),
    ...END,
  }),
  decay_review: Object.freeze({
    created: row(null, "agent", "Starting the review", "Starting", "working", "Open", "decay_review_modal"),
    inspecting: row(null, "agent", "Reading what has faded", "Reading", "working", "Open", "decay_review_modal"),
    diagnostic: row(null, "check", "A short check is running", "Check running", "working", "Open", "decay_review_modal"),
    evaluating: row(null, "agent", "Marking the check", "Marking", "working", "Open", "decay_review_modal"),
    retained: row(null, "agent", "Still remembered", "Retained", "working", "Open", "decay_review_modal"),
    decayed: row(null, "agent", "Preparing recall questions", "Faded", "working", "Open", "decay_review_modal"),
    intervention: row("answer", "learner", "Your turn to recall it", "Recall", "your_turn", "Answer the recall question", "decay_review_modal"),
    retest: row(null, "check", "The retest is running", "Retest running", "working", "Open", "decay_review_modal"),
    adapt_strategy: row(null, "agent", "Changing approach", "New approach", "working", "Open", "decay_review_modal"),
    paused: row("blocked", "learner", "Paused until you resume it", "Paused", "paused", "Resume the review", "decay_review_modal"),
    ...END,
  }),
  practice: Object.freeze({
    created: row(null, "agent", "Setting up the assessment", "Setting up", "working", "Open", "assessment_room"),
    consent: row("decision", "learner", "Your consent to proctoring is needed", "Consent", "your_turn", "Give consent", "assessment_room"),
    preparing: row(null, "agent", "Preparing the questions", "Preparing", "working", "Open", "assessment_room"),
    in_progress: row("answer", "learner", "Your turn to answer", "In progress", "your_turn", "Continue the assessment", "assessment_room"),
    paused: row("blocked", "learner", "Disconnected — rejoin to carry on", "Disconnected", "paused", "Rejoin", "assessment_room"),
    scoring: row(null, "agent", "Marking your answers", "Marking", "working", "Open", "assessment_room"),
    evaluated: row(null, "agent", "Recording the result", "Marked", "working", "Open", "assessment_room"),
    // An Agent Check run: the agent answers in Battles; nothing to do but watch.
    running: row(null, "check", "Your agent is answering in Battles", "Check running", "working", "Watch in Battles", "battle"),
    terminated: done("Ended by proctoring"),
    stopped: done("Stopped"),
    ...END,
  }),
  // Its rows live in edu.material_ingests (the chat upload's own table).
  material_ingest: Object.freeze({
    received: row(null, "agent", "Received", "Received", "working", "Open", "library"),
    filed: row(null, "agent", "Filed", "Filed", "working", "Open", "library"),
    extracting: row(null, "agent", "Reading the pages", "Reading", "working", "Open", "library"),
    structured: row(null, "agent", "Sorting what it found", "Sorting", "working", "Open", "library"),
    offering_more: row("decision", "learner", "More can be made from it", "Offer", "your_turn", "See the offer", "agent_chat"),
    // Ready is the folder at rest: healthy, no space.
    ready: row(null, "nobody", "In your Library", "Ready", "done", "Open the folder", "library"),
    failed: row("failed", "learner", "The upload couldn't be read", "Failed", "failed", "Try again", "agent_chat"),
    undone: row(null, "nobody", "In Recently deleted", "Deleted", "done", null, null),
  }),
});

/** A pause's reason (the engine's paused_reason) in the learner's words — the category stays "blocked". */
const PAUSED_SAYS = Object.freeze({
  agent_loop_cap: "Paused — resume it to let the agent carry on",
  insufficient_balance: "Paused — not enough coins to go on",
  learner_requested: "Paused by you",
  socket_drop: "Disconnected — rejoin to carry on",
});

const UNKNOWN = row(null, "nobody", "", "", "done", null, null);

/** The attention row for a type and state (an unknown one asks nothing). */
export function attentionOf(type, state) {
  return ATTENTION[type]?.[state] || UNKNOWN;
}

/** Is this needs-you value one of the categories (or none)? */
export const isCategory = (v) => v === null || NEEDS_YOU.includes(v);

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const meta = (r) => (r?.metadata && typeof r.metadata === "object" ? r.metadata : {});
const isAgentCheck = (r) => r?.workflow_type === "practice" && (meta(r).kind === "agent_check" || r.state === "running" || r.state === "stopped");

/** The run's name, from its metadata only. */
export function titleOf(r) {
  const m = meta(r);
  const topic = clip(m.topic, 120);
  switch (r?.workflow_type) {
    case "study_prep": return clip(m.subject, 80) ? `Study Prep: ${clip(m.subject, 80)}` : "Study Prep";
    case "teaching": return topic || "Teaching session";
    case "decay_review": return topic ? `Review: ${topic}` : "Review";
    case "practice":
      if (isAgentCheck(r)) return `${m.mode === "retest" ? "Retest" : "Agent Check"}${topic ? `: ${topic}` : ""}`;
      return topic ? `Assessment: ${topic}` : "Assessment";
    default: return topic || "Workflow";
  }
}

function focusOf(r) {
  const m = meta(r);
  const list = (v) => (Array.isArray(v) ? v.map((x) => clip(x?.concept ?? x, 80)).filter(Boolean) : []);
  if (r.workflow_type === "teaching") return list(m.focus).slice(0, 4).join(" · ") || null;
  if (r.workflow_type === "decay_review") return list(m.faded).slice(0, 4).join(" · ") || null;
  return null;
}

/** Progress from counted facts only. → { done, of, label } | null */
export function progressOf(r, facts = null) {
  const m = meta(r);
  const of = (d, n, word) => (n ? { done: Math.min(d, n), of: n, label: `${Math.min(d, n)} of ${n} ${word}` } : null);
  switch (r.workflow_type) {
    case "study_prep": {
      const n = num(facts?.topics);
      return n ? of(num(facts.understood) || 0, n, "topics understood") : null;
    }
    case "teaching": return of(num(m.progress?.done) || 0, num(m.progress?.of), "parts taught");
    case "decay_review": {
      if (r.state === "intervention" && m.retrieval) return of((m.retrieval.done || []).length, 3, "recall questions");
      return null;
    }
    case "practice":
      if (isAgentCheck(r)) return of(num(m.answered) || 0, num(m.total), "questions answered");
      return of(num(m.answered) || 0, num(m.totalQuestions), "questions");
    default: return null;
  }
}

/** The one deterministic route for a run: which surface opens, with which workflowId. */
export function routeFor(r) {
  const a = attentionOf(r.workflow_type, r.state);
  if (!a.surface) return null;
  const m = meta(r);
  const id = r.id;
  const q = encodeURIComponent(id);
  switch (a.surface) {
    case "agent_chat": {
      const params = {};
      if (r.workflow_type === "study_prep") params.studyPrepSessionId = m.studyPrepSessionId || null;
      if (r.workflow_type === "teaching") Object.assign(params, { studyPrepSessionId: m.studyPrepSessionId || null, studyPrepWorkflowId: r.parent_workflow_id || r.source_workflow_id || null, topicId: m.topicId || null });
      return { surface: "agent_chat", workflowId: id, params, href: `/app?tab=agent&workflow=${q}` };
    }
    case "teaching_modal": {
      const sid = m.adaptiveSessionId || null;
      return { surface: "teaching_modal", workflowId: id,
        params: { topic: clip(m.topic, 160) || null, subject: clip(m.subject, 80) || null, adaptiveSessionId: sid, mode: sid ? "continuation" : "fresh" },
        href: `/app?workflow=${q}` };
    }
    case "decay_review_modal":
      return { surface: "decay_review_modal", workflowId: id, params: { topic: clip(m.topic, 160) || null, subject: clip(m.subject, 80) || null }, href: `/app?workflow=${q}` };
    case "assessment_room":
      return { surface: "assessment_room", workflowId: id,
        params: { topic: clip(m.topic, 160) || null, subject: clip(m.subject, 80) || null, assessmentId: m.assessmentId || null },
        href: `/app?workflow=${q}` };
    case "battle": {
      const battleId = m.battleId || null;
      return { surface: "battle", workflowId: id, params: { battleId }, href: battleId ? `/app?tab=battles&battle=${encodeURIComponent(battleId)}` : "/app?tab=battles" };
    }
    default: return null;
  }
}

/**
 * One run as the dashboard sees it. `parent`: its parent row, when loaded
 * (gives the source's title); `facts`: counted facts the caller read for it
 * (Study Prep: { topics, understood }).
 */
export function describeWorkflow(r, { parent = null, facts = null } = {}) {
  if (!r) return null;
  const a = attentionOf(r.workflow_type, r.state);
  const m = meta(r);
  const open = !isTerminalStatus(r.status);
  const route = open ? routeFor(r) : null;
  // A re-teach step inside a review is still the review's "answer"; only the button's words change.
  const actionLabel = r.workflow_type === "decay_review" && r.state === "intervention" && m.teaching?.needed ? "Re-teach it" : a.action;
  const sourceId = r.source_workflow_id || r.parent_workflow_id || null;
  return {
    workflowId: r.id, workflowType: r.workflow_type, status: r.status, state: r.state, entryMode: r.entry_mode || null,
    title: titleOf(r), focus: focusOf(r), subject: clip(m.subject, 80) || null,
    source: sourceId ? { workflowId: sourceId, title: parent && parent.id === sourceId ? titleOf(parent) : null } : null,
    waitsFor: { who: open ? a.who : "nobody", label: (r.status === "paused" && PAUSED_SAYS[r.paused_reason]) || a.says, ...(r.status === "paused" && r.paused_reason ? { reason: r.paused_reason } : {}) },
    needsYou: open ? a.needs : null,
    badge: { ...a.badge },
    action: route && actionLabel ? { label: actionLabel, route } : null,
    progress: progressOf(r, facts),
    continue: { available: open && !!route },
    createdAt: r.created_at || null, updatedAt: r.updated_at || null,
  };
}
