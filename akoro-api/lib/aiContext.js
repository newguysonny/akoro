/**
 * lib/aiContext.js
 * ─────────────────────────────────────────────────────────────
 * Per-request AI context via AsyncLocalStorage. authenticateToken runs each
 * request's handler chain inside a store carrying the acting user + a coarse
 * feature label, so the metered OpenAI client (lib/aiModel.js) can charge the
 * right wallet for ANY AI call made during the request — without every call
 * site having to thread userId through.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const aiContext = new AsyncLocalStorage();

export const getAiUser    = () => aiContext.getStore()?.userId ?? null;
export const getAiFeature = () => aiContext.getStore()?.feature ?? "ai";
export const getAiBillTo  = () => aiContext.getStore()?.billTo ?? null;
export const runWithAiContext = (store, fn) => aiContext.run(store, fn);

// Coarse feature label from the request path (for the ledger).
export function featureForRequest(req) {
  const p = (req.baseUrl || req.originalUrl || req.path || "").toLowerCase();
  if (p.includes("/adaptive")) return "adaptive_learning";
  if (p.includes("/tasks"))    return "agent_task";
  if (p.includes("/battle"))   return "battle";
  if (p.includes("/instructor")) return "instructor_ai";
  if (p.includes("/school"))   return "school_ai";
  if (p.includes("/voice"))    return "voice";
  return "ai";
}
