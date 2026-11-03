/**
 * Grand Plan Phase 18, items 3 and 6, in the shared workflow runtime (stub
 * agents, no model): the loop guard's two thresholds, per-tool time limits
 * ending in a `timeout` observation, and asked-or-inferred — an inferred
 * change with no rule is refused by the harness, and every decision records
 * its basis.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runAgentLoop } from "./loop.js";
import { bindRegistry } from "./tools.js";
import { canonicalArgs, createLoopGuard, repeatReminder, LOOP_GUARD } from "./loopGuard.js";
import { TOOL_TIME_LIMITS_MS, ToolTimeout, timeLimitFor, withToolTimeLimit } from "./toolTime.js";
import { NO_RULE_CODE, RULES, actionBasis, basisColumns, basisOfRow, basisRefusal, currentActionBasis, withActionBasis } from "./actionBasis.js";
import { classifyError } from "../agent-contract/contract.js";

const script = (steps) => { let i = 0; return { async next() { const s = steps[Math.min(i++, steps.length - 1)]; return typeof s === "function" ? s() : s; } }; };
const recorder = () => { const log = []; return { log, record: async (e) => { log.push(e); } }; };
const caps = { maxIterations: 6, maxToolCalls: 20, decisionTimeoutMs: 1_000 };

function registry({ basis = { basis: "inferred", rule: "workflow:toy" }, handlers = {}, definitions = null } = {}) {
  const calls = [];
  return {
    calls,
    registry: bindRegistry({
      definitions: definitions || [
        { name: "status.read", level: "read", description: "Read the status" },
        { name: "plan.make", level: "propose", description: "Make a plan" },
        { name: "slow.read", level: "read", description: "A read that hangs", timeLimitMs: 30 },
      ],
      handlers: {
        "status.read": async () => { calls.push("status.read"); return { status: "running" }; },
        "plan.make": async () => { calls.push("plan.make"); return { planned: true }; },
        "slow.read": () => { calls.push("slow.read"); return new Promise(() => {}); },
        ...handlers,
      },
      basis,
    }),
  };
}

/* ── item 3: the loop guard ─────────────────────────────────────────────── */

test("loop guard: canonical arguments ignore key order, spacing and private keys", () => {
  assert.equal(canonicalArgs({ b: 1, a: " x " }), canonicalArgs({ a: "x", b: 1 }));
  assert.equal(canonicalArgs({ a: 1, __agreed: true }), canonicalArgs({ a: 1 }));
  assert.notEqual(canonicalArgs({ a: 1 }), canonicalArgs({ a: 2 }));
  assert.equal(canonicalArgs(null), "{}");
});

test("loop guard: nothing on the first call, a reminder on the 2nd and 3rd, a firm one from the 4th; a different call resets", () => {
  assert.deepEqual([LOOP_GUARD.reminderAt, LOOP_GUARD.firmAt], [2, 4]);
  const guard = createLoopGuard();
  assert.equal(guard.note("get_running_work", {}), null);
  const second = guard.note("get_running_work", {});
  assert.equal(second.level, "reminder");
  assert.match(second.text, /change your approach|finish/i);
  assert.equal(guard.note("get_running_work", {}).level, "reminder");
  const fourth = guard.note("get_running_work", {});
  assert.equal(fourth.level, "firm");
  assert.match(fourth.text, /get_running_work has now been called 4 times in a row/);
  assert.match(fourth.text, /\(\{\}\)/, "the arguments are shown");
  assert.equal(guard.note("get_running_work", { subject: "Biology" }), null, "different arguments: a new run");
  assert.equal(guard.note("check_progress", { subject: "Biology" }), null);
  // The argument preview is capped.
  const long = repeatReminder("search", { query: "x".repeat(500) }, 5);
  assert.ok(long.text.length < 500, long.text.length);
  assert.match(long.text, /…\)/);
});

