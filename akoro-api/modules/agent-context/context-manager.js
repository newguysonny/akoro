/**
 * modules/agent-context/context-manager.js — the platform Context Manager
 * (Context Layer Adoption mini-plan P0; promoted from
 * modules/adaptive-learning/study-prep/context-manager.js, Master Plan §4.6,
 * from S3). Loads the configurable agent brain — the `akoro-agent/` workspace
 * of .md files — and selects the file set PER OPERATION so a planning step
 * never carries the research files (cost + reasoning degradation — S3's
 * explicit trap).
 *
 * Doctrine: files are stable instructions; the DATABASE is dynamic truth;
 * tools are controlled access. The .md files are never authoritative state.
 *
 * Two loading modes (see ./manifest.mjs):
 *   loadContext(setName)      joined S3 assembly (headers + --- separators)
 *   loadDoctrine(file)        one verbatim chunk, for byte-identical prompt
 *                             assembly by migrated surfaces (mini-plan D1)
 *
 * Preflight (D6): every registered set must resolve within budget or the
 * boot refuses to start — agent behaviour can never silently change because
 * a workspace file went missing. contextVersion() (D8) hashes the loaded
 * doctrine so changes are observable (drift audit), not invisible.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_VERSION, PENDING_ADOPTION, SETS } from "./manifest.mjs";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../akoro-agent");

/** Joined sets (S3 assembly) — the study-prep loop's selection sets. */
export const CONTEXT_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries(SETS)
      .filter(([, definition]) => definition.mode === "joined")
      .map(([name, definition]) => [name, [...definition.files]]),
  ),
);

export const CONTEXT_SET_NAMES = Object.freeze(Object.keys(CONTEXT_SETS));

/** Hard size budget per file (bytes) and per assembled context (bytes). */
export const CONTEXT_BUDGET = Object.freeze({ MAX_FILE_BYTES: 8192, MAX_CONTEXT_BYTES: 24_576 });

export { MANIFEST_VERSION, PENDING_ADOPTION, SETS as CONTEXT_MANIFEST };

const cache = new Map();

function workspacePath(relative) {
  const resolved = path.resolve(path.join(WORKSPACE_ROOT, relative));
  if (!resolved.startsWith(WORKSPACE_ROOT)) throw new Error(`Context file escapes the workspace: ${relative}`);
  return resolved;
}

async function loadFile(relative, { required = false } = {}) {
  if (cache.has(relative)) return cache.get(relative);
  const resolved = workspacePath(relative);
  let content;
  try {
    content = await readFile(resolved, "utf8");
  } catch {
    // A missing OPTIONAL file is silence; a missing REQUIRED file is a fault —
    // doctrine listed in a manifest set must never silently vanish (D6).
    if (required) throw new Error(`Required context file is missing: ${relative}`);
    return null;
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
 * set; the identity files load only when explicitly selected. Set-listed
 * files are required; `extra` files stay optional (dynamic additions).
 */
export async function loadContext(setName, { extra = [] } = {}) {
  const files = CONTEXT_SETS[setName] || [];
  const requested = files.map((relative) => [relative, true]).concat(extra.map((relative) => [relative, false]));
  const loaded = [];
  let bytes = 0;
  for (const [relative, required] of requested) {
    const entry = await loadFile(relative, { required });
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
 * One verbatim doctrine chunk (trimmed) for byte-identical prompt assembly by
 * migrated surfaces (P1+). Required by definition: a surface that assembles
 * its system prompt from a file must fail loudly if the file is gone — the
 * boot preflight catches it first.
 */
export async function loadDoctrine(relative) {
  const entry = await loadFile(relative, { required: true });
  return entry.content.trim();
}

/**
 * contextVersion (D8): a short content hash over every file referenced by the
 * manifest. Boot logs it; doctrine changes become observable. Deterministic:
 * same files + manifest version → same hash.
 */
export async function contextVersion() {
  const referenced = [...new Set(Object.values(SETS).flatMap((definition) => [...definition.files]))].sort();
  const parts = [];
  for (const relative of referenced) {
    const entry = await loadFile(relative, { required: true });
    parts.push(`${relative}:${createHash("sha256").update(entry.content).digest("hex").slice(0, 16)}`);
  }
  return createHash("sha256").update(`v${MANIFEST_VERSION}\n${parts.join("\n")}`).digest("hex").slice(0, 12);
}

/**
 * Preflight (D6): validate every registered set — every file present, every
 * file within its budget, every assembled set within the context budget.
 * Returns { ok, problems, sets, version }. The boot (app.js) and
 * scripts/boot-smoke.mjs refuse to start when ok is false; the manifest
 * contract test runs it against fabricated broken sets too.
 */
export async function preflight({ sets = SETS } = {}) {
  const problems = [];
  const report = [];
  for (const [name, definition] of Object.entries(sets)) {
    let bytes = 0;
    let present = 0;
    for (const file of definition.files) {
      try {
        const entry = await loadFile(file, { required: false });
        if (!entry) { problems.push(`${name}: missing file ${file}`); continue; }
        bytes += entry.content.length;
        present += 1;
      } catch (error) {
        problems.push(`${name}: ${file}: ${error.message}`);
      }
    }
    if (bytes > CONTEXT_BUDGET.MAX_CONTEXT_BYTES) {
      problems.push(`${name}: assembled ${bytes} > ${CONTEXT_BUDGET.MAX_CONTEXT_BYTES} bytes`);
    }
    report.push({ set: name, mode: definition.mode, files: definition.files.length, present, bytes });
  }
  let version;
  try {
    version = await contextVersion();
  } catch (error) {
    // a missing required file must surface as a preflight PROBLEM, never as
    // an unhandled throw that hides the rest of the report
    problems.push(`contextVersion: ${error.message}`);
    version = null;
  }
  return {
    ok: problems.length === 0,
    problems,
    sets: report,
    manifestVersion: MANIFEST_VERSION,
    version,
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
