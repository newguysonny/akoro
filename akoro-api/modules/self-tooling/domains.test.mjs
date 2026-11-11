import test from "node:test";
import assert from "node:assert/strict";
import { DOMAINS, domainForGoal, actionForGoal } from "./domains.js";
import { asRows } from "./sandbox/index.js";

/** resolveTotal's rule for code tools: sum `count` rows, else row count. */
const totalOf = (rows) => (
  rows.length && rows.every((r) => typeof r?.count === "number" && Number.isFinite(r.count))
    ? rows.reduce((n, r) => n + r.count, 0)
    : rows.length
);

/** Run a domain source in-process (our own trusted script, test only: the
 *  sandbox needs quickjs-emscripten, which CI has but a bare checkout may not). */
const evalRun = (source) => new Function(`${source}\nreturn run;`)();

/** Run a domain spec's real script against fixture data — no LLM. */
const fixtureRun = (spec, data) => async (_s, input) => {
  try {
    const rows = asRows(evalRun(spec.source)(input, data, { today: "2026-01-01", now: "2026-01-01T00:00:00Z", timezone: "Africa/Lagos" }));
    return { ok: true, rows, total: totalOf(rows) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

const LIB_FIXTURE = {
  lib: [
    { name: "Mitochondria notes", kind: "paste", created_at: "2026-01-01" },
    { name: "Cell Structure.pdf", kind: "upload", created_at: "2026-01-02" },
    { name: "BIO 111 notes", kind: "upload", created_at: "2026-01-03" },
  ],
};

test("domainForGoal routes documents first, then subject domains", () => {
  assert.equal(domainForGoal("How many documents are in my library?"), "library_documents");
  assert.equal(domainForGoal("Library count (correct total)"), "library_documents");
  assert.equal(domainForGoal("List my document titles"), "library_documents");
  assert.equal(domainForGoal("Count my study sessions"), "my_study_sessions");
  assert.equal(domainForGoal("WAEC chemistry accuracy"), "my_past_questions");
  assert.equal(domainForGoal("List my study notes"), "my_study_notes");
  // Not a curated domain → let the generic builder handle it.
  assert.equal(domainForGoal("Count my tasks"), null);
  assert.equal(domainForGoal("Set Chemistry tasks to high priority"), null);
});

test("actionForGoal infers the action", () => {
  assert.equal(actionForGoal("how many documents"), "count");
  assert.equal(actionForGoal("list my document titles"), "list");
  assert.equal(actionForGoal("documents by kind"), "by_kind");
  assert.equal(actionForGoal("search for chemistry notes"), "search");
  assert.equal(actionForGoal("sessions by subject"), "by_subject");
});

test("every domain definition is a valid, sandbox-safe code tool", () => {
  for (const [key, d] of Object.entries(DOMAINS)) {
    assert.equal(d.name, key);
    assert.ok(Array.isArray(d.actions) && d.actions.length >= 2, `${key} has actions`);
    assert.deepEqual(d.params.action.enum, d.actions, `${key} enum matches actions`);
    assert.equal(d.definition?.kind || "code", "code");
    // not used; the pipeline assembles { kind, steps, source }
    const src = d.source;
    assert.match(src, /^function run\(input, data, akoro\)/, `${key} exports run()`);
    assert.ok(!src.includes("${"), `${key} source must not use template literals`);
    assert.ok(!/\b(async|await|this|globalThis|eval|Function|require|import)\b/.test(src), `${key} uses no banned syntax`);
  }
});

test("genericDomain builds a per-view action tool (own-data views only)", async () => {
  const { genericDomain } = await import("./domains.js");
  const d = genericDomain("my_courses");
  assert.equal(d?.name, "my_courses");
  assert.deepEqual(d?.params.action.enum, d?.actions);
  assert.ok(d.actions.includes("count") && d.actions.includes("list"));
  assert.ok(d.actions.includes("by_subject"));
  assert.ok(d.source && !d.source.includes("${"));
  assert.equal(genericDomain("does_not_exist"), null);
});

test("genericReadGoal and inferAction", async () => {
  const { genericReadGoal, inferAction } = await import("./domains.js");
  assert.equal(genericReadGoal("List my enrolled courses"), true);
  assert.equal(genericReadGoal("How many XP transactions do I have?"), true);
  assert.equal(genericReadGoal("Total XP I've earned"), false);       // value aggregate → builder
  assert.equal(genericReadGoal("Average accuracy by subject"), false);
  assert.equal(inferAction("courses by subject", ["count", "list", "by_subject"]), "by_subject");
  assert.equal(inferAction("list my courses", ["count", "list", "by_subject"]), "list");
  assert.equal(inferAction("how many courses", ["count", "list", "by_subject"]), "count");
});

test("verifyDomainActions flags a regressed action (would block the save)", async () => {
  const { verifyDomainActions } = await import("./domains.js");
  const spec = DOMAINS.library_documents;
  const good = fixtureRun(spec, LIB_FIXTURE);
  // A runner where 'list' regresses; everything else still passes.
  const run = async (s, sample) => (sample.action === "list" ? { ok: false, error: "boom" } : good(s, sample));
  const checks = await verifyDomainActions(spec, run);
  const list = checks.find((c) => c.action === "list");
  assert.equal(list.ok, false);
  assert.equal(list.error, "boom");
  assert.equal(checks.filter((c) => !c.ok).length, 1, "only the regressed action is flagged");
  // All-pass fixture runner → nothing flagged.
  const allOk = await verifyDomainActions(spec, good);
  assert.deepEqual(allOk.filter((c) => !c.ok), []);
});

test("byActionForGoal maps a requested breakdown to a valid view field", async () => {
  const { byActionForGoal } = await import("./domains.js");
  assert.equal(byActionForGoal("documents by size", "my_library"), "by_size");
  assert.equal(byActionForGoal("past questions by exam", "my_past_questions"), "by_exam");
  assert.equal(byActionForGoal("documents by colour", "my_library"), null); // not a field
  assert.equal(byActionForGoal("list my documents", "my_library"), null);
});

test("verifyDomainActions covers a newly added action", async () => {
  const { verifyDomainActions } = await import("./domains.js");
  const spec = { actions: ["count", "list", "by_subject", "by_exam"], source: DOMAINS.library_documents.source };
  const checks = await verifyDomainActions(spec, fixtureRun(spec, { v: [] }));
  assert.deepEqual(checks.map((c) => c.action), ["count", "list", "by_subject", "by_exam"]);
  assert.equal(checks.every((c) => c.ok), true);
});

test("verifyDomainActions respects the budget (flags actions past it, blocking the save)", async () => {
  const { verifyDomainActions } = await import("./domains.js");
  let t = 0;
  const now = () => (t += 5000);
  const spec = { actions: ["count", "list", "by_subject"], source: DOMAINS.library_documents.source };
  const run = fixtureRun(spec, LIB_FIXTURE);
  const checks = await verifyDomainActions(spec, run, { budgetMs: 6000, now });
  assert.equal(checks[0].ok, true);
  assert.ok(checks.some((c) => c.error === "verification budget exceeded"));
});

test("verifyDomainActions retries a transient sandbox start, not a real failure", async () => {
  const { verifyDomainActions } = await import("./domains.js");
  const spec = DOMAINS.library_documents;
  const good = fixtureRun(spec, LIB_FIXTURE);
  let calls = 0;
  const flaky = async (s, sample) => {
    calls += 1;
    if (sample.action === "by_kind" && calls <= spec.actions.indexOf("by_kind") + 1) {
      return { ok: false, error: "the code ran too long" }; // worker start jitter
    }
    return good(s, sample);
  };
  const checks = await verifyDomainActions(spec, flaky);
  assert.equal(checks.every((c) => c.ok), true, "a transient timeout is retried once");
  const always = await verifyDomainActions(spec, async () => ({ ok: false, error: "the code ran too long" }));
  assert.equal(always.every((c) => !c.ok), true, "a real timeout still blocks the save");
});

test("a truncated breakdown passes (rows are capped, total is full)", async () => {
  const { verifyDomainActions } = await import("./domains.js");
  const spec = DOMAINS.library_documents;
  const run = async (_s, input) => {
    if (input.action === "count") return { ok: true, rows: [{ count: 193 }], total: 193 };
    if (input.action === "by_kind") return { ok: true, rows: [{ kind: "upload", count: 100 }], total: 193, truncated: true };
    if (input.action === "list") return { ok: true, rows: [{ name: "a", kind: "upload" }], total: 1 };
    return { ok: true, rows: [], total: 0 };
  };
  const checks = await verifyDomainActions(spec, run);
  assert.equal(checks.find((c) => c.action === "by_kind").ok, true, "capped output is not called a regression");
});

test("scripted regression: fixtures give exact outputs and a broken action is caught", async () => {
  const { verifyDomainActions, actionContract } = await import("./domains.js");
  const spec = DOMAINS.library_documents;
  const run = fixtureRun(spec, LIB_FIXTURE);

  // Exact, deterministic values from the real script (no LLM):
  assert.deepEqual((await run(spec, { action: "count" })).rows, [{ count: 3 }]);
  assert.deepEqual((await run(spec, { action: "by_kind" })).rows, [
    { kind: "paste", count: 1 }, { kind: "upload", count: 2 },
  ]);
  assert.deepEqual((await run(spec, { action: "search", query: "cell" })).rows, [
    { name: "Cell Structure.pdf", kind: "upload" },
  ]);
  const list = await run(spec, { action: "list" });
  assert.equal(list.rows.length, 3);
  assert.deepEqual(list.rows[1], { name: "Cell Structure.pdf", kind: "upload", added: "2026-01-02" });
  assert.equal((await verifyDomainActions(spec, run)).every((c) => c.ok), true);

  // A count that isn't a number breaks its contract.
  assert.match(actionContract("count", { ok: true, rows: [{ count: "lots" }], total: 1 }), /numeric count/);
  // A breakdown declaring a different total breaks the cross-action check.
  const skewed = async (_s, input) => (input.action === "count"
    ? { ok: true, rows: [{ count: 3 }], total: 3 }
    : input.action === "by_kind"
      ? { ok: true, rows: [{ kind: "upload", count: 2 }], total: 2 }
      : { ok: true, rows: [], total: 0 });
  const bad = await verifyDomainActions(spec, skewed);
  assert.equal(bad.find((c) => c.action === "by_kind").ok, false);
  assert.match(bad.find((c) => c.action === "by_kind").error, /adds up to 2 but count is 3/);
});