test("the workflow loop puts the reminder on the repeated call's observation", async () => {
  const { registry: reg } = registry();
  const out = await runAgentLoop({ agent: script([{ tool: "status.read", args: { topic: "cells" }, intent: "check" }]), registry: reg, goal: "g", caps: { ...caps, maxIterations: 4 } });
  const reminders = out.observations.map((o) => o.reminder || null);
  assert.equal(reminders[0], null);
  assert.match(reminders[1], /same arguments/);
  assert.match(reminders[2], /same arguments/);
  assert.match(reminders[3], /status\.read has now been called 4 times in a row/);
  // The observation itself is unchanged otherwise.
  assert.equal(out.observations[3].ok, true);
  assert.equal(out.observations[3].result.status, "running");
});

test("the model is told about the latest reminder on its own line (the list may be cut)", () => {
  const src = readFileSync(new URL("./llm-agent.js", import.meta.url), "utf8");
  assert.match(src, /observations\[observations\.length - 1\]\?\.reminder/);
  assert.match(src, /About your last call: \$\{reminder\}/);
});

/* ── item 3: per-tool time limits ────────────────────────────────────────── */

test("every tool has a time limit: its own, else its family's", () => {
  assert.equal(timeLimitFor({ level: "read" }), TOOL_TIME_LIMITS_MS.read);
  assert.equal(timeLimitFor({ level: "execute" }), TOOL_TIME_LIMITS_MS.execute);
  assert.equal(timeLimitFor({ level: "read", timeLimitMs: 30 }), 30);
  assert.ok(timeLimitFor({ level: "unknown" }) > 0);
  const { registry: reg } = registry();
  assert.equal(reg.timeLimitFor("slow.read"), 30);
  assert.equal(reg.timeLimitFor("plan.make"), TOOL_TIME_LIMITS_MS.propose);
});

test("withToolTimeLimit: a stuck call throws ToolTimeout (code timeout); a quick one returns", async () => {
  assert.equal(await withToolTimeLimit(async () => 7, 50, "quick"), 7);
  const err = await withToolTimeLimit(() => new Promise(() => {}), 20, "stuck").catch((e) => e);
  assert.ok(err instanceof ToolTimeout);
  assert.equal(err.code, "timeout");
  assert.match(err.message, /stuck did not finish within 0 s \(timed out\)/);
  assert.doesNotMatch(err.message, /timed out before/, "a change may have run: never says it didn't");
});

test("a call past its limit becomes a `timeout` observation and the step goes on", async () => {
  const { registry: reg, calls } = registry();
  const started = Date.now();
  const out = await runAgentLoop({
    agent: script([{ tool: "slow.read", args: {} }, { tool: "plan.make", args: {} }]), registry: reg, goal: "g",
    caps: { ...caps, maxIterations: 3 }, terminalActions: ["plan.make"],
  });
  assert.ok(Date.now() - started < 1_000, "never stalls");
  assert.equal(out.observations[0].ok, false);
  assert.equal(out.observations[0].code, "timeout");
  assert.equal(out.observations[0].error_code, "timeout");
  assert.equal(classifyError({ code: "timeout" }).retryable, true);
  assert.equal(out.ended, "terminal");
  assert.deepEqual(calls, ["slow.read", "plan.make"]);
});

/* ── item 6: asked or inferred ──────────────────────────────────────────── */

test("actionBasis: two values, an unknown one reads as inferred, a rule is trimmed", () => {
  assert.deepEqual(actionBasis("explicit"), { basis: "explicit", rule: null });
  assert.deepEqual(actionBasis({ basis: "inferred", rule: "  proactive:task " }), { basis: "inferred", rule: "proactive:task" });
  assert.deepEqual(actionBasis({ basis: "whatever", rule: "" }), { basis: "inferred", rule: null });
  assert.equal(actionBasis(null), null);
  assert.deepEqual(actionBasis(null, { basis: "explicit" }), { basis: "explicit", rule: null });
  assert.equal(RULES.proactive("study_plan"), "proactive:study_plan");
  assert.equal(RULES.workflow("study_prep"), "workflow:study_prep");
});

