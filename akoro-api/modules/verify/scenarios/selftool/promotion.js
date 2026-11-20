// Self-tooling promotion: the gate check and promoting a learner's tool to everyone.
import { needCreate } from "./shared.js";

export const DEFAULT_PROMOTION_TESTERS = ["@tester01", "@tester21", "@tester41"];

export async function runPromotionCheck(ctx, p) {
    if (!p.toolId) ctx.expect.blocked("pass { toolId }");
    const t = (await ctx.db.rows("edu.agent_tools", { id: p.toolId }, { columns: "id, scope, audience, status, definition, params_schema, capabilities, views, verification", limit: 1 }))[0];
    if (!t) ctx.expect.blocked("no such tool");
    const { validateDefinition, runDefinition } = await import("../../../self-tooling/index.js");
    const { coerceInput } = await import("../../../self-tooling/index.js");
    const { capabilityStatus } = await import("../../../self-tooling/index.js");
    const { CAPABILITIES } = await import("../../../self-tooling/index.js");
    const { LIMITS } = await import("../../../self-tooling/index.js");
    const { selfToolDeps } = await import("../../../adaptive-learning/index.js");
    const { runDry } = await import("../../../../lib/dryRunContext.js");

    const audience = t.audience || "learner";
    const role = audience === "instructor" ? "instructor" : "student";
    const { learnerGrantable } = await import("../../../self-tooling/index.js");
    const v = await validateDefinition(structuredClone(t.definition), t.params_schema, { audience });
    // Not yet on for everyone is expected for an own-data change: the promotion turns it on.
    const errs = v.errors.filter((e) => !(/capability (\S+) needs approval/.test(e) && learnerGrantable(e.match(/capability (\S+) needs approval/)[1])));
    ctx.expect.ok("definition validates", !errs.length, errs);
    for (const c of t.capabilities || []) {
      // A change to each learner's own rows is turned on for everyone by the promotion itself.
      if (learnerGrantable(c)) { ctx.note(`${c}: a change to each learner's own rows — promotion turns it on for everyone; each change waits for their Confirm`); continue; }
      ctx.expect.eq(`capability ${c} is on`, await capabilityStatus(c), "enabled");
      ctx.expect.eq(`capability ${c} only reads`, CAPABILITIES[c]?.kind, "read");
    }
    const samples = (Array.isArray(t.verification?.samples) && t.verification.samples.length ? t.verification.samples : [{}]).slice(0, 3);
    const testers = [].concat(p.testers || DEFAULT_PROMOTION_TESTERS).slice(0, 3);
    let withRows = 0;
    for (const handle of testers) {
      const acct = await ctx.as(handle);
      if (!acct.tester) ctx.expect.blocked(`${handle} isn't a test account`);
      if ((acct.role === "instructor") !== (audience === "instructor")) ctx.expect.blocked(`${handle} is a ${acct.role} — this is a${audience === "instructor" ? "n instructor" : " learner"} tool`);
      let any = false;
      for (const [i, s] of samples.entries()) {
        const t0 = Date.now();
        let out = null, err = null;
        // Read-only, and dry anyway: nothing a capability step calls can change data.
        try { out = await runDry(() => runDefinition(structuredClone(t.definition), coerceInput(t.params_schema, s), { learnerId: acct.id, callCapability: selfToolDeps(acct.id, role).callCapability })); }
        catch (e) { err = e.message; }
        const ms = Date.now() - t0;
        ctx.expect.ok(`${acct.username} sample ${i + 1} runs`, !err && Array.isArray(out?.rows), err);
        ctx.expect.lte(`${acct.username} sample ${i + 1} time (ms)`, ms, LIMITS.runMs * 2);
        if (out?.rows?.length) any = true;
      }
      if (any) withRows++;
      ctx.note(`${acct.username}: ${any ? "returned rows" : "no rows"}`);
    }
    ctx.expect.gte("returns data for at least one test learner", withRows, 1);
}

