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

/**
 * Coarse feature label from the request path.
 *
 * This is what every cost and latency figure is grouped BY, so a path missing
 * from it is spend you cannot attribute. Six prefixes were listed and nine were
 * not — including /teaching, which is the whole tool suite (podcasts, lesson
 * hooks, misconceptions) and one of the heaviest AI consumers on the platform.
 * All of it was landing in the catch-all "ai" bucket, which by volume was the
 * joint-largest "feature" on the dashboard and told you nothing.
 *
 * Ordered longest-prefix-first where paths overlap.
 */
export function featureForRequest(req) {
  const p = (req.baseUrl || req.originalUrl || req.path || "").toLowerCase();
  if (p.includes("/adaptive"))       return "adaptive_learning";
  if (p.includes("/tasks"))          return "agent_task";
  if (p.includes("/battle"))         return "battle";
  if (p.includes("/self-study"))     return "self_study";
  if (p.includes("/teaching"))       return "teaching_tool";
  if (p.includes("/past-questions")) return "past_questions";
  if (p.includes("/curriculum"))     return "curriculum";
  if (p.includes("/records"))        return "records";
  if (p.includes("/instructor"))     return "instructor_ai";
  if (p.includes("/school"))         return "school_ai";
  if (p.includes("/student"))        return "student_ai";
  if (p.includes("/profiles"))       return "profiles_ai";
  if (p.includes("/content"))        return "content_ai";
  if (p.includes("/admin"))          return "admin_ai";
  if (p.includes("/voice"))          return "voice";
  return "ai";
}
