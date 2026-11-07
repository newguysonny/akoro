// Phase 11 / §7.11.5: the chat's model picker behind AI_MODEL_PICKER_ENABLED.
// Picker on → the registry's full resolution (tier list, caps, set up here),
// with the notice the learner sees; picker off → today's switch, unchanged.
// Every model carries its cost against the default; grading never follows a pick.
process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
import assert from "node:assert/strict";
import test from "node:test";
import { publicModelList, pickerInfo, pickerEnabled, resolveChatChoice, resolveChatModel, costHint } from "./modelCatalogue.js";
import { createModelRegistry } from "./modelRegistry.js";

const KEYS = { OPENAI_API_KEY: "k", ANTHROPIC_API_KEY: "k" };
const ON = { ...KEYS, AI_MODEL_PICKER_ENABLED: "true" };

test("the flag: on by default, off only when set off; /models says so", () => {
  assert.equal(pickerEnabled({}), true, "on by default");
  assert.equal(pickerEnabled({ AI_MODEL_PICKER_ENABLED: "false" }), false);
  assert.equal(pickerEnabled({ AI_MODEL_PICKER_ENABLED: "off" }), false);
  assert.equal(pickerEnabled({ AI_MODEL_PICKER_ENABLED: "TRUE" }), true);
  assert.deepEqual(pickerInfo(ON), { enabled: true, defaultId: "gpt-4o-mini" });
  assert.deepEqual(pickerInfo({ AI_MODEL_PICKER_ENABLED: "false" }), { enabled: false, defaultId: "gpt-4o-mini" });
});

test("cost hints against the default: the default has none; Opus reads about 30x", () => {
  const by = Object.fromEntries(publicModelList(ON).map((m) => [m.id, m]));
  assert.equal(by["gpt-4o-mini"].costHint, null);
  assert.equal(by["gpt-4o-mini"].costMultiple, 1);
  assert.match(by["claude-opus"].costHint, /^≈ 3\d× coins per message$/);
  assert.ok(by["claude-haiku"].costMultiple < 1, "cheaper than the default");
  assert.equal(by["claude-haiku"].costHint, "Fewer coins per message");
  assert.equal(by.grok.costHint, null, "unpriced: no hint, never a guess");
  assert.deepEqual(costHint({ id: "x", price: null }, { id: "d", price: { in: 1, out: 1 } }), { multiple: null, hint: null });
});

test("a tier list locks models outside it, never the default", () => {
  const list = publicModelList(ON, { allowedModels: ["claude-haiku"] });
  const by = Object.fromEntries(list.map((m) => [m.id, m]));
  assert.equal(by["claude-haiku"].available, true);
  assert.equal(by["gpt-4o-mini"].available, true);
  assert.equal(by["claude-opus"].available, false);
  assert.equal(by["claude-opus"].locked, "plan");
  assert.equal(by["claude-opus"].note, "Not in your plan.");
  assert.ok(list.every((m) => !("apiModel" in m)), "no internals to the browser");
});

test("picker on: a pick runs through the registry, and a refused pick says why", () => {
  assert.deepEqual(resolveChatChoice("claude-sonnet", ON), { apiModel: "claude-sonnet-5-5", notice: null });
  const refused = resolveChatChoice("claude-sonnet", ON, { allowedModels: ["claude-haiku"] });
  assert.equal(refused.apiModel, null);
  assert.match(refused.notice, /isn't in your plan/);
  assert.match(resolveChatChoice("claude-opus", { OPENAI_API_KEY: "k", AI_MODEL_PICKER_ENABLED: "true" }).notice, /isn't set up here/);
  assert.match(resolveChatChoice("gpt-4o", ON).notice, /can't be chosen/);
  assert.match(resolveChatChoice("claude-sonnet", { ...ON, AI_MODELS: JSON.stringify([{ id: "claude-sonnet", enabled: false }]) }).notice, /switched off/);
  assert.equal(resolveChatModel("claude-sonnet", { ...ON, AI_MODEL_LOCKED_ROLES: "chat" }), null, "a locked chat role ignores the pick");
});

test("picker off: today's switch is unchanged", () => {
  assert.equal(resolveChatModel("claude-opus", KEYS), "claude-opus-5-5");
  assert.equal(resolveChatModel("claude-opus", { OPENAI_API_KEY: "k" }), null);
  assert.deepEqual(resolveChatChoice(null, KEYS), { apiModel: null, notice: null });
});

test("the learner's choice never applies to grading (assessor) or evidence", () => {
  const reg = createModelRegistry({ ...ON, AI_MODEL_ROLE_ASSESSOR: "gpt-4.1" });
  for (const choice of ["claude-opus", "claude-sonnet", "gpt-4o-mini"]) {
    assert.equal(reg.resolve({ role: "assessor", learnerChoice: choice }).model.id, "gpt-4.1");
    assert.equal(reg.resolve({ role: "assessor", learnerChoice: choice }).source, "locked");
    assert.equal(reg.resolve({ role: "evidence", learnerChoice: choice }).source, "locked");
  }
});
