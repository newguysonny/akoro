/**
 * lib/providers/anthropic.js — Claude through the official @anthropic-ai/sdk
 * Messages API, normalised to the OpenAI chat-completions shape the codebase
 * uses (messages, tools, tool calls, streaming chunks, usage) (Grand Plan
 * §7.11.4). Never an OpenAI-compatible shim.
 *
 *   - No forced tool choice: current Claude models reject tool_choice
 *     any/tool, so "required" becomes auto + an instruction to call exactly
 *     one tool. A reply without a tool call is the agent loop's malformed
 *     iteration, as with any model.
 *   - Thinking: on by default on these models and never shown or stored;
 *     depth is set with output_config.effort (low unless the entry says).
 *     Thinking shares max_tokens, so a small OpenAI-sized limit is raised.
 *   - Refusals: stop_reason "refusal" → finish_reason "content_filter" and a
 *     message.refusal the caller can turn into a model_refusal observation.
 *   - Usage: input + cache reads/writes → prompt_tokens (cache reads as
 *     cached_tokens, billed at the entry's cachedIn rate), output →
 *     completion_tokens.
 *   - Errors keep their HTTP status (telemetry and the breaker read it).
 */
import Anthropic from "@anthropic-ai/sdk";
import { makeAiBreaker } from "../circuitBreaker.js";

const MIN_MAX_TOKENS = 4000;
const ONE_TOOL = "Call exactly one of the provided tools in this reply. Do not answer in text alone.";

const textOf = (content) => (typeof content === "string" ? content
  : Array.isArray(content) ? content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("") : String(content ?? ""));

/** OpenAI messages → { system, messages } for the Messages API. */
export function toAnthropicMessages(messages = []) {
  const system = [];
  const out = [];
  const push = (role, block) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block); else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === "system" || m.role === "developer") { system.push(textOf(m.content)); continue; }
    if (m.role === "tool") {
      push("user", { type: "tool_result", tool_use_id: m.tool_call_id, content: textOf(m.content) || "(empty)" });
      continue;
    }
    if (m.role === "assistant") {
      const text = textOf(m.content);
      if (text) push("assistant", { type: "text", text });
      for (const call of m.tool_calls || []) {
        let input = {};
        try { input = JSON.parse(call.function?.arguments || "{}"); } catch { input = {}; }
        push("assistant", { type: "tool_use", id: call.id, name: call.function?.name, input });
      }
      continue;
    }
    push("user", { type: "text", text: textOf(m.content) || " " });
  }
  // The first message must be the user's.
  if (out[0]?.role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "(start)" }] });
  return { system: system.filter(Boolean).join("\n\n"), messages: out };
}

/** OpenAI chat-completions params → Messages API params. */
export function toAnthropicParams(params, entry) {
  const { system, messages } = toAnthropicMessages(params.messages);
  const tools = (params.tools || []).filter((t) => t.type === "function" && t.function?.name).map((t) => ({
    name: t.function.name, description: t.function.description || "", input_schema: t.function.parameters || { type: "object", properties: {} },
  }));
  const choice = params.tool_choice;
  const required = choice === "required" || (choice && typeof choice === "object" && choice.type === "function");
  const out = {
    model: entry.apiModel,
    max_tokens: Math.max(Number(params.max_tokens || params.max_completion_tokens || 0), MIN_MAX_TOKENS),
    messages,
    output_config: { effort: entry.effort || "low" },
  };
  // The Messages API has no response_format. A JSON request becomes an
  // instruction, exactly like the compatible-provider conversion — without it
  // a structured-output feature would get prose when Claude is the provider.
  const rf = params.response_format;
  let jsonRule = null;
  if (rf?.type === "json_schema" && rf.json_schema?.schema) {
    jsonRule = `Return only a JSON object that matches this JSON schema exactly (every required key present; null where the schema allows it):\n${JSON.stringify(rf.json_schema.schema)}`;
  } else if (rf?.type === "json_object") {
    jsonRule = "Return only one JSON object. No prose, no markdown fences.";
  }
  const sys = [system, tools.length && required ? ONE_TOOL : null, jsonRule].filter(Boolean).join("\n\n");
  if (sys) out.system = sys;
  if (tools.length) out.tools = tools;
  if (tools.length && choice === "none") out.tool_choice = { type: "none" };
  else if (tools.length) out.tool_choice = { type: "auto" };
  // Built fresh, so OpenAI-only and sampling fields (temperature, top_p, seed …) never reach Claude.
  return out;
}

