process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
process.env.ANTHROPIC_API_KEY ||= "test";
process.env.AI_TELEMETRY_DB = "off";

import test from "node:test";
import assert from "node:assert/strict";

test("a vision call never fails over to a text-only model", async () => {
  const { fallbackLadder } = await import("./aiModel.js");
  const { createModelRegistry, ROLES } = await import("./modelRegistry.js");
  const env = { OPENCODE_API_KEY: "k" };
  const reg = createModelRegistry(env);
  const ladder = fallbackLadder(reg.get("gpt-6-luna"), { registry: reg, env, role: "vision", ROLES });
  assert.ok(ladder.length > 0);
  assert.ok(ladder.every((e) => e.caps.vision), "every hop can see images");
  assert.ok(!ladder.some((e) => e.id === "deepseek"), "the text-only default is never a vision hop");
});
