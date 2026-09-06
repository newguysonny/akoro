import assert from "node:assert/strict";
import test from "node:test";

process.env.AKORO_AGENT_TOOLS_SECRET = "gateway-test-secret";
process.env.AKORO_AGENT_TOOLS_CAPABILITY_SECRET = "capability-test-secret";

const {
  issueAgentToolsCapability,
  requireAgentToolsCredential,
  verifyAgentToolsCapability,
} = await import("./capability.js");

test("tool capability is short-lived, opaque, and bound to one session", () => {
  const token = issueAgentToolsCapability({
    user: { id: "learner-1", role: "student" }, sessionId: "python-session-1", ttlSeconds: 60,
  });
  const claims = verifyAgentToolsCapability(token, "python-session-1");
  assert.equal(claims.sub, "learner-1");
  assert.equal(claims.scope, "student");
  assert.ok(claims.jti);
  assert.equal(verifyAgentToolsCapability(token, "another-session"), null);
});

test("teacher task capability requires both a task and an active-run identifier", () => {
  assert.throws(() => issueAgentToolsCapability({
    user: { id: "teacher-1", role: "instructor" }, sessionId: "python-session-1", taskId: "task-1",
  }), /taskId and runId/);
  const token = issueAgentToolsCapability({
    user: { id: "teacher-1", role: "instructor" }, sessionId: "python-session-1", taskId: "task-1", runId: "run-1",
  });
  const claims = verifyAgentToolsCapability(token, "python-session-1");
  assert.equal(claims.scope, "teacher_task");
  assert.equal(claims.taskId, "task-1");
  assert.equal(claims.runId, "run-1");
});

test("gateway credential check uses the required header and rejects mismatches", () => {
  const response = () => {
    const value = { statusCode: null, body: null };
    value.status = (code) => { value.statusCode = code; return value; };
    value.json = (body) => { value.body = body; return value; };
    return value;
  };
  let nextCalled = false;
  requireAgentToolsCredential({ get: () => "gateway-test-secret" }, response(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  const denied = response();
  requireAgentToolsCredential({ get: () => "wrong" }, denied, () => assert.fail("must not call next"));
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body.success, false);
});
