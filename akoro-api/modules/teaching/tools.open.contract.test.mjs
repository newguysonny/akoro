import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [teaching, access, catalogue, taskTool] = await Promise.all([
  read("./tools.js"), read("../../lib/toolAccess.js"), read("../instructor/tools.js"), read("../tasks/tools/teaching-tool.js"),
]);

test("no tool is locked: the lock check, the gates and the pricing are gone", () => {
  // Teaching tools: no lock state, never refused for being locked, always listed open.
  assert.doesNotMatch(teaching, /lockState|TOOL_LOCKED/);
  assert.match(teaching, /locked: false, priceKobo: 0, toolId: null/);
  assert.doesNotMatch(taskTool, /TOOL_LOCKED/);
  // Agent tools: nothing is gated behind a purchase.
  assert.match(access, /export const TOOL_GATES = \{\};/);
  // The catalogue shows tools as owned and free; checkout never charges for one.
  assert.match(catalogue, /owned:\s+r\.kind === "tool" \? true : ownedSet\.has\(r\.id\)/);
  assert.match(catalogue, /if \(tool\.kind === "tool"\) \{\s*return res\.json\(\{ success: true, free: true, owned: true/);
});
