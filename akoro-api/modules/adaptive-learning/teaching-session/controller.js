/**
 * teaching-session/controller.js — one agent-driven teaching turn (Grand Plan
 * §9.3, Phase 6).
 *
 *   ① harness pre-steps (always):   load_session_state · observe_teaching_evidence
 *   ② the teaching agent (≤3 decisions, 8 s each): read the state, pick a
 *      strategy, set a coaching focus — then ONE reply: the protégé's move
 *      (teach_agent) or NaNa's (learn_with_guide); or propose finishing /
 *      pausing. Anything invalid, slow or missing → the fallback reply the
 *      evidence suggests (decision.fallback).
 *   ③ harness post-steps (always):  assess · persist · record · coach (teach
 *      mode) · gate_teaching_progress — the gate is the only thing that moves
 *      the session.
 *
 * The agent proposes; nothing it generates can skip the evidence or the gate.
 * The learner always gets exactly one reply per turn. `decide` is injectable
 * (tests); production asks the controller model with function tools.
 */
import { createTeachingTurnTools, currentTeachingStrategy, recordTeachingStrategyOutcome } from "../teaching-workflow/tools.js";
import { TEACHING_TURN_TOOL_CATALOG } from "../teaching-workflow/catalog.js";
import {
  TEACHING_POLICY, PROTEGE_MOVES, GUIDE_MOVES, TEACHING_STRATEGIES, TOOLS_BY_MODE, TERMINAL_TOOLS, PLAN_NAME,
  normaliseMode, fallbackReply, validateDecision, objectiveMet, boundedEnd, teachingStrategy,
} from "./policy.js";
import { guideTeach } from "./guideTeacher.js";

export const AGENT_TURN_POLICY_VERSION = "adaptive-teaching-agent-v1";
const LABELS = Object.fromEntries(TEACHING_TURN_TOOL_CATALOG.map((t) => [t.name, t.label]));
const AGENT_LABELS = {
  teaching_get_state: "Looking at where the session is",
  strategy_select: "Choosing how to teach this",
  guide_coach: "Planning a teaching nudge",
  protege_respond: "Preparing the protégé's reply",
  guide_teach: "Preparing the guide's reply",
  teaching_propose_complete: "Checking whether the session is complete",
  teaching_propose_pause: "Pausing the session",
  assess_learner_response: "Checking your answer",
};

/** The function tools the controller model sees, per mode. */
export function controllerTools(mode) {
  const defs = {
    teaching_get_state: { description: "Read where the session is: phase, the part being taught, the evidence so far, turns used, the strategy.", parameters: { type: "object", properties: {} } },
    strategy_select: { description: `Change how this session teaches (at most ${TEACHING_POLICY.MAX_STRATEGY_CHANGES} changes per session). Use when the current approach isn't landing.`, parameters: { type: "object", properties: { strategy: { type: "string", enum: TEACHING_STRATEGIES }, reason: { type: "string" } }, required: ["strategy"] } },
    guide_coach: { description: "Set what NaNa's next coaching ideas for the learner should focus on (the protégé's reply still follows).", parameters: { type: "object", properties: { focus: { type: "string" } }, required: ["focus"] } },
    protege_respond: { description: "END THE TURN with the protégé's reply to the learner, in one move.", parameters: { type: "object", properties: { move: { type: "string", enum: Object.keys(PROTEGE_MOVES), description: Object.entries(PROTEGE_MOVES).map(([k, v]) => `${k}: ${v}`).join("; ") }, focusConcept: { type: "string" } }, required: ["move"] } },
    guide_teach: { description: "END THE TURN with NaNa's teaching reply to the learner, in one move.", parameters: { type: "object", properties: { move: { type: "string", enum: Object.keys(GUIDE_MOVES), description: Object.entries(GUIDE_MOVES).map(([k, v]) => `${k}: ${v}`).join("; ") }, focusConcept: { type: "string" } }, required: ["move"] } },
    teaching_propose_complete: { description: "END THE TURN by proposing the session is complete. Accepted only when every part is verified (the gate decides); otherwise you get objective_not_met and must reply instead.", parameters: { type: "object", properties: {} } },
    teaching_propose_pause: { description: "END THE TURN by pausing the session (the learner wants to stop for now, or is too frustrated to go on).", parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } },
  };
  return TOOLS_BY_MODE[normaliseMode(mode)].map((name) => ({ type: "function", function: { name, ...defs[name] } }));
}

