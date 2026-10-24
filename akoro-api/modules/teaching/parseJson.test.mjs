import test from "node:test";
import assert from "node:assert/strict";
import { closeJson } from "./jsonRepair.js";

test("closeJson closes brackets a model left open, in order", () => {
  const cut = '{"title":"T","entries":[{"title":"A","sections":[{"kind":"fields","items":[{"label":"M","value":"Chalk"}]}]}';
  assert.deepEqual(JSON.parse(closeJson(cut)), { title: "T", entries: [{ title: "A", sections: [{ kind: "fields", items: [{ label: "M", value: "Chalk" }] }] }] });
  assert.equal(closeJson('{"a":"x [ y ] }","b":[1,2'), '{"a":"x [ y ] }","b":[1,2]}');
  assert.equal(closeJson('{"a":"unfinished'), '{"a":"unfinished"}');
  assert.equal(closeJson('{"a":]'), null, "a mismatched closer is not repaired");
});
