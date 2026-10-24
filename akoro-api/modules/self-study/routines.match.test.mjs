// node --test modules/self-study/routines.match.test.mjs — cancelling a routine by its id or its title.
import test from "node:test";
import assert from "node:assert/strict";

const { matchRoutine } = await import("./routinesCore.js");
const list = [
  { id: "11111111-1111-4111-8111-111111111111", title: "[verify:x] Friday revision" },
  { id: "22222222-2222-4222-8222-222222222222", title: "Fractions battle" },
  { id: "33333333-3333-4333-8333-333333333333", title: "Fractions battle" },
];

test("matchRoutine: by id, by title (quotes and case aside); an ambiguous title asks", () => {
  assert.equal(matchRoutine(list, "11111111-1111-4111-8111-111111111111")?.title, "[verify:x] Friday revision");
  assert.equal(matchRoutine(list, "[verify:x] Friday revision")?.id, list[0].id);
  assert.equal(matchRoutine(list, "  “[VERIFY:x] friday revision”  ")?.id, list[0].id);
  assert.equal(matchRoutine(list, "Nothing like it"), null);
  assert.equal(matchRoutine(list, ""), null);
  assert.throws(() => matchRoutine(list, "Fractions battle"), /2 routines are called/);
});
