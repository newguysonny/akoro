import test from "node:test";
import assert from "node:assert/strict";
import { DOMAINS, domainForGoal, actionForGoal } from "./domains.js";

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
  const { verifyDomainActions, DOMAINS } = await import("./domains.js");
  const spec = DOMAINS.library_documents;
  // A runner where 'list' regresses; everything else still passes.
  const run = async (_s, sample) => (sample.action === "list" ? { ok: false, error: "boom" } : { ok: true, rows: [] });
  const checks = await verifyDomainActions(spec, run);
  const list = checks.find((c) => c.action === "list");
  assert.equal(list.ok, false);
  assert.equal(list.error, "boom");
  assert.equal(checks.filter((c) => !c.ok).length, 1, "only the regressed action is flagged");
  // All-pass runner → nothing flagged.
  const allOk = await verifyDomainActions(spec, async () => ({ ok: true, rows: [] }));
  assert.equal(allOk.every((c) => c.ok), true);
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
  const spec = { actions: ["count", "list", "by_subject", "by_exam"] };
  const checks = await verifyDomainActions(spec, async () => ({ ok: true, rows: [] }));
  assert.deepEqual(checks.map((c) => c.action), ["count", "list", "by_subject", "by_exam"]);
});
