import test from "node:test";
import assert from "node:assert/strict";
import { featureModels } from "./aiFeatureModels.js";

test("only the Responses-API modes name a model directly", () => {
  const list = featureModels({}, "deepseek");
  assert.deepEqual(list.map((f) => f.key), ["think_mode", "research_mode"]);
  assert.equal(list[0].pinned, true);
  assert.equal(list[0].api, "responses");
  assert.match(list[0].reason, /Responses surface/);
  assert.equal(list[1].pinned, true);
  assert.equal(list[1].api, "chat");
  assert.match(list[1].reason, /Fallback only/);
  assert.equal(list[0].modelId, "o4-mini");
  assert.equal(list[1].modelId, "gpt-4o");
});

test("an env still overrides a Responses-API mode", () => {
  const list = featureModels({ OPENAI_THINK_MODEL: "gpt-6-luna" }, "deepseek");
  assert.equal(list[0].modelId, "gpt-6-luna");
  assert.equal(list[0].source, "env");
});

test("a runtime feature override wins over env and fallback and is labelled", () => {
  const list = featureModels({ OPENAI_RESEARCH_MODEL: "gpt-5" }, "deepseek", { research_mode: "glm-5-3-flash" });
  const research = list.find((f) => f.key === "research_mode");
  assert.equal(research.modelId, "glm-5-3-flash");
  assert.equal(research.source, "runtime");
  assert.equal(research.override, undefined, "the API adds the raw override");
  assert.deepEqual(research.requires, ["tools"]);
});
