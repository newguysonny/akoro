// DSML tool-call markup must never reach the learner as reply text.
import assert from "node:assert/strict";
import test from "node:test";
import { stripDsmlMarkup, hasDsmlMarkup, stripToolCallMarkup, hasToolCallMarkup } from "./reply-scrub.js";

const LEAK = `<｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="update_plan">
<｜｜DSML｜｜ parameter name="goal" string="true">Rebuild the tool</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke>
</｜｜DSML｜｜ calls>`;

test("a whole DSML calls block is removed", () => {
  assert.equal(stripDsmlMarkup(LEAK), "");
  assert.equal(hasDsmlMarkup(LEAK), true);
});

test("prose around a DSML block survives, the block does not", () => {
  const out = stripDsmlMarkup(`Here is your answer.\n\n${LEAK}\n\nAnything else?`);
  assert.equal(out, "Here is your answer.\n\nAnything else?");
});

test("ascii variant and a lone invoke block are removed", () => {
  const ascii = `<||DSML|| invoke name="create_tool"><||DSML|| parameter name="x" string="true">1</||DSML|| parameter></||DSML|| invoke>`;
  assert.equal(stripDsmlMarkup(ascii), "");
});

test("a truncated block (stream cut) loses its tail, keeps the prose", () => {
  const out = stripDsmlMarkup(`Done — 0%.\n<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="update_pl`);
  assert.equal(out, "Done — 0%.");
});

test("clean text is untouched", () => {
  const clean = "You've completed **33%** of your goals — 1 out of 3.";
  assert.equal(stripDsmlMarkup(clean), clean);
  assert.equal(hasDsmlMarkup(clean), false);
});

/* The <tool_call> JSON variant (observed live 2026-11-16 as a whole reply). */

const TC_LEAK = `<tool_call>
{"name": "ask_to_be_taught", "arguments": {"topic": "properties of matter", "subject": "Physics"}}
</tool_call>`;

test("a whole <tool_call> JSON reply is removed", () => {
  assert.equal(stripToolCallMarkup(TC_LEAK), "");
  assert.equal(hasToolCallMarkup(TC_LEAK), true);
});

test("prose around a <tool_call> block survives, the block does not", () => {
  const out = stripToolCallMarkup(`Here is your answer.\n\n${TC_LEAK}\n\nAnything else?`);
  assert.equal(out, "Here is your answer.\n\nAnything else?");
});

test("a <tool_calls> wrapper and <invoke> XML are removed", () => {
  const wrapped = `<tool_calls><tool_call>{"name": "a", "arguments": {}}</tool_call><tool_call>{"name": "b", "arguments": {}}</tool_call></tool_calls>`;
  assert.equal(stripToolCallMarkup(wrapped), "");
  const xml = `<invoke name="make_study_material"><parameter name="tool">quiz</parameter></invoke>`;
  assert.equal(stripToolCallMarkup(xml), "");
  const fc = `<function_calls><invoke name="x"></invoke></function_calls>`;
  assert.equal(stripToolCallMarkup(fc), "");
});

test("a truncated <tool_call> (stream cut) loses its tail, keeps the prose", () => {
  const out = stripToolCallMarkup(`Working on it.\n<tool_call>\n{"name": "ask_to_be_ta`);
  assert.equal(out, "Working on it.");
});

test("a stray closing tag is removed, prose kept", () => {
  assert.equal(stripToolCallMarkup(`Done.</tool_call>`), "Done.");
});

test("ordinary angle brackets and clean text are untouched", () => {
  const clean = "In HTML a <div> wraps content, and 2 < 3 is true.";
  assert.equal(stripToolCallMarkup(clean), clean);
  assert.equal(hasToolCallMarkup(clean), false);
});
