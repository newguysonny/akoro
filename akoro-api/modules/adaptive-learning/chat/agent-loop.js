// The model streaming adapters and the bounded Agent Chat tool loop. The loop
// stays the one executor of tools; chat.js re-exports runAgentToolLoop and the
// iteration cap, so every existing importer keeps using chat.js.
//
// The tool runtime must never import this module: the loop depends on it, not
// the other way round.

import { OPENAI_MODEL, openai } from "../../../lib/aiModel.js";
import { isInspected } from "../../../lib/dryRunContext.js";
import { agentToolActivity } from "../../../lib/agentActivity.js";
import { newToolRequestId, toolObservation } from "../../../utils/toolObservation.js";
import { toResponsesInput, toResponsesTools } from "../responses-input.js";
import { hasDsmlMarkup, hasToolCallMarkup } from "../reply-scrub.js";
import { looksLikeStepNarration, containsDeferral, admitsNonCompletion, looksTruncated, planHasOpenSteps } from "../narration-stall.js";
import { decisionNarration, TALK_AFTER_TOOLS, talkAfterTool } from "./chat-trace.js";
import { materialsFrom, collectMaterials } from "./chat-materials.js";
import { UPDATE_PLAN_TOOL, applyPlanUpdate } from "../taskLedger.js";
import { startRun, recordStep, finishRun, stepRow } from "../execution/executionLog.js";
import { failed as toolFailed, shouldRetry, recoveryHint } from "../toolRecovery.js";
import { runWithinLimit } from "../toolLimits.js";
import { createLoopGuard } from "../../agent-runtime/loopGuard.js";
import { agreesToBuild } from "../../self-tooling/capabilities.js";
import { adminRequestOf } from "../requestClaims.js";
import {
  openAiChatTools, isSideEffecting, PARALLEL_CALL_BARRIERS, PARALLEL_READ_BATCH,
  DECIDED_CONFIRM_STATUSES, executeChatTool, latestUserText, unsaidActivityFields, inspectResult,
  actionBasis, basisRefusal, SIDE_EFFECT_TOOLS, isSideEffectingAction, BUILTIN_TOOL_NAMES,
} from "./tool-runtime.js";

export const THINK_MODEL    = process.env.OPENAI_THINK_MODEL    || "o4-mini";
// Think mode reasons at every tool-loop decision too (each "Thought for Ns"
// row is the model's real reasoning summary). Decisions run at a lighter
// effort than the final answer to keep a multi-step turn affordable.
const THINK_DECISION_EFFORT = process.env.OPENAI_THINK_DECISION_EFFORT || "low";
const THINK_ANSWER_EFFORT   = process.env.OPENAI_THINK_ANSWER_EFFORT   || "medium";

/* chat.completions streaming → `delta` events. Returns the full text. */
export async function streamChat({ send, messages, model, max_tokens = 700, temperature = 0.6, tools = null, toolChoice = undefined, isAborted = () => false }) {
  const stream = await openai.chat.completions.create({
    model, temperature, max_tokens, stream: true, messages,
    ...(tools ? { tools, ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}) } : {}),
  });
  let full = "";
  let muted = false;   // DSML markup started: keep collecting, stop painting (the final reply is scrubbed)
  let tail = "";
  for await (const chunk of stream) {
    // The learner pressed stop (the connection closed): leaving the loop ends
    // the upstream stream; usage so far is still metered by meteredCreate.
    if (isAborted()) break;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      if (!muted) {
        if (hasDsmlMarkup(tail + delta) || hasToolCallMarkup(tail + delta)) muted = true;
        else send("delta", { text: delta });
        tail = (tail + delta).slice(-16);
      }
    }
  }
  return full;
}

/*
 * One tool-loop DECISION on the standard model, streamed: text the model
 * writes streams to onText as it arrives (the words between steps), tool
 * calls are assembled from their deltas. Returns the assistant message in
 * the chat-completions shape, or { aborted } when the learner stopped.
 */
