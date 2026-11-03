/**
 * practice/controller.js — one turn of the proctored assessment (Grand Plan
 * §11.5, Phase 9).
 *
 *   ① pre-step (harness, always): Sergeant judges the answer against the
 *      rubric (assessor role, locked — D23). The judgement is a PROPOSAL; the
 *      score comes from practice/workflow.js at the end.
 *   ② the agent (≤3 picks, 8 s each) decides what happens next:
 *        assessment_ask_next   the next question in the generated order
 *        assessment_probe      ONE follow-up on the same question
 *        assessment_give_hint  a hint (the hint policy and its deduction are code's)
 *      Anything invalid, slow or missing → the fallback: ask the next question
 *      (today's behaviour). Rejected picks come back as observations.
 *   ③ post-step (harness): progress; integrity is the gateway's, never the agent's.
 *
 * The agent never sees raw frames, the cheat probability, the score or the
 * verdict, and cannot end, pause or soften the exam. `decide` is injectable.
 */
import { PRACTICE_POLICY, hintAllowed } from "./workflow.js";

export const PRACTICE_AGENT_POLICY_VERSION = "practice-agent-v1";
export const PRACTICE_TOOLS = Object.freeze(["assessment_ask_next", "assessment_probe", "assessment_give_hint"]);

export function practiceControllerTools() {
  return [
    { type: "function", function: { name: "assessment_ask_next", description: "Move on: ask the next question in the order Sergeant generated (or finish if it was the last).", parameters: { type: "object", properties: {} } } },
    { type: "function", function: { name: "assessment_probe", description: `Ask ONE follow-up on the same question to see how deep the understanding goes (at most ${PRACTICE_POLICY.MAX_PROBES_PER_QUESTION} per question). Good after an answer that is right but thin, or partly right.`, parameters: { type: "object", properties: { focus: { type: "string", description: "What the follow-up should test." } } } } },
    { type: "function", function: { name: "assessment_give_hint", description: `Give a hint and let the candidate answer again (at most ${PRACTICE_POLICY.MAX_HINTS_PER_QUESTION} per question and ${PRACTICE_POLICY.MAX_HINTS_PER_SESSION} per exam; each hint costs ${PRACTICE_POLICY.HINT_DEDUCTION} points on that question). Only when the candidate is close but stuck.`, parameters: { type: "object", properties: {} } } },
  ];
}

/** PURE: what the agent decides from — no score totals, no integrity signals, no answer keys. */
export function practiceDecisionState({ proctor, judgement }) {
  const rec = proctor.record() || {};
  const session = (proctor.records || []).filter(Boolean).reduce((n, r) => n + (r.hints || 0), 0);
  return {
    topic: proctor.topic,
    question: { number: proctor.index + 1, of: proctor.questions.length, objective: rec.objective, difficulty: rec.difficulty },
    lastAnswer: { wasFollowUp: !!judgement?.probing, correct: judgement?.correct ?? null, judgedScore: judgement?.score ?? null, feedback: String(judgement?.feedback || "").slice(0, 300) },
    used: { hintsThisQuestion: rec.hints || 0, hintsThisExam: session, probesThisQuestion: rec.probes || 0 },
    limits: { hintsPerQuestion: PRACTICE_POLICY.MAX_HINTS_PER_QUESTION, hintsPerExam: PRACTICE_POLICY.MAX_HINTS_PER_SESSION, probesPerQuestion: PRACTICE_POLICY.MAX_PROBES_PER_QUESTION },
  };
}

/** PURE: may this pick run now? → { ok } | { ok:false, error } */
export function validatePracticeDecision(decision, state) {
  if (!decision || !PRACTICE_TOOLS.includes(decision.tool)) return { ok: false, error: "unknown_tool" };
  if (decision.tool === "assessment_probe") {
    if (state.lastAnswer.wasFollowUp) return { ok: false, error: "already_probed" };
    if (state.used.probesThisQuestion >= PRACTICE_POLICY.MAX_PROBES_PER_QUESTION) return { ok: false, error: "probe_limit_question" };
  }
  if (decision.tool === "assessment_give_hint") {
    const h = hintAllowed({ hintsThisQuestion: state.used.hintsThisQuestion, hintsThisSession: state.used.hintsThisExam });
    if (!h.ok) return h;
    if (state.lastAnswer.correct === true && (state.lastAnswer.judgedScore ?? 0) >= PRACTICE_POLICY.PASS_AT) return { ok: false, error: "hint_not_needed" };
  }
  return { ok: true };
}