/** PURE: the state the agent decides from (no hidden evaluation values beyond what it needs). */
export function decisionState(context) {
  const s = context.orchestrator.session;
  const d = context.evidenceUpdate?.dialogue || {};
  const ev = context.evidenceUpdate?.current || {};
  return {
    mode: context.mode, topic: context.topic,
    phase: s.phase, phaseLabel: context.phaseLabels?.[s.phase] || s.phase,
    part: context.mustKnowParts[context.mustKnowIndex] || context.topic,
    partIndex: context.mustKnowIndex + 1, parts: context.mustKnowParts.length || 1,
    evidence: { dialogueMove: d.move || null, canAdvance: !!d.canAdvance, allPartsVerified: !!d.allConceptsVerified, masteryStatus: ev.masteryStatus || null, misconceptionPresent: !!ev.misconceptionPresent },
    turn: s.turnCount, maxTurns: TEACHING_POLICY.MAX_TURNS, strategy: s.strategy || null, strategyChanges: s.strategyChanges || 0,
    defaultReply: fallbackReply(context.mode, d.move),
  };
}

/** The production decision: the controller model picks one function tool. → { tool, args } | null */
async function modelDecide({ context, observations }) {
  const { openai } = await import("../../../lib/aiModel.js");
  const system = [
    `You run one turn of a teaching session. Mode: ${context.mode === "learn_with_guide" ? "the guide (NaNa) teaches the learner directly" : "the learner teaches their protégé (a student agent); NaNa coaches on the side"}.`,
    "Pick ONE tool. Read tools and strategy/coaching changes don't end the turn; the reply tools do. End the turn within 3 picks.",
    context.mode === "learn_with_guide"
      ? "Reply with guide_teach: choose the move that best fits what the learner just said and the evidence (explain when they're missing the core idea, correct_misconception when they hold a wrong idea, ask_check_question / ask_explain_back to get evidence, summarise when the part is consolidated)."
      : "Reply with protege_respond: choose the move a real student would make that gets the BEST teaching out of the learner (request_clarification when the explanation was unclear, confused_student to surface a misconception, challenge to test it, teach_back_prompt to check it, acknowledge when it landed).",
    "Propose completion only when the evidence shows every part verified. The default reply is a safe choice when unsure.",
  ].join(" ");
  const user = JSON.stringify({ state: decisionState(context), learnerMessage: String(context.humanMessage || "").slice(0, 1200), recent: context.history.slice(-4).map((h) => ({ role: h.role, text: String(h.content || "").slice(0, 300) })), observations });
  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini", temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: user }],
    tools: controllerTools(context.mode), tool_choice: "required",
    __role: "controller", __feature: "teaching_controller", __userId: context.studentId, __timeoutMs: TEACHING_POLICY.DECISION_TIMEOUT_MS + 4_000, __maxRetries: 0,
  });
  const call = res.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.name) return null;
  let args = {};
  try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = null; }
  return { tool: call.function.name, args };
}

const withTimeout = (promise, ms) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("decision timed out"), { code: "timeout" })), ms); })])
    .finally(() => clearTimeout(timer));
};