export async function streamDecision({ messages, tools, toolChoice, onText = null, isAborted = () => false, model = null, meta = null }) {
  const stream = await openai.chat.completions.create({
    ...(meta || {}),   // e.g. the eval runner's { __feature: "eval", __userId }
    model: model || OPENAI_MODEL,
    temperature: 0.6,
    max_tokens: 900,
    messages,
    tools,
    tool_choice: toolChoice,
    stream: true,
  });
  let content = "";
  let dsmlMuted = false, dsmlTail = "";
  const calls = [];
  for await (const chunk of stream) {
    if (isAborted()) return { aborted: true, assistant: { role: "assistant", content } };
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      // Same DSML guard as streamChat: once tool-call markup starts, stop
      // painting it live; the composed reply is scrubbed before it is saved.
      if (!dsmlMuted && (hasDsmlMarkup(dsmlTail + delta.content) || hasToolCallMarkup(dsmlTail + delta.content))) dsmlMuted = true;
      if (!dsmlMuted) { onText?.(delta.content); dsmlTail = (dsmlTail + delta.content).slice(-16); }
    }
    for (const part of delta.tool_calls || []) {
      const index = part.index ?? calls.length;
      calls[index] ||= { id: "", type: "function", function: { name: "", arguments: "" } };
      if (part.id) calls[index].id = part.id;
      if (part.function?.name) calls[index].function.name += part.function.name;
      if (part.function?.arguments) calls[index].function.arguments += part.function.arguments;
    }
  }
  const toolCalls = calls.filter((call) => call?.function?.name);
  return { assistant: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } };
}

/*
 * Think mode: one tool-loop DECISION on the reasoning model. Its reasoning
 * summary streams into the step's "Thought for Ns" row (onReasoning); the
 * result comes back in the chat-completions assistant shape the loop already
 * uses. Throws when the model or API surface is unavailable so the loop can
 * fall back to the standard model.
 */
export async function thinkDecision({ systemContent, transcript, tailContent = null, tools, toolChoice, onReasoning = () => {}, onText = null, isAborted = () => false }) {
  const stream = await openai.responses.create({
    model: THINK_MODEL,
    input: toResponsesInput([{ role: "system", content: systemContent }, ...transcript, ...(tailContent ? [{ role: "system", content: tailContent }] : [])], { native: true }),
    tools: toResponsesTools(tools),
    tool_choice: toolChoice?.function?.name ? { type: "function", name: toolChoice.function.name } : "auto",
    reasoning: { effort: THINK_DECISION_EFFORT, summary: "auto" },
    max_output_tokens: 4000,
    stream: true,
  });
  let content = "";
  const toolCalls = [];
  for await (const ev of stream) {
    if (isAborted()) return { aborted: true, assistant: { role: "assistant", content } };
    if (ev.type === "response.reasoning_summary_part.added" && ev.summary_index > 0) onReasoning("\n\n");
    else if (ev.type === "response.reasoning_summary_text.delta" && ev.delta) onReasoning(ev.delta);
    else if (ev.type === "response.output_text.delta" && ev.delta) { content += ev.delta; onText?.(ev.delta); }
    else if (ev.type === "response.output_item.done" && ev.item?.type === "function_call") {
      toolCalls.push({ id: ev.item.call_id, type: "function", function: { name: ev.item.name, arguments: ev.item.arguments || "{}" } });
    }
    else if (ev.type === "response.failed") throw new Error(ev.response?.error?.message || "reasoning model failed");
    else if (ev.type === "error") throw new Error(ev.message || "reasoning model error");
  }
  return { assistant: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } };
}

/*
 * Reasoning model via the Responses API — the Think-mode ANSWER, including
 * after tools ran (their results arrive as developer notes). The reasoning
 * summary streams into its own "Thought for Ns" trace row, which closes as
 * the answer starts streaming as `delta`. Returns { reply, thinking }. Throws
 * when the model or API surface is unavailable so the caller can fall back.
 */
export async function streamThinkWithResponses({ send, messages, model, trace = null, isAborted = () => false }) {
  const useReasoning = model !== "gpt-4o";   // gpt-4o has no reasoning surface
  const stream = await openai.responses.create({
    model,
    input: toResponsesInput(messages),
    ...(useReasoning ? { reasoning: { effort: THINK_ANSWER_EFFORT, summary: "auto" } } : {}),
    max_output_tokens: 4000,
    stream: true,
  });
  let full = "";
  let thinking = "";
  let thinkId = useReasoning ? trace?.thinkStart() : null;
  const closeThink = () => { if (thinkId) { trace.thinkEnd(thinkId, ""); thinkId = null; } };
  const reason = (text) => { thinking += text; if (thinkId) trace.thinkDelta(thinkId, text); };
  try {
    for await (const ev of stream) {
      if (isAborted()) break;
      if (ev.type === "response.reasoning_summary_part.added" && ev.summary_index > 0) reason("\n\n");
      else if (ev.type === "response.reasoning_summary_text.delta" && ev.delta) reason(ev.delta);
      else if (ev.type === "response.output_text.delta" && ev.delta) { closeThink(); full += ev.delta; send("delta", { text: ev.delta }); }
      else if (ev.type === "response.failed") throw new Error(ev.response?.error?.message || "reasoning model failed");
      else if (ev.type === "error") throw new Error(ev.message || "reasoning model error");
    }
  } finally {
    closeThink();
  }
  return { reply: full, thinking: thinking.trim() };
}

