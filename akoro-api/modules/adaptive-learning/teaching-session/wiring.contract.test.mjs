/** Phases 6–7 wiring: the socket runs agent turns with the mode, ends a session that finished itself, reopens workflows; the modal follows. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the socket: mode, guide stream, the agent's end, open_workflow, the turn audit", () => {
  const ws = read("../websocket.js");
  assert.match(ws, /socket\.on\("teacher_message", async \(\{ message, mode \} = \{\}\)/);
  assert.match(ws, /onGuideReplyChunk: \(token\) => socket\.emit\("guide_reply_token"/);
  assert.match(ws, /if \(result\.endRequested\) await endLiveSession\(socket, \{ endedBy: result\.endRequested, bounded: result\.boundedEnd \}\)/);
  assert.match(ws, /socket\.on\("end_session", async \(\) => endLiveSession\(socket, \{ endedBy: "learner" \}\)\)/);
  assert.match(ws, /socket\.on\("set_teaching_mode"/);
  assert.match(ws, /socket\.on\("open_workflow"/);
  assert.match(ws, /h\.recordTurn\(\{ workflowId: orchestrator\.teachingWorkflowId/);
  const orch = read("../agents/student/orchestrator.js");
  assert.match(orch, /String\(process\.env\.AKORO_TEACHING_AGENT \|\| "on"\)\.toLowerCase\(\) !== "off"/);
  assert.match(orch, /studentAgentResponse: workflow\.guideReply \? null : studentReply/);
});

test("the modal: guide chat over the live session, mode switch, a session that ended itself", () => {
  const modal = read("../../../../akoro-learner/src/components/teaching/TeachAgentModal.jsx");
  assert.match(modal, /wsRef\.current\.emit\("set_teaching_mode"/);
  assert.match(modal, /wsRef\.current\.emit\("teacher_message", \{ message: clean, mode: "learn_with_guide" \}\)/);
  assert.match(modal, /ws\.on\("guide_reply_token"/);
  assert.match(modal, /ws\.on\("session_ended"/);
  assert.match(modal, /if \(!parkedRef\.current && !endedRef\.current\) wsRef\.current\?\.emit\("end_session"\)/);
});
