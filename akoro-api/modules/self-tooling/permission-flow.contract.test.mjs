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

test("Approve with continueInChat turns the tool on and leaves the run (and its one card) to the agent's turn", () => {
  const src = read("./confirmations.js");
  assert.match(src, /if \(continueInChat\) out = \{ status: "created", tool: t\.name, label: t\.label, result: \{\} \};/);
  assert.match(src, /if \(continueInChat && next\?\.confirmationId\) \{/);
  assert.match(src, /if \(postIntoChat && conversationId && !continueInChat\) \{/);
  assert.match(read("./routes.js"), /continueInChat: req\.body\?\.continueInChat === true/);
});

test("the trace says 'Drafted', not 'Built', for a tool waiting for Approve", () => {
  assert.equal(chatToolChange("create_tool", { status: "needs_permission", drafted: true, label: "Set Chemistry tasks to high priority" }).label, "Drafted a tool — waiting for your OK");
  assert.equal(chatToolChange("create_tool", { status: "rejected", reason: "x" }), null);
  assert.equal(chatToolChange("create_tool", { status: "created", tool: "t", label: "T" }).label, "Built a tool");
});

test("the app: one card, compact once decided, and the chat carries on after a tap", () => {
  const card = read("../../../akoro-learner/src/components/tabs/agentChat/ConfirmChangeCard.jsx");
  assert.doesNotMatch(card, /state\.next\?\.confirmationId && <ConfirmChangeCard/);
  assert.match(card, /\{ continueInChat: true \}/);
  assert.match(card, /onDone\(state\.kind === 'permission' \? 'approved' : 'confirmed'/);
  const tab = read("../../../akoro-learner/src/components/tabs/AgentChatTab.jsx");
  assert.match(tab, /Approved "\$\{name\}" — go ahead\./);
  assert.match(tab, /check it went through and tell me if anything is left/);
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
