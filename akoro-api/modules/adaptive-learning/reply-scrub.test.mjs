// DSML tool-call markup must never reach the learner as reply text.
import assert from "node:assert/strict";
import test from "node:test";
import { stripDsmlMarkup, hasDsmlMarkup } from "./reply-scrub.js";

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
