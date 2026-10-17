/**
 * modules/verify/realUser.js — phase V4: one write run on one REAL account,
 * approved by an admin (plan: Verification Gate — Phase V4).
 *
 *   - Only the admin route calls this (modules/admin/verify-real-user.js).
 *     The gate API (/api/verify, the coding agent's key) never passes an
 *     approval, so it can't write to a real account.
 *   - Production: off unless VERIFY_REAL_USER_WRITES=true.
 *   - Only scenarios marked `realUserSafe` (they undo everything they create,
 *     send nothing to other people and spend no coins), one pass, no suites.
 *   - The approval (edu.verify_real_user_runs) is single-use and expires in
 *     15 minutes: claimed approved → running exactly once.
 *   - Afterwards: the account is checked for anything the run left behind,
 *     the account owner is told (in-app, email, SMS), the admin action is
 *     audit-logged, and leftovers are reported to the admin at once.
 */
import db from "../../db.js";
import config from "../../config/index.js";
import { SCENARIOS } from "./scenarios/index.js";
import { startRun } from "./runner.js";
import { resolveAccount, realUserWritesEnabled, PolicyError, TARGET } from "./policy.js";
import { refusal, ownerNotice, firstName, MAX_PER_ACCOUNT_PER_DAY } from "./realUserRules.js";

const edu = () => db.schema("edu");
const TABLE = "verify_real_user_runs";
export const APPROVAL_TTL_MS = 15 * 60 * 1000;

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Scenarios an admin may run on a real account. */
export const realUserScenarios = () => Object.values(SCENARIOS)
  .filter((s) => s.risk === "write" && s.realUserSafe)
  .map((s) => ({ name: s.name, description: s.description, what: s.realUserSafe.what, changes: s.realUserSafe.changes, roles: s.realUserSafe.roles || ["student"] }));

/** approved → running, once, while unexpired. → true if this call claimed it. */
export async function claimApproval(id) {
  const now = new Date().toISOString();
  const { data, error } = await edu().from(TABLE).update({ status: "running", started_at: now })
    .eq("id", id).eq("status", "approved").gt("expires_at", now).select("id").maybeSingle();
  if (error) throw new Error(`couldn't claim the approval: ${error.message}`);
  return !!data;
}

/**
 * Leftovers on the account from this run: rows carrying the run's marker
 * (every row a write scenario creates carries it, see context.js).
 */
