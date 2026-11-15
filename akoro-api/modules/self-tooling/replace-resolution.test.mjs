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
