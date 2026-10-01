import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Tool-observation contract (REASON → ACT → OBSERVE → LLM).
 *
 * Every tool execution in both node agent loops must become a structured
 * observation — { success, request_id, action, result, error } — before it
 * enters the model transcript, so the reply confirms what the backend
 * actually returned. The envelope itself is unit-tested in
 * utils/toolObservation.test.mjs; this pins the loops to keep using it.
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const chat = await read("./chat.js");
const toolObservationsDoctrine = await read("../../akoro-agent/policies/TOOL_OBSERVATIONS.md");
const taskLoop = await read("../tasks/lib/agentLoop.js");
const util = await read("../../utils/toolObservation.js");

test("learner Agent Chat observes tools through the structured envelope", () => {
  assert.match(chat, /import \{ newToolRequestId, toolObservation \} from "\.\.\/\.\.\/utils\/toolObservation\.js"/);
  assert.match(chat, /toolObservation\(\{ action: tool, result: toolResult, requestId: newToolRequestId\(\) \}\)/);
  assert.match(chat, /content: JSON\.stringify\(observation\)/);
  // The model is taught the envelope so confirmations stay grounded.
  // P1: the guide loads from the workspace through the doctrine seam.
  assert.match(chat, /assembleChatDoctrine/);
  assert.match(toolObservationsDoctrine, /"success": boolean, "request_id": string, "action": string/);
  // Executions carry the correlation id for tracing.
  assert.match(chat, /requestId: observation\.request_id/);
});

test("instructor task loop observes the same envelope", () => {
  assert.match(taskLoop, /import \{ newToolRequestId, toolObservation \} from "\.\.\/\.\.\/\.\.\/utils\/toolObservation\.js"/);
  assert.match(taskLoop, /toolObservation\(\{ action: name/);
  assert.match(taskLoop, /content: JSON\.stringify\(observation\)/);
  // Raw-string tool observations are gone; failures are envelope errors.
  assert.doesNotMatch(taskLoop, /`Tool error: \$\{err\.message\}`/);
  // Side-effect replay still dedupes through the envelope's verdict.
  assert.match(taskLoop, /next\.success\) done\.set\(name, result\)/);
  assert.match(taskLoop, /alreadyDone: true/);
});

test("the envelope speaks the same contract as the Python agent gateway", () => {
  // {success, result, error} — the deliberate gateway shape — plus
  // request/action correlation, per the observation design.
  for (const key of ["success", "request_id", "action", "result", "error"]) {
    assert.match(util, new RegExp(`\\b${key}\\b`));
  }
  assert.match(util, /req_\$\{randomBytes\(4\)\.toString\("hex"\)\}/);
});
