import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Context-layer manifest contract tests (Context Layer Adoption mini-plan
 * §3.3/§6, P0): every registered set resolves within budget, required-file
 * semantics hold (D6 — a missing required file fails preflight and throws at
 * load time; extras stay optional), the version hash is deterministic (D8),
 * and no workspace file is dead doctrine (D13 orphan check).
 */

import {
  CONTEXT_BUDGET, CONTEXT_MANIFEST, CONTEXT_SETS, CONTEXT_SET_NAMES, PENDING_ADOPTION,
  buildAgentContext, clearContextCache, contextVersion, loadContext, loadDoctrine, preflight,
} from "./context-manager.js";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../akoro-agent");

async function workspaceFiles() {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
      else if (entry.name.endsWith(".md")) out.push(path.relative(WORKSPACE_ROOT, path.join(dir, entry.name)).replaceAll(path.sep, "/"));
    }
  }
  await walk(WORKSPACE_ROOT);
  return out.sort();
}

test("every registered set resolves within its budgets (joined and verbatim)", async () => {
  clearContextCache();
  const pf = await preflight();
  assert.ok(pf.ok, `preflight problems: ${pf.problems.join(" | ")}`);
  assert.equal(pf.sets.length, Object.keys(CONTEXT_MANIFEST).length);
  for (const report of pf.sets) {
    assert.equal(report.present, report.files, `${report.set}: every declared file present`);
    assert.ok(report.bytes <= CONTEXT_BUDGET.MAX_CONTEXT_BYTES, `${report.set}: assembled bytes within budget`);
  }
  // joined sets assemble through loadContext, verbatim sets file-by-file
  for (const name of CONTEXT_SET_NAMES) {
    const loaded = await loadContext(name);
    assert.ok(loaded.files.length >= 2, `${name} is a real selection, not a single file`);
    assert.ok(loaded.files.length < (await workspaceFiles()).length, `${name} selects a slice, never everything`);
  }
  for (const [name, definition] of Object.entries(CONTEXT_MANIFEST)) {
    if (definition.mode !== "verbatim") continue;
    for (const file of definition.files) {
      const content = await loadDoctrine(file);
      assert.ok(content.length > 40, `${name} → ${file} has real doctrine`);
    }
  }
});

test("manifest and manager agree: joined sets are exactly the S3 study-prep sets", () => {
  assert.deepEqual(
    Object.keys(CONTEXT_MANIFEST).filter((name) => CONTEXT_MANIFEST[name].mode === "joined").sort(),
    [...CONTEXT_SET_NAMES].sort(),
  );
  // byte-order matters: study-prep assembly order is pinned by its own tests
  assert.deepEqual(CONTEXT_SETS.planning, [
    "AGENT.md", "learning/LEARNING.md", "reasoning/PLANNING.md", "policies/EDUCATION_RULES.md",
  ]);
});

test("required-file semantics: a missing declared file fails preflight; extras stay optional", async () => {
  clearContextCache();
  // extras remain silence (the study-prep contract, unchanged)
  const loaded = await loadContext("planning", { extra: ["policies/NOT_THERE.md"] });
  assert.ok(!loaded.files.includes("policies/NOT_THERE.md"));
  // a required file throws at load time
  await assert.rejects(() => loadDoctrine("channels/NOT_THERE.md"), /Required context file is missing/);
  // and fails the preflight when a registered set declares it
  const broken = await preflight({
    sets: { broken_set: { mode: "joined", consumer: "test", files: ["AGENT.md", "channels/NOT_THERE.md"] } },
  });
  assert.equal(broken.ok, false);
  assert.ok(broken.problems.some((p) => p.includes("missing file channels/NOT_THERE.md")));
  // an over-budget assembled set fails preflight too (the check is a byte sum —
  // the real workspace is far under budget, so force it with repetition)
  const bloated = await preflight({
    sets: { bloated_set: { mode: "joined", consumer: "test", files: Array(50).fill("AGENT.md") } },
  });
  assert.equal(bloated.ok, false);
  assert.ok(bloated.problems.some((p) => p.includes("assembled") && p.includes(">")));
  // and loadContext enforces the same budget on the joined path
  await assert.rejects(
    () => loadContext("planning", { extra: Array(50).fill("AGENT.md") }),
    /Assembled context exceeds its budget/,
  );
});

