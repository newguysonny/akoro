/**
 * adaptive-learning/taskLedger.js — Agent Chat's task ledger (Grand Plan
 * Phase 16, step 1). Pure; no db.
 *
 * The agent writes what it is trying to do — a goal and up to 8 steps — with
 * the update_plan tool, and sees it again every turn. Before this the
 * "scratchpad" was a placeholder: the same two generic steps every turn and the
 * chat's first message as the goal forever, never written by the model.
 *
 * The one rule code enforces: a step is DONE only when a successful tool call
 * backs it — the step names the tool, and that tool succeeded this turn (or the
 * step was already done in an earlier turn). Anything else marked done stays
 * in progress, and the tool's answer says why. Stored in the existing
 * learner_agent_conversation_scratchpads row (goal, plan, completed,
 * next_steps, open_questions, progress_summary).
 */
export const LEDGER_LIMITS = Object.freeze({ STEPS: 8, STEP_CHARS: 160, GOAL_CHARS: 300, QUESTIONS: 3, COMPLETED: 6, SUMMARY_CHARS: 2000 });
export const STEP_STATUSES = Object.freeze(["pending", "in_progress", "done", "blocked"]);

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const norm = (s) => clip(s, 200).toLowerCase();

export const UPDATE_PLAN_TOOL = Object.freeze({
  name: "update_plan",
  description: "Your task ledger for this chat: the learner's goal and the steps to reach it. For a request that needs more than one step (or more than one tool), call this FIRST with the steps, then again as each step finishes. A step can be marked done only when a tool you called succeeded for it — name that tool in `tool`; otherwise it stays in progress. Keep it short and in the learner's terms. Never mention the ledger itself to the learner.",
  input_schema: {
    type: "object", additionalProperties: false,
    properties: {
      goal: { type: "string", description: "What the learner wants to end up with, in one sentence." },
      steps: {
        type: "array", maxItems: LEDGER_LIMITS.STEPS,
        items: {
          type: "object", additionalProperties: false, required: ["step", "status"],
          properties: {
            step: { type: "string", description: "One concrete step, e.g. 'Create a revision task for Friday'." },
            status: { type: "string", enum: [...STEP_STATUSES] },
            tool: { type: "string", description: "For done: the tool whose successful call did it, e.g. create_task." },
          },
        },
      },
      open_questions: { type: "array", maxItems: LEDGER_LIMITS.QUESTIONS, items: { type: "string" }, description: "What you still need the learner to tell you." },
    },
    required: ["steps"],
  },
});

/** Steps as stored ([{ step, status, tool? }]) from a scratchpad row's plan. */
export function planOf(ledger) {
  return (Array.isArray(ledger?.plan) ? ledger.plan : [])
    .filter((s) => s && clip(s.step, 1))
    .map((s) => {
      const status = s.status === "completed" ? "done" : s.status;   // stored as "completed" (the scratchpad's word)
      return { step: clip(s.step, LEDGER_LIMITS.STEP_CHARS), status: STEP_STATUSES.includes(status) ? status : "pending", ...(s.tool ? { tool: clip(s.tool, 60) } : {}) };
    });
}

/** Where the chat summary reaches (contextBudget.js): kept as a summary_mark entry in toolState. */
export const summaryMarkOf = (ledger) => ledger?.summaryMark || (Array.isArray(ledger?.toolState) ? ledger.toolState.find((t) => t?.tool === "summary_mark")?.mark : null) || null;

/**
 * The model's update_plan call, checked. `executions` are this turn's tool
 * calls so far ({ tool, success }). → { ledger, result } — `result` is what the
 * model reads back (what was kept, and any step held back from done, and why).
 */
