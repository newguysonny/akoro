/**
 * lib/providers/opencode.js — the OpenCode Go transport (Grand Plan §7.11.4).
 *
 * Every text model is served through the OpenAI chat-completions endpoint;
 * OpenCode translates to the model's own API family. One OpenAI client per
 * lane address with the key from OPENCODE_API_KEY, plus the headers Go asks
 * for: a real user agent and a stable x-opencode-session per conversation.
 *
 * Responses keep their `usage` untouched and carry the gateway's own billing
 * figures as a non-enumerable `__opencode`:
 *   { costUsd, billingSource, listCostUsd, allowanceUsd }
 * Billing may read them; nothing learner-facing serialises them.
 */
import OpenAI from "openai";
import { makeAiBreaker } from "../circuitBreaker.js";
import { aiContext } from "../aiContext.js";
import { compatParams } from "./openaiCompatible.js";

const DEFAULT_BASE = "https://opencode.ai/inference";
const DEFAULT_USER_AGENT = "akoro-api/1.0";

/** `OPENCODE_BASE_URL` + `/<lane>` + the OpenAI-compatible surface. */
export function openCodeBaseURL(entry, env = process.env) {
  const root = String(env.OPENCODE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const lane = entry?.lane || "go";
  const base = root.endsWith(`/${lane}`) ? root : `${root}/${lane}`;
  return base.endsWith("/openai/v1") ? base : `${base}/openai/v1`;
}

const numOrNull = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** The gateway's cost metadata from a usage object, or null when it reports none. */
export function openCodeMeta(usage) {
  const oc = usage?.opencode || {};
  const meta = {
    costUsd: numOrNull(usage?.cost),
    billingSource: oc.billing_source ?? null,
    listCostUsd: numOrNull(oc.list_cost),
    allowanceUsd: numOrNull(oc.allowance),
  };
  return meta.costUsd == null && meta.listCostUsd == null && meta.allowanceUsd == null && !meta.billingSource ? null : meta;
}

/** Attach `__opencode` without changing what serialises or what the caller sees in `usage`. */
export function attachOpenCodeMeta(target, usage) {
  if (!target || typeof target !== "object") return target;
  const meta = openCodeMeta(usage);
  if (!meta) return target;
  try {
    Object.defineProperty(target, "__opencode", { value: meta, enumerable: false, configurable: true, writable: true });
  } catch { /* a frozen response is still a valid response */ }
  return target;
}

export function makeOpenCodeAdapter({ env = process.env, clientFor = null } = {}) {
  const clients = new Map();
  const sessionId = () => aiContext.getStore()?.sessionId || aiContext.getStore()?.requestId || "akoro-api";
  const headersFor = () => ({
    "User-Agent": env.OPENCODE_USER_AGENT || DEFAULT_USER_AGENT,
    "x-opencode-session": sessionId(),
  });
  const client = (entry) => {
    const baseURL = openCodeBaseURL(entry, env);
    const apiKey = env.OPENCODE_API_KEY || null;
    if (clientFor) return clientFor({ ...entry, baseURL }, { apiKey, baseURL });
    if (!clients.has(baseURL)) {
      if (!apiKey) throw Object.assign(new Error(`${entry.id}: no API key (set OPENCODE_API_KEY in env)`), { status: 401 });
      clients.set(baseURL, new OpenAI({ apiKey, baseURL }));
    }
    return clients.get(baseURL);
  };
  const breakers = new Map();
  const breakerFor = (baseURL) => {
    if (!breakers.has(baseURL)) {
      breakers.set(baseURL, makeAiBreaker(`opencode:${new URL(baseURL).host}${new URL(baseURL).pathname}`, (entry, params, reqOpts) => client(entry).chat.completions.create(params, reqOpts)));
    }
    return breakers.get(baseURL);
  };
  const streamWithMeta = (source) => {
    const gen = (async function* () {
      for await (const chunk of source) {
        if (chunk?.usage) attachOpenCodeMeta(chunk, chunk.usage);
        yield chunk;
      }
    })();
    if (source?.controller) gen.controller = source.controller;
    return gen;
  };
  return {
    /** params already carry `model` = the entry's apiModel (lib/aiModel.js). */
    async create(params, reqOpts, entry) {
      const baseURL = openCodeBaseURL(entry, env);
      const opts = { ...(reqOpts || {}), headers: { ...(reqOpts?.headers || {}), ...headersFor() } };
      // The gateway/models take json_object, not json_schema: the schema becomes
      // an instruction. Without this every strict-schema call silently degraded
      // to prose (quiz/summary, mark schemes, autonomy, materials, suggestions).
      const payload = compatParams(params);
      try {
        const res = await breakerFor(baseURL).fire(entry, payload, opts);
        if (payload?.stream) return streamWithMeta(res);
        return attachOpenCodeMeta(res, res?.usage);
      } catch (error) {
        // A 4xx that is not 429 is our request's fault: say what was refused.
        const status = error?.status ?? error?.response?.status;
        if (status && status >= 400 && status < 500) {
          console.warn(`[ai:${entry.id}] ${status} rejected ${payload?.stream ? "stream " : ""}request (${Object.keys(payload || {}).filter((k) => !["messages", "model"].includes(k)).join(",")}): ${String(error?.message || "").slice(0, 300)}`);
        }
        throw error;
      }
    },
  };
}