async function modelDecide({ state, observations, userId }) {
  const { openai } = await import("../../../lib/aiModel.js");
  const system = [
    "You run one turn of a proctored exam conducted by Sergeant. The candidate just answered; Sergeant has judged it.",
    "Decide what happens next with ONE tool: ask_next (move on), probe (one follow-up on the same question when the answer was right but thin or partly right), or give_hint (only when the candidate is close but stuck — hints cost points).",
    "You do not score, grade or decide anything about integrity. When unsure, ask_next.",
  ].join(" ");
  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini", temperature: 0,
    messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify({ state, observations }) }],
    tools: practiceControllerTools(), tool_choice: "required",
    __role: "controller", __feature: "practice_controller", __userId: userId, __timeoutMs: PRACTICE_POLICY.DECISION_TIMEOUT_MS + 4_000, __maxRetries: 0,
  });
  const call = res.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.name) return null;
  let args = {};
  try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
  return { tool: call.function.name, args };
}

const withTimeout = (promise, ms) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("decision timed out"), { code: "timeout" })), ms); })])
    .finally(() => clearTimeout(timer));
};

/**
 * Run one turn. → { eval, hint, probe, advanced, done, nextQuestion, progress, suspicious, agent }
 * `agent` is the audit record: { picks:[{tool,args,ok,error}], chosen, fallback, reason }.
 */
export async function conductPracticeTurn({ proctor, answer, cheatProbability = 0, decide = modelDecide, userId = null, policy = PRACTICE_POLICY }) {
  if (!proctor.currentQuestion()) return { done: true };
  // ① pre-step: Sergeant's judgement (a proposal).
  const judgement = await proctor.judge(answer);

  // ② the agent picks the next move.
  const picks = [];
  const observations = [];
  let chosen = null;
  let reason = null;
  for (let i = 0; i < policy.MAX_ITERATIONS && !chosen; i++) {
    const state = practiceDecisionState({ proctor, judgement });
    let decision = null;
    try { decision = await withTimeout(Promise.resolve(decide({ state, observations, userId })), policy.DECISION_TIMEOUT_MS); }
    catch (e) { reason = e?.code === "timeout" ? "timeout" : "decision_error"; break; }
    if (!decision) { reason = "no_decision"; break; }
    const v = validatePracticeDecision(decision, state);
    picks.push({ tool: decision.tool, args: decision.args || {}, ok: v.ok, error: v.error || null });
    if (v.ok) chosen = decision;
    else observations.push({ tool: decision.tool, error: v.error });
  }
  const fallback = !chosen;
  if (fallback) { chosen = { tool: "assessment_ask_next", args: {} }; reason ||= "invalid_picks"; }

  // Execute the pick (a failed hint/probe generation also falls back to the next question).
  let hint = null;
  let probe = null;
  let advanced = false;
  try {
    if (chosen.tool === "assessment_give_hint") hint = await proctor.hint(answer, judgement);
    else if (chosen.tool === "assessment_probe") probe = await proctor.probe(answer, judgement, { focus: chosen.args?.focus });
  } catch { hint = null; probe = null; }
  if (!hint && !probe) {
    if (chosen.tool !== "assessment_ask_next") { chosen = { tool: "assessment_ask_next", args: {} }; reason = "step_failed"; }
    proctor.advance();
    advanced = true;
  }

  // ③ post-step.
  return {
    eval: judgement,
    hint, probe, advanced,
    done: proctor.index >= proctor.questions.length,
    nextQuestion: advanced ? proctor.currentQuestion() : null,
    progress: { index: proctor.index, total: proctor.questions.length },
    // A strong answer under elevated proctoring signals is shown as flagged (display only; the verdict is code's).
    suspicious: cheatProbability >= 0.5 && (judgement?.score ?? 0) >= 70,
    agent: { policyVersion: PRACTICE_AGENT_POLICY_VERSION, picks, chosen: chosen.tool, fallback: fallback || reason === "step_failed", reason: fallback || reason === "step_failed" ? reason : null },
  };
}
