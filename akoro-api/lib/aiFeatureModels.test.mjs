import test from "node:test";
import assert from "node:assert/strict";
import { featureModels } from "./aiFeatureModels.js";

test("only the Responses-API modes name a model directly", () => {
  const list = featureModels({}, "deepseek");
  assert.deepEqual(list.map((f) => f.key), ["think_mode", "research_mode"]);
  for (const f of list) {
    assert.equal(f.pinned, true);
    assert.equal(f.api, "responses");
    assert.match(f.reason, /Responses API/);
  }
  assert.equal(list[0].modelId, "o4-mini");
  assert.equal(list[1].modelId, "gpt-4o");
});

test("an env still overrides a Responses-API mode", () => {
  const list = featureModels({ OPENAI_THINK_MODEL: "gpt-6-luna" }, "deepseek");
  assert.equal(list[0].modelId, "gpt-6-luna");
  assert.equal(list[0].source, "env");
});