/*
 * Thinking on a chat-completions model (DeepSeek/GLM/Qwen/GPT Luna/Grok):
 * request reasoning where the provider accepts a hint, stream any exposed
 * reasoning text into the "Thought for Ns" row, and answer from the same
 * selected model — no hidden switch to o4-mini.
 */
export async function thinkChatOnce({ messages, model, trace = null }) {
  const thinkId = trace?.thinkStart();
  const call = (extra) => openai.chat.completions.create({
    model, temperature: 0.4, max_tokens: 2200, messages, ...extra,
  });
  let resp;
  try { resp = await call({ reasoning_effort: "medium" }); }
  catch (e) {
    if (e?.status === 400 || /reasoning/i.test(String(e?.message || ""))) resp = await call({});
    else { if (thinkId) trace.thinkEnd(thinkId, ""); throw e; }
  }
  const m = resp?.choices?.[0]?.message || {};
  const thinking = String(m.reasoning_content || m.reasoning || "").trim();
  const reply = String(m.content || "").trim();
  if (thinkId) { if (thinking) trace.thinkDelta(thinkId, thinking); trace.thinkEnd(thinkId, ""); }
  return { reply, thinking };
}

export async function streamThinkChat({ send, messages, model, trace = null, isAborted = () => false }) {
  let thinkId = trace?.thinkStart() || null;
  const call = (extra) => openai.chat.completions.create({
    model, temperature: 0.4, max_tokens: 2200, stream: true, messages, ...extra,
  });
  let stream;
  try { stream = await call({ reasoning_effort: "medium" }); }
  catch (e) {
    if (e?.status === 400 || /reasoning/i.test(String(e?.message || ""))) stream = await call({});
    else { if (thinkId) trace.thinkEnd(thinkId, ""); throw e; }
  }
  let full = "";
  let thinking = "";
  const close = () => { if (thinkId) { trace.thinkEnd(thinkId, ""); thinkId = null; } };
  try {
    for await (const chunk of stream) {
      if (isAborted()) break;
      const d = chunk.choices?.[0]?.delta || {};
      const r = d.reasoning_content ?? d.reasoning ?? d.thinking;
      if (r) { thinking += r; if (thinkId) trace.thinkDelta(thinkId, r); }
      if (d.content) { if (thinkId) close(); full += d.content; send("delta", { text: d.content }); }
    }
  } finally { close(); }
  return { reply: full, thinking: thinking.trim() };
}

/* Non-streaming reasoning call → { reply, thinking }; the summary is also a trace row. */
export async function thinkOnce({ messages, model, trace = null }) {
  const useReasoning = model !== "gpt-4o";
  const thinkId = useReasoning ? trace?.thinkStart() : null;
  let resp;
  try {
    resp = await openai.responses.create({
      model,
      input: toResponsesInput(messages),
      ...(useReasoning ? { reasoning: { effort: THINK_ANSWER_EFFORT, summary: "auto" } } : {}),
      max_output_tokens: 4000,
    });
  } catch (error) {
    if (thinkId) trace.thinkEnd(thinkId, "");
    throw error;
  }
  const thinking = (Array.isArray(resp?.output) ? resp.output : [])
    .filter((o) => o?.type === "reasoning")
    .flatMap((o) => (o.summary || []).map((s) => s?.text || ""))
    .join("\n\n")
    .trim();
  if (thinkId) { if (thinking) trace.thinkDelta(thinkId, thinking); trace.thinkEnd(thinkId, ""); }
  return { reply: String(resp?.output_text || "").trim(), thinking };
}

// One Agent Chat turn may interleave decisions, tool calls and text many
// times (Grand Plan §13.4). Bounded by code, never by the model.
export const CHAT_TOOL_LOOP_MAX_ITERATIONS = 8;
export const STOPPED_REPLY = "(Stopped before finishing.)";

