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
    create(params, reqOpts, entry) {
      return breakerFor(entry).fire(entry, params, reqOpts);
    },
  };
}
