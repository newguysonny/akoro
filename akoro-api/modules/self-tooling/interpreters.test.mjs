// Self-tooling S2: data ops, validation and the recipe interpreter (no database).
import assert from "node:assert/strict";
import test from "node:test";
import * as O from "./ops.js";
import { validateDefinition, runDefinition } from "./interpreters.js";
import { validateParams, coerceInput, bind } from "./bind.js";

const rows = [
  { subject: "Physics", year: 2019, attempted: 20, correct: 8, created_at: "2026-09-01T10:00:00Z" },
  { subject: "Physics", year: 2021, attempted: 10, correct: 4, created_at: "2026-10-01T10:00:00Z" },
  { subject: "Chemistry", year: 2022, attempted: 15, correct: 12, created_at: "2026-10-05T10:00:00Z" },
];

test("ops: filter, group with buckets, compute, sort, limit, pick", () => {
  assert.equal(O.filter(rows, [{ field: "subject", op: "eq", value: "physics" }]).length, 2, "string eq is case-insensitive");
  const g = O.group(rows, { by: ["subject"], sum: ["attempted", "correct"], count: true });
  const phy = g.find((x) => x.subject === "Physics");
  assert.deepEqual([phy.sum_attempted, phy.sum_correct, phy.count], [30, 12, 2]);
  const acc = O.compute(g, { as: "accuracy", fn: "percent", a: "sum_correct", b: "sum_attempted" });
  assert.equal(acc.find((x) => x.subject === "Chemistry").accuracy, 80);
  const byMonth = O.group(rows, { by: [{ field: "created_at", bucket: "month" }], sum: ["attempted"] });
  assert.deepEqual(byMonth.map((x) => x.created_at_month).sort(), ["2026-09", "2026-10"]);
  const mins = O.compute([{ a: "2026-10-01T10:00:00Z", b: "2026-10-01T11:30:00Z" }], { as: "m", fn: "minutesBetween", a: "a", b: "b" });
  assert.equal(mins[0].m, 90);
  assert.deepEqual(O.pick(O.limit(O.sort(rows, { by: "attempted", dir: "desc" }), { n: 1 }), { fields: ["subject"] }), [{ subject: "Physics" }]);
  assert.throws(() => O.filter(rows, [{ field: "x", op: "eval", value: 1 }]), /unknown filter op/);
});

test("ops: join merges on keys, inner and left", () => {
  const left = [{ subject: "Physics", topic: "Waves" }, { subject: "Biology", topic: "Cells" }];
  const right = [{ subject: "physics", accuracy: 0.4 }];
  assert.deepEqual(O.join(left, right, { on: ["subject"] }), [{ subject: "Physics", topic: "Waves", accuracy: 0.4 }]);
  assert.equal(O.join(left, right, { on: ["subject"], type: "left" }).length, 2);
});

test("params: subset schema, coercion, $refs", () => {
  assert.deepEqual(validateParams({ maxAccuracy: { type: "number", default: 0.6 } }), []);
  assert.ok(validateParams({ "bad name": { type: "number" } }).length);
  assert.ok(validateParams({ a: { type: "function" } }).length);
  assert.deepEqual(coerceInput({ n: { type: "integer", default: 5 }, s: { type: "string" } }, { n: "7.6", junk: 1 }), { n: 8 });
  assert.deepEqual(bind({ where: [{ value: "$n" }], keep: "$$literal" }, { n: 3 }), { where: [{ value: 3 }], keep: "$$literal" });
});

test("validation rejects unknown views/fields/ops/caps and undeclared params", async () => {
  const bad = await validateDefinition({ kind: "spec", from: "users", where: [{ field: "password_hash", op: "eq", value: "$x" }] }, {});
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /unknown view users/.test(e)));
  assert.ok(bad.errors.some((e) => /\$x is not a declared param/.test(e)));
  const badField = await validateDefinition({ kind: "spec", from: "my_past_questions", where: [{ field: "user_id", op: "eq", value: "abc" }] }, {});
  assert.ok(badField.errors.some((e) => /unknown field user_id/.test(e)), "owner columns are not fields");
  const badOp = await validateDefinition({ kind: "recipe", steps: [{ id: "a", view: "my_tasks" }], then: [{ op: "exec", code: "x" }] }, {});
  assert.ok(badOp.errors.some((e) => /unknown op exec/.test(e)));
  const locked = await validateDefinition({ kind: "recipe", steps: [{ id: "a", cap: "tasks.mark_done" }], then: [] }, {});
  assert.ok(locked.errors.some((e) => /changes data|needs approval/.test(e)), locked.errors.join("; "));
  const ok = await validateDefinition({ kind: "spec", from: "my_past_questions", where: [{ field: "created_at", op: "within", value: "1y" }],
    group: { by: ["subject"], sum: ["attempted", "correct"] } }, {});
  assert.equal(ok.ok, true, ok.errors.join("; "));
  assert.deepEqual(ok.uses.views, ["my_past_questions"]);
});

test("recipe runs capability steps through the injected tool runner, with from/save/join", async () => {
  const calls = [];
  const callCapability = async (tool, args) => {
    calls.push(tool);
    if (tool === "get_weak_topics") return { weak_topics: [{ subject: "Physics", topic: "Waves", confidence: 0.3 }, { subject: "Chemistry", topic: "Moles", confidence: 0.4 }] };
    if (tool === "get_past_question_practice") return { bySubject: [{ subject: "Physics", attempted: 30, correct: 12 }, { subject: "Chemistry", attempted: 15, correct: 12 }] };
    return { error: "unexpected" };
  };
  const def = { kind: "recipe",
    steps: [{ id: "weak", cap: "learning.weak_topics", rows: "weak_topics" }, { id: "pq", cap: "practice.past_questions", rows: "bySubject" }],
    then: [
      { op: "from", ref: "pq" }, { op: "compute", as: "accuracy", fn: "divide", a: "correct", b: "attempted" },
      { op: "filter", where: [{ field: "accuracy", op: "lt", value: "$max" }] }, { op: "save", as: "low" },
      { op: "from", ref: "weak" }, { op: "join", right: "low", on: ["subject"] }, { op: "pick", fields: ["subject", "topic", "accuracy"] },
    ] };
  const v = await validateDefinition(def, { max: { type: "number", default: 0.6 } });
  assert.equal(v.ok, true, v.errors.join("; "));
  const out = await runDefinition(def, { max: 0.6 }, { learnerId: "u1", callCapability });
  assert.deepEqual(out.rows, [{ subject: "Physics", topic: "Waves", accuracy: 0.4 }]);
  assert.deepEqual(calls, ["get_weak_topics", "get_past_question_practice"]);
});
