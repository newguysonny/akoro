// Self-tooling S2: data ops, validation and the recipe interpreter (no database).
import "../../test-env.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import * as O from "./ops.js";
import { validateDefinition, runDefinition, normalizeDefinition, dropUnsetFilters } from "./interpreters.js";
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

test("single items where lists belong are wrapped, not crashed on", async () => {
  const def = { kind: "spec", from: "my_learning_sessions", group: { by: { field: "started_at", bucket: "month" }, sum: "subject" }, sort: { by: "started_at_month", dir: "asc" } };
  const v = await validateDefinition(def, {});
  assert.ok(!v.errors.some((e) => /group\.by/.test(e)), v.errors.join("; "));
  assert.deepEqual(def.group.by, [{ field: "started_at", bucket: "month" }]);
  assert.deepEqual(def.group.sum, ["subject"]);
  assert.ok(Array.isArray(def.sort));
  const r = normalizeDefinition({ kind: "recipe", steps: [{ id: "a", view: "my_tasks", where: { field: "status", op: "eq", value: "done" } }], then: [{ op: "group", by: "status", count: true }, { op: "pick", fields: "status" }] });
  assert.deepEqual(r.steps[0].where.length, 1);
  assert.deepEqual(r.then[0].by, ["status"]);
  assert.deepEqual(r.then[1].fields, ["status"]);
});