test("path escapes are still refused", async () => {
  clearContextCache();
  await assert.rejects(() => loadContext("planning", { extra: ["../../.env"] }), /escapes the workspace|ENOENT/);
  await assert.rejects(() => loadDoctrine("../package.json"), /escapes the workspace/);
});

test("contextVersion is deterministic and content-derived (drift audit, D8)", async () => {
  clearContextCache();
  const first = await contextVersion();
  assert.match(first, /^[0-9a-f]{12}$/);
  clearContextCache();
  assert.equal(await contextVersion(), first, "same files → same version");
  // recompute manually from the files the manifest references
  const { createHash } = await import("node:crypto");
  const referenced = [...new Set(Object.values(CONTEXT_MANIFEST).flatMap((d) => [...d.files]))].sort();
  const parts = [];
  for (const relative of referenced) {
    const content = await readFile(path.join(WORKSPACE_ROOT, relative), "utf8");
    parts.push(`${relative}:${createHash("sha256").update(content).digest("hex").slice(0, 16)}`);
  }
  const expected = createHash("sha256").update(`v${(await import("./manifest.mjs")).MANIFEST_VERSION}\n${parts.join("\n")}`).digest("hex").slice(0, 12);
  assert.equal(first, expected, "the version is a pure function of file contents");
});

test("no dead doctrine: every workspace file is registered or pending (orphan check, D13)", async () => {
  const files = await workspaceFiles();
  assert.ok(files.length >= 25, `workspace has the shipped + P1 files (${files.length})`);
  const registered = new Set(Object.values(CONTEXT_MANIFEST).flatMap((definition) => [...definition.files]));
  for (const file of files) {
    assert.ok(
      registered.has(file) || PENDING_ADOPTION[file],
      `${file} is loaded by no set and is not pending adoption — dead doctrine is deleted, not kept`,
    );
  }
  // the pending list is pinned EXACTLY: adopting or adding an orphan is a
  // conscious manifest change, never an accident
  assert.deepEqual(Object.keys(PENDING_ADOPTION).sort(), ["identity/SOUL.md", "memory/MEMORY.md"]);
  for (const [file, phase] of Object.entries(PENDING_ADOPTION)) {
    assert.match(phase, /^P\d/, `${file} must name the phase that will adopt it`);
    assert.ok(files.includes(file), `${file} is pending but missing from the workspace`);
  }
  // and every registered file exists (no dangling references)
  for (const file of registered) {
    await readFile(path.join(WORKSPACE_ROOT, file), "utf8");
  }
});

test("the files are doctrine, never state", async () => {
  const files = await workspaceFiles();
  for (const file of files) {
    const content = await readFile(path.join(WORKSPACE_ROOT, file), "utf8");
    assert.ok(content.length <= CONTEXT_BUDGET.MAX_FILE_BYTES, `${file} within its size budget`);
    assert.doesNotMatch(content, /mastery\s*=\s*0\.\d/i, `no learner mastery values in ${file}`);
    assert.doesNotMatch(content, /wallet\s*=\s*\d/i, `no wallet balances in ${file}`);
    assert.doesNotMatch(content, /learner-[0-9a-f-]+/i, `no learner ids in ${file}`);
  }
});

test("buildAgentContext still merges workspace selection with dynamic truth", async () => {
  clearContextCache();
  const context = await buildAgentContext({
    setName: "planning",
    goal: "Prepare me for my whole-term Basic Science exam",
    session: { subject: "Basic Science", classLevel: "JSS1", status: "planning" },
    dynamic: { syllabus: "6 topics found" },
  });
  assert.match(context.system, /# AGENT\.md/);
  assert.match(context.system, /GOAL: Prepare me for my whole-term Basic Science exam/);
  assert.match(context.system, /SESSION: Basic Science \(JSS1\), status planning/);
});
