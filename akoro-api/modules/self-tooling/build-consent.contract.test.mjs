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
import { chatToolChange } from "../adaptive-learning/index.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const PIPELINE_PARTS = ["./pipeline.js", "./pipeline-create.js", "./pipeline-dry.js", "./pipeline-io.js", "./pipeline-verify.js", "./rules.js"];
const readPipeline = () => PIPELINE_PARTS.map(read).join("\n");
const toolCatalogue = read("../adaptive-learning/chat/tool-catalogue-core.js");

test("a brand-new built tool is drafted OFF behind a card, never saved active", () => {
  const src = readPipeline();
  assert.match(src, /if \(audience === "learner" && !resumed && !replaced\) return draftBuildAndAsk\(\{ def, runNow \}\);/);
  assert.match(src, /status: "disabled", verification: \{ \.\.\.def\.verification, awaitingBuild: true \}/);
  assert.match(src, /status: "needs_consent", drafted: true, tool: name, label, mode: def\.mode, confirmation: card\.confirmation/);
  // The drafted answer still comes back, so the learner sees what the tool does before deciding.
  assert.match(src, /result: runNow\.ok \? \(runNow\.write \? await writeOutcome\(\{ learnerId, dry: true/);
});

test("a brand-new domain tool is drafted too; extending an active one is not re-gated", () => {
  const src = readPipeline();
  assert.match(src, /const existingDraft = existing\?\.status === "disabled" && !!existing\?\.verification\?\.awaitingBuild;/);
  assert.match(src, /if \(audience === "learner" && !resumed && \(!existing \|\| existingDraft\)\)/);
  assert.match(src, /samples: \[\], awaitingBuild: true \}/);
});

test("the card: proposeBuild stores kind 'build'; an approved Keep activates via the pipeline (executeBuild, called by await_decision); Not now discards the draft", () => {
  const src = read("./confirmations.js");
  assert.match(src, /export async function proposeBuild\(/);
  assert.match(src, /const args = \{ kind: "build", toolId, proposed,\n    \.\.\.\(Array\.isArray\(refs\) && refs\.length \? \{ approvedRefs:/);
  assert.match(src, /kind === "build" \? await executeBuild\(row, \{ userId, toolDeps, callTool \}\)/);
  assert.match(src, /const activate = toolDeps\?\.activateTool \|\| pipe\.activateBuiltTool;/);
  assert.match(src, /kind === "permission" \|\| row\.tool_arguments\?\.kind === "build"\) \? row\.tool_arguments\.toolId/);
  const pipe = readPipeline();
  assert.match(pipe, /export async function activateBuiltTool\(learnerId, toolId\)/);
  assert.match(pipe, /if \(!t\?\.verification\?\.awaitingBuild\) return null;/);
});

test("the trace says 'Drafted', not 'Built', while a tool waits for Keep", () => {
  assert.equal(chatToolChange("create_tool", { status: "needs_consent", drafted: true, label: "Study time by subject" }).label, "Drafted a tool — waiting for your OK");
  assert.equal(chatToolChange("create_tool", { status: "created", tool: "t", label: "T" }).label, "Built a tool");
});

test("the agent is told the new outcome, and the app renders a Keep card for it", () => {
  assert.match(toolCatalogue, /needs_consent \(a brand-new tool: built and checked, but drafted OFF/);
  const card = read("../../../akoro-learner/src/components/tabs/agentChat/ConfirmChangeCard.jsx");
  assert.match(card, /state\.kind === 'build'\) return <BuildCard/);
  assert.match(card, /data-build-card=""/);
  assert.match(card, /\(state\.kind === 'permission' \|\| state\.kind === 'build'\) \? 'approved' : 'confirmed'/);
});

test("a rebuild (replace) is a swap, not a new tool: saved active, old retired only at the save point", () => {
  const src = readPipeline();
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

test("a brand-new domain tool is not even drafted until the learner wants their own copy", () => {
  const pipe = readPipeline();
  // The gate sits in buildDomain, ahead of the draft insert, and only the
  // learner's confirmed ownCopy hint (or an existing/resumed/replaced build) passes it.
  assert.match(pipe, /if \(audience === "learner" && !resumed && !replaced && \(!existing \|\| existingDraft\) && hint\?\.ownCopy !== true && !\(await ownCopyOfferOpen\(learnerId, spec\.view\)\)\) \{\s+await finish\("offer_own_copy", \{\}\);\s+await logEvent\(\{ user_id: learnerId, goal, outcome: "own_copy_offered", detail: \{ view: spec\.view, name: spec\.name \} \}\);/);
  assert.match(pipe, /status: "offer_own_copy", tool: spec\.name, label: spec\.label, actions,/);
  // The agent is told the outcome and the re-call contract.
  assert.match(toolCatalogue, /offer_own_copy \(a built-in already covers this data/);
  assert.match(toolCatalogue, /ownCopy: true/);
  // The trace names the ask honestly — nothing was built.
  assert.equal(chatToolChange("create_tool", { status: "offer_own_copy", label: "Library documents" }).label, "A built-in covers this — asked about their own copy");
});

test("the own-copy gate is stateful: an open offer lets the follow-up build proceed", () => {
  const pipe = readPipeline();
  // The offer is remembered per learner + view for a short window, in the
  // events table (the same store the one-off computations use).
  assert.match(pipe, /const OWN_COPY_OFFER_WINDOW_MS = 30 \* 60 \* 1000;/);
  assert.match(pipe, /async function ownCopyOfferOpen\(learnerId, view\)/);
  assert.match(pipe, /\.in\("outcome", \["own_copy_offered", "own_copy_accepted"\]\)/);
  // Honouring closes the offer (one offer, one build) and never throws: a
  // lookup failure falls back to asking, the pre-fix behaviour.
  assert.match(pipe, /outcome: "own_copy_accepted", detail: \{ view \}/);
  assert.match(pipe, /if \(!latest \|\| latest\.outcome !== "own_copy_offered"\) return false;/);
});
