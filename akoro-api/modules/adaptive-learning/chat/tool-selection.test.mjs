// The named-tool force: "run my Delete a chat by title tool" must force
// that tool's call. Live, 2026-11-18: the tool was loaded (its area was
// active — verified by enumeration) yet the model repeatedly declined
// to call it and claimed it did not exist, in fresh sessions only.
// Naming a tool with a run verb is the strongest signal a turn carries.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { namedLearnerTool } from "./toolSelection.js";

const TOOLS = [
  { name: "delete_chat_by_title", label: "Delete a chat by title" },
  { name: "weekly_xp_summary", label: "Weekly XP summary" },
  { name: "count", label: "Count" },
];

test("a named tool with a run verb is forced", () => {
  assert.equal(namedLearnerTool("Please run my Delete a chat by title tool now with the phrase as an empty string, and report exactly what it returns.", TOOLS), "delete_chat_by_title");
  assert.equal(namedLearnerTool("Two facts change the picture. This tool's writes are card-gated, so the run is safe to make. Please run my Delete a chat by title tool now with the phrase as an empty string.", TOOLS), "delete_chat_by_title");
  assert.equal(namedLearnerTool("Can you use my weekly XP summary tool for this week?", TOOLS), "weekly_xp_summary");
  // The function name spelled out names the tool too.
  assert.equal(namedLearnerTool("Run delete_chat_by_title with the phrase Stage.", TOOLS), "delete_chat_by_title");
});

test("naming a tool without asking to run it forces nothing", () => {
  assert.equal(namedLearnerTool("My Delete a chat by title tool — is it active?", TOOLS), null);
  assert.equal(namedLearnerTool("The Delete a chat by title tool is broken.", TOOLS), null);
  assert.equal(namedLearnerTool("What does my Delete a chat by title tool do?", TOOLS), null);
  // A NEGATED run verb is the opposite instruction (live miss,
  // 2026-11-18: this exact status question was forced into a call).
  assert.equal(namedLearnerTool("My Delete a chat by title tool — is it active? Just tell me its status, do not run it.", TOOLS), null);
  assert.equal(namedLearnerTool("Please do not use my Weekly XP summary tool today.", TOOLS), null);
  assert.equal(namedLearnerTool("Never run my Delete a chat by title tool without asking me.", TOOLS), null);
  // A run verb with no named tool forces nothing either.
  assert.equal(namedLearnerTool("Run a quick check on my progress.", TOOLS), null);
  // Short names never force — too collision-prone.
  assert.equal(namedLearnerTool("Run count for me.", TOOLS), null);
  assert.equal(namedLearnerTool("", TOOLS), null);
  assert.equal(namedLearnerTool("Run my Delete a chat by title tool.", []), null);
  assert.equal(namedLearnerTool("Run my Delete a chat by title tool.", null), null);
});

test("the loop wires the force: labels flow from the catalogue into forcedTool", () => {
  const chat = readFileSync(new URL("./turn-answer.js", import.meta.url), "utf8");
  assert.match(chat, /namedLearnerTool/);
  assert.match(chat, /if \(!forcedTool && learnerLabels\?\.size\)/);
  const pipeline = readFileSync(new URL("../../self-tooling/pipeline-io.js", import.meta.url), "utf8");
  assert.match(pipeline, /const labels = new Map\(rows\.map\(\(t\) => \[t\.name, t\.label \|\| t\.name\]\)\);/);
});
