/**
 * Phase 18 (attention and agent hygiene), items 3 and 6, on a live server.
 *
 * agent.loop_guard_time_limits — the deployed runtime: the same call again
 *   in a row gets a reminder (2nd) and a firm one naming the tool and the
 *   count (4th); a tool past its time limit comes back as a `timeout`
 *   observation within the limit, not a stalled step; every Agent Chat tool
 *   has a limit, and a real read tool still answers within its own.
 * agent.action_basis — asked or inferred: the four tables carry the basis
 *   columns; an inferred change with no rule is refused for a test learner
 *   (nothing runs, dry anyway); with a rule, or asked, it goes through (dry);
 *   the self-tooling audit and the V4 approvals answer with the basis.
 *
 * Neither writes anything: no model is called, every tool call is dry.
 */
export const loopGuardTimeLimits = {
  name: "agent.loop_guard_time_limits", area: "agent", risk: "read", timeoutMs: 60_000,
  description: "Phase 18 item 3: the same tool with the same arguments in a row → a reminder on the 2nd call and a firm one (tool, count, arguments) on the 4th; a tool past its time limit → a `timeout` observation the recovery rule retries once for a read, never a stalled step; every Agent Chat tool has a limit and a real read answers within it.",
  params: { learner: { default: "@tester20" } },
  async run(ctx, p) {
    const { runAgentLoop } = await import("../../agent-runtime/index.js");
    const { bindRegistry } = await import("../../agent-runtime/index.js");
    const registry = bindRegistry({
      definitions: [
        { name: "status.read", level: "read", description: "status" },
        { name: "stuck.read", level: "read", description: "never answers", timeLimitMs: 300 },
        { name: "plan.make", level: "propose", description: "plan" },
      ],
      handlers: { "status.read": async () => ({ status: "running" }), "stuck.read": () => new Promise(() => {}), "plan.make": async () => ({ planned: true }) },
      basis: { basis: "inferred", rule: "workflow:gate" },
    });
    const repeat = { async next() { return { tool: "status.read", args: { topic: "cells" }, intent: "check again" }; } };
    const looped = await runAgentLoop({ agent: repeat, registry, goal: "gate", caps: { maxIterations: 4, maxToolCalls: 10, decisionTimeoutMs: 5_000 } });
    const reminders = looped.observations.map((o) => o.reminder || null);
    ctx.note(`reminders: ${JSON.stringify(reminders.map((r) => (r ? r.slice(0, 60) : null)))}`);
    ctx.expect.eq("1st call: no reminder", reminders[0], null);
    ctx.expect.ok("2nd identical call: a reminder to change approach or finish", /same arguments/.test(reminders[1] || ""), reminders[1]);
    ctx.expect.ok("4th: a firm one naming the tool and the count", /status\.read has now been called 4 times in a row/.test(reminders[3] || ""), reminders[3]);

    let n = 0;
    const timed = { async next() { n += 1; return n === 1 ? { tool: "stuck.read", args: {} } : { tool: "plan.make", args: {} }; } };
    const t0 = Date.now();
    const out = await runAgentLoop({ agent: timed, registry, goal: "gate", caps: { maxIterations: 3, maxToolCalls: 10, decisionTimeoutMs: 5_000 }, terminalActions: ["plan.make"] });
    const ms = Date.now() - t0;
    ctx.expect.eq("a stuck tool comes back as `timeout`", out.observations[0]?.error_code, "timeout");
    ctx.expect.ok("…within its limit, not a stalled step", ms < 3_000, `${ms} ms`);
    ctx.expect.eq("…and the step goes on to its terminal action", out.ended, "terminal");

    const chat = await import("../../adaptive-learning/chat.js");
    const { chatToolTimeLimit, runWithinLimit } = await import("../../adaptive-learning/chat/toolLimits.js");
    const { shouldRetry } = await import("../../adaptive-learning/chat/toolRecovery.js");
    const missing = chat.getLearnerChatTools().filter((t) => !(chatToolTimeLimit(t.name, { sideEffecting: chat.isSideEffecting(t.name, {}) }) > 0)).map((t) => t.name);
    ctx.expect.eq("every Agent Chat tool has a time limit", missing, []);
    const stuck = await runWithinLimit(() => new Promise(() => {}), "get_running_work", { limitMs: 200 });
    ctx.expect.eq("a chat tool past its limit → code timeout", stuck.code, "timeout");
    ctx.expect.eq("…a read is retried once (the recovery rule)", shouldRetry("get_running_work", stuck), true);
    ctx.expect.eq("…a change is not", shouldRetry("create_task", { ...stuck, error: "create_task did not finish within 90 s (timed out)." }, { sideEffecting: true }), false);
    const real = await ctx.agent.tool({ as: p.learner, tool: "get_running_work" });
    ctx.expect.ok("a real read still answers within its limit", real && real.code !== "timeout" && !real.threw, real);
  },
};

