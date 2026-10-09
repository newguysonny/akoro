/**
 * responses-input.js — chat.completions shapes → Responses API shapes, for
 * Think mode (reasoning models run on the Responses API; the tool loop and
 * transcript stay in the chat.completions shape everywhere else).
 */

/*
 * Convert chat.completions-style messages (including the tool loop's
 * transcript) to Responses-API input.
 *   native: true  — tool calls/results become function_call /
 *                   function_call_output items (a decision call that also
 *                   declares the tools). No item `id` is sent, so the items
 *                   are valid without their reasoning items.
 *   native: false — a tools-free answer call: each result is a developer note
 *                   naming the tool, so the model explains real outcomes.
 */
export function toResponsesInput(messages, { native = false } = {}) {
  const toolNames = new Map();
  const input = [];
  for (const m of messages || []) {
    if (m.role === "tool") {
      if (native) input.push({ type: "function_call_output", call_id: m.tool_call_id, output: String(m.content ?? "") });
      else input.push({ role: "developer", content: [{ type: "input_text", text: `Akoro tool result (${toolNames.get(m.tool_call_id) || "tool"}): ${m.content ?? ""}` }] });
      continue;
    }
    const calls = m.role === "assistant" && Array.isArray(m.tool_calls) ? m.tool_calls : [];
    const hasContent = typeof m.content === "string" ? m.content.trim() : Array.isArray(m.content) && m.content.length;
    if (hasContent) {
      input.push({
        role: m.role,
        content: typeof m.content === "string"
          ? [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }]
          : m.content.map((p) => p.type === "image_url"
              ? { type: "input_image", image_url: p.image_url?.url, detail: p.image_url?.detail || "auto" }
              : { type: "input_text", text: p.text }),
      });
    }
    for (const call of calls) {
      toolNames.set(call.id, call.function?.name);
      if (native) input.push({ type: "function_call", call_id: call.id, name: call.function?.name, arguments: call.function?.arguments || "{}" });
    }
  }
  return input;
}

/* Responses-API function tools from the chat-completions tool list. strict is
   off: the catalogue's schemas are not all strict-mode shaped. */
export function toResponsesTools(tools) {
  return (tools || []).map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: false,
  }));
}
