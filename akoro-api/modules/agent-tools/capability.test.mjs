import assert from "node:assert/strict";
import test from "node:test";

process.env.AKORO_AGENT_TOOLS_SECRET = "gateway-test-secret";
process.env.AKORO_AGENT_TOOLS_CAPABILITY_SECRET = "capability-test-secret";

const {
  agentToolArgumentsDigest,
  issueAgentToolsCapability,
  issueAgentToolsWriteConfirmation,
  requireAgentToolsCredential,
  verifyAgentToolsCapability,
  verifyAgentToolsWriteConfirmation,
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

test("write confirmation is short-lived and bound to exactly one capability, session, and payload", () => {
  const capability = issueAgentToolsCapability({
    user: { id: "learner-1", role: "student" }, sessionId: "python-session-1", ttlSeconds: 60,
  });
  const claims = verifyAgentToolsCapability(capability, "python-session-1");
  const digest = agentToolArgumentsDigest({ title: "Revise biology", priority: "medium" });
  // Key order must not create a different approved action.
  assert.equal(digest, agentToolArgumentsDigest({ priority: "medium", title: "Revise biology" }));
  const token = issueAgentToolsWriteConfirmation({
    userId: "learner-1", sessionId: "python-session-1", capabilityJti: claims.jti,
    confirmationId: "3ea5f00a-13e5-4acf-aef0-bb0427e6acb4", toolName: "create_task",
    argumentsDigest: digest, ttlSeconds: 60,
  });
  const confirmed = verifyAgentToolsWriteConfirmation(token, { claims, sessionId: "python-session-1" });
  assert.equal(confirmed.confirmationId, "3ea5f00a-13e5-4acf-aef0-bb0427e6acb4");
  assert.equal(confirmed.argumentsDigest, digest);
  assert.equal(verifyAgentToolsWriteConfirmation(token, { claims, sessionId: "other-session" }), null);
  assert.notEqual(digest, agentToolArgumentsDigest({ title: "Delete every task", priority: "medium" }));
  const otherCapability = issueAgentToolsCapability({
    user: { id: "learner-1", role: "student" }, sessionId: "python-session-1", ttlSeconds: 60,
  });
  const otherClaims = verifyAgentToolsCapability(otherCapability, "python-session-1");
  assert.equal(verifyAgentToolsWriteConfirmation(token, { claims: otherClaims, sessionId: "python-session-1" }), null);
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

test("a concept-state capability is additionally bound to one reviewed curriculum scope", () => {
  const token = issueAgentToolsCapability({
    user: { id: "learner-1", role: "student" }, sessionId: "python-session-1",
    learningScope: { curriculumKey: "NERDC-JSS2-BASIC-SCIENCE-V1", subject: "Biology", topicKey: "Photosynthesis" },
  });
  const claims = verifyAgentToolsCapability(token, "python-session-1");
  assert.deepEqual(claims.learningScope, {
    curriculumKey: "nerdc-jss2-basic-science-v1", subject: "Biology", topicKey: "photosynthesis",
  });
  assert.throws(() => issueAgentToolsCapability({
    user: { id: "teacher-1", role: "instructor" }, sessionId: "python-session-1",
    learningScope: { curriculumKey: "scope", subject: "Biology", topicKey: "plants" },
  }), /only for learner/);
});