export async function runPromotePlatform(ctx, p) {
    await needCreate(ctx);
    const me = await ctx.as(p.learner);
    const other = await ctx.as(p.other);
    const tag = ctx.marker.slice(8, 16).replace(/[^a-z0-9]/g, "x");
    const name = `verify_src_${tag}`, platformName = `verify_pub_${tag}`;
    ctx.cleanup(async () => {
      // The platform copy has no owner, so deleteOwned can't reach it: remove exactly
      // the row this run made (gate label, promoted from this run's tool).
      const { default: db } = await import("../../../../db.js");
      const { error } = await db.schema("edu").from("agent_tools").delete().eq("scope", "platform").eq("name", platformName).like("label", "[verify:%");
      if (error) throw new Error(`platform tool cleanup failed: ${error.message}`);
    });

    const r = await ctx.agent.tool({ as: p.learner, tool: "create_tool", mode: "live", input: {
      goal: "How many tasks I have by status", name, label: `${ctx.marker} Tasks by status`, hint: { views: ["my_tasks"] } } });
    // create_tool may save under a canonical domain name (r.tool) instead of the
    // requested name — promote the row it actually created.
    ctx.expect.ok("source tool created (or reused)", r?.status === "created" || r?.status === "reused", r);
    if (r?.status !== "created" && r?.status !== "reused") return;
    const srcName = r.tool || name;
    ctx.cleanup(() => ctx.db.deleteOwned("edu.agent_tools", { ownerColumn: "owner_id", ownerId: me.id, filters: { name: srcName } }));
    const src = (await ctx.db.rows("edu.agent_tools", { owner_id: me.id, name: srcName }, { columns: "id", limit: 1 }))[0];
    if (!src) return;

    const { promoteTool, setToolStatus } = await import("../../../self-tooling/index.js");
    const { startRun } = await import("../../runner.js");
    const { selfToolDeps } = await import("../../../adaptive-learning/index.js");
    const gateAdmin = { id: null, label: "verification gate" };
    let promoted = null, err = null;
    try {
      promoted = await promoteTool({ id: src.id, name: platformName, label: `${ctx.marker} Tasks by status (everyone)`, admin: gateAdmin, builtIn: selfToolDeps(null).builtIn,
        runGate: (toolId) => startRun({ scenario: "selftool.promotion_check", params: { toolId }, actor: "verify", nested: true }).done });
    } catch (e) { err = e; }
    ctx.expect.ok("promotion check passed and the tool was promoted", !!promoted?.tool?.id, err ? `${err.message} (run ${err.runId || "-"})` : promoted);
    if (!promoted) return;
    ctx.note(`promotion check run ${promoted.runId}`);
    const row = (await ctx.db.rows("edu.agent_tools", { id: promoted.tool.id }, { columns: "scope, owner_id, promoted_from, status, verification", limit: 1 }))[0];
    ctx.expect.ok("platform row: no owner, promoted from the source, carries the check", row?.scope === "platform" && row?.owner_id === null && row?.promoted_from === src.id && row?.verification?.promotion?.verdict === "PASS", row);

    // Another learner sees it in their catalogue and runs it on their own tasks.
    const { learnerToolDefs } = await import("../../../self-tooling/index.js");
    const defs = await learnerToolDefs(other.id);
    ctx.expect.ok("in another learner's catalogue", defs.some((d) => d.function?.name === platformName), defs.map((d) => d.function?.name));
    const out = await ctx.agent.tool({ as: p.other, tool: platformName, learnerTool: true, mode: "live", input: {} });
    ctx.expect.ok("runs for the other learner", Array.isArray(out?.rows), out?.error);
    const theirTasks = await ctx.db.count("tasks", { creator_id: other.id });
    const counted = (out?.rows || []).reduce((n, x) => n + (Number(x.count) || 0), 0);
    if ((out?.rows || []).some((x) => "count" in x)) ctx.expect.eq("counts the other learner's own tasks", counted, theirTasks);
    else ctx.note(`rows: ${JSON.stringify(out?.rows || []).slice(0, 200)} (no count column to compare)`);

    // Revoke: off for everyone at once.
    await setToolStatus({ id: promoted.tool.id, status: "revoked", admin: gateAdmin });
    const after = await ctx.agent.tool({ as: p.other, tool: platformName, learnerTool: true, mode: "live", input: {} });
    ctx.expect.ok("revoked platform tool stops", !after?.rows, after);
}