// Exported for the benchmark (lib/evals/benchmark.js), which runs this same loop with stub tools.
// `callTool` is the one seam; `recorder` is an agent-contract/episode.js recorder.
// `basis` (Phase 18 item 6): explicit when a person's message started the turn,
// else { basis: "inferred", rule } for a proactive/workflow turn.
// `toolLimitMs`: one time limit for every call; else each tool's own (toolLimits.js).
export async function runAgentToolLoop({ systemContent, messages, studentId, conversationId = null, turnId = null, status, tools = openAiChatTools(), requiredTool = null, role = "student", trace = null, isAborted = () => false, think = false, streamText = true, model = null, teacherWords = null, ledger = null, callTool = null, recorder = null, meta = null, basis = "explicit", toolLimitMs = null, planFirst = false, tailContent = null }) {
  const turnBasis = actionBasis(basis, { basis: "explicit" });
  const runTool = callTool || ((name, input) => executeChatTool(name, input, studentId, { conversationId, role, basis: turnBasis }));
  // The loop guard (loopGuard.js): the same call again in a row gets a reminder in its observation.
  const guard = createLoopGuard();
  // The task ledger (taskLedger.js): the agent keeps its goal and steps with update_plan; offered every turn.
  let ledgerNow = ledger;
  if (!tools.some((t) => t.function?.name === UPDATE_PLAN_TOOL.name)) {
    tools = [...tools, { type: "function", function: { name: UPDATE_PLAN_TOOL.name, description: UPDATE_PLAN_TOOL.description, parameters: UPDATE_PLAN_TOOL.input_schema } }];
  }
  const executions = [];
  const transcript = [...messages];
  if (requiredTool && !tools.some((tool) => tool.function?.name === requiredTool)) {
    throw new Error("The required Agent Chat tool is unavailable");
  }
  // Learner account tools are never authorised for instructor/school roles.
  if (!tools.length) return { messages: transcript, toolExecutions: executions, ledger: ledgerNow };
  // Phase 22: the durable execution trace. One run per turn; a step per tool
  // call below. Best-effort — startRun never throws, so logging can't break a turn.
  const runId = await startRun({ sessionId: conversationId, userId: studentId, model, turnId });
  // Think mode decides every step on the reasoning model; if that model is
  // unavailable the rest of the turn decides on the standard model.
  let reasonDecisions = think;
  // After a Library search, a reader tool or the past papers, the agent says what it found
  // before its next step (2026-10-19); if it goes straight on to a tool, this line is said.
  let owedLine = null;
  // One continuation per turn for a step narration that lost its tool call.
  let narrationContinuationUsed = false;
  for (let iteration = 0; iteration < CHAT_TOOL_LOOP_MAX_ITERATIONS; iteration += 1) {
    // Stop pressed between steps: end here, before spending another call.
    if (isAborted()) return { messages: transcript, toolExecutions: executions, ledger: ledgerNow, aborted: true };
    // Each decision is a "Thought for Ns" row: harness narration (D10), or
    // the model's real reasoning summary in Think mode.
    const thinkId = trace?.thinkStart();
    // This force is limited to capability questions: it guarantees the
    // response is based on the live Akoro inventory, but does not choose an
    // endpoint, shape learner-facing prose, or invent a feature.
    // Phase 22 Part E: a multi-step request the agent is to act on starts by writing its plan
    // (update_plan with steps and done_when) — enforced on the first step, not left to a prompt hint.
    const planStep = iteration === 0 && !requiredTool && planFirst && !(Array.isArray(ledgerNow?.plan) && ledgerNow.plan.some((st) => st && !["done", "completed"].includes(st.status)));
    // Last step: a streamed, non-think turn answers with what it has
    // (tool_choice "none"), so the handler pays no separate answer call.
    const lastChance = iteration === CHAT_TOOL_LOOP_MAX_ITERATIONS - 1 && streamText && !think && !requiredTool && !planStep;
    const toolChoice = iteration === 0 && requiredTool
      ? { type: "function", function: { name: requiredTool } }
      : planStep ? { type: "function", function: { name: UPDATE_PLAN_TOOL.name } } : lastChance ? "none" : "auto";
    // Words the model writes stream live as an activity block. The step's
    // thinking row closes when they start (they narrate the step themselves).
    // Research mode buffers instead: its answer is regenerated on the
    // research model, so live text would show twice.
    let thinkOpen = Boolean(thinkId);
    const closeThink = (text) => { if (thinkOpen) { trace.thinkEnd(thinkId, text); thinkOpen = false; } };
    let liveId = null;
    const onText = streamText && trace
      ? (text) => { closeThink(""); if (!liveId) liveId = trace.activityStart(); trace.activityDelta(liveId, text); }
      : null;
    const stoppedHere = (assistantSoFar) => {
      closeThink("");
      if (liveId) trace.activityEnd(liveId, assistantSoFar?.content || "");
      return { messages: transcript, toolExecutions: executions, ledger: ledgerNow, aborted: true };
    };
    let assistant = null;
    let reasoned = false;
    if (reasonDecisions) {
      try {
        const decision = await thinkDecision({
          systemContent, transcript, tailContent, tools, toolChoice, isAborted, onText,
          onReasoning: (text) => { if (thinkOpen) trace.thinkDelta(thinkId, text); },
        });
        if (decision.aborted) return stoppedHere(decision.assistant);
        assistant = decision.assistant;
        reasoned = true;
      } catch (error) {
        console.warn("[agent-chat] think decision unavailable — standard model for the rest of this turn:", error?.message || error);
        reasonDecisions = false;
        // Any words already shown came from the failed call; the retry rewrites them.
        if (liveId) { trace.activityDrop(liveId); liveId = null; }
      }
    }
    if (!assistant) {
      const decision = await streamDecision({
        // Cache layout (2026-11-17): the volatile tail rides AFTER the
        // transcript, so the static system + history stay a stable prefix.
        messages: [{ role: "system", content: systemContent }, ...transcript, ...(tailContent ? [{ role: "system", content: tailContent }] : [])],
        tools, toolChoice, onText, isAborted, model, meta,
      });
      if (decision.aborted) return stoppedHere(decision.assistant);
      assistant = decision.assistant;
    }
    const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    closeThink(decisionNarration(calls));
    if (recorder && calls.length) {
      recorder.decision({ tool_calls: calls.map((c) => { let args = {}; try { args = JSON.parse(c?.function?.arguments || "{}"); } catch { args = {}; } return { name: c?.function?.name, arguments: args }; }),
        intent: typeof assistant.content === "string" ? assistant.content.trim().slice(0, 300) : null });
    }
    const content = typeof assistant.content === "string" ? assistant.content.trim() : "";
    if (!calls.length) {
      // A step narration that lost its tool call is not an answer: when the
      // turn owes work, keep the line as activity, steer once, and accept a
      // second text-only reply unconditionally.
      // Kill switch: AKORO_NARRATION_CONTINUATION=false.
      const owesWork = planHasOpenSteps(ledgerNow) || (executions.length === 0 && (looksLikeStepNarration(content) || containsDeferral(content) || admitsNonCompletion(content)));
      if (!narrationContinuationUsed && streamText && !think && !lastChance
        && iteration <= CHAT_TOOL_LOOP_MAX_ITERATIONS - 3
        && process.env.AKORO_NARRATION_CONTINUATION !== "false" && owesWork) {
        narrationContinuationUsed = true;
        if (liveId) trace.activityEnd(liveId, content);
        else if (content) trace?.activity(content);
        transcript.push(assistant);
        transcript.push({ role: "system", content: "Loop note (not from the learner): your last reply called no tool — it described a step, deferred it, or said the work wasn't done — and a reply with no tool call ends the turn with the work NOT done. If the learner's request needs a tool, call it now, with its one-sentence narration in the same reply. If you genuinely cannot do it, name the concrete blocker plainly. If you have genuinely finished, give the complete final answer instead; do not repeat the same reply." });
        continue;
      }
      // A decision that calls no tool IS the answer: what already streamed
      // becomes the reply (promoted out of the trace), so no second model
      // call is paid for. Research mode still regenerates on its own model.
      const finalText = (reasoned || streamText) ? content : "";
      if (liveId) {
        if (finalText) trace.activityPromote(liveId);
        else trace.activityDrop(liveId);
      }
      // Phase 22: this is the common completion path (the model's final answer,
      // no more tool calls) — close the run here too, not only at the max-iteration exit.
      await finishRun(runId, { status: "ok" });
      return { messages: transcript, toolExecutions: executions, ledger: ledgerNow, ...(finalText ? { finalText, promoted: Boolean(liveId) } : {}) };
    }
    // Text written alongside tool calls stays between the steps.
    if (liveId) trace.activityEnd(liveId, content);
    else if (content) trace?.activity(content);
    else if (owedLine) trace?.activity(owedLine);
    owedLine = null;
    transcript.push(assistant);
    // ── Executing the decision's calls (parallel reads, 2026-11-17).
    // Independent READ calls run together; everything else runs one at a
    // time in the model's order. Outcomes are always APPLIED in that order.
    // prepareCall parses and checks; runPrepared executes; applyPrepared
    // records the outcome.
    const prepareCall = (call) => {
      const tool = call?.function?.name;
      let input = {};
      try { input = JSON.parse(call?.function?.arguments || "{}"); } catch { input = {}; }
      // A follow-up on a draft's questions goes to the paper writer in the
      // teacher's own words: the model rewrote "Remove question 3" as the
      // whole question list, and the revision changed other questions too.
      if (tool === "revise_activity_draft" && teacherWords && input?.question_request) input = { ...input, question_request: teacherWords };
      // A permission card only after the learner said yes to building it (their latest message, never the model's say-so).
      if (tool === "create_tool" && input && typeof input === "object") {
        const { __agreed, ...rest } = input;
        input = role === "student" && agreesToBuild(latestUserText(transcript)) ? { ...rest, __agreed: true } : rest;
      }
      const changes = isSideEffecting(tool, input);
      // Asked or inferred (actionBasis.js): an inferred change with no rule allowing it is refused, not run.
      const refused = changes ? basisRefusal(turnBasis, { action: tool }) : null;
      return { call, tool, input, changes, refused };
    };
    const runPrepared = async (p) => {
      const { tool, input, changes, refused } = p;
      const callStarted = Date.now();
      status?.("tool", "Checking your Akoro study data…");
      // The header stream too - the same labels the background workers send,
      // so the agent's subtitle shows live work during active chats as well.
      agentToolActivity(studentId, tool);
      const traceRow = trace?.toolStart(tool, input);
      let toolResult;
      // The important fields come from the TEACHER (activityFields.js): a subject, an audience or a
      // topic they never said is asked for, not filled in — nothing is prepared until they answer.
      const unsaid = role === "instructor" ? await unsaidActivityFields(tool, input, transcript).catch(() => null) : null;
      // Each call within its time limit (toolLimits.js): past it, a `timeout` observation, never a stalled turn.
      const timed = () => runWithinLimit(() => runTool(tool, input), tool, { sideEffecting: changes, limitMs: toolLimitMs });
      if (tool === UPDATE_PLAN_TOOL.name) {
        // The ledger: checked here (a step is done only when a successful call this turn backs it), saved after the turn.
        const applied = applyPlanUpdate(ledgerNow, input, executions);
        ledgerNow = applied.ledger;
        toolResult = applied.result;
      } else if (unsaid) toolResult = unsaid;
      else if (refused) toolResult = { success: false, code: refused.code, error: refused.message };
      else try {
        toolResult = await timed();
        // Recovery (toolRecovery.js): a temporary failure (a time-out included) is tried once more before the agent sees it.
        if (shouldRetry(tool, toolResult, { sideEffecting: changes })) {
          console.log(`[agent-chat] tool ${tool} failed temporarily — retrying once`);
          const again = await timed().catch(() => null);
          if (again != null) toolResult = toolFailed(again) ? { ...(typeof again === "object" ? again : {}), retried: true } : again;
        }
      }
      catch (error) {
        // The observation stays generic (internal detail never reaches the
        // learner), but the log carries the real cause — the 2026-10-01
        // study-prep outage was invisible here while every call failed with
        // "relation study_prep_sessions does not exist".
        console.warn(`[agent-chat] tool ${tool} error:`, error?.message || error);
        toolResult = { success: false, error: "The requested Akoro action could not be completed." };
      }
      return { p, toolResult, traceRow, durationMs: Date.now() - callStarted };
    };
    const applyPrepared = async ({ p, toolResult, traceRow, durationMs }) => {
      const { call, tool, input, changes } = p;
      const who = role === "instructor" ? "the instructor" : "the learner";
      if (traceRow) trace.toolEnd(traceRow, toolResult);
      if (TALK_AFTER_TOOLS.includes(tool)) {
        owedLine = talkAfterTool(tool, input, toolResult);
        if (toolResult && typeof toolResult === "object" && !Array.isArray(toolResult) && !toolFailed(toolResult)) {
          toolResult = { ...toolResult, sayFirst: `Before your next step, tell ${who} in one short sentence what this found.` };
        }
      }
      // Step narration after EVERY step (Matt, 2026-11-17): a short line
      // streams as activity before the next step. A failed step is narrated
      // too, alongside the recovery steer below.
      if (process.env.AKORO_STEP_NARRATION !== "false"
        && toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)
        && !toolResult.sayFirst) {
        toolResult = toolFailed(toolResult)
          ? { ...toolResult, sayFirst: `Before your next step, tell ${who} in one short sentence that this step didn't work and what you're doing about it, in your own words — no internal details.` }
          : { ...toolResult, sayFirst: `Before your next step, tell ${who} in one short sentence what this step did or found, in your own words.` };
      }
      // Structured observation: the tool's real backend outcome becomes the
      // model's next input, so the reply confirms facts, not intent.
      // create_tool built a tool: offer it for the rest of this turn.
      if (toolResult && typeof toolResult === "object" && toolResult.__newTool) {
        const def = toolResult.__newTool;
        delete toolResult.__newTool;
        if (!tools.some((t) => t.function?.name === def.function.name)) tools.push(def);
      }
      // get_agent_capabilities loaded an area: offer its tools for the rest of this turn.
      if (toolResult && typeof toolResult === "object" && Array.isArray(toolResult.__addTools)) {
        const adds = toolResult.__addTools;
        delete toolResult.__addTools;
        for (const def of adds) {
          if (def?.function?.name && !tools.some((t) => t.function?.name === def.function.name)) tools.push(def);
        }
      }
      // A failure says what to do next: the documented alternative for the job, else tell the learner plainly.
      if (tool !== UPDATE_PLAN_TOOL.name && toolFailed(toolResult) && toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)) {
        const hint = recoveryHint(tool, toolResult, { retried: toolResult.retried === true, offered: tools.map((t) => t.function?.name) });
        if (hint) toolResult = { ...toolResult, recovery: hint.next };
      }
      // The same tool with the same arguments again in a row: a reminder rides on this observation (the ledger is bookkeeping, not counted).
      const repeat = tool === UPDATE_PLAN_TOOL.name ? null : guard.note(tool, input);
      if (repeat) console.log(`[agent-chat] tool ${tool} repeated ${repeat.count}× in a row — ${repeat.level} added`);
      const observation = toolObservation({ action: tool, result: toolResult, requestId: newToolRequestId(), extra: repeat ? { reminder: repeat.text } : null });
      recorder?.observation(observation);
      // Every tool call is logged: with nothing here, "the agent ignores my
      // data" is undiagnosable from server logs — zero lines means the model
      // never called a tool; a failed line points at the tool's backend.
      console.log(`[agent-chat] tool ${tool} → ${observation.success ? "ok" : "FAILED"} (request ${observation.request_id})`);
      const failNote = observation.success ? null
        : (String(toolResult?.error || toolResult?.message || "").trim().slice(0, 160) || null);
      executions.push({
        tool,
        success: observation.success,
        requestId: observation.request_id,
        // The real failure reason, so the end-of-turn correction can quote the
        // API response instead of a generic "nothing was saved".
        ...(failNote ? { error: failNote } : {}),
        sideEffecting: SIDE_EFFECT_TOOLS.includes(tool)
          || isSideEffectingAction(tool, input),
        // Asked or inferred, on every change (Phase 18 item 6) — shown in developer mode.
        ...(changes ? { basis: turnBasis.basis, rule: turnBasis.rule } : {}),
        ...(repeat ? { repeated: repeat.count } : {}),
        // Did this turn really put a request in front of an admin? (requestClaims.js checks the reply against it.)
        ...(tool === "submit_tool_request" || tool === "create_tool" ? { adminRequest: adminRequestOf(tool, toolResult) } : {}),
        ...(isInspected() ? { input, result: inspectResult(toolResult) } : {}),
        // A small echo so the chat UI can render the Preview affordance for
        // the human-in-the-loop approval without parsing the model's prose.
        // The protégé's two moves ride the reply so the app can show them:
        // a Teach me button, and the teaching guide's mark on the answer.
        ...(tool === "ask_to_be_taught" && toolResult?.asked ? { teach: { topic: toolResult.topic, subject: toolResult.subject } } : {}),
        // A tool that would change data (S6): the confirmation card — only the learner's tap runs it.
        // Only a card still WAITING for its tap rides the reply: a decided
        // card (an await_decision outcome) is never written into the chat —
        // the agent's narration is the outcome (Matt, 2026-11-17).
        ...(toolResult?.confirmation?.confirmationId && !DECIDED_CONFIRM_STATUSES.includes(toolResult.confirmation.status) ? { confirm: toolResult.confirmation }
          : toolResult?.result?.confirmation?.confirmationId && !DECIDED_CONFIRM_STATUSES.includes(toolResult.result.confirmation.status) ? { confirm: toolResult.result.confirmation } : {}),
        // await_decision APPLIED a card this turn — its result also carries
        // the decided card as `confirmation`, which on its own would read to
        // the end-of-turn check as "only a card was made" and append a false
        // "nothing has changed yet" note under a truthful outcome report.
        ...(tool === "await_decision" && toolResult?.executed ? { appliedDecision: true } : {}),
        // Materials the tool returned (courses, blog posts, Library documents, weak topics)
        // ride as clickable links — built from ids/slugs, never from the model's prose.
        ...(() => { const mats = collectMaterials([materialsFrom(tool, toolResult)]); return mats.length ? { materials: mats } : {}; })(),
        // Agent search results ride as cards the app can show (Challenge / Message buttons).
        ...((tool === "search_agents" || tool === "find_competitors") && Array.isArray(toolResult?.agents) ? { agents: toolResult.agents.slice(0, 6) } : {}),
        // `requestsMine`: the learner's OWN requests get Cancel, not Accept.
        ...(tool === "search_challenge_requests" && Array.isArray(toolResult?.requests) ? { requests: toolResult.requests.slice(0, 6), requestsMine: !!input?.mine } : {}),
        ...(tool === "consult_teaching_guide" && toolResult?.consulted ? { guide: { name: toolResult.guide, ...(toolResult.teach ? { teach: toolResult.teach } : {}) } } : {}),
        ...(((tool === "prepare_activity" || tool === "run_teaching_tool") && toolResult?.prepared
            || tool === "revise_activity_draft" && toolResult?.revised)
          && toolResult?.draftId
          ? { draft: { id: toolResult.draftId, title: toolResult.title, type: toolResult.type, audience: toolResult.audience, ...(toolResult.version ? { version: toolResult.version } : {}) } }
          : {}),
        // Study-prep sessions ride the same way, so the chat tab renders the
        // session card without parsing prose. Only a live session with a plan
        // qualifies — not a plan-less "planning" leftover or a finished one.
        ...(() => {
          const live = (x) => x && Array.isArray(x.plan) && x.plan.length > 0 && !["completed", "abandoned", "cancelled", "ended", "failed"].includes(x.status);
          // A session being planned in the background shows its card at once: it streams the planning.
          if (tool === "start_study_prep_session" && toolResult?.sessionId && (live(toolResult) || toolResult.planning)) return { session: { id: toolResult.sessionId } };
          if (tool === "get_study_prep_session") { const s0 = (toolResult?.sessions || []).find(live); if (s0) return { session: { id: s0.sessionId } }; }
          return {};
        })(),
      });
      // A card the learner must act on goes out NOW, not with "done": it used to
      // appear only after the whole reply had been written (2026-11-06).
      if (executions.at(-1)?.confirm) trace?.card?.({ tool, confirm: executions.at(-1).confirm });
      // A result's `next` proposal is normally already decided and NOT shown;
      // a still-pending one is shown, or nobody can tap it.
      if (toolResult?.next?.confirmationId && !DECIDED_CONFIRM_STATUSES.includes(toolResult.next.status)) trace?.card?.({ tool, confirm: toolResult.next });
      // Phase 22: persist this step (redacted, capped) so the full path — tool,
      // real error class/message, duration, retry — survives the turn.
      await recordStep(runId, stepRow({ runId, iteration, tool, input, success: observation.success,
        result: toolResult, durationMs, retries: toolResult?.retried ? 1 : 0, requestId: observation.request_id,
        sideEffecting: changes }));
      transcript.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(observation) });
    };
    const preparedCalls = calls.map(prepareCall);
    const parallelReadsOn = process.env.AKORO_PARALLEL_READS !== "false";
    const isParallelRead = (p) => parallelReadsOn && !p.changes && !PARALLEL_CALL_BARRIERS.has(p.tool) && BUILTIN_TOOL_NAMES.has(p.tool);
    let callIndex = 0;
    while (callIndex < preparedCalls.length) {
      if (isAborted()) return { messages: transcript, toolExecutions: executions, ledger: ledgerNow, aborted: true };
      let runEnd = callIndex;
      while (runEnd < preparedCalls.length && runEnd - callIndex < PARALLEL_READ_BATCH && isParallelRead(preparedCalls[runEnd])) runEnd += 1;
      if (runEnd - callIndex >= 2) {
        const ranBatch = await Promise.all(preparedCalls.slice(callIndex, runEnd).map((p) => runPrepared(p)));
        for (const ran of ranBatch) {
          if (isAborted()) return { messages: transcript, toolExecutions: executions, ledger: ledgerNow, aborted: true };
          await applyPrepared(ran);
        }
        callIndex = runEnd;
      } else {
        await applyPrepared(await runPrepared(preparedCalls[callIndex]));
        callIndex += 1;
      }
    }
  }
  // Phase 22: close the run. An aborted/excepted turn never reaches here, so it
  // stays 'running' and the stale sweep marks it 'incomplete' (a visible crash).
  await finishRun(runId, { status: "ok" });
  return { messages: transcript, toolExecutions: executions, ledger: ledgerNow };
}
