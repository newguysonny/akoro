// Grand Plan §7.12 (D31, D23): the Agent Check's tool names and its locked
// models. practice.run_agent_check / agent.get_knowledge_coverage run the
// same harness operations as practice.generate / topic.get_notes; the recall,
// question and assessor roles ignore the learner's model pick.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

process.env.OPENAI_API_KEY ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { buildRegistry, toolByName, TOOL_ARGS, TOOL_ALIASES } = await import("../tools/registry.js");
const { createModelRegistry, ROLES } = await import("../../../lib/modelRegistry.js");

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("practice.run_agent_check and agent.get_knowledge_coverage are the plan's names over today's operations", async () => {
  assert.equal(toolByName("practice.run_agent_check").level, "execute");
  assert.equal(toolByName("agent.get_knowledge_coverage").level, "read");
  assert.deepEqual(TOOL_ARGS["practice.run_agent_check"].properties.mode.enum, ["diagnostic", "retest"]);
  assert.equal(TOOL_ALIASES["practice.generate"], "practice.run_agent_check");
  assert.equal(TOOL_ALIASES["topic.get_notes"], "agent.get_knowledge_coverage");
  const calls = [];
  const harness = {
    startTopicPractice: async (a) => { calls.push(["startTopicPractice", a]); return { check: true }; },
    topicNotes: async (a) => { calls.push(["topicNotes", a]); return { notes: 2, strength: "thin" }; },
  };
  const registry = buildRegistry({ readTools: {}, harness, learnerId: "L", sessionId: "S" });
  await registry.execute("practice.run_agent_check", { topicId: "t1", mode: "diagnostic" }, "Check it.");
  await registry.execute("practice.generate", { topicId: "t1", mode: "retest" }, "Old name.");
  assert.deepEqual(await registry.execute("agent.get_knowledge_coverage", {}), { notes: 2, strength: "thin" });
  await registry.execute("topic.get_notes", { topicId: "t2" });
  assert.deepEqual(calls.map(([n]) => n), ["startTopicPractice", "startTopicPractice", "topicNotes", "topicNotes"]);
  // Same gate either way: inside the approved coins only, as the learner's own session.
  for (const [name, a] of calls.filter(([n]) => n === "startTopicPractice")) { assert.equal(a.withinEstimateOnly, true, name); assert.equal(a.learnerId, "L"); }
  assert.equal(calls[3][1].topicId, "t2");
  assert.ok(!registry.catalogue.some((t) => t.name === "practice.generate" || t.name === "topic.get_notes"), "offered once");
  assert.equal(registry.validate("practice.run_agent_check", { topicId: "t1", mode: "final" }).code, "tool_schema_invalid");
});

test("the recall, question and assessor roles are locked: every learner pick is ignored, the env model serves", () => {
  for (const role of ["agent_recall", "question_generator", "assessor"]) assert.equal(ROLES[role]?.locked, true, role);
  const env = { AI_MODEL_PICKER_ENABLED: "true", OPENCODE_API_KEY: "k",
    AI_MODEL_ROLE_AGENT_RECALL: "glm-5-3-flash", AI_MODEL_ROLE_ASSESSOR: "claude-haiku" };
  const registry = createModelRegistry(env);
  for (const choice of ["claude-opus", "claude-fable", "gpt-4.1", "claude-haiku"]) {
    for (const role of ["agent_recall", "question_generator", "assessor"]) {
      const r = registry.resolve({ role, learnerChoice: choice, allowedModels: [choice] });
      assert.equal(r.source, "locked", `${role} with ${choice}`);
    }
    assert.equal(registry.resolve({ role: "agent_recall", learnerChoice: choice }).model.id, "glm-5-3-flash");
    assert.equal(registry.resolve({ role: "assessor", learnerChoice: choice }).model.id, "claude-haiku");
  }
  // A role that is not locked does follow the pick — the lock is what differs.
  assert.notEqual(createModelRegistry({ AI_MODEL_PICKER_ENABLED: "true", ANTHROPIC_API_KEY: "k" }).resolve({ role: "persona", learnerChoice: "claude-opus" }).source, "locked");
});

test("the Agent Check's call sites name their locked role and pass an env model (never the learner's)", () => {
  const recall = read("../../battle/agentRecall.js");
  assert.match(recall, /__role: "agent_recall"/);
  assert.match(recall, /__role: "agent_recall"/, "the locked recall role decides the model");
  assert.doesNotMatch(recall, /model = ANSWER_MODEL/, "no model is pinned on the call");
  assert.doesNotMatch(recall, /__learnerChoice/);
  const questions = read("../../battle/questionSource.js");
  assert.match(questions, /__role: "question_generator"/);
  assert.match(questions, /model = process\.env\.AI_MODEL_ROLE_QUESTION_GENERATOR \|\| OPENAI_MODEL/);
  assert.doesNotMatch(questions, /__learnerChoice/);
  const judge = read("../../battle/judge.js");
  assert.match(judge, /__role: "assessor"/);
  assert.doesNotMatch(judge, /__learnerChoice/);
  // The metered client: an explicit model is used as given unless the call carries a learner's
  // choice, and that choice only goes through the role resolver (which never moves a locked role).
  const ai = read("../../../lib/aiBilling.js");
  assert.match(ai, /const picked = clean\.model && params\.__learnerChoice\s*\n?\s*\? modelRegistry\.resolve\(\{ role: params\.__role/);
  assert.match(ai, /let entry = picked\?\.source === "learner" \? picked\.model : clean\.model\s*\n?\s*\? \(modelRegistry\.get\(clean\.model\)/);
});
