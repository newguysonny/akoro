import test from "node:test";
import assert from "node:assert/strict";
import { featureModels } from "./aiFeatureModels.js";

test("pinned helpers keep their own model; the guide follows the default", () => {
  const by = Object.fromEntries(featureModels({}, "deepseek").map((f) => [f.key, f]));
  assert.equal(by.chat_suggestions.modelId, "gpt-4o-mini");
  assert.equal(by.chat_suggestions.pinned, true);
  assert.equal(by.guide_ideas.modelId, "gpt-4o-mini");
  assert.equal(by.chat_guide.modelId, "deepseek");
  assert.equal(by.chat_guide.pinned, false);
  assert.equal(by.think_mode.modelId, "o4-mini");
  assert.equal(by.vision_imports.modelId, "gpt-4o");
  assert.equal(by.syllabus_import.modelId, "deepseek");
});

test("an env var moves a pinned feature without touching code", () => {
  const by = Object.fromEntries(featureModels({ OPENAI_SUGGEST_MODEL: "glm-5-3-flash", OPENAI_VISION_MODEL: "gpt-6-luna" }, "deepseek").map((f) => [f.key, f]));
  assert.equal(by.chat_suggestions.modelId, "glm-5-3-flash");
  assert.equal(by.chat_suggestions.pinned, true);
  assert.equal(by.chat_suggestions.envSet, true);
  assert.equal(by.vision_imports.modelId, "gpt-6-luna");
});
