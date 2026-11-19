/**
 * Model-driven card decisions (2026-11-16, Matt's direction): a card tap
 * records ONLY the decision. The agent waits for it with the `await_decision`
 * tool inside its own turn; that call applies exactly what the card proposed
 * and returns the outcome for the agent to narrate. A decision that lands
 * after the turn ended is surfaced to the next turn in that chat, which
 * finishes it the same way. The server posts NOTHING into the chat.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("confirmations: decide records, execute applies, await waits — and nothing posts to chat", () => {
  const src = read("./confirmations.js");
  assert.doesNotMatch(src, /postIntoChat|chat_messages/, "no chat writes anywhere in the decision flow");
  assert.doesNotMatch(src, /decisionFollowUp/, "the server-side follow-up turn is gone from this path");
  assert.match(src, /export async function decideConfirmation\(\{ id, userId, decision \}\)/);
  assert.match(src, /export async function executeDecision\(\{ id, userId, callTool, buildTool = null, toolDeps = null \}\)/);
  assert.match(src, /export async function awaitDecision\(/);
  assert.match(src, /export async function listConfirmedDecisions\(userId, sessionId\)/);
  // The DB status is the table's own 'confirmed' (its CHECK constraint knows no 'approved');
  // the public view presents it as 'approved' for the app.
  assert.match(src, /status: row\.status === "confirmed" \? "approved" : row\.status/);
  assert.match(src, /update\(\{ status: "confirmed", confirmed_at: now/);
  // Execution claims approved -> consumed atomically, so two turns can't apply one card twice.
  assert.match(src, /eq\("status", "confirmed"\)\.select\("\*"\)\.maybeSingle\(\)/);
  // Every proposal note sends the agent to await_decision in the same turn.
  assert.equal((src.match(/call await_decision with this confirmationId/g) || []).length, 3, "write, permission and build notes all instruct the wait");
});

test("the tool: defined for the chat, executable, always in the turn's tool list, with a wait-sized limit", () => {
  const chat = read("../adaptive-learning/chat/handlers-merged.js");
  const toolCatalogue = read("../adaptive-learning/chat/tool-catalogue-core.js");
  assert.match(toolCatalogue, /name: "await_decision",\n    featureGate: "self_tooling"/);
  assert.match(chat, /async await_decision\(input/);
  assert.match(chat, /awaitDecision\(\{ id: String\(input\.confirmationId\), userId: studentId,/);
  const sel = read("../adaptive-learning/toolSelection.js");
  assert.match(sel, /"await_decision"/, "CORE: area selection never drops it");
  const limits = read("../adaptive-learning/toolLimits.js");
  assert.match(limits, /await_decision: 150_000/);
  const examples = read("../agent-capabilities/examples.js");
  assert.match(examples, /await_decision: e\("building"/);
});

test("a late decision is surfaced to the next turn in its chat, and that turn is forced to finish it", () => {
  const chat = read("../adaptive-learning/chat.js");
  assert.match(chat, /listConfirmedDecisions\(req\.user\.id, conversationId\)/);
  assert.match(chat, /## A decision is waiting for you to finish/);
  assert.match(chat, /approvedDecisions\.length \? "await_decision"/);
});

test("the card renders the recorded-decision state while the agent finishes it", () => {
  const card = read("../../../akoro-learner/src/components/tabs/agentChat/ConfirmChangeCard.jsx");
  assert.equal((card.match(/state\.status === 'approved'/g) || []).length >= 3, true, "all three card variants know 'approved'");
  assert.match(card, /Approved — your agent is finishing it\./);
  assert.match(card, /Approved — your agent is saving it\./);
});
