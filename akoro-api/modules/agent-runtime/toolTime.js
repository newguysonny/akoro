/**
 * agent-runtime/toolTime.js — per-tool time limits (Grand Plan Phase 18,
 * item 3). Every tool has one: declared on the tool (`timeLimitMs`), else its
 * family's default. A call past it does not stall the turn: the loop stops
 * waiting and the agent reads a failed observation with the code `timeout`,
 * which the recovery rule (Phase 16 step 3, toolRecovery.js; the contract's
 * ERROR_CODES.timeout) takes from there — a read is retried once, a change
 * is never repeated blindly (it may still finish on its own).
 *
 *   TOOL_TIME_LIMITS_MS        the family defaults (the runtime's tool levels)
 *   timeLimitFor(tool)         a tool's own limit, else its family's
 *   ToolTimeout                the error, code "timeout"
 *   withToolTimeLimit(fn, ms, tool) → fn()'s result, or throws ToolTimeout
 *
 * The defaults sit well above what each family normally takes, so only a
 * stuck call is cut: a read answers from the database, a change may write
 * several rows, a persona or an execute step may call a model.
 */
export const TOOL_TIME_LIMITS_MS = Object.freeze({
  read: 30_000,
  propose: 60_000,
  execute: 120_000,
  persona: 90_000,
});
export const DEFAULT_TOOL_TIME_LIMIT_MS = 60_000;

/** PURE: the limit for a tool definition ({ level, timeLimitMs? }) or a family name. */
export function timeLimitFor(tool, families = TOOL_TIME_LIMITS_MS) {
  if (typeof tool === "string") return families[tool] ?? DEFAULT_TOOL_TIME_LIMIT_MS;
  const own = Number(tool?.timeLimitMs);
  if (Number.isFinite(own) && own > 0) return own;
  return families[tool?.level] ?? DEFAULT_TOOL_TIME_LIMIT_MS;
}

/** The observation's words: "timed out" (a temporary failure), never "before" (a change may have run). */
export class ToolTimeout extends Error {
  constructor(tool, ms) {
    super(`${tool || "The tool"} did not finish within ${Math.round(ms / 1000)} s (timed out). It may still finish on its own, so check before repeating a change.`);
    this.name = "ToolTimeout";
    this.code = "timeout";
    this.tool = tool || null;
    this.timeLimitMs = ms;
  }
}

/** Run fn(); past `ms` stop waiting and throw ToolTimeout. No limit (0, null, ∞) → just fn(). */
export async function withToolTimeLimit(fn, ms, tool = null) {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return fn();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new ToolTimeout(tool, ms)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
