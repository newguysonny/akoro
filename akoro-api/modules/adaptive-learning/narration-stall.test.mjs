// The narration-stall guard: a step line sent without its tool call must
// be recognised (so the loop can continue the turn once), while genuine
// answers must not be — a false hit costs an extra decision call.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { looksLikeStepNarration, planHasOpenSteps } from "./narration-stall.js";

test("tonight's stall lines are recognised as step narration, not answers", () => {
  assert.equal(looksLikeStepNarration("Checking which Akoro capability can delete a chat, so the tool is drafted against the real action rather than a lookalike."), true);
  assert.equal(looksLikeStepNarration("I'll check what capability Akoro exposes for deleting chats, then redraft the tool with a title-contains match."), true);
  assert.equal(looksLikeStepNarration("Running the tool now on the phrase \"Basic\" — it will find the matching chat and show you an Allow card before anything is removed."), true);
  assert.equal(looksLikeStepNarration("Let me look up which of your chats is the earliest first."), true);
  assert.equal(looksLikeStepNarration("One moment — pulling up your tools."), true);
});

test("genuine answers are not step narration", () => {
  assert.equal(looksLikeStepNarration("Your earliest chat is Computer Studies — Software, from 7 October."), false);
  assert.equal(looksLikeStepNarration("Done — the chat is deleted and 3 remain."), false);
  assert.equal(looksLikeStepNarration(""), false);
  assert.equal(looksLikeStepNarration(null), false);
  // A finding reported before a promised retry starts with the finding,
  // not the intent — the text helper leaves it to the open-plan check.
  assert.equal(looksLikeStepNarration("Your chat list does contain Basic Science — Matter and its states, so the tool should have found it — I'm retrying with lowercase to test whether it's strict about capital letters."), false);
});

test("questions back to the learner and hand-backs are never stalls", () => {
  assert.equal(looksLikeStepNarration("Which of these two chats should I delete?"), false);
  assert.equal(looksLikeStepNarration("Let me know which chat you mean and I'll delete it."), false);
  // A long explanation that happens to open with "Let me explain" is an
  // answer, not a step line — the word cap keeps it out.
  const long = "Let me explain how this works in full: " + "the reader groups every creation under the tool that made it, newest first, and each list pages ten at a time as you scroll, so nothing loads forever and nothing is hidden behind a separate screen you have to go hunting for today.";
  assert.ok(long.split(/\s+/).length > 48);
  assert.equal(looksLikeStepNarration(long), false);
});

test("an unfinished plan in the turn's own ledger means work is owed", () => {
  assert.equal(planHasOpenSteps({ plan: [{ status: "done" }, { status: "pending" }] }), true);
  assert.equal(planHasOpenSteps({ plan: [{ status: "in_progress" }] }), true);
  assert.equal(planHasOpenSteps({ plan: [{ status: "done" }, { status: "completed" }] }), false);
  assert.equal(planHasOpenSteps({ plan: [] }), false);
  assert.equal(planHasOpenSteps(null), false);
  assert.equal(planHasOpenSteps({}), false);
});

test("the loop wires the guard: one-shot, streamed turns only, kill switch, narration kept as activity", () => {
  const src = readFileSync(new URL("./chat.js", import.meta.url), "utf8");
  assert.match(src, /import \{ looksLikeStepNarration, planHasOpenSteps \} from "\.\/narration-stall\.js";/);
  assert.match(src, /narrationContinuationUsed = false/);
  assert.match(src, /process\.env\.AKORO_NARRATION_CONTINUATION !== "false"/);
  assert.match(src, /const owesWork = planHasOpenSteps\(ledgerNow\) \|\| \(executions\.length === 0 && looksLikeStepNarration\(content\)\);/);
  assert.match(src, /The sentence must ride in the SAME reply as the tool call it describes/);
});

test("re- prefixed gerunds also read as step narration (live miss, 2026-11-17)", () => {
  // This exact sentence ended a verification turn with zero tool calls:
  // the lead list had "building" but the string starts with "Rebuilding".
  assert.equal(looksLikeStepNarration("Rebuilding first, then I'll run it with the title parameter left out entirely."), true);
  assert.equal(looksLikeStepNarration("Re-running the check now."), true);
  assert.equal(looksLikeStepNarration("Rechecking your chat list."), true);
  assert.equal(looksLikeStepNarration("I'm rebuilding it as a contains-match version."), true);
});
