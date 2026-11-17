// `replace` may arrive as the tool's label or a slug variant of its name —
// resolve it only when exactly one of the learner's tools can be meant.
import "../../test-env.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { pickReplacement } from "./pipeline.js";

const rows = [
  { id: "1", name: "goals_percentage_fixed", label: "Goals percentage" },
  { id: "2", name: "my_chats", label: "My Chats" },
  { id: "3", name: "goals_by_month", label: "Goals by month" },
];

test("label, slug and unique prefix all resolve", () => {
  assert.equal(pickReplacement(rows, "Goals percentage")?.id, "1");
  assert.equal(pickReplacement(rows, "goals percentage")?.id, "1");
  assert.equal(pickReplacement(rows, "my_chats")?.id, "2");
  assert.equal(pickReplacement(rows, "Goals by month")?.id, "3");
});

test("no match or an ambiguous prefix resolves to nothing", () => {
  assert.equal(pickReplacement(rows, "Weather tool"), null);
  assert.equal(pickReplacement(rows, "goals"), null);   // prefixes two tools
  assert.equal(pickReplacement(rows, ""), null);
});

test("a same-name swap retires the old row BEFORE inserting the new one (live duplicate-key failure, 2026-11-17)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./pipeline.js", import.meta.url), "utf8");
  // The helper exists and only fires on an exact name collision.
  assert.match(src, /const retireReplacedBeforeInsert = async \(\) => \{\n    if \(!replaced\?\.id \|\| replaced\.name !== name\) return;/);
  // Every register save site calls it ahead of its insert: domain saves,
  // the permission draft, and the direct register insert.
  const calls = src.match(/await retireReplacedBeforeInsert\(\);/g) || [];
  assert.ok(calls.length >= 3, `expected >=3 retire-before-insert calls, got ${calls.length}`);
  // The direct register insert is preceded by the retire call (not just archiveReplaced after).
  const insertAt = src.indexOf('insert({ owner_id: learnerId, scope: "learner", audience, ...def, domain: (def.views || [])[0] || null');
  const retireAt = src.lastIndexOf("await retireReplacedBeforeInsert();", insertAt);
  assert.ok(retireAt > 0 && insertAt - retireAt < 160, "the retire call immediately precedes the register insert");
});
