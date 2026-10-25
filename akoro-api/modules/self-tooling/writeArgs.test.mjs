// A change's value: checked when built, worked out when run, shown on the card.
import assert from "node:assert/strict";
import test from "node:test";
import { checkArgs, dateValue, resolveArgs } from "./writeArgs.js";
import { CAPABILITIES } from "./capabilities.js";

test("dateValue: relative to the learner's today", () => {
  assert.equal(dateValue("tomorrow", "2026-10-25"), "2026-10-26");
  assert.equal(dateValue("today", "2026-10-25"), "2026-10-25");
  assert.equal(dateValue("+7d", "2026-10-25"), "2026-11-01");
  assert.equal(dateValue("2026-12-01", "2026-10-25"), "2026-12-01");
  assert.equal(dateValue("monday", "2026-10-25"), "2026-10-26", "2026-10-25 is a Sunday");
  assert.equal(dateValue("sunday", "2026-10-25"), "2026-11-01", "the NEXT one, not today");
  for (const bad of ["", "soon", "+0d", "+999d", "2026-13-45"]) assert.equal(dateValue(bad, "2026-10-25"), null, bad);
});

test("checkArgs: each capability's values", () => {
  const r = CAPABILITIES["tasks.reschedule"], p = CAPABILITIES["tasks.set_priority"], d = CAPABILITIES["tasks.delete"];
  assert.deepEqual(checkArgs("tasks.reschedule", r, { date: "tomorrow" }), []);
  assert.deepEqual(checkArgs("tasks.reschedule", r, { date: "$newDate" }), [], "a param is filled in when it runs");
  assert.equal(checkArgs("tasks.reschedule", r, {}).length, 1);
  assert.equal(checkArgs("tasks.reschedule", r, { date: "whenever" }).length, 1);
  assert.deepEqual(checkArgs("tasks.set_priority", p, { priority: "high" }), []);
  assert.equal(checkArgs("tasks.set_priority", p, { priority: "huge" }).length, 1);
  assert.equal(checkArgs("tasks.delete", d, { date: "tomorrow" }).length, 1, "a change without values takes none");
  assert.deepEqual(checkArgs("tasks.delete", d, undefined), []);
});

test("resolveArgs: the date as applied, with a label for the Confirm card", () => {
  const out = resolveArgs("tasks.reschedule", CAPABILITIES["tasks.reschedule"], { date: "tomorrow" }, "2026-10-25");
  assert.equal(out.date, "2026-10-26");
  assert.match(out.dateLabel, /Mon 26 Oct/);
  assert.match(CAPABILITIES["tasks.reschedule"].describe(out), /move your tasks to Mon 26 Oct/);
  assert.throws(() => resolveArgs("tasks.set_priority", CAPABILITIES["tasks.set_priority"], { priority: "nope" }, "2026-10-25"));
});
