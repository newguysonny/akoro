// Verification Gate phase V4: real-account write runs — policy and refusals.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.GOOGLE_CLIENT_ID ||= "test";
process.env.GOOGLE_CLIENT_SECRET ||= "test";
process.env.VERIFY_TARGET = "production";
delete process.env.VERIFY_REAL_USER_WRITES;

const policy = await import("./policy.js");
const { refusal, ownerNotice } = await import("./realUserRules.js");
const TASK_DEF = { risk: "write", realUserSafe: { what: "creating a task", changes: "did x", roles: ["student"] } };

const real = { id: "u-real", username: "ada", role: "student", tester: false };
const tester = { id: "u-test", username: "tester06", role: "student", tester: true };

test("a real account is read-only to the gate without an approval for it", () => {
  process.env.VERIFY_ALLOW_WRITES = "true";
  assert.throws(() => policy.assertMayActAs(real, "write"), /read-only/);
  assert.doesNotThrow(() => policy.assertMayActAs(tester, "write"));
  delete process.env.VERIFY_ALLOW_WRITES;
});

test("an approval opens writes only for its own account, and only with VERIFY_REAL_USER_WRITES on production", () => {
  const approval = { id: "a1", accountId: real.id };
  assert.throws(() => policy.assertMayActAs(real, "write", { approval }), /read-only/, "off by default on production");
  process.env.VERIFY_REAL_USER_WRITES = "true";
  try {
    assert.doesNotThrow(() => policy.assertMayActAs(real, "write", { approval }));
    assert.throws(() => policy.assertMayActAs({ ...real, id: "someone-else" }, "write", { approval }), /read-only/);
    assert.throws(() => policy.assertMayActAs(real, "write", { approval: { accountId: real.id } }), /read-only/, "an approval needs an id");
  } finally {
    delete process.env.VERIFY_REAL_USER_WRITES;
  }
});

test("refusals: switch off, test accounts, unsafe checks, wrong role, no reason, daily cap", () => {
  const ok = { enabled: true, account: real, def: TASK_DEF, reason: "Support ticket 123: tasks not saving" };
  assert.equal(refusal(ok), null);
  assert.match(refusal({ ...ok, enabled: false }), /off on this server/);
  assert.match(refusal({ ...ok, account: tester }), /test account/);
  assert.match(refusal({ ...ok, def: { risk: "dry", realUserSafe: TASK_DEF.realUserSafe } }), /isn't approved/);
  assert.match(refusal({ ...ok, def: { risk: "write" } }), /isn't approved/, "write scenarios aren't safe unless marked");
  assert.match(refusal({ ...ok, def: undefined }), /isn't approved/);
  assert.match(refusal({ ...ok, account: { ...real, role: "instructor" } }), /student/);
  assert.match(refusal({ ...ok, reason: "because" }), /Say why/);
  assert.match(refusal({ ...ok, recentForAccount: 3 }), /last 24 hours/);
});

test("only scenarios marked realUserSafe are offered — today: creating a task", () => {
  const writes = readFileSync(new URL("./scenarios/writes.js", import.meta.url), "utf8");
  const marked = [...writes.matchAll(/name: "([^"]+)",[^\n]*\n\s*realUserSafe: \{ what: "[^"]+", changes: "[^"]+", roles: \[[^\]]+\] \}/g)].map((m) => m[1]);
  assert.deepEqual(marked, ["tasks.create_due_in_minutes"]);
  assert.equal((writes.match(/realUserSafe:/g) || []).length, 1 + 0, "no other scenario is marked");
});

test("the owner's notice is plain and honest about leftovers", () => {
  const n = ownerNotice({ name: "Ada Obi", what: "creating a task with your agent", changes: "created one test task and deleted it straight away", cleanupOk: true, at: "2026-10-17T09:00:00Z" });
  assert.match(n.body, /^Hi Ada,/);
  assert.match(n.body, /Nothing else on your account was changed/);
  assert.ok(n.sms.length <= 200, "one SMS");
  assert.doesNotMatch(n.body + n.sms, /tasks\.create|verify|scenario/i, "no internal names");
  const left = ownerNotice({ name: "Ada", what: "x", changes: "did y", cleanupOk: false, at: "2026-10-17T09:00:00Z" });
  assert.match(left.body, /team has been alerted/);
});

test("wiring: the gate API never passes an approval; the admin route is admin-only", () => {
  const routes = readFileSync(new URL("./routes.js", import.meta.url), "utf8");
  assert.doesNotMatch(routes, /approval/, "the key-guarded gate API can't approve");
  const admin = readFileSync(new URL("../admin/verify-real-user.js", import.meta.url), "utf8");
  assert.match(admin, /requireRole\(\["admin"\]\)/);
  assert.equal((admin.match(/router\.(get|post)\("\/verify\/[^"]+", adminOnly/g) || []).length, 4);
  const ctx = readFileSync(new URL("./context.js", import.meta.url), "utf8");
  assert.match(ctx, /needs an id or a run-marker filter/, "cleanup on a real account is pinned to the run's own rows");
});