test("field flow: unknown fields after a group, and unused steps, fail validation", async () => {
  const sess = { id: "sessions", view: "my_learning_sessions", where: [{ field: "started_at", op: "year", value: "this" }] };
  const tail = [{ op: "from", ref: "sessions" }, { op: "compute", as: "duration", fn: "minutesBetween", a: "started_at", b: "completed_at" },
    { op: "group", by: [{ field: "started_at", bucket: "month" }], sum: ["duration"] }];
  // Seen on production: a template name picked after the group, and a step nothing reads.
  const bad = await validateDefinition({ kind: "recipe", steps: [sess, { id: "notes", view: "my_study_notes" }],
    then: [...tail, { op: "sort", by: "field_bucket" }, { op: "pick", fields: ["field_bucket", "sum_duration"] }] }, {});
  assert.ok(bad.errors.some((e) => /field_bucket isn't a field/.test(e)), bad.errors.join("; "));
  assert.ok(bad.errors.some((e) => /step notes is never used/.test(e)), bad.errors.join("; "));
  const good = await validateDefinition({ kind: "recipe", steps: [sess],
    then: [...tail, { op: "sort", by: "started_at_month" }, { op: "pick", fields: ["started_at_month", "sum_duration"] }] }, {});
  assert.deepEqual(good.errors, []);
  // The builder prompt's own examples stay valid.
  const spec = await validateDefinition({ kind: "spec", from: "my_past_questions", where: [{ field: "created_at", op: "within", value: "1y" }], group: { by: ["subject"], sum: ["attempted", "correct"] }, compute: [], sort: [{ by: "sum_attempted", dir: "desc" }] }, {});
  assert.deepEqual(spec.errors, []);
  const recipe = await validateDefinition({ kind: "recipe", steps: [{ id: "weak", view: "my_weak_topics", where: [{ field: "confidence", op: "lt", value: 0.5 }] }, { id: "pq", view: "my_past_questions" }],
    then: [{ op: "from", ref: "pq" }, { op: "group", by: ["subject"], sum: ["attempted", "correct"] }, { op: "compute", as: "accuracy", fn: "divide", a: "sum_correct", b: "sum_attempted" }, { op: "filter", where: [{ field: "accuracy", op: "lt", value: "$maxAccuracy" }] }, { op: "save", as: "acc" },
      { op: "from", ref: "weak" }, { op: "join", right: "acc", on: ["subject"] }, { op: "sort", by: "confidence", dir: "asc" }, { op: "pick", fields: ["subject", "topic", "confidence", "accuracy"] }] }, { maxAccuracy: { type: "number" } });
  assert.deepEqual(recipe.errors, []);
});

test("calendar filters: year and month", () => {
  const y = new Date().getUTCFullYear();
  const rows = [{ t: `${y}-03-04T10:00:00Z` }, { t: `${y - 1}-03-04T10:00:00Z` }, { t: null }];
  assert.equal(O.filter(rows, [{ field: "t", op: "year", value: "this" }]).length, 1);
  assert.equal(O.filter(rows, [{ field: "t", op: "year", value: y - 1 }]).length, 1);
  assert.equal(O.filter(rows, [{ field: "t", op: "month", value: `${y}-03` }]).length, 1);
});

test("types and keys: no sums of timestamps, join keys must exist, params are whole values", async () => {
  const sess = { id: "sessions", view: "my_learning_sessions" };
  const sumTimes = await validateDefinition({ kind: "recipe", steps: [sess], then: [{ op: "group", by: [{ field: "started_at", bucket: "month" }], sum: ["completed_at"] }] }, {});
  assert.ok(sumTimes.errors.some((e) => /completed_at is a timestamp, not a number/.test(e)), sumTimes.errors.join("; "));
  const badJoin = await validateDefinition({ kind: "recipe", steps: [sess, { id: "pq", view: "my_past_questions" }],
    then: [{ op: "from", ref: "sessions" }, { op: "join", right: "pq", on: ["started_at_month"] }] }, {});
  assert.ok(badJoin.errors.some((e) => /join key started_at_month/.test(e)), badJoin.errors.join("; "));
  const mixed = await validateDefinition({ kind: "spec", from: "my_learning_sessions", where: [{ field: "started_at", op: "month", value: "$year-$month" }] },
    { year: { type: "integer" }, month: { type: "integer" } });
  assert.ok(mixed.errors.some((e) => /whole value/.test(e)), mixed.errors.join("; "));
  const opObj = await validateDefinition({ kind: "spec", from: "my_learning_sessions", where: [{ field: "started_at", op: { year: "this" } }] }, {});
  assert.ok(opObj.errors.some((e) => /\{"year":"this"\}/.test(e)), opObj.errors.join("; "));
});

test("a filter on an optional param that wasn't given is skipped", () => {
  const def = { kind: "recipe", steps: [{ id: "s", view: "my_learning_sessions", where: [{ field: "started_at", op: "year", value: "$year" }] }],
    then: [{ op: "filter", where: [{ field: "started_at_month", op: "eq", value: "$month" }] }] };
  const out = dropUnsetFilters(def, { year: 2026 });
  assert.equal(out.steps[0].where.length, 1);
  assert.equal(out.then[0].where.length, 0);
});

test("value shapes seen on production are rejected with a hint", async () => {
  const v = await validateDefinition({ kind: "spec", from: "my_learning_sessions",
    where: [{ field: "started_at", op: "within", value: { op: "year", value: "this" } }, { field: "completed_at", op: "isNull", value: false }],
    compute: [{ as: "h", fn: "divide", a: { fn: "minutesBetween", a: "started_at", b: "completed_at" }, b: 60 }] }, {});
  const all = v.errors.join("; ");
  assert.match(all, /within needs a duration/);
  assert.match(all, /isNull takes no value/);
  assert.match(all, /never|nest by adding another compute/);
  const ok = await validateDefinition({ kind: "spec", from: "my_learning_sessions",
    where: [{ field: "started_at", op: "year", value: "this" }, { field: "completed_at", op: "notNull" }],
    compute: [{ as: "minutes", fn: "minutesBetween", a: "started_at", b: "completed_at" }, { as: "hours", fn: "divide", a: "minutes", b: 60 }],
    group: { by: [{ field: "started_at", bucket: "month" }], sum: ["hours"] }, sort: [{ by: "started_at_month" }] }, {});
  assert.deepEqual(ok.errors, []);
});

test("params that carry data are dropped, simple ones kept", async () => {
  const { wellFormedParams } = await import("./bind.js");
  const r = wellFormedParams({ year: { type: "integer", default: 2026 }, sessions: [{ session_duration: 60 }], blob: { nested: { type: "x" } } });
  assert.deepEqual(Object.keys(r.params), ["year"]);
  assert.deepEqual(r.dropped, ["sessions", "blob"]);
});

test("resolveTotal: an aggregate count row totals its count, not the row count", async () => {
  const { resolveTotal } = await import("./interpreters.js");
  assert.equal(resolveTotal([{ kind: "upload", count: 12 }]), 12);
  assert.equal(resolveTotal([{ subject: "Math", count: 3 }, { subject: "Bio", count: 2 }]), 5);
  // Per-record rows (no count field) → row count.
  assert.equal(resolveTotal([{ title: "a" }, { title: "b" }]), 2);
  // A known matched count always wins (spec runs / group-by must use records).
  assert.equal(resolveTotal([{ subject: "Math", count: 3 }], 51), 51);
});

test("ops: group percentOf derives part and whole from the same rows", () => {
  const goals = [{ status: "achieved" }, { status: "active" }, { status: "active" }];
  const [g] = O.group(goals, { by: [], count: true, percentOf: [{ field: "status", is: "achieved", as: "completed_pct" }] });
  assert.deepEqual([g.count, g.completed_pct_count, g.completed_pct_total, g.completed_pct], [3, 1, 3, 33.3]);
  const all = O.group(goals, { by: [], percentOf: [{ field: "status", is: "active", as: "active_pct" }] });
  assert.equal(all[0].active_pct, 66.7);
  // per-group: each group's percentage is of ITS OWN rows
  const mixed = [
    { subject: "Maths", status: "achieved" }, { subject: "Maths", status: "active" },
    { subject: "Science", status: "achieved" }, { subject: "Science", status: "achieved" },
  ];
  const bySubject = O.group(mixed, { by: ["subject"], percentOf: [{ field: "status", is: "achieved", as: "done_pct" }] });
  assert.equal(bySubject.find((x) => x.subject === "Maths").done_pct, 50);
  assert.equal(bySubject.find((x) => x.subject === "Science").done_pct, 100);
});

test("validation accepts percentOf on a real field and rejects a bad one", async () => {
  const ok = await validateDefinition({ kind: "spec", from: "my_goals",
    group: { by: [], count: true, percentOf: [{ field: "status", is: "achieved", as: "completed_pct" }] },
    select: ["completed_pct_count", "count", "completed_pct"] }, {});
  assert.equal(ok.ok, true, ok.errors.join("; "));
  const badField = await validateDefinition({ kind: "spec", from: "my_goals",
    group: { by: [], percentOf: [{ field: "nope", is: "x", as: "p" }] } }, {});
  assert.equal(badField.ok, false);
  assert.ok(badField.errors.some((e) => /percentOf field/.test(e)), badField.errors.join("; "));
  const badShape = await validateDefinition({ kind: "recipe", steps: [{ id: "a", view: "my_goals" }],
    then: [{ op: "from", ref: "a" }, { op: "group", by: [], percentOf: [{ field: "status" }] }] }, {});
  assert.equal(badShape.ok, false);
  assert.ok(badShape.errors.some((e) => /percentOf needs/.test(e)), badShape.errors.join("; "));
});

test("on a WRITE recipe, an unset identity filter is kept as match-nothing, not dropped", () => {
  // Live, 2026-11-18: a delete-by-title tool run with NO title proposed
  // the learner's only chat, because the unset $title filter was
  // dropped and the write inherited every row.
  const def = { kind: "recipe", steps: [{ id: "s", view: "my_chats", where: [{ field: "title", op: "contains", value: "$title" }] }],
    then: [{ op: "from", ref: "s" }, { op: "write", cap: "chats.delete" }] };
  const out = dropUnsetFilters(def, {}, { write: true });
  assert.equal(out.steps[0].where.length, 1);
  assert.equal(out.steps[0].where[0].__unset, true);
  // Same def, param provided: untouched.
  const given = dropUnsetFilters(def, { title: "Basic" }, { write: true });
  assert.equal(given.steps[0].where[0].__unset, undefined);
  // Same def as a READ (no write flag): the filter is dropped, as before.
  const read = dropUnsetFilters(def, {});
  assert.equal(read.steps[0].where.length, 0);
});

test("on a WRITE recipe, an unset CONDITION filter (status) is still dropped", () => {
  const def = { kind: "recipe", steps: [{ id: "s", view: "my_chats", where: [{ field: "status", op: "eq", value: "$status" }] }],
    then: [{ op: "from", ref: "s" }, { op: "write", cap: "chats.delete" }] };
  const out = dropUnsetFilters(def, {}, { write: true });
  assert.equal(out.steps[0].where.length, 0);
});
