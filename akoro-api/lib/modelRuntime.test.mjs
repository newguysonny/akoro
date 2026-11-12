import assert from "node:assert/strict";
import test from "node:test";
import { validateModelChange } from "./modelRuntime.js";

const caps = { tools: true, stream: true, json: true };
const entries = {
  deepseek: { id: "deepseek", label: "DeepSeek", enabled: true, caps },
  claude: { id: "claude-haiku", label: "Claude Haiku", enabled: true, caps: { ...caps, vision: true } },
  o4: { id: "o4-mini", label: "o4-mini", enabled: true, caps: { ...caps, responses: true } },
  disabled: { id: "gpt-4o", label: "GPT-4o", enabled: false, caps },
  unavailable: { id: "unavailable", label: "Grok", enabled: true, caps },
};
const roles = { suggestions: { caps: ["json"] }, vision: { caps: ["vision"] } };
const features = { think_mode: { requires: ["responses"] }, research_mode: { requires: ["tools"] } };

const getEntry = (id) => entries[id] || null;
const isAvailable = (entry) => entry.id !== "unavailable"
  ? { available: true, reason: null }
  : { available: false, reason: "No API key on this server." };

const validate = (body) => validateModelChange(body, { getEntry, isAvailable });

test("a valid default with no fallback is accepted", () => {
  assert.deepEqual(validate({ defaultModel: "deepseek" }), {
    ok: true,
    values: { defaultModel: "deepseek", fallbackModel: null },
  });
});

test("a valid default and different fallback are accepted", () => {
  assert.deepEqual(validate({ defaultModel: "deepseek", fallbackModel: "claude" }), {
    ok: true,
    values: { defaultModel: "deepseek", fallbackModel: "claude" },
  });
});

test("an unknown model id is rejected", () => {
  const out = validate({ defaultModel: "not-a-model" });
  assert.equal(out.ok, false);
  assert.equal(out.code, "unknown_model");
  assert.equal(out.field, "defaultModel");
  assert.match(out.message, /not a known model/);
});

test("a disabled model is rejected", () => {
  const out = validate({ defaultModel: "disabled" });
  assert.equal(out.ok, false);
  assert.equal(out.code, "model_disabled");
  assert.match(out.message, /turned off/);
});

test("an unavailable model is rejected and carries the reason", () => {
  const out = validate({ defaultModel: "unavailable" });
  assert.equal(out.ok, false);
  assert.equal(out.code, "model_unavailable");
  assert.match(out.message, /No API key/);
});

test("a fallback equal to the default is rejected", () => {
  const out = validate({ defaultModel: "deepseek", fallbackModel: "deepseek" });
  assert.equal(out.ok, false);
  assert.equal(out.code, "fallback_equals_default");
  assert.equal(out.field, "fallbackModel");
});

test("an empty default is rejected", () => {
  for (const defaultModel of [undefined, null, "", "   "]) {
    const out = validate({ defaultModel });
    assert.equal(out.ok, false);
    assert.equal(out.code, "default_model_required");
  }
});

test("an invalid fallback is reported on the fallback field", () => {
  const out = validate({ defaultModel: "deepseek", fallbackModel: "nope" });
  assert.equal(out.ok, false);
  assert.equal(out.code, "unknown_model");
  assert.equal(out.field, "fallbackModel");
});


test("a role-only patch leaves the default alone and validates capability", () => {
  const withMaps = (body) => validateModelChange(body, {
    getEntry, isAvailable, roles, features,
  });
  const ok = withMaps({ roleModels: { suggestions: "deepseek" } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.values, { roleModels: { suggestions: "deepseek" } });
  const noVision = withMaps({ roleModels: { vision: "deepseek" } });
  assert.equal(noVision.ok, false);
  assert.equal(noVision.code, "role_capability");
  const vision = withMaps({ roleModels: { vision: "claude" } });
  assert.equal(vision.ok, true);
  assert.equal(withMaps({ roleModels: { nope: "deepseek" } }).code, "unknown_role");
});

test("feature overrides check their required capability", () => {
  const withMaps = (body) => validateModelChange(body, { getEntry, isAvailable, roles, features });
  assert.equal(withMaps({ featureModels: { research_mode: "deepseek" } }).ok, true);
  const think = withMaps({ featureModels: { think_mode: "deepseek" } });
  assert.equal(think.ok, false);
  assert.equal(think.code, "feature_capability");
  assert.equal(withMaps({ featureModels: { think_mode: "o4" } }).ok, true);
  assert.equal(withMaps({ featureModels: { nope: "o4" } }).code, "unknown_feature");
});
