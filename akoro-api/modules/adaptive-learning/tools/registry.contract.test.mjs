import assert from "node:assert/strict";
import test from "node:test";

/**
 * Tool registry contract (Master Plan §4.13): permission levels, the
 * harness-only operations are absent from the model-facing catalogue, and
 * the dispatcher delegates every tool to the harness/read layer.
 */

import {
  HARNESS_ONLY_OPERATIONS, TOOL_DEFINITIONS, buildRegistry, llmFacingTools, toolByName,
} from "./registry.js";
import { STRATEGY_LIBRARY } from "../study-prep/education-engine.js";

test("every tool declares a known permission level", () => {
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(["read", "propose", "execute"].includes(tool.level), `${tool.name} has level ${tool.level}`);
    assert.ok(tool.description?.length > 20, `${tool.name} documents itself for the model`);
  }
});

test("the harness-only operations are never model-callable", () => {
  const catalogue = llmFacingTools({ includeContentSearch: true }).map((tool) => tool.name);
  for (const operation of HARNESS_ONLY_OPERATIONS) {
    assert.ok(!catalogue.includes(operation), `${operation} must not appear in the LLM catalogue`);
    assert.equal(toolByName(operation), null, `${operation} is not even a definition`);
  }
  // and the dispatcher refuses them outright
  const registry = buildRegistry({ readTools: {}, harness: {}, learnerId: "L", sessionId: "S" });
  assert.rejects(() => registry.execute("wallet.charge", {}), /Unknown tool|not enabled/);
  assert.rejects(() => registry.execute("practice.score", {}), /Unknown tool/);
});

test("content.search is gated off until enabled (Decision 14)", () => {
  assert.ok(!llmFacingTools().some((tool) => tool.name === "content.search"));
  assert.ok(llmFacingTools({ includeContentSearch: true }).some((tool) => tool.name === "content.search"));
  const registry = buildRegistry({ readTools: {}, harness: {}, learnerId: "L", sessionId: "S" });
  assert.rejects(() => registry.execute("content.search", {}), /not enabled/);
});

test("the registry covers the full union catalogue from the two v2.1 docs", () => {
  const names = TOOL_DEFINITIONS.map((tool) => tool.name);
  for (const expected of [
    "syllabus.resolve", "learner.get_state", "learner.get_history", "learner.get_relevant_memory",
    "concept.get_prerequisites", "content.search", "session.get_state", "plan.validate",
    "propose_plan", "offer_strategy", "advance_topic", "defer_topic", "topic.flag", "session.replan",
    "conclude_session", "practice.generate", "practice.submit",
  ]) {
    assert.ok(names.includes(expected), `${expected} is in the registry`);
  }
});

test("the dispatcher routes tools to the right seam with the stated intent", async () => {
  const calls = [];
  const readTools = {
    resolveSyllabus: async (args) => { calls.push(["resolveSyllabus", args]); return { topics: [] }; },
    getSessionState: async (args) => { calls.push(["getSessionState", args]); return {}; },
  };
  const harness = {
    proposePlan: async (args) => { calls.push(["proposePlan", args]); return { session: {}, plan: [] }; },
    offerStrategy: async (args) => { calls.push(["offerStrategy", args]); return { strategy: args.strategy }; },
  };
  const registry = buildRegistry({ readTools, harness, learnerId: "learner-9", sessionId: "session-9" });
  assert.ok(Array.isArray(registry.catalogue) && registry.catalogue.length > 0, "the catalogue is exposed for the agent");

  await registry.execute("syllabus.resolve", { subject: "Basic Science" });
  await registry.execute("propose_plan", { topics: ["water-cycle"] }, "Weak topics first.");
  await registry.execute("offer_strategy", { strategy: STRATEGY_LIBRARY[0] }, "Near miss.");

  assert.deepEqual(calls[0], ["resolveSyllabus", { subject: "Basic Science", classLevel: undefined, exam: undefined }]);
  assert.equal(calls[1][1].learnerId, "learner-9");
  assert.equal(calls[1][1].sessionId, "session-9");
  assert.equal(calls[1][1].intent, "Weak topics first.");
  assert.equal(calls[2][1].strategy, "teach_back");
});
