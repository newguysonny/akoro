/**
 * lib/providers/openaiCompatible.js — providers that speak OpenAI's
 * chat-completions API at their own address (Grok/xAI, DeepSeek, …)
 * (Grand Plan §7.11.4). The same OpenAI client, pointed at the entry's
 * `baseURL` with the key from its `apiKeyEnv`; responses are already in the
 * shape the codebase uses.
 */
import OpenAI from "openai";
import { makeAiBreaker } from "../circuitBreaker.js";

const clients = new Map();

export function makeOpenAICompatibleAdapter({ env = process.env, clientFor = null } = {}) {
  const client = (entry) => {
    if (clientFor) return clientFor(entry);
    const key = `${entry.baseURL}|${entry.apiKeyEnv}`;
    if (!clients.has(key)) {
      const apiKey = entry.apiKeyEnv ? env[entry.apiKeyEnv] : null;
      if (!apiKey) throw Object.assign(new Error(`${entry.id}: no API key (set ${entry.apiKeyEnv || "apiKeyEnv"} in env)`), { status: 401 });
      clients.set(key, new OpenAI({ apiKey, baseURL: entry.baseURL }));
    }
    return clients.get(key);
  };
  // One breaker per provider address: one provider's trouble doesn't trip another's.
  const breakers = new Map();
  const breakerFor = (entry) => {
    if (!breakers.has(entry.baseURL)) {
      breakers.set(entry.baseURL, makeAiBreaker(`compat:${new URL(entry.baseURL).host}`, (e, params, reqOpts) => client(e).chat.completions.create(params, reqOpts)));
    }
    return breakers.get(entry.baseURL);
  };
  return {
    /** params already carry `model` = the entry's apiModel. */
    async create(params, reqOpts, entry) {
      try {
        return await breakerFor(entry).fire(entry, compatParams(params), reqOpts);
      } catch (error) {
        // A provider refusing the request (4xx) is our request's fault: say what it refused.
        const status = error?.status ?? error?.response?.status;
        if (status && status >= 400 && status < 500) {
          console.warn(`[ai:${entry.id}] ${status} rejected ${params?.stream ? "stream " : ""}request (${Object.keys(params || {}).filter((k) => !["messages", "model"].includes(k)).join(",")}): ${String(error?.message || "").slice(0, 300)}`);
        }
        throw error;
      }
    },
  };
}

/**
 * What these providers accept: DeepSeek and most OpenAI-compatible APIs take
 * `json_object` but not `json_schema` structured output. The schema becomes an
 * instruction (the word "JSON" included, which json_object mode requires), and
 * code still checks every answer as before. OpenAI-only stream options go too.
 */
export function compatParams(params) {
  const out = { ...params };
  const rf = out.response_format;
  if (rf?.type === "json_schema" && rf.json_schema?.schema) {
    out.response_format = { type: "json_object" };
    const rule = `Return only a JSON object that matches this JSON schema exactly (every required key present; null where the schema allows it):\n${JSON.stringify(rf.json_schema.schema)}`;
    const messages = Array.isArray(out.messages) ? [...out.messages] : [];
    const i = messages.findIndex((m) => m?.role === "system" && typeof m.content === "string");
    if (i >= 0) messages[i] = { ...messages[i], content: `${messages[i].content}\n\n${rule}` };
    else messages.unshift({ role: "system", content: rule });
    out.messages = messages;
  }
  return out;
}
