import assert from "node:assert/strict";
import test from "node:test";

/**
 * study_prep_events contract (Master Plan §4.13): append-only shaping,
 * origin tagging, the intent cap, and the rule that NO LLM-origin string
 * other than agent_intent can appear in an event. Also the union schema
 * invariants (S4 sequence/thought_type/duration_ms + S5 origin/intent).
 */

import { makeEvent, maskProfanity, publicEvent, shapeFacts, stampThoughtType } from "./events.js";
import { POLICY } from "./state-machine.js";

test("makeEvent accepts only the six union event types and three origins", () => {
  for (const eventType of ["agent_tool_call", "agent_action", "harness_decision", "observation", "human_gate", "engine_result"]) {
    assert.doesNotThrow(() => makeEvent({ sequence: 1, eventType, origin: "harness" }));
  }
  assert.throws(() => makeEvent({ sequence: 1, eventType: "tool_call", origin: "harness" }), /invalid event_type/);
  assert.throws(() => makeEvent({ sequence: 1, eventType: "observation", origin: "llm" }), /invalid origin/);
  assert.throws(() => makeEvent({ sequence: -1, eventType: "observation", origin: "harness" }), /sequence/);
});

test("agent intent is capped, collapsed and profanity-masked; the ONLY LLM-origin string in events", () => {
  const event = makeEvent({
    sequence: 1, eventType: "agent_action", origin: "agent_stated_intent", action: "propose_plan",
    agentIntent: `I will check the damn syllabus\nfirst and then ${"x".repeat(400)}`,
  });
  assert.ok(event.agent_intent.length <= POLICY.INTENT_MAX_CHARS);
  assert.ok(!event.agent_intent.includes("\n"));
  assert.ok(event.agent_intent.includes("d***"));
  // intent never appears on non-agent events
  const harnessEvent = makeEvent({ sequence: 2, eventType: "harness_decision", origin: "harness", agentIntent: "should be dropped" });
  assert.equal(harnessEvent.agent_intent, null);
});

test("facts are bounded and can never carry answer keys, raw chat or nesting bombs", () => {
  const shaped = shapeFacts({
    answer_key: { q1: 1 }, answers: [0, 1, 2], transcript: "raw chat", topic: "Water Cycle",
    nested: { deep: { deeper: { deepest: "gone" } } },
    list: Array.from({ length: 50 }, (_, index) => index),
    long: "y".repeat(5000),
  });
  const serialised = JSON.stringify(shaped);
  assert.ok(!/answer_key|answers|transcript/i.test(Object.keys(shaped).join(",")));
  assert.equal(shaped.nested.deep, null, "nesting is cut at the depth budget");
  assert.ok(shaped.list.length <= 12);
  assert.ok(shaped.long.length <= 240);
  assert.equal(shaped.topic, "Water Cycle");
});

test("thought types are stamped by the harness from tool/action, never by the model", () => {
  assert.equal(stampThoughtType({ eventType: "agent_tool_call", tool: "syllabus.resolve" }), "research");
  assert.equal(stampThoughtType({ eventType: "agent_tool_call", tool: "learner.get_state" }), "research");
  assert.equal(stampThoughtType({ eventType: "agent_action", action: "propose_plan" }), "draft");
  assert.equal(stampThoughtType({ eventType: "harness_decision" }), "verification");
  assert.equal(stampThoughtType({ eventType: "engine_result" }), "reflection");
  assert.equal(stampThoughtType({ eventType: "human_gate" }), "synthesis");
  assert.equal(stampThoughtType({ eventType: "agent_action", action: "advance_topic" }), "action");
  // an unknown tool is an action, never null
  assert.equal(stampThoughtType({ eventType: "agent_tool_call", tool: "mystery.tool" }), "action");
});

test("duration_ms and sequence ride along from the S4 schema union", () => {
  const event = makeEvent({ sequence: 7, eventType: "observation", origin: "harness", durationMs: 80, thoughtType: "research" });
  assert.equal(event.sequence, 7);
  assert.equal(event.duration_ms, 80);
  assert.equal(event.thought_type, "research");
  assert.equal(makeEvent({ sequence: 1, eventType: "observation", origin: "harness", durationMs: -5 }).duration_ms, null);
});

test("publicEvent hides internals and only surfaces origin-tagged intent", () => {
  const row = makeEvent({
    sequence: 3, iteration: 2, eventType: "agent_action", origin: "agent_stated_intent", action: "defer_topic",
    agentIntent: "Capped out — deferring.", decisionNode: "topic_deferred", narrative: "Human Body Systems deferred.",
    facts: { reason: "attempt_cap_reached" }, thoughtType: "action", durationMs: 42, policyVersion: "study-prep-v1",
  });
  const shaped = publicEvent({ ...row, created_at: "2026-01-01T00:00:00Z" });
  assert.equal(shaped.sequence, 3);
  assert.equal(shaped.iteration, 2);
  assert.equal(shaped.agentIntent, "Capped out — deferring.");
  assert.equal(shaped.origin, "agent_stated_intent");
  assert.equal(shaped.thoughtType, "action");
  assert.equal(shaped.durationMs, 42);
  // a harness-origin row never surfaces an agent intent
  const harnessRow = publicEvent({ ...makeEvent({ sequence: 4, eventType: "harness_decision", origin: "harness" }), created_at: null });
  assert.equal(harnessRow.agentIntent, null);
});

test("maskProfanity masks without crashing on regex-y input", () => {
  assert.equal(maskProfanity("damn"), "d***");
  assert.equal(maskProfanity("clean text"), "clean text");
  assert.equal(maskProfanity("SHIT"), "S***");
});
