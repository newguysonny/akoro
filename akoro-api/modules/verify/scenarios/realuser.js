// Phase V4 end to end, on the gate SANDBOX only: an admin-approved write run
// on an account that isn't a test learner (sbxlearner, seeded only in the
// sandbox's demo group). Production never runs this — its accounts are real.

export const realUserRun = {
  name: "verify.real_user_run", area: "platform", risk: "write",
  description: "Sandbox only: the gate key can't write to a non-test account; an admin approval can, exactly once, and the run cleans up, notifies the owner and is audit-logged.",
  params: { account: { default: "@sbxlearner" }, scenario: { default: "tasks.create_due_in_minutes" } },
  async run(ctx, p) {
    const { TARGET } = await import("../policy.js");
    if (TARGET === "production") ctx.expect.blocked("runs on the gate sandbox only — production accounts are real people");
    const [acct] = await ctx.db.rows("users", { username: String(p.account).replace(/^@/, "") }, { columns: "id, username", limit: 1 });
    if (!acct) ctx.expect.blocked(`${p.account} isn't seeded here (2026-seed-sandbox-real-account.sql, demo group)`);
    const { startRun } = await import("../runner.js");
    const { startRealUserRun, claimApproval } = await import("../realUser.js");

    // 1. Without an approval (the gate API's only way in) the write is refused.
    const plain = await startRun({ scenario: p.scenario, params: { learner: acct.id }, actor: "gate-scenario", nested: true }).done;
    ctx.expect.ok("gate key alone can't write to a non-test account", plain.verdict !== "PASS" && /read-only|real users/i.test(plain.reason || ""), `${plain.verdict}: ${plain.reason}`);

    // 2. Refusals: a test account, a check not approved for real accounts.
    const refused = async (args) => { try { await startRealUserRun({ admin: { label: "gate scenario" }, reason: `${ctx.marker} refusal check`, nested: true, ...args }); return null; } catch (e) { return e.message; } };
    ctx.expect.ok("a test account is refused", /test account/i.test((await refused({ account: "@tester06", scenario: p.scenario })) || ""));
    ctx.expect.ok("a check not marked safe is refused", /isn't approved/i.test((await refused({ account: p.account, scenario: "chat.dry_run_no_writes" })) || ""));
    ctx.expect.ok("a missing reason is refused", /say why/i.test((await refused({ account: p.account, scenario: p.scenario, reason: "short" })) || ""));

    // 3. Approved: one pass, cleaned up, owner told, audit-logged, approval spent.
    const out = await startRealUserRun({ admin: { label: "gate scenario" }, account: p.account, scenario: p.scenario, reason: `${ctx.marker} sandbox end-to-end check`, nested: true });
    const row = await out.finished;
    ctx.note(`approval ${row.id} → run ${row.run_id}: ${row.verdict}`);
    ctx.expect.eq("approved run passes", row.verdict, "PASS");
    ctx.expect.eq("nothing left on the account", row.cleanup_ok, true);
    ctx.expect.eq("owner notified in-app", row.notified?.inapp, "sent");
    ctx.expect.ok("email/SMS stay inside the sandbox", /^skipped/.test(row.notified?.email || "") && /^skipped/.test(row.notified?.sms || ""), JSON.stringify(row.notified));
    ctx.expect.eq("owner's notice is on their account", await ctx.db.count("notifications", { user_id: acct.id, related_id: row.id }), 1);
    ctx.expect.gte("admin action audit-logged", await ctx.db.count("admin_audit_log", { action: "verify.real_user_write", entity_id: acct.id }), 1);
    ctx.expect.eq("approval can't be used twice", await claimApproval(row.id), false);
    const [saved] = await ctx.db.rows("edu.verify_real_user_runs", { id: row.id }, { columns: "status, run_id", limit: 1 });
    ctx.expect.eq("approval recorded as done", saved?.status, "done");
  },
};
