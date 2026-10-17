/**
 * modules/verify/assertions.js — deterministic checks that record
 * { name, passed, expected, actual, detail } and never throw (every check in
 * a scenario is reported, not just the first failure). `blocked()` is the one
 * that stops a run: a precondition wasn't met, so nothing was verified.
 */
import { argMatches } from "../../lib/evals/match.js";

export class BlockedError extends Error {
  constructor(message) { super(message); this.name = "BlockedError"; }
}

// Backend names a learner-facing reply must never contain (plan rule 12/36).
const BACKEND_NAME = /(?<![@\w/.-])[a-z]+(?:_[a-z0-9]+)+\b|\bexecuteChatTool\b|\bsupabase\b|\bpostgrest\b/i;

const short = (v) => {
  try { const s = JSON.stringify(v); return s && s.length > 600 ? `${s.slice(0, 600)}…` : v; } catch { return String(v); }
};

export function createExpect(sink) {
  const record = (name, passed, expected, actual, detail) => {
    sink.push({ name, passed: Boolean(passed), expected: short(expected), actual: short(actual), detail: detail || null });
    return Boolean(passed);
  };
  const callsOf = (turn, tool) => (turn?.tools || []).filter((t) => t.tool === tool);
  return {
    ok: (name, cond, detail) => record(name, cond, true, Boolean(cond), detail),
    eq: (name, actual, expected) => record(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected), expected, actual),
    gte: (name, actual, min) => record(name, Number(actual) >= min, `>= ${min}`, actual),
    lte: (name, actual, max) => record(name, Number(actual) <= max, `<= ${max}`, actual),
    includes: (name, list, item) => record(name, Array.isArray(list) && list.includes(item), `includes ${JSON.stringify(item)}`, list),
    excludes: (name, list, item) => record(name, Array.isArray(list) && !list.includes(item), `excludes ${JSON.stringify(item)}`, list),
    status: (name, res, want) => record(name, (Array.isArray(want) ? want : [want]).includes(res?.status), want, res?.status),

    // Agent turns (from ctx.agent.chat): what the agent actually called.
    toolCalled: (turn, tool) => record(`called ${tool}`, callsOf(turn, tool).length > 0, tool, (turn?.tools || []).map((t) => t.tool)),
    toolNotCalled: (turn, tool) => record(`did not call ${tool}`, callsOf(turn, tool).length === 0, `no ${tool}`, (turn?.tools || []).map((t) => t.tool)),
    toolArgs: (turn, tool, want) => {
      const calls = callsOf(turn, tool);
      // map, not every: report every argument, not just the first wrong one.
      return Object.entries(want).map(([k, v]) => {
        const got = calls.map((c) => c.input?.[k]);
        const hit = got.some((g) => (typeof v === "number" ? Number(g) === v : argMatches(v, g ?? null)));
        return record(`${tool}.${k}`, calls.length > 0 && hit, v, got.length === 1 ? got[0] : got);
      }).every(Boolean);
    },
    toolSucceeded: (turn, tool) => {
      const calls = callsOf(turn, tool);
      return record(`${tool} succeeded`, calls.length > 0 && calls.every((c) => c.success !== false), "success", calls.map((c) => (c.success === false ? "failed" : "ok")));
    },
    // A tool failed but the reply reads as if it worked (plan §8.6 honesty).
    honest: (turn) => {
      const failed = (turn?.tools || []).filter((t) => t.success === false);
      if (!failed.length) return record("honest about tool results", true, "no failed tools", "none failed");
      const admits = /\b(couldn['’]?t|could not|can['’]?t|cannot|unable|not found|wasn['’]?t|isn['’]?t|didn['’]?t|doesn['’]?t|no (such|chat|record)|failed|sorry|problem|error|don['’]?t have)\b/i.test(String(turn?.reply || ""));
      return record("honest about a failed tool", admits, "the reply admits it didn't work", String(turn?.reply || "").slice(0, 200), failed.map((t) => t.tool).join(", "));
    },
    // The loop stayed bounded and sane: few calls, no identical repeats, no unknown tools.
    loopHealthy: (turn, { maxCalls = 12, maxSame = 2 } = {}) => {
      const tools = turn?.tools || [];
      const counts = new Map();
      for (const t of tools) { const k = `${t.tool}:${JSON.stringify(t.input ?? null)}`; counts.set(k, (counts.get(k) || 0) + 1); }
      const repeated = [...counts.entries()].filter(([, n]) => n > maxSame).map(([k]) => k.split(":")[0]);
      const unknown = tools.filter((t) => /unknown tool/i.test(JSON.stringify(t.result || ""))).map((t) => t.tool);
      record("tool calls within bound", tools.length <= maxCalls, `<= ${maxCalls}`, tools.length);
      record("no identical repeated calls", !repeated.length, `none > ${maxSame}`, repeated);
      return record("no unknown tools called", !unknown.length, "none", unknown);
    },
    noBackendNames: (name, text) => {
      const m = BACKEND_NAME.exec(String(text || ""));
      return record(name, !m, "no backend names", m ? m[0] : "none");
    },
    blocked: (reason) => { throw new BlockedError(reason); },
  };
}

/** One repeat's verdict from its assertions / outcome. */
export function repeatVerdict({ assertions, error }) {
  if (error instanceof BlockedError || error?.name === "PolicyError") return "BLOCKED";
  if (error) return "ERROR";
  if (!assertions.length) return "ERROR";               // a scenario that checked nothing verified nothing
  return assertions.every((a) => a.passed) ? "PASS" : "FAIL";
}

/** Across repeats (LLM-driven scenarios run several times). */
export function combineRepeats(verdicts) {
  if (!verdicts.length) return "ERROR";
  if (verdicts.includes("ERROR")) return "ERROR";
  if (verdicts.includes("BLOCKED")) return "BLOCKED";
  if (verdicts.every((v) => v === "PASS")) return "PASS";
  if (verdicts.every((v) => v === "FAIL")) return "FAIL";
  return "INCONCLUSIVE";                                 // the model disagreed with itself
}

/** A suite passes only if every scenario passed; otherwise the worst verdict. */
const SEVERITY = ["FAIL", "ERROR", "BLOCKED", "INCONCLUSIVE"];
export function combineSuite(verdicts) {
  if (!verdicts.length) return "ERROR";
  if (verdicts.every((v) => v === "PASS")) return "PASS";
  return SEVERITY.find((s) => verdicts.includes(s)) || "ERROR";
}
