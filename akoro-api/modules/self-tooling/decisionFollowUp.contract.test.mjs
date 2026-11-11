import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "decisionFollowUp.js"), "utf8");

test("decision follow-up captures the final answer (streaming on; reads finalText)", () => {
  // With streamText:false the loop drops the final answer and messages never
  // gets the last assistant turn, so the follow-up posted nothing.
  assert.match(src, /streamText:\s*true/, "must stream so finalText is set");
  assert.doesNotMatch(src, /streamText:\s*false/);
  assert.match(src, /run\?\.finalText/, "reads finalText");
});