/** Run one agent-driven turn. Returns the same context shape the fixed runner did, plus the agent's record. */
export async function executeAgentTeachingTurn({ orchestrator, humanMessage, callbacks = {}, phaseLabels, actionForDialogueMove, mode, decide = modelDecide, policy = TEACHING_POLICY, tools: harnessTools = null, teachGuide = guideTeach }) {
  const session = orchestrator?.session;
  if (!orchestrator?.studentAgent || !orchestrator?.studentAgentRecord || !session?.topic) throw new Error("Adaptive teaching workflow requires an initialized session");
  const context = {
    orchestrator, humanMessage, callbacks, phaseLabels, actionForDialogueMove,
    mode: normaliseMode(mode || session.teachingMode),
    topic: session.topic, phase: session.phase,
    mustKnowParts: Array.isArray(session.mustKnowParts) ? session.mustKnowParts : [],
    mustKnowIndex: Number.isInteger(session.mustKnowIndex) ? session.mustKnowIndex : 0,
    history: Array.isArray(session.history) ? session.history : [],
    subject: orchestrator.decayPayload?.subject || null,
    agentId: orchestrator.studentAgentRecord.id, studentId: orchestrator.studentId,
    completedTools: [], decisions: [], fallback: null,
  };
  const tools = harnessTools || createTeachingTurnTools();
  const step = (name, status) => callbacks.onWorkflowStep?.({ workflow: "adaptive_teaching_turn", policyVersion: AGENT_TURN_POLICY_VERSION, step: PLAN_NAME[name] || name, label: AGENT_LABELS[name] || LABELS[name] || "Updating teaching session", status });
  const runFixed = async (name) => {
    step(name, "started");
    try { await tools[name].execute(context); context.completedTools.push(name); step(name, "completed"); }
    catch (e) { step(name, "failed"); throw e; }
  };
  session.toolCalls = Number(session.toolCalls) || 0;

  // ① pre-steps
  await runFixed("load_session_state");
  await runFixed("observe_teaching_evidence");

  // ② the agent: up to MAX_ITERATIONS_PER_TURN decisions; a reply tool ends it
  const observations = [];
  let reply = null;   // { tool, args }
  for (let i = 0; i < policy.MAX_ITERATIONS_PER_TURN && !reply; i++) {
    let decision = null;
    let error = null;
    try { decision = await withTimeout(Promise.resolve(decide({ context, observations, iteration: i + 1 })), policy.DECISION_TIMEOUT_MS); }
    catch (e) { error = e?.code === "timeout" ? "timeout" : "model_error"; }
    if (!decision && !error) error = "no_decision";
    if (error) { context.decisions.push({ iteration: i + 1, error }); break; }
    session.toolCalls += 1;
    const valid = validateDecision(context.mode, decision, { strategyChanges: session.strategyChanges || 0 });
    context.decisions.push({ iteration: i + 1, tool: PLAN_NAME[decision.tool] || decision.tool, args: decision.args || {}, ok: valid.ok, ...(valid.ok ? {} : { error: valid.error }) });
    if (!valid.ok) { observations.push({ tool: decision.tool, error: valid.error }); continue; }
    const args = decision.args || {};
    step(decision.tool, "started");
    if (decision.tool === "teaching_get_state") observations.push({ tool: decision.tool, result: decisionState(context) });
    else if (decision.tool === "strategy_select") {
      // The way it was being taught wasn't landing: that is its outcome (§7.7.1 step 6).
      const previous = currentTeachingStrategy(orchestrator);
      const chosen = teachingStrategy(args.strategy);
      session.strategy = chosen;
      session.strategyChanges = (Number(session.strategyChanges) || 0) + 1;
      if (previous && previous !== chosen) {
        void recordTeachingStrategyOutcome(orchestrator, { strategy: previous, outcome: "did_not_work", turnRef: `switch${session.strategyChanges}:t${session.turnCount || 0}`,
          details: { switchedTo: chosen, reason: String(args.reason || "").slice(0, 200) || null } });
      }
      observations.push({ tool: decision.tool, result: { strategy: chosen, changesUsed: session.strategyChanges } });
    } else if (decision.tool === "guide_coach") {
      context.coachFocus = String(args.focus || "").slice(0, 200);
      observations.push({ tool: decision.tool, result: { ok: true } });
    } else if (decision.tool === "teaching_propose_complete") {
      if (objectiveMet({ phase: session.phase, allConceptsVerified: context.evidenceUpdate?.dialogue?.allConceptsVerified })) {
        context.completeAccepted = true;
        reply = context.mode === "learn_with_guide" ? { tool: "guide_teach", args: { move: "summarise" } } : { tool: "protege_respond", args: { move: "acknowledge" } };
      } else observations.push({ tool: decision.tool, error: "objective_not_met" });
    } else if (decision.tool === "teaching_propose_pause") {
      context.pauseRequested = String(args.reason || "learner").slice(0, 120);
      reply = context.mode === "learn_with_guide" ? { tool: "guide_teach", args: { move: "summarise" } } : { tool: "protege_respond", args: { move: "acknowledge" } };
    } else if (TERMINAL_TOOLS.includes(decision.tool)) reply = { tool: decision.tool, args };
    step(decision.tool, "completed");
  }
  if (!reply) {
    reply = fallbackReply(context.mode, context.evidenceUpdate?.dialogue?.move);
    context.fallback = { reason: context.decisions.at(-1)?.error || "cap_reached", reply: { tool: PLAN_NAME[reply.tool], move: reply.args.move } };
  }
  context.reply = { tool: PLAN_NAME[reply.tool], move: reply.args.move, focusConcept: reply.args.focusConcept || null };

  // the one reply
  const part = context.mustKnowParts[context.mustKnowIndex] || context.topic;
  step(reply.tool, "started");
  if (reply.tool === "guide_teach") {
    context.guideReply = await teachGuide({
      orchestrator, humanMessage, topic: context.topic, part, move: reply.args.move, focusConcept: reply.args.focusConcept,
      phaseLabel: phaseLabels?.[session.phase], evidence: context.evidenceUpdate?.current || {}, history: context.history,
      onChunk: callbacks.onGuideReplyChunk || null,
    });
    context.studentReply = "";
  } else {
    context.studentReply = await orchestrator.studentAgent.reply(
      humanMessage, context.topic, context.state.cognitive, context.history, phaseLabels?.[session.phase],
      callbacks.onStudentChunk || null,
      { dialogue: context.evidenceUpdate.dialogue, evidence: context.evidenceUpdate.current, protegeMove: PROTEGE_MOVES[reply.args.move], focusConcept: reply.args.focusConcept || null },
    );
  }
  step(reply.tool, "completed");
  context.completedTools.push(reply.tool);

  // ③ post-steps
  if (context.mode === "learn_with_guide") {
    // No protégé: the learner's own answer (already observed as evidence) is what is assessed.
    step("assess_learner_response", "started");
    const ev = context.evidenceUpdate.current || {};
    const cog = context.state?.cognitive || {};
    const pct = (v) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100);
    // The same fields assessProtegeUnderstanding returns (0–100), read from the learner's own evidence.
    context.analysis = {
      understanding: pct(ev.learnerMastery ?? cog.understanding),
      confusion: ev.misconceptionPresent ? Math.max(pct(cog.confusion), 40) : Math.round(pct(cog.confusion) * 0.8),
      engagement: Math.max(pct(cog.engagement), 50),
      mistakes: ev.misconceptionPresent ? [part] : [], strengths: ev.masteryStatus === "verified" ? [part] : [],
      misconceptionDetected: ev.misconceptionPresent ? part : null,
      newConceptLearned: ev.masteryStatus === "verified" ? part : null,
    };
    step("assess_learner_response", "completed");
  } else await runFixed("assess_protege_understanding");
  await runFixed("persist_cognitive_state");
  if (context.mode === "learn_with_guide") {
    step("record_verified_learning", "started");
    await orchestrator.studentAgent.extractStudentKnowledge(humanMessage, context.topic, context.subject, context.analysis, context.evidenceUpdate.current).catch(() => null);
    if (context.evidenceUpdate.current.masteryStatus === "verified") orchestrator.stats.conceptsLearned.push(part);
    if (context.evidenceUpdate.misconceptionRepaired) orchestrator.stats.misconceptionsCleared.push(part);
    step("record_verified_learning", "completed");
    context.guideResult = { tip: null, nextAction: actionForDialogueMove?.[context.evidenceUpdate.dialogue.move] || "DIG_DEEPER", nextPhase: null, nextMustKnowIndex: context.mustKnowIndex, isUrgent: false };
  } else {
    await runFixed("record_verified_learning");
    await runFixed("coach_teaching_dialogue");
  }
  await runFixed("gate_teaching_progress");

  // how the session stands after the gate
  context.objectiveMet = objectiveMet({ phase: session.phase, allConceptsVerified: context.evidenceUpdate?.dialogue?.allConceptsVerified });
  context.boundedEnd = context.objectiveMet ? null : boundedEnd({ turnCount: session.turnCount, strategyChanges: session.strategyChanges, toolCalls: session.toolCalls });
  context.endRequested = context.completeAccepted && context.objectiveMet ? "objective_met" : (context.boundedEnd ? "bounded_end" : null);
  context.publicWorkflow = {
    type: "adaptive_teaching_turn", policyVersion: AGENT_TURN_POLICY_VERSION, state: "completed", mode: context.mode,
    completedTools: [...context.completedTools], reply: context.reply, fallback: context.fallback ? context.fallback.reason : null,
    ...(context.endRequested ? { endRequested: context.endRequested } : {}), ...(context.pauseRequested ? { pauseRequested: true } : {}),
  };
  return context;
}
