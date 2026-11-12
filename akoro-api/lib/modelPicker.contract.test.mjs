// Phase 11 / §7.11.5: the chat's model picker behind AI_MODEL_PICKER_ENABLED.
// Picker on → the registry's full resolution (tier list, caps, set up here),
// with the notice the learner sees; picker off → today's switch, unchanged.
// Every model carries its cost against the default; grading never follows a pick.
process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
import assert from "node:assert/strict";
import test from "node:test";
import { publicModelList, pickerInfo, pickerEnabled, resolveChatChoice, resolveChatModel, costHint } from "./modelCatalogue.js";
import { createModelRegistry } from "./modelRegistry.js";

const KEYS = { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k", OPENCODE_API_KEY: "k" };
const ON = { ...KEYS, AI_MODEL_PICKER_ENABLED: "true" };

test("the flag: on by default, off only when set off; /models says so", () => {
  assert.equal(pickerEnabled({}), true, "on by default");
  assert.equal(pickerEnabled({ AI_MODEL_PICKER_ENABLED: "false" }), false);
  assert.equal(pickerEnabled({ AI_MODEL_PICKER_ENABLED: "off" }), false);
  assert.equal(pickerEnabled({ AI_MODEL_PICKER_ENABLED: "TRUE" }), true);
  assert.deepEqual(pickerInfo(ON), { enabled: true, defaultId: "deepseek" });
  assert.deepEqual(pickerInfo({ AI_MODEL_PICKER_ENABLED: "false" }), { enabled: false, defaultId: "deepseek" });
});

test("cost hints against the default: the default has none; a frontier model reads higher", () => {
  const by = Object.fromEntries(publicModelList(ON).map((m) => [m.id, m]));
  assert.equal(by["deepseek"].costHint, null);
  assert.equal(by["deepseek"].costMultiple, 1);
  assert.match(by.grok.costHint, /coins per message/);
  assert.ok(by.grok.costMultiple > 1, "Grok costs more than DeepSeek");
  assert.ok(by["claude-haiku"].costMultiple < 1, "cheaper than the default");
  assert.equal(by["claude-haiku"].costHint, "Fewer coins per message");
  assert.deepEqual(costHint({ id: "x", price: null }, { id: "d", price: { in: 1, out: 1 } }), { multiple: null, hint: null });
});

test("a tier list locks models outside it, never the default", () => {
  const list = publicModelList(ON, { allowedModels: ["claude-haiku"] });
  const by = Object.fromEntries(list.map((m) => [m.id, m]));
  assert.equal(by["claude-haiku"].available, true);
  assert.equal(by["deepseek"].available, true, "the default is always allowed");
  assert.equal(by.grok.available, false);
  assert.equal(by.grok.locked, "plan");
  assert.equal(by.grok.note, "Not in your plan.");
  assert.ok(list.every((m) => !("apiModel" in m) && !("provider" in m)), "no internals to the browser");
});

test("picker on: a pick runs through the registry, and a refused pick says why", () => {
  assert.deepEqual(resolveChatChoice("glm-5-3-flash", ON), { apiModel: "glm-5.3-flash", notice: null });
  const refused = resolveChatChoice("glm-5-3-flash", ON, { allowedModels: ["claude-haiku"] });
  assert.equal(refused.apiModel, null);
  assert.match(refused.notice, /isn't in your plan/);
  assert.match(resolveChatChoice("claude-opus", ON).notice, /switched off/);
  assert.match(resolveChatChoice("glm-5-3-flash", { ...ON, AI_MODELS: JSON.stringify([{ id: "glm-5-3-flash", selectable: false }]) }).notice, /can't be chosen/);
  assert.match(resolveChatChoice("glm-5-3-flash", { ...ON, AI_MODELS: JSON.stringify([{ id: "glm-5-3-flash", enabled: false }]) }).notice, /switched off/);
  assert.equal(resolveChatModel("glm-5-3-flash", { ...ON, AI_MODEL_LOCKED_ROLES: "chat" }), null, "a locked chat role ignores the pick");
});

test("picker off: the switch still requires an available model", () => {
  assert.equal(resolveChatModel("glm-5-3-flash", KEYS), "glm-5.3-flash");
  assert.equal(resolveChatModel("glm-5-3-flash", { OPENAI_API_KEY: "k" }), null);
  assert.deepEqual(resolveChatChoice(null, KEYS), { apiModel: null, notice: null });
});

test("the learner's choice never applies to grading (assessor) or evidence", () => {
  const reg = createModelRegistry({ ...ON, AI_MODEL_ROLE_ASSESSOR: "gpt-6-luna" });
  for (const choice of ["claude-opus", "glm-5-3-flash", "deepseek"]) {
    assert.equal(reg.resolve({ role: "assessor", learnerChoice: choice }).model.id, "gpt-6-luna");
    assert.equal(reg.resolve({ role: "assessor", learnerChoice: choice }).source, "locked");
    assert.equal(reg.resolve({ role: "evidence", learnerChoice: choice }).source, "locked");
  }
});