async function residueFor(accountId, runId) {
  const like = `[verify:${String(runId).slice(0, 8)}]%`;
  const checks = [
    ["tasks", db.from("tasks").select("id", { count: "exact", head: true }).eq("creator_id", accountId).like("title", like)],
    ["chats", db.from("chat_sessions").select("id", { count: "exact", head: true }).eq("user_id", accountId).like("title", like)],
    ["follow_ups", edu().from("scheduled_chat_follow_ups").select("id", { count: "exact", head: true }).eq("user_id", accountId).like("title", like)],
    ["notifications", db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", accountId).like("title", like)],
  ];
  const out = {};
  for (const [name, q] of checks) {
    const { count, error } = await q;
    out[name] = error ? `unknown (${error.message})` : count ?? 0;
  }
  return out;
}

/** In-app, email, SMS. → { inapp, email, sms } each "sent", "skipped (…)" or "failed (…)". */
async function notifyOwner(account, row, notice) {
  const out = {};
  const { data: user } = await db.from("users").select("email, phone, full_name").eq("id", account.id).maybeSingle();
  const { error } = await db.from("notifications").insert({ user_id: account.id, type: "account_check", title: notice.title, content: notice.body, related_id: row.id });
  out.inapp = error ? `failed (${error.message})` : "sent";
  // Sandbox/local accounts aren't real people: nothing leaves the building.
  if (TARGET !== "production") return { ...out, email: "skipped (sandbox)", sms: "skipped (sandbox)" };
  try {
    if (!user?.email) out.email = "skipped (no email)";
    else {
      const { sendNotificationEmail } = await import("../auth/emails.js");
      await sendNotificationEmail({ to: user.email, name: firstName(user.full_name), subject: notice.title, heading: notice.title, body: notice.body });
      out.email = "sent";
    }
  } catch (e) { out.email = `failed (${String(e.message).slice(0, 120)})`; }
  try {
    const { accountSid, authToken, phoneNumber, countryCode } = config.twilio ?? {};
    if (!user?.phone) out.sms = "skipped (no phone)";
    else if (!accountSid || !authToken || !phoneNumber) out.sms = "skipped (SMS not configured)";
    else {
      const twilio = (await import("twilio")).default;
      const raw = String(user.phone).replace(/\s+/g, "");
      const to = raw.startsWith("+") ? raw : `+${countryCode || "234"}${raw.replace(/^0/, "")}`;
      await twilio(accountSid, authToken).messages.create({ to, from: phoneNumber, body: notice.sms });
      out.sms = "sent";
    }
  } catch (e) { out.sms = `failed (${String(e.message).slice(0, 120)})`; }
  return out;
}

/** Leftovers after a real-account run: the approving admin hears at once (in-app + ops email). */
async function alertAdmin(row, account, residue) {
  const text = `The check "${row.scenario}" on ${account.username} may have left data behind: ${JSON.stringify(residue)}. Run ${row.run_id}.`;
  if (row.admin_id) {
    await db.from("notifications").insert({ user_id: row.admin_id, type: "verify_alert", title: "Real-account check left data behind", content: text, related_id: row.id }).then(() => {}, () => {});
  }
  const to = String(process.env.ALERT_EMAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (to.length && TARGET === "production") {
    try {
      const { sendOpsAlertEmail } = await import("../auth/emails.js");
      await sendOpsAlertEmail({ to, subject: "[Akoro] Real-account check left data behind", title: "Real-account check left data behind", detail: text, kind: "fired", severity: "warning" });
    } catch (e) { console.warn(`[verify] residue alert email failed: ${e.message}`); }
  }
}

/** After the run: verdict, residue, owner notice, audit. Never throws. */
async function finish(row, account, run) {
  let residue = {}, cleanupOk = false, notified = {};
  try {
    residue = await residueFor(account.id, run.id);
    const cleanupFailed = run.scenarios.some((s) => s.assertions.some((a) => a.name === "cleanup" && !a.passed));
    cleanupOk = !cleanupFailed && Object.values(residue).every((v) => v === 0);
    const def = SCENARIOS[row.scenario];
    notified = await notifyOwner(account, row, ownerNotice({ name: account.name, what: def.realUserSafe.what, changes: def.realUserSafe.changes, cleanupOk, at: row.started_at || new Date().toISOString() }));
    if (!cleanupOk) await alertAdmin({ ...row, run_id: run.id }, account, residue);
  } catch (e) {
    console.warn(`[verify] real-account run ${row.id} follow-up failed: ${e.message}`);
  }
  const done = { status: "done", finished_at: new Date().toISOString(), run_id: run.id, verdict: run.verdict, cleanup_ok: cleanupOk, residue, notified };
  await edu().from(TABLE).update(done).eq("id", row.id).then(() => {}, () => {});
  await db.from("admin_audit_log").insert({
    actor: row.admin_id, actor_label: row.admin_label, action: "verify.real_user_write", entity_type: "user", entity_id: account.id,
    after: { approvalId: row.id, scenario: row.scenario, reason: row.reason, runId: run.id, verdict: run.verdict, cleanupOk, notified },
  }).then(() => {}, () => {});
  return { ...row, ...done };
}

/**
 * Approve and start one run. → { approval, run, finished } where `finished`
 * resolves with the final row after the owner was notified.
 * `nested`: called from inside a gate run (the sandbox scenario).
 */
export async function startRealUserRun({ admin, account: handle, scenario, reason, nested = false }) {
  let account;
  try { account = await resolveAccount(handle); } catch (e) { throw httpError(e instanceof PolicyError ? 400 : 503, e.message); }
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  // The per-account daily cap protects real people; sandbox accounts are not.
  const { count: recent } = TARGET === "production"
    ? await edu().from(TABLE).select("id", { count: "exact", head: true }).eq("account_id", account.id).gte("created_at", since)
    : { count: 0 };
  const why = refusal({ enabled: realUserWritesEnabled(), account, def: SCENARIOS[scenario], reason, recentForAccount: recent || 0 });
  if (why) throw httpError(why.includes("off on this server") ? 403 : 400, why);

  const { data: row, error } = await edu().from(TABLE).insert({
    admin_id: admin?.id || null, admin_label: String(admin?.label || "admin").slice(0, 80), account_id: account.id,
    scenario, reason: String(reason).trim().slice(0, 500), status: "approved", expires_at: new Date(Date.now() + APPROVAL_TTL_MS).toISOString(),
  }).select("*").single();
  if (error) throw httpError(503, `couldn't record the approval: ${error.message}`);
  if (!(await claimApproval(row.id))) throw httpError(409, "The approval was already used or expired.");
  row.status = "running";
  row.started_at = new Date().toISOString();

  let run;
  try {
    run = startRun({ scenario, params: { learner: account.id }, actor: `admin:${row.admin_label}`.slice(0, 40), approval: { id: row.id, accountId: account.id }, nested });
  } catch (e) {
    await edu().from(TABLE).update({ status: "failed", finished_at: new Date().toISOString(), verdict: "ERROR" }).eq("id", row.id);
    throw httpError(e.status || 500, e.message);
  }
  await edu().from(TABLE).update({ run_id: run.id }).eq("id", row.id);
  const finished = run.done.then((r) => finish({ ...row, run_id: run.id }, account, r));
  return { approval: { ...row, run_id: run.id }, run, account, finished };
}

/** Recent real-account runs, newest first, with who/which account. */
export async function listRealUserRuns({ limit = 30, id = null } = {}) {
  let q = edu().from(TABLE).select("*").order("created_at", { ascending: false }).limit(Math.min(100, Number(limit) || 30));
  if (id) q = q.eq("id", id);
  const { data, error } = await q;
  if (error) throw httpError(503, `couldn't load real-account runs: ${error.message}`);
  const ids = [...new Set((data || []).map((r) => r.account_id))];
  const { data: users } = ids.length ? await db.from("users").select("id, username, full_name, role").in("id", ids) : { data: [] };
  const byId = new Map((users || []).map((u) => [u.id, u]));
  // Approvals never claimed within their window read as expired.
  return (data || []).map((r) => ({
    id: r.id, scenario: r.scenario, reason: r.reason, adminLabel: r.admin_label,
    status: r.status === "approved" && Date.parse(r.expires_at) <= Date.now() ? "expired" : r.status,
    account: byId.get(r.account_id) ? { username: byId.get(r.account_id).username, name: byId.get(r.account_id).full_name, role: byId.get(r.account_id).role } : null,
    runId: r.run_id, verdict: r.verdict, cleanupOk: r.cleanup_ok, residue: r.residue, notified: r.notified,
    createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at,
  }));
}