test("basisRefusal: an inferred change with no rule is refused; explicit, ruled and reads pass", () => {
  assert.equal(basisRefusal({ basis: "explicit", rule: null }), null);
  assert.equal(basisRefusal({ basis: "inferred", rule: "consent:autonomy" }), null);
  assert.equal(basisRefusal({ basis: "inferred", rule: null }, { sideEffecting: false }), null);
  const refused = basisRefusal({ basis: "inferred", rule: null }, { action: "create_task" });
  assert.equal(refused.code, NO_RULE_CODE);
  assert.match(refused.message, /^create_task: nobody asked/);
  assert.equal(classifyError({ code: NO_RULE_CODE }).code, "not_allowed", "the agent stops, never routes around it");
});

test("rows carry the basis: columns in, API fields out", () => {
  assert.deepEqual(basisColumns({ basis: "inferred", rule: "proactive:goal" }), { basis: "inferred", basis_rule: "proactive:goal" });
  assert.deepEqual(basisColumns("explicit"), { basis: "explicit", basis_rule: null });
  assert.deepEqual(basisOfRow({ basis: "inferred", basis_rule: "workflow:x" }), { basis: "inferred", rule: "workflow:x" });
  assert.deepEqual(basisOfRow({}), { basis: null, rule: null });
  assert.deepEqual(basisOfRow({}, { basis: "explicit" }), { basis: "explicit", rule: null });
});

test("the basis travels with the work (nested calls inherit it)", async () => {
  assert.equal(currentActionBasis(), null);
  await withActionBasis({ basis: "inferred", rule: "approved_request:1" }, async () => {
    await Promise.resolve();
    assert.deepEqual(currentActionBasis(), { basis: "inferred", rule: "approved_request:1" });
    await withActionBasis("explicit", async () => assert.equal(currentActionBasis().basis, "explicit"));
    assert.equal(currentActionBasis().basis, "inferred");
  });
  assert.equal(currentActionBasis(), null);
});

test("the harness refuses an inferred change with no rule — as an observation, and the handler never runs", async () => {
  const { registry: reg, calls } = registry({ basis: null });
  assert.deepEqual(reg.validate("status.read", {}), { ok: true }, "reads need no rule");
  const verdict = reg.validate("plan.make", {});
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, NO_RULE_CODE);
  await assert.rejects(reg.execute("plan.make", {}), (e) => e.code === NO_RULE_CODE, "execute checks again");
  const out = await runAgentLoop({ agent: script([{ tool: "plan.make", args: {} }]), registry: reg, goal: "g", caps: { ...caps, maxIterations: 1 }, terminalActions: ["plan.make"] });
  assert.equal(out.observations[0].code, NO_RULE_CODE);
  assert.equal(out.observations[0].error_code, "not_allowed");
  assert.deepEqual(calls, []);
});

test("with the workflow's rule the change runs, and each decision records its basis", async () => {
  const { registry: reg, calls } = registry({ basis: { basis: "inferred", rule: "workflow:toy" } });
  const { log, record } = recorder();
  const out = await runAgentLoop({ agent: script([{ tool: "plan.make", args: {} }]), registry: reg, goal: "g", caps, terminalActions: ["plan.make"], record });
  assert.equal(out.ended, "terminal");
  assert.deepEqual(calls, ["plan.make"]);
  assert.deepEqual(log.find((e) => e.kind === "decision").basis, { basis: "inferred", rule: "workflow:toy" });
});

test("Study Prep's registry names its workflow policy; its events carry the basis", () => {
  const reg = readFileSync(new URL("../adaptive-learning/tools/registry.js", import.meta.url), "utf8");
  assert.match(reg, /basis: \{ basis: "inferred", rule: RULES\.workflow\("study_prep"\) \}/);
  const loop = readFileSync(new URL("../adaptive-learning/study-prep/agent-loop.js", import.meta.url), "utf8");
  assert.match(loop, /entry\.basis \? \{ basis: entry\.basis\.basis, rule: entry\.basis\.rule \} : \{\}/);
});
