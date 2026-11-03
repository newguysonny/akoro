import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENAI_API_KEY ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { parseBuilderJson } = await import("./builder.js");

test("builder JSON: a valid answer parses as is", () => {
  assert.deepEqual(parseBuilderJson('{"definition":{"kind":"code"},"samples":[{"n":1}]}'), { definition: { kind: "code" }, samples: [{ n: 1 }] });
});

test("builder JSON: a mangled trailing samples list doesn't discard a good definition", () => {
  const raw = '{"definition":{"kind":"code","steps":[],"source":"function run(){ return []; }"},"samples":[{},{"}]}';
  const out = parseBuilderJson(raw);
  assert.equal(out.definition.kind, "code");
  assert.equal(out.samples, undefined);
});

test("builder JSON: garbage is still null", () => {
  assert.equal(parseBuilderJson("not json"), null);
  assert.equal(parseBuilderJson('{"definition":{"kind":'), null);
});
