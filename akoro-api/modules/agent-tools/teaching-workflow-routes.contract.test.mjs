import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./teaching-workflow-routes.js", import.meta.url), "utf8");
const gateway = await readFile(new URL("./routes.js", import.meta.url), "utf8");

test("the Python bridge invokes only the canonical fixed teaching workflow", () => {
  assert.match(gateway, /router\.use\("\/teaching-workflow", teachingWorkflowRouter\)/);
  assert.match(source, /router\.post\("\/sessions", requireAgentToolsCredential/);
  assert.match(source, /verifyAgentToolsCapability\(toolContext, sessionId\)/);
  assert.match(source, /claims\.scope !== "student"/);
  // D43: prepared by the same shared start as the app's sessions (which
  // always builds the gated student session), for the capability's subject.
  assert.match(source, /prepareTeachingSession\(\{/);
  assert.match(source, /const learnerId = String\(claims\.sub\);/);
  assert.match(source, /studentId: learnerId, caller: learnerId/);
  assert.match(source, /orchestrator\.processTeachingMessage\(message\)/);
  assert.match(source, /TEACHING_TURN_WORKFLOW/);
  assert.doesNotMatch(source, /body\?\.studentId|body\.studentId/);
  assert.doesNotMatch(source, /body\?\.tools/);
  // Every HTTP route authenticates before the work runs.
  assert.equal((source.match(/router\.post\("[^"]+", requireAgentToolsCredential, authed\(/g) || []).length, 4);
  const authedFn = source.slice(source.indexOf("const authed = (fn)"), source.indexOf('router.post("/sessions"'));
  assert.ok(authedFn.indexOf("readCapability(body)") < authedFn.indexOf("await fn(claims"), "capability verified first");
});

test("D43: a bridged session is saved, its turns are saved, ending completes it", () => {
  const start = source.slice(source.indexOf("async function startSession"), source.indexOf("async function runTurn"));
  assert.match(start, /createSessionRecord\(orchestrator/);
  assert.match(start, /recordId: recordId \|\| null/);
  assert.match(start, /previousSessionId \(the earlier session's recordId\) is required to continue/);
  const turn = source.slice(source.indexOf("async function runTurn"), source.indexOf("async function summarise"));
  assert.ok(turn.indexOf("processTeachingMessage(") < turn.indexOf("appendSessionBlocks("), "the turn is saved after it runs");
  const end = source.slice(source.indexOf("async function endSession"), source.indexOf("export const teachingBridge"));
  assert.ok(end.indexOf("completeSessionRecord(") < end.indexOf("sessions.delete("), "completed before it is dropped");
});

test("the bridge makes session ownership and idempotent turn replay explicit", () => {
  assert.match(source, /entry\.learnerId !== String\(claims\.sub\)/);
  assert.match(source, /turnId cannot be reused for a different message/);
  assert.match(source, /MAX_TURNS_PER_SESSION/);
  assert.match(source, /sessionAffinity: "required"/);
  assert.match(source, /sessions\.delete\(sessionId\)/);
});
