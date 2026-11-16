/**
 * The learner-allowed change flow (2026-11-01): the approve card comes in the
 * same reply as the draft, the approve card never nests a second change card,
 * and after Approve / Confirm the chat carries on so the agent follows through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chatToolChange } from "../adaptive-learning/chat-trace.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("no 'shall I build it?' round: a change the learner can allow is drafted with its card at once", () => {
  const src = read("./pipeline.js");
  assert.doesNotMatch(src, /status: "offer", capability/);
  assert.match(src, /if \(hinted\.length && learnerGrantable\(hinted\[0\]\) && audience === "learner"\) \{ draftCap = hinted\[0\]/);
  assert.match(read("../adaptive-learning/chat.js"), /in this same turn — don't ask 'shall I build it\?' first/);
});

test("after Approve/Confirm the tap records ONLY the decision — the agent's await_decision applies it (2026-11-16: model-driven, no server post)", () => {
  const src = read("./confirmations.js");
  assert.doesNotMatch(src, /postIntoChat/, "the server never posts the outcome into the chat");
  assert.doesNotMatch(src, /kickDecisionFollowUp/, "no server-side follow-up turn is kicked");
  assert.match(src, /export async function decideConfirmation\(/, "the tap records the decision");
  assert.match(src, /status: "confirmed", confirmed_at: now/, "approve moves pending -> confirmed, unexecuted");
  assert.match(src, /export async function awaitDecision\(/, "the agent waits for the decision itself");
  const routes = read("./routes.js");
  assert.match(routes, /decideConfirmation\(\{ id: req\.params\.id, userId: req\.user\.id, decision: "approved" \}\)/);
  assert.doesNotMatch(routes, /executeChatTool|postIntoChat/, "the confirm route executes nothing and posts nothing");
});

test("the trace says 'Drafted', not 'Built', for a tool waiting for Approve", () => {
  assert.equal(chatToolChange("create_tool", { status: "needs_permission", drafted: true, label: "Set Chemistry tasks to high priority" }).label, "Drafted a tool — waiting for your OK");
  assert.equal(chatToolChange("create_tool", { status: "rejected", reason: "x" }), null);
  assert.equal(chatToolChange("create_tool", { status: "created", tool: "t", label: "T" }).label, "Built a tool");
});

test("the app: one card, compact once decided, and the chat carries on after a tap", () => {
  const card = read("../../../akoro-learner/src/components/tabs/agentChat/ConfirmChangeCard.jsx");
  assert.doesNotMatch(card, /state\.next\?\.confirmationId && <ConfirmChangeCard/);
  // Model-driven continuation: the card just calls the confirm endpoint, which
  // records the decision; the agent's live turn (await_decision) applies it
  // and narrates the outcome (no client continueInChat).
  assert.match(card, /\/api\/self-tooling\/confirmations\/\$\{state\.confirmationId\}\/\$\{what\}/);
  assert.match(card, /onDone\(.*'approved' : 'confirmed'/);
  // Continuation is model-driven now (the decision test above); the card no
  // longer sends continueInChat or injects a client "Approved…" turn.
  assert.doesNotMatch(card, /continueInChat/);
});

test("an admin's approval: the tool is turned on, no background run or stray card, and Run it now starts the agent's turn", () => {
  const src = read("./escalation.js");
  assert.match(src, /if \(stray\) await edu\(\)\.from\("agent_tool_write_confirmations"\)\.delete\(\)/);
  assert.match(src, /meta = \{ runTool: \{ name: out\.tool \|\| p\.name, label: out\.label \|\| label, changes \} \};/);
  assert.doesNotMatch(src, /Here's what it found:/, "no raw row dump posted for the learner");
  assert.match(read("../adaptive-learning/chat.js"), /asks you to run one of your tools by name \(after the Akoro team approved it\), run that tool now/);
  const tab = read("../../../akoro-learner/src/components/tabs/AgentChatTab.jsx");
  assert.match(tab, /m\.meta\?\.runTool\?\.label \? \{ runTool: m\.meta\.runTool \}/);
  assert.match(tab, /sendMessage\(`Run "\$\{msg\.runTool\.label\}" now\.`\)/);
});

test("a write capability always asks — locked to build, Confirm to apply", async () => {
  const { CAPABILITIES } = await import("./capabilities.js");
  const writes = Object.entries(CAPABILITIES).filter(([, c]) => c.kind === "write");
  assert.ok(writes.length > 0, "there are write capabilities");
  for (const [name, c] of writes) assert.equal(c.status, "locked", `${name} must be locked so building always asks`);
  const src = read("./pipeline.js");
  assert.match(src, /if \(r\.write\) return writeOutcome\(/, "every run of a write tool goes through writeOutcome");
  assert.match(src, /await proposeWrite\(\{ learnerId, conversationId, tool, write \}\)/, "a write proposes a Confirm card (never applies directly)");
  assert.match(src, /await proposePermission\(\{ learnerId, conversationId, capability: draftCap/, "building a write tool asks Allow");
});

test("create_tool reuses an existing tool for the same goal (no flooding)", () => {
  const src = read("./pipeline.js");
  assert.match(src, /textsOf\(t\)\.some\(\(x\) => similarGoal\(x, goal\)\)/, "checks goal, label and name for a near-duplicate");
  assert.match(src, /status: "reused"/, "returns the existing tool instead of building another");
});

test("document goals read my_library only, and replace a wrong-view duplicate", () => {
  const src = read("./pipeline.js");
  assert.match(src, /isDocumentGoal\(goal\)/, "detects document goals");
  assert.match(src, /docGoal\s*=\s*audience === "learner" && isDocumentGoal\(goal\)/);
  assert.match(src, /registrySlice\(\{ views: \[\], capabilities: \[\] \}, \{ views: \["my_library"\] \}/, "offers ONLY my_library (ignoring model hints)");
  assert.match(src, /dupes\.find\(\(d\) => \(d\.t\.views \|\| \[\]\)\.includes\("my_library"\)\)/, "reuses a correct-view duplicate");
  assert.match(src, /for \(const \{ t \} of dupes\)[\s\S]{0,160}eq\("id", t\.id\)/, "archives wrong-view duplicates");
});

test("create_tool can rebuild a saved tool in place (replace)", () => {
  const src = read("./pipeline.js");
  assert.match(src, /const replaceRaw = String\(input\?\.replace/, "reads the replace target");
  assert.match(src, /status: "archived"[\s\S]{0,140}eq\("id", replaced\.id\)/, "retires the replaced tool at the save point (archiveReplaced)");
});

test("createTool builds deterministic domain tools and verifies every action", () => {
  const src = read("./pipeline.js");
  assert.match(src, /domainForGoal\(goal\)/, "routes to curated domains");
  assert.match(src, /verifyDomainActions\(spec2, /, "verifies every action before saving");
  assert.match(src, /status: "archived"[\s\S]{0,120}eq\("id", existing\.id\)/, "retires an older tool for the domain");
});