export const actionBasis = {
  name: "agent.action_basis", area: "agent", risk: "read", timeoutMs: 60_000,
  description: "Phase 18 item 6: the basis columns exist on the self-tooling audit, change cards, proposals and V4 approvals; an inferred change with no rule is refused (no_rule_for_inferred_action) and never runs; with a rule, or when the learner asked, it goes through (dry); the audit and the V4 list answer with basis + rule.",
  params: { learner: { default: "@tester20" } },
  async run(ctx, p) {
    for (const t of ["edu.self_tool_events", "edu.agent_tool_write_confirmations", "edu.agent_proposals", "edu.verify_real_user_runs"]) {
      const probe = await ctx.db.probe(t, "basis, basis_rule");
      if (!probe.ok) ctx.expect.blocked(`${t} has no basis columns yet (migration 2026-agent-action-basis.sql): ${probe.error}`);
    }
    const me = await ctx.as(p.learner);
    const chat = await import("../../adaptive-learning/chat.js");
    const { runDry } = await import("../../../lib/dryRunContext.js");
    const task = { title: `Gate basis check ${Date.now()}` };
    const refused = await runDry(() => chat.executeChatTool("create_task", task, me.id, { role: "student", channel: "verify", basis: "inferred" }));
    ctx.expect.eq("an inferred change with no rule is refused", refused?.code, "no_rule_for_inferred_action");
    ctx.expect.eq("…as a failure the agent reads", refused?.success, false);
    const ruled = await runDry(() => chat.executeChatTool("create_task", task, me.id, { role: "student", channel: "verify", basis: { basis: "inferred", rule: "proactive:task" } }));
    ctx.expect.eq("with a rule it goes through (dry)", ruled?.dryRun, true);
    const asked = await runDry(() => chat.executeChatTool("create_task", task, me.id, { role: "student", channel: "verify" }));
    ctx.expect.eq("asked (the default) goes through (dry)", asked?.dryRun, true);
    const readOnly = await runDry(() => chat.executeChatTool("list_tasks", {}, me.id, { role: "student", channel: "verify", basis: "inferred" }));
    ctx.expect.ok("a read needs no rule", readOnly?.code !== "no_rule_for_inferred_action", readOnly);
    ctx.expect.eq("nothing was created", await ctx.db.count("tasks", { creator_id: me.id, title: task.title }), 0);

    const { auditRows } = await import("../../self-tooling/index.js");
    const rows = await auditRows({ days: 30, limit: 50 });
    ctx.note(`self-tooling audit: ${rows.length} rows in 30 days; with a basis: ${rows.filter((r) => r.basis).length}`);
    ctx.expect.ok("every audit row has the basis fields", rows.every((r) => "basis" in r && "rule" in r), rows.slice(0, 3));
    ctx.expect.ok("an inferred audit row names its rule", rows.every((r) => r.basis !== "inferred" || !!r.rule), rows.filter((r) => r.basis === "inferred" && !r.rule).slice(0, 3));
    const { listRealUserRuns } = await import("../realUser.js");
    const runs = await listRealUserRuns({ limit: 5 });
    ctx.expect.ok("V4 approvals answer with the basis (an admin asked: explicit)", runs.every((r) => r.basis === "explicit"), runs.map((r) => r.basis));
  },
};
