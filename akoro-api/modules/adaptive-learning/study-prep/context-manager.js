/**
 * study-prep context manager (Master Plan §4.6, from S3). Loads the
 * configurable agent brain — the `akoro-agent/` workspace of .md files — and
 * selects the file set PER OPERATION so a planning step never carries the
 * research files (cost + reasoning degradation — S3's explicit trap).
 *
 * Doctrine: files are stable instructions; the DATABASE is dynamic truth;
 * tools are controlled access. The .md files are never authoritative state.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../akoro-agent");

/** Per-operation selection sets (S3): small, purposeful, never everything. */
export const CONTEXT_SETS = Object.freeze({
  planning: ["AGENT.md", "learning/LEARNING.md", "reasoning/PLANNING.md", "policies/EDUCATION_RULES.md"],
  research: ["AGENT.md", "reasoning/RESEARCH.md", "reasoning/INSPECTION.md", "policies/EDUCATION_RULES.md"],
  teaching: ["AGENT.md", "learning/LEARNING.md", "learning/TEACHING.md", "learning/MASTERY.md"],
  reflection: ["AGENT.md", "learning/ASSESSMENT.md", "learning/MASTERY.md", "reasoning/REASONING.md"],
  strategies: ["AGENT.md", "strategies/STRATEGIES.md", "policies/TOOL_RULES.md"],
  safety: ["AGENT.md", "policies/SAFETY.md"],
});

export const CONTEXT_SET_NAMES = Object.freeze(Object.keys(CONTEXT_SETS));

/** Hard size budget per file (bytes) and per assembled context (bytes). */
export const CONTEXT_BUDGET = Object.freeze({ MAX_FILE_BYTES: 8192, MAX_CONTEXT_BYTES: 24_576 });

const cache = new Map();

async function loadFile(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const location = path.join(WORKSPACE_ROOT, relative);
  const resolved = path.resolve(location);
  if (!resolved.startsWith(WORKSPACE_ROOT)) throw new Error(`Context file escapes the workspace: ${relative}`);
  let content;
  try {
    content = await readFile(resolved, "utf8");
  } catch {
    return null; // a missing optional file is silence, not a failure
  }
  if (content.length > CONTEXT_BUDGET.MAX_FILE_BYTES) {
    throw new Error(`Context file exceeds its size budget: ${relative} (${content.length} > ${CONTEXT_BUDGET.MAX_FILE_BYTES})`);
  }
  const entry = { file: relative, content };
  cache.set(relative, entry);
  return entry;
}

/** Invalidate the cache (tests use it to prove files are really read). */
export function clearContextCache() { cache.clear(); }

/**
 * Load one operation's file set → { system, files }. AGENT.md anchors every
 * set; the identity files load only when explicitly selected.
 */
export async function loadContext(setName, { extra = [] } = {}) {
  const files = CONTEXT_SETS[setName] || [];
  const requested = files.concat(extra);
  const loaded = [];
  let bytes = 0;
  for (const relative of requested) {
    const entry = await loadFile(relative);
    if (!entry) continue;
    bytes += entry.content.length;
    if (bytes > CONTEXT_BUDGET.MAX_CONTEXT_BYTES) {
      throw new Error(`Assembled context exceeds its budget (${setName}): ${bytes} > ${CONTEXT_BUDGET.MAX_CONTEXT_BYTES}`);
    }
    loaded.push(entry);
  }
  return {
    set: setName,
    files: loaded.map((entry) => entry.file),
    system: loaded.map((entry) => `# ${entry.file}\n${entry.content.trim()}`).join("\n\n---\n\n"),
  };
}

/**
 * buildAgentContext (S3): workspace selection + dynamic truth, assembled for
 * one agent-loop step. `dynamic` is fetched through read tools by the caller —
 * this function never touches the database itself.
 */
export async function buildAgentContext({ setName, goal, session, dynamic = {} }) {
  const context = await loadContext(setName);
  const dynamicLines = [];
  if (goal) dynamicLines.push(`GOAL: ${String(goal).slice(0, 300)}`);
  if (session) {
    dynamicLines.push(`SESSION: ${session.subject} (${session.classLevel}), status ${session.status}`);
    if (session.pausedReason) dynamicLines.push(`PAUSED: ${session.pausedReason}`);
  }
  for (const [key, value] of Object.entries(dynamic)) {
    if (value == null) continue;
    const serialised = typeof value === "string" ? value : JSON.stringify(value);
    dynamicLines.push(`${key.toUpperCase()}: ${serialised.slice(0, 2000)}`);
  }
  return {
    ...context,
    dynamic: dynamicLines.join("\n"),
    system: `${context.system}\n\n# CURRENT CONTEXT\n${dynamicLines.join("\n")}`,
  };
}
