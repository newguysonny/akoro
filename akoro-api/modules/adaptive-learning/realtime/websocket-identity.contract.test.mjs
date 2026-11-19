import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const websocket = await readFile(new URL("./websocket.js", import.meta.url), "utf8");
const teachingSessionContext = await readFile(new URL("../teaching-session/context.js", import.meta.url), "utf8");
const decayEngine = await readFile(new URL("../agents/student/decayEngine.js", import.meta.url), "utf8");
const orchestrator = await readFile(new URL("../agents/student/orchestrator.js", import.meta.url), "utf8");
const decayChatRoutes = await readFile(new URL("../decay-review/routes.js", import.meta.url), "utf8");
// Session preparation (continuation / decay loading) is shared by every
// transport since D43 — the socket and the agent bridge both call it.
const sessionStart = await readFile(new URL("../teaching-session/start.js", import.meta.url), "utf8");

test("adaptive socket events use token identity rather than browser-supplied learner ids", () => {
  for (const event of [
    "start_adaptive_session", "teacher_message", "request_summary", "resume_session",
    "park_session", "end_session", "switch_agent_pair", "get_state", "acknowledge_alert",
  ]) {
    assert.match(websocket, new RegExp(`"${event}"`));
  }
  assert.match(websocket, /const u = socket\.data\.user;/);
  assert.match(websocket, /payload\.userId = u\.id;/);
  assert.match(websocket, /payload\.studentId = u\.id;/);

  // The legacy starts are retired (D42): they answer with an error only.
  assert.match(websocket, /for \(const retired of \["start_session", "start_student_session", "start_decay_session"\]\)/);
  assert.match(websocket, /prepareTeachingSession\(\{\s*studentId, caller, topic, subject, mode,/);
});

test("continuation history is scoped to the authenticated learner", () => {
  // The ownership query lives in the teaching-session context loader since
  // the 2026-10-03 service extraction; the scoping contract is unchanged.
  assert.match(
    teachingSessionContext,
    /\.eq\("id", prevSessionId\)\s*\.eq\("student_id", studentId\)\s*\.maybeSingle\(\)/,
  );
  assert.match(sessionStart, /loadContinuationContext\(\{ studentId, prevSessionId \}\)/);
});

test("decay-alert mutations are scoped to their authenticated owner", () => {
  assert.match(decayEngine, /async markNotificationRead\(notificationId, studentId\)/);
  assert.match(decayEngine, /\.eq\("id", notificationId\)\s*\.eq\("student_id", studentId\)/);
  assert.match(decayEngine, /async markNotificationActioned\(notificationId, sessionId, studentId\)/);
  assert.match(orchestrator, /markNotificationActioned\(this\.notificationId, sessionId, studentId\)/);
  assert.match(sessionStart, /markNotificationRead\(notificationId, studentId\)/);
  assert.match(websocket, /markNotificationRead\(notificationId, socket\.data\.user\.id\)/);
  // The legacy /decay route lives in decay-review/routes.js since the chat.js
  // split (Phase 19 step 3, 7/7); the ownership contract is unchanged.
  assert.match(decayChatRoutes, /markNotificationRead\(req\.params\.notifId, req\.user\.id\)/);
});

test("minimize parks the session instead of ending it — the conversation survives", () => {
  // park_session saves like an end (row ensured; every turn is already
  // appended durably) but keeps the session RESUMABLE — it must never
  // complete the row or drop the orchestrator.
  const park = websocket.slice(
    websocket.indexOf('socket.on("park_session"'),
    websocket.indexOf('socket.on("end_session"'),
  );
  assert.ok(park.length > 0, "park_session handler must precede end_session");
  assert.match(park, /ensureSessionRecord\(orchestrator\)/);
  assert.doesNotMatch(park, /completeSessionRecord/);
  assert.doesNotMatch(park, /activeSessions\.delete/);

  // resume ships the saved transcript so a REMOUNTED client (minimize →
  // restore, local blocks gone) rebuilds its transcript from the same
  // per-turn history a continuation loads.
  assert.match(websocket, /readSessionBlocks\(orchestrator\)/);
  const resume = websocket.slice(
    websocket.indexOf('socket.on("resume_session"'),
    websocket.indexOf('socket.on("park_session"'),
  );
  assert.match(resume, /historyBlocks/);
});
