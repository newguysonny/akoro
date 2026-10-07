/**
 * modules/tasks/lib/agentLoop.js
 *
 * The agent loop itself, with nothing task-specific left in it.
 *
 * Lifted out of worker.js so the eval suite can run the SAME loop against stub
 * tools. Evaluating a copy would be worse than not evaluating at all: the copy
 * would pass while the real loop drifted, and the green result would be quoted
 * as though it meant something. Everything that decides behaviour — the
 * iteration cap, the side-effect replay, the order messages are pushed in —
 * lives here now and is shared.
 *
 * What stayed in worker.js: billing, DB writes, progress delivery. Those are
 * the parts an eval must NOT do.
 */

import { openai, OPENAI_MODEL } from "../../../lib/aiModel.js";
import { newToolRequestId, toolObservation } from "../../../utils/toolObservation.js";

export const MAX_TOOL_ITERATIONS = 20;

/**
 * Tools that CHANGE THE WORLD, and so must run at most once per run.
 *
 * The loop lets the model call tools until it stops. That is right for reads —
 * look up a student, then another — and dangerous for writes: a model that
 * misreads a tool result as a failure will simply try again, and each retry is
 * a real battle sent to a real class, or work assigned to eighteen learners, or
 * coins spent. Observed in testing: one task produced twenty battles and
 * eighteen self-study assignments before the iteration cap stopped it.
 *
 * So a successful side-effecting call is remembered and replayed. The model
 * sees the same result it already got — which is the truth, since the work was
 * done — and stops asking. Failures are NOT cached: a retry after a genuine
 * error is exactly what should be allowed.
 */
export const SIDE_EFFECTING = new Set([
  "assign_battle", "create_battle", "challenge_peer",
  "assign_self_study", "run_teaching_tool",
  "send_reminder", "schedule_session", "create_study_plan", "set_study_reminder",
]);

/**
 * Run the loop until the model stops asking for tools.
 *
 * @param {object}   o
 * @param {Array}    o.messages      seeded conversation (system + user)
 * @param {Array}    o.toolDefs      OpenAI function-tool definitions
 * @param {Function} o.callTool      async (name, args) => result. The ONLY seam
 *                                   between production and an eval: the worker
 *                                   passes real executors, the suite passes
 *                                   stubs that record instead of acting.
 * @param {Function} [o.onStep]      async (step) => void, after each model turn
 * @param {Function} [o.onToolStart] async (name) => void, before each execution
 * @param {object}   [o.meta]        __userId / __feature / __ref for telemetry
 * @returns {{ steps, outputs, messages, iterations, calls, hitCap }}
 *   `calls` is every tool the model asked for, in order, including the ones
 *   answered from the replay cache — what it ASKED is the behaviour under test,
 *   not what got through.
 */
export async function runAgentLoop({
  messages,
  toolDefs = [],
  callTool,
  onStep = null,
  onToolStart = null,
  model = OPENAI_MODEL,
  maxIterations = MAX_TOOL_ITERATIONS,
  maxTokens = 4096,
  meta = {},
}) {
  const steps   = [];
  const outputs = [];
  const calls   = [];
  const done    = new Map();   // side-effecting tool -> its result, this run only

  let iterations = 0;
  let hitCap = true;           // proved false by a clean break below

  while (iterations < maxIterations) {
    iterations++;
    const response = await openai.chat.completions.create({
      model, max_tokens: maxTokens,
      ...(toolDefs.length ? { tools: toolDefs } : {}),
      messages,
      ...meta,
    });

    const msg    = response.choices?.[0]?.message ?? { role: "assistant", content: "" };
    const finish = response.choices?.[0]?.finish_reason;
    const step   = { role: "assistant", content: msg.content ?? null, toolCalls: msg.tool_calls ?? null, finishReason: finish, iteration: iterations };
    steps.push(step);
    await onStep?.(step, steps);

    // Echo the assistant turn back (may carry tool_calls) — required before
    // the matching tool results.
    messages.push(msg);
    if (msg.content && msg.content.trim()) outputs.push({ type: "message", text: msg.content });

    const toolCalls = msg.tool_calls ?? [];
    if (!toolCalls.length) { hitCap = false; break; }   // "stop" — no tools requested

    for (const call of toolCalls) {
      const name = call.function?.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      calls.push({ name, args });

      // Structured observation (utils/toolObservation.js): the tool's real
      // outcome becomes the model's next input, so confirmations come from
      // the backend response, not from hope.
      let observation;
      if (SIDE_EFFECTING.has(name) && done.has(name)) {
        // Already done in this run — hand back the same answer rather than
        // doing it a second time.
        observation = toolObservation({
          action: name,
          result: done.get(name),
          requestId: newToolRequestId(),
          extra: { alreadyDone: true,
            note: `${name} already ran for this task; this is the result of that run.` },
        });
      } else {
        await onToolStart?.(name);
        try {
          const result = await callTool(name, args);
          const next = toolObservation({ action: name, result, requestId: newToolRequestId() });
          // Cache only SUCCESS (the envelope's verdict): a retry after a real
          // error is legitimate. The RAW result is cached so the replay is
          // byte-faithful to what the first execution actually returned.
          if (SIDE_EFFECTING.has(name) && next.success) done.set(name, result);
          observation = next;
        } catch (err) {
          observation = toolObservation({ action: name, result: { error: err.message }, requestId: newToolRequestId() });
        }
      }
      // One tool message per tool_call_id, or OpenAI rejects the next call.
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(observation) });
    }
  }

  return { steps, outputs, messages, iterations, calls, hitCap };
}
