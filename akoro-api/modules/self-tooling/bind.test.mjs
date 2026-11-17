// coerceInput (bind.js): an explicitly passed "" is a VALUE for a string
// param, not a missing input. Before this fix, "" silently became the
// param's declared default, so "run with an empty phrase" ran with
// whatever target the default named (live, 2026-11-17: a delete tool
// proposed the chat its title default pointed at). Defaults fill only
// absent values — plus "" for non-string params, where "" is never a
// real value.
import assert from "node:assert/strict";
import test from "node:test";
import { coerceInput } from "./bind.js";

const schema = {
  title: { type: "string", default: "Stage 3 API proof" },
  limit: { type: "number", default: 10 },
  flag: { type: "boolean", default: true },
  plain: { type: "string" },
};

test("an explicit empty string is honoured for a string param — no default swap", () => {
  const out = coerceInput(schema, { title: "" });
  assert.equal(out.title, "");
});

test("absent values still take the default (undefined and null)", () => {
  assert.equal(coerceInput(schema, {}).title, "Stage 3 API proof");
  assert.equal(coerceInput(schema, { title: undefined }).title, "Stage 3 API proof");
  assert.equal(coerceInput(schema, { title: null }).title, "Stage 3 API proof");
});

test("a real string value passes through untouched", () => {
  assert.equal(coerceInput(schema, { title: "Basic" }).title, "Basic");
  assert.equal(coerceInput(schema, { title: "   " }).title, "   ");
});

test("empty string still means 'use the default' for number and boolean params", () => {
  const out = coerceInput(schema, { limit: "", flag: "" });
  assert.equal(out.limit, 10);
  assert.equal(out.flag, true);
});

test("a string param with no default keeps an explicit empty string", () => {
  assert.equal(coerceInput(schema, { plain: "" }).plain, "");
  assert.equal("plain" in coerceInput(schema, {}), false);
});
