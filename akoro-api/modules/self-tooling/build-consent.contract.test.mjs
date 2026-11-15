/**
 * The build-consent gate: a brand-new tool the agent builds is drafted OFF
 * and only the learner's tap on its Keep card saves it. The build + verify +
 * first run happen silently BEFORE the card (the dry run that makes the ask
 * honest); resumed builds (already approved on a card or by an admin) and
 * extensions of an already-active domain tool are not re-gated.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatToolChange } from "../adaptive-learning/chat-trace.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("a brand-new built tool is drafted OFF behind a card, never saved active", () => {
  const src = read("./pipeline.js");
  assert.match(src, /if \(audience === "learner" && !resumed && !replaced\) return draftBuildAndAsk\(\{ def, runNow \}\);/);
  assert.match(src, /status: "disabled", verification: \{ \.\.\.def\.verification, awaitingBuild: true \}/);
  assert.match(src, /status: "needs_consent", drafted: true, tool: name, label, mode: def\.mode, confirmation: card\.confirmation/);
  // The drafted answer still comes back, so the learner sees what the tool does before deciding.
  assert.match(src, /result: runNow\.ok \? \(runNow\.write \? await writeOutcome\(\{ learnerId, dry: true/);
});

test("a brand-new domain tool is drafted too; extending an active one is not re-gated", () => {
  const src = read("./pipeline.js");
  assert.match(src, /const existingDraft = existing\?\.status === "disabled" && !!existing\?\.verification\?\.awaitingBuild;/);
  assert.match(src, /if \(audience === "learner" && !resumed && \(!existing \|\| existingDraft\)\)/);
  assert.match(src, /samples: \[\], awaitingBuild: true \}/);
});

test("the card: proposeBuild stores kind 'build'; Keep activates via the pipeline; Not now discards the draft", () => {
  const src = read("./confirmations.js");
  assert.match(src, /export async function proposeBuild\(/);
  assert.match(src, /const args = \{ kind: "build", toolId, proposed \};/);
  assert.match(src, /if \(row\.tool_arguments\?\.kind === "build"\) return confirmBuild\(row, \{ userId, postIntoChat, toolDeps \}\);/);
  assert.match(src, /const activate = toolDeps\?\.activateTool \|\| pipe\.activateBuiltTool;/);
  assert.match(src, /kind === "permission" \|\| row\.tool_arguments\?\.kind === "build"\) \? row\.tool_arguments\.toolId/);
  const pipe = read("./pipeline.js");
  assert.match(pipe, /export async function activateBuiltTool\(learnerId, toolId\)/);
  assert.match(pipe, /if \(!t\?\.verification\?\.awaitingBuild\) return null;/);
});

test("the trace says 'Drafted', not 'Built', while a tool waits for Keep", () => {
  assert.equal(chatToolChange("create_tool", { status: "needs_consent", drafted: true, label: "Study time by subject" }).label, "Drafted a tool — waiting for your OK");
  assert.equal(chatToolChange("create_tool", { status: "created", tool: "t", label: "T" }).label, "Built a tool");
});

test("the agent is told the new outcome, and the app renders a Keep card for it", () => {
  assert.match(read("../adaptive-learning/chat.js"), /needs_consent \(a brand-new tool: built and checked, but drafted OFF/);
  const card = read("../../../akoro-learner/src/components/tabs/agentChat/ConfirmChangeCard.jsx");
  assert.match(card, /state\.kind === 'build'\) return <BuildCard/);
  assert.match(card, /data-build-card=""/);
  assert.match(card, /\(state\.kind === 'permission' \|\| state\.kind === 'build'\) \? 'approved' : 'confirmed'/);
});

test("a rebuild (replace) is a swap, not a new tool: saved active, old retired only at the save point", () => {
  const src = read("./pipeline.js");
  // Capture without archiving: the block that resolves `replace` must not retire the old row.
  const cap = src.slice(src.indexOf("const replaceRaw"), src.indexOf("const archiveReplaced"));
  assert.ok(!cap.includes('status: "archived"'), "the replace capture must not archive the old tool");
  // A rebuild is an explicit save: neither the answer-only rule nor the consent gate may swallow it.
  assert.match(src, /!resumed && !replaced && isAnswerOnlyRead\(def, runNow\)/);
  // The old row is retired at the save points, once the replacement exists.
  assert.match(src, /const archiveReplaced = async \(newRowId\)/);
  assert.ok((src.match(/await archiveReplaced\(row\.id\)/g) || []).length >= 2, "both save paths retire the replaced tool");
  // The rebuild is not deduped back to the tool it replaces, nor blocked by its name.
  assert.match(src, /t\.id !== replaced\?\.id/);
});
