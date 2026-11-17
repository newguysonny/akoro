// ops.js matches(): a blank text-search needle must match NOTHING.
// "".includes("") is true for every string, so before this guard a
// contains/startsWith filter whose value arrived empty (a tool run with
// no phrase) matched the learner's whole list — live, 2026-11-17: a
// rebuilt contains-tool's automatic first run proposed the learner's
// current chat on a delete card.
import assert from "node:assert/strict";
import test from "node:test";
import { matches, filter } from "./ops.js";

const row = { title: "Basic Science — Matter and its states" };

test("contains with a blank needle matches nothing", () => {
  assert.equal(matches(row, { field: "title", op: "contains", value: "" }), false);
  assert.equal(matches(row, { field: "title", op: "contains", value: "   " }), false);
  assert.equal(matches(row, { field: "title", op: "contains", value: null }), false);
  assert.equal(matches(row, { field: "title", op: "contains", value: undefined }), false);
});

test("startsWith with a blank needle matches nothing", () => {
  assert.equal(matches(row, { field: "title", op: "startsWith", value: "" }), false);
  assert.equal(matches(row, { field: "title", op: "startsWith", value: "  " }), false);
  assert.equal(matches(row, { field: "title", op: "startsWith", value: null }), false);
});

test("real needles still match, case-insensitively, trimmed", () => {
  assert.equal(matches(row, { field: "title", op: "contains", value: "basic" }), true);
  assert.equal(matches(row, { field: "title", op: "contains", value: " SCIENCE " }), true);
  assert.equal(matches(row, { field: "title", op: "contains", value: "zzz" }), false);
  assert.equal(matches(row, { field: "title", op: "startsWith", value: "Basic" }), true);
  assert.equal(matches(row, { field: "title", op: "startsWith", value: "Science" }), false);
  assert.equal(matches({ title: null }, { field: "title", op: "contains", value: "basic" }), false);
});

test("a where clause with a blank contains empties the whole filter", () => {
  const rows = [{ title: "Alpha" }, { title: "Beta" }, { title: "" }];
  assert.deepEqual(filter(rows, [{ field: "title", op: "contains", value: "" }]), []);
  assert.equal(filter(rows, [{ field: "title", op: "contains", value: "a" }]).length, 2);
});

test("other ops are untouched: eq can still find an empty field", () => {
  assert.equal(matches({ title: "" }, { field: "title", op: "eq", value: "" }), true);
  assert.equal(matches(row, { field: "title", op: "eq", value: "" }), false);
  assert.equal(matches(row, { field: "title", op: "neq", value: "" }), true);
});
