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
  assert.match(source, /getOrchestrator\(\{/);
  assert.match(source, /mode: "student"/);
  assert.match(source, /studentId: String\(claims\.sub\)/);
  assert.match(source, /orchestrator\.processTeachingMessage\(message\)/);
  assert.match(source, /TEACHING_TURN_WORKFLOW/);
  assert.doesNotMatch(source, /req\.body\?\.studentId/);
  assert.doesNotMatch(source, /req\.body\?\.tools/);
});

test("the bridge makes session ownership and idempotent turn replay explicit", () => {
  assert.match(source, /entry\.learnerId !== String\(claims\.sub\)/);
  assert.match(source, /turnId cannot be reused for a different message/);
  assert.match(source, /MAX_TURNS_PER_SESSION/);
  assert.match(source, /sessionAffinity: "required"/);
  assert.match(source, /sessions\.delete\(sessionId\)/);
});