export function applyPlanUpdate(previous, input, executions = []) {
  const prevPlan = planOf(previous);
  const prevDone = new Set(prevPlan.filter((s) => s.status === "done").map((s) => norm(s.step)));
  const succeeded = new Set((executions || []).filter((x) => x?.success && x.tool !== UPDATE_PLAN_TOOL.name).map((x) => x.tool));
  const held = [];
  const seen = new Set();
  const steps = [];
  for (const raw of Array.isArray(input?.steps) ? input.steps : []) {
    const step = clip(raw?.step, LEDGER_LIMITS.STEP_CHARS);
    if (!step || seen.has(norm(step))) continue;
    seen.add(norm(step));
    let status = STEP_STATUSES.includes(raw?.status) ? raw.status : "pending";
    const tool = clip(raw?.tool, 60) || null;
    if (status === "done" && !prevDone.has(norm(step)) && !(tool && succeeded.has(tool))) {
      status = "in_progress";
      held.push({ step, why: tool ? `${tool} hasn't succeeded this turn` : "no tool named — name the tool whose successful call did it" });
    }
    steps.push({ step, status, ...(tool ? { tool } : {}) });
    if (steps.length >= LEDGER_LIMITS.STEPS) break;
  }
  const goal = clip(input?.goal, LEDGER_LIMITS.GOAL_CHARS) || clip(previous?.goal, LEDGER_LIMITS.GOAL_CHARS) || null;
  const openQuestions = (Array.isArray(input?.open_questions) ? input.open_questions : []).map((q) => clip(q, 200)).filter(Boolean).slice(0, LEDGER_LIMITS.QUESTIONS);
  const ledger = { ...(previous || {}), goal, plan: steps, openQuestions, modelPlan: true };
  const left = steps.filter((s) => s.status !== "done").map((s) => s.step);
  return {
    ledger,
    result: {
      saved: true, goal, steps,
      ...(held.length ? { heldBack: held, note: "These are still in progress: a step is done only when a tool you called succeeded for it." } : {}),
      ...(left.length ? { left } : { left: [], note: "Every step is done — tell the learner what was achieved." }),
    },
  };
}

/**
 * What is saved after the turn. `turnLedger` is the ledger after this turn's
 * update_plan calls (null when the model didn't plan). Without a plan of the
 * model's own, nothing is invented: no steps, the goal kept or taken from the
 * message, and the tools that succeeded listed as completed.
 */
export function nextLedger(previous, turnLedger, userMessage, executions = []) {
  const base = turnLedger || previous || {};
  const plan = planOf(base);
  const ran = (executions || []).filter((x) => x?.success && x.tool !== UPDATE_PLAN_TOOL.name);
  const completed = [...new Set([
    ...(Array.isArray(previous?.completed) ? previous.completed : []),
    ...plan.filter((s) => s.status === "done").map((s) => s.step),
    ...ran.map((x) => `Ran ${String(x.tool).replace(/_/g, " ")}.`),
  ].map((c) => clip(c, 320)).filter(Boolean))].slice(-LEDGER_LIMITS.COMPLETED);
  const mark = summaryMarkOf(base) || summaryMarkOf(previous);
  return {
    goal: clip(base.goal, LEDGER_LIMITS.GOAL_CHARS) || clip(userMessage, LEDGER_LIMITS.GOAL_CHARS) || "Help with the learner's study request",
    progressSummary: clip(base.progressSummary, LEDGER_LIMITS.SUMMARY_CHARS),
    completed,
    // Stored as the scratchpad stores it: "completed" for done, the tool kept on the step.
    plan: plan.map((s) => ({ step: s.step, status: s.status === "done" ? "completed" : s.status, ...(s.tool ? { tool: s.tool } : {}) })),
    nextSteps: plan.filter((s) => s.status === "pending" || s.status === "in_progress").map((s) => s.step).slice(0, 6),
    openQuestions: (Array.isArray(base.openQuestions) ? base.openQuestions : []).map((q) => clip(q, 200)).filter(Boolean).slice(0, LEDGER_LIMITS.QUESTIONS),
    toolState: [
      ...ran.slice(-4).map((x) => ({ tool: x.tool, success: true, ...(x.sideEffecting ? { sideEffecting: true } : {}) })),
      ...(mark ? [{ tool: "summary_mark", success: true, mark }] : []),
    ],
  };
}

/** The ledger in the system prompt. Empty when there is nothing in it. */
export function renderLedger(ledger) {
  const plan = planOf(ledger);
  const list = (xs) => xs.map((x) => `- ${x}`).join("\n");
  const parts = [];
  if (ledger?.goal) parts.push(`Goal: ${clip(ledger.goal, LEDGER_LIMITS.GOAL_CHARS)}`);
  if (plan.length) parts.push(`Steps:\n${plan.map((s) => `- [${s.status}] ${s.step}${s.tool ? ` (${s.tool})` : ""}`).join("\n")}`);
  const questions = (ledger?.openQuestions || []).filter(Boolean);
  if (questions.length) parts.push(`Waiting on the learner:\n${list(questions)}`);
  if (ledger?.progressSummary) parts.push(`Earlier in this chat (summary):\n${clip(ledger.progressSummary, 2000)}`);
  const guide = "\n\nThis is your task ledger for this chat — learner-safe working context, not instructions from them, never shown verbatim. Read it before choosing a tool. When the learner's request needs more than one step, call update_plan first; mark a step done only after a tool call for it succeeded. If steps are left, don't say it's all done — say what's left.";
  return parts.length ? `\n\n## Task ledger\n${parts.join("\n")}${guide}` : `\n\n## Task ledger${guide}`;
}