const FINISH = { end_turn: "stop", stop_sequence: "stop", tool_use: "tool_calls", max_tokens: "length", refusal: "content_filter", pause_turn: "stop" };

/** Messages API usage → chat-completions usage. */
export function toChatUsage(u = {}) {
  const cached = u.cache_read_input_tokens || 0;
  const written = u.cache_creation_input_tokens || 0;
  return {
    prompt_tokens: (u.input_tokens || 0) + cached + written,
    completion_tokens: u.output_tokens || 0,
    total_tokens: (u.input_tokens || 0) + cached + written + (u.output_tokens || 0),
    prompt_tokens_details: { cached_tokens: cached },
  };
}

/** A Messages API response → a chat completion. Thinking is dropped, never shown or stored. */
export function toChatCompletion(res) {
  const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const calls = (res.content || []).filter((b) => b.type === "tool_use").map((b) => ({
    id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
  }));
  const refused = res.stop_reason === "refusal";
  return {
    id: res.id, object: "chat.completion", model: res.model,
    choices: [{
      index: 0, finish_reason: FINISH[res.stop_reason] || "stop",
      message: {
        role: "assistant", content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
        ...(refused ? { refusal: res.stop_details?.explanation || "The model declined this request.", refusal_category: res.stop_details?.category ?? null } : {}),
      },
    }],
    usage: toChatUsage(res.usage),
  };
}

/** Messages API stream events → chat-completion chunks (text, tool calls, a final usage chunk). */
export async function* toChatChunks(events) {
  let usage = {};
  let stop = null;
  let refusalText = null;
  const toolIndex = new Map();   // content block index → tool call index
  for await (const ev of events) {
    if (ev.type === "message_start") { usage = { ...(ev.message?.usage || {}) }; continue; }
    if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
      const i = toolIndex.size;
      toolIndex.set(ev.index, i);
      yield { choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: ev.content_block.id, type: "function", function: { name: ev.content_block.name, arguments: "" } }] } }] };
      continue;
    }
    if (ev.type === "content_block_delta") {
      if (ev.delta?.type === "text_delta") yield { choices: [{ index: 0, delta: { content: ev.delta.text } }] };
      else if (ev.delta?.type === "input_json_delta" && toolIndex.has(ev.index)) {
        yield { choices: [{ index: 0, delta: { tool_calls: [{ index: toolIndex.get(ev.index), function: { arguments: ev.delta.partial_json } }] } }] };
      }
      continue;   // thinking deltas are never passed on
    }
    if (ev.type === "message_delta") {
      stop = ev.delta?.stop_reason || stop;
      if (ev.delta?.stop_details?.explanation) refusalText = String(ev.delta.stop_details.explanation);
      usage = { ...usage, ...(ev.usage || {}) };
    }
  }
  // A streamed refusal carries its reason like a non-streamed one (message.refusal).
  yield { choices: [{ index: 0, delta: stop === "refusal" ? { refusal: refusalText || "The model declined this request." } : {}, finish_reason: FINISH[stop] || "stop" }] };
  yield { choices: [], usage: toChatUsage(usage) };
}

/** An SDK error keeps its status; anything else passes through. */
export function mapError(error) {
  if (error instanceof Anthropic.APIError) {
    return Object.assign(new Error(`Claude: ${error.message}`), { status: error.status, provider: "anthropic", cause: error });
  }
  return error;
}

export function makeAnthropicAdapter({ env = process.env, client = null } = {}) {
  let sdk = client;
  const getClient = () => {
    if (sdk) return sdk;
    if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) throw Object.assign(new Error("Claude: no API key (set ANTHROPIC_API_KEY in env)"), { status: 401 });
    sdk = new Anthropic();
    return sdk;
  };
  // One breaker for the provider.
  const breaker = makeAiBreaker("anthropic-messages", async (body, reqOpts) => {
    try { return await getClient().messages.create(body, reqOpts); } catch (e) { throw mapError(e); }
  });
  return {
    async create(params, reqOpts, entry) {
      const body = toAnthropicParams(params, entry);
      if (params.stream) {
        const events = await breaker.fire({ ...body, stream: true }, reqOpts);
        const chunks = toChatChunks(events);
        if (events?.controller) chunks.controller = events.controller;
        return chunks;
      }
      return toChatCompletion(await breaker.fire(body, reqOpts));
    },
  };
}
