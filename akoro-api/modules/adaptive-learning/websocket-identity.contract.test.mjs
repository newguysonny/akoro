import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const websocket = await readFile(new URL("./websocket.js", import.meta.url), "utf8");
const decayEngine = await readFile(new URL("./agents/student/decayEngine.js", import.meta.url), "utf8");
const orchestrator = await readFile(new URL("./agents/student/orchestrator.js", import.meta.url), "utf8");
const chat = await readFile(new URL("./chat.js", import.meta.url), "utf8");

test("adaptive socket events use token identity rather than browser-supplied learner ids", () => {
  for (const event of [
    "start_adaptive_session", "teacher_message", "request_summary", "resume_session",
    "end_session", "switch_agent_pair", "get_state", "acknowledge_alert",
  ]) {
    assert.match(websocket, new RegExp(`"${event}"`));
  }
  assert.match(websocket, /const u = socket\.data\.user;/);
  assert.match(websocket, /payload\.userId = u\.id;/);
  assert.match(websocket, /payload\.studentId = u\.id;/);

  const legacyStart = websocket.slice(
    websocket.indexOf('socket.on("start_session"'),
    websocket.indexOf('socket.on("start_student_session"'),
  );
  assert.doesNotMatch(legacyStart, /sessionId\s*\|\|/);
});

test("continuation history is scoped to the authenticated learner", () => {
  assert.match(
    websocket,
    /\.eq\("id", prevSessionId\)\s*\.eq\("student_id", studentId\)\s*\.maybeSingle\(\)/,
  );
});

test("decay-alert mutations are scoped to their authenticated owner", () => {
  assert.match(decayEngine, /async markNotificationRead\(notificationId, studentId\)/);
  assert.match(decayEngine, /\.eq\("id", notificationId\)\s*\.eq\("student_id", studentId\)/);
  assert.match(decayEngine, /async markNotificationActioned\(notificationId, sessionId, studentId\)/);
  assert.match(orchestrator, /markNotificationActioned\(this\.notificationId, sessionId, studentId\)/);
  assert.match(websocket, /markNotificationRead\(notificationId, studentId\)/);
  assert.match(websocket, /markNotificationRead\(notificationId, socket\.data\.user\.id\)/);
  assert.match(chat, /markNotificationRead\(req\.params\.notifId, req\.user\.id\)/);
});
