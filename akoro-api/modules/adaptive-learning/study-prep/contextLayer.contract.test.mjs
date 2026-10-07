import assert from "node:assert/strict";
import test from "node:test";

/**
 * Context-layer contract tests (Master Plan §4.6, S3): the workspace files
 * exist, the Context Manager selects per-operation sets (never everything),
 * budgets hold, no state lives in the files, and buildAgentContext merges
 * dynamic truth. These read the REAL akoro-agent/ workspace from disk.
 */

import { readFile } from "node:fs/promises";
import {
  CONTEXT_BUDGET, CONTEXT_SETS, CONTEXT_SET_NAMES, buildAgentContext, clearContextCache, loadContext,
} from "./context-manager.js";

const WORKSPACE_FILES = [
  "AGENT.md", "identity/SOUL.md",
  "learning/LEARNING.md", "learning/TEACHING.md", "learning/ASSESSMENT.md", "learning/MASTERY.md",
  "reasoning/REASONING.md", "reasoning/RESEARCH.md", "reasoning/INSPECTION.md", "reasoning/PLANNING.md",
  "policies/SAFETY.md", "policies/EDUCATION_RULES.md", "policies/TOOL_RULES.md",
  "strategies/STRATEGIES.md", "memory/MEMORY.md",
];

test("the configurable agent brain exists: all 15 workspace files are present and bounded", async () => {
  for (const file of WORKSPACE_FILES) {
    const content = await readFile(new URL(`../../../akoro-agent/${file}`, import.meta.url), "utf8");
    assert.ok(content.trim().length > 40, `${file} has real content`);
    assert.ok(content.length <= CONTEXT_BUDGET.MAX_FILE_BYTES, `${file} within its size budget`);
  }
});

test("context selection is per-operation: planning never loads the research files", async () => {
  clearContextCache();
  const planning = await loadContext("planning");
  assert.ok(planning.files.includes("AGENT.md"));
  assert.ok(planning.files.includes("reasoning/PLANNING.md"));
  assert.ok(!planning.files.includes("reasoning/RESEARCH.md"));
  assert.ok(!planning.files.includes("memory/MEMORY.md"));

  const research = await loadContext("research");
  assert.ok(research.files.includes("reasoning/RESEARCH.md"));
  assert.ok(!research.files.includes("reasoning/PLANNING.md"));

  // never everything: every set is a strict subset of the workspace
  for (const name of CONTEXT_SET_NAMES) {
    const loaded = await loadContext(name);
    assert.ok(loaded.files.length < WORKSPACE_FILES.length, `${name} selects ${loaded.files.length}, not all ${WORKSPACE_FILES.length}`);
    assert.ok(loaded.system.length <= CONTEXT_BUDGET.MAX_CONTEXT_BYTES, `${name} within the assembled budget`);
  }
});

test("the files are doctrine, never state: no mastery numbers, wallets or learner data", async () => {
  clearContextCache();
  const everything = await Promise.all(WORKSPACE_FILES.map((file) => readFile(new URL(`../../../akoro-agent/${file}`, import.meta.url), "utf8")));
  for (const content of everything) {
    assert.doesNotMatch(content, /mastery\s*=\s*0\.\d/i, "no learner mastery values in the workspace");
    assert.doesNotMatch(content, /wallet\s*=\s*\d/i, "no wallet balances in the workspace");
    assert.doesNotMatch(content, /learner-[0-9a-f-]+/i, "no learner ids in the workspace");
  }
});

test("buildAgentContext merges workspace selection with dynamic truth from the database seam", async () => {
  clearContextCache();
  const context = await buildAgentContext({
    setName: "planning",
    goal: "Prepare me for my whole-term Basic Science exam",
    session: { subject: "Basic Science", classLevel: "JSS1", status: "planning" },
    dynamic: { syllabus: "6 topics found", weak: "water-cycle: 0.42" },
  });
  assert.match(context.system, /# AGENT\.md/);
  assert.match(context.system, /GOAL: Prepare me for my whole-term Basic Science exam/);
  assert.match(context.system, /SESSION: Basic Science \(JSS1\), status planning/);
  assert.match(context.system, /SYLLABUS: 6 topics found/);
  assert.match(context.dynamic, /WEAK: water-cycle: 0\.42/);
});

test("a missing optional file is silence, and path escapes are refused", async () => {
  clearContextCache();
  const loaded = await loadContext("planning", { extra: ["policies/NOT_THERE.md"] });
  assert.ok(!loaded.files.includes("policies/NOT_THERE.md"));
  // loadContext with a traversal attempt throws rather than reading outside
  await assert.rejects(() => loadContext("planning", { extra: ["../../.env"] }), /escapes the workspace|ENOENT/);
});
