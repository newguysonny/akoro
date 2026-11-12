import test from "node:test";
import assert from "node:assert/strict";
import { parseLooseJson, validateShape, repairShape, readStructured, jsonRetryInstruction } from "./structuredOutput.js";

const schema = {
  type: "object", additionalProperties: false, required: ["value", "items"],
  properties: {
    value: { type: "string" },
    items: { type: "array", items: { type: "object", required: ["n"], properties: { n: { type: "integer" } } } },
  },
};

test("JSON is found in a body, a fence or prose", () => {
  assert.deepEqual(parseLooseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseLooseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseLooseJson('Here you go: {"a":1} — hope it helps'), { a: 1 });
  assert.equal(parseLooseJson("no json here"), null);
});

test("missing keys fail validation; repair fills and coerces for the retry", () => {
  const parsed = { items: [{ n: "2" }] };
  assert.ok(validateShape(parsed, schema).length > 0);
  const repaired = repairShape(parsed, schema);
  assert.deepEqual(repaired, { value: "", items: [{ n: 2 }] });
  assert.deepEqual(validateShape(repaired, schema), []);
});

test("readStructured returns ok only when the shape matches", () => {
  assert.equal(readStructured('{"value":"v","items":[]}', schema).ok, true);
  const bad = readStructured("prose", schema);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /unparseable/);
  assert.match(jsonRetryInstruction(schema, ["x: required"]), /Return ONLY one JSON value/);
});
