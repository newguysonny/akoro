import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");
const app = await readFile(new URL("../../app.js", import.meta.url), "utf8");
const adminRoutes = await readFile(new URL("../admin/agent-tool-requests.js", import.meta.url), "utf8");

test("learners file tool requests through Agent Chat only — no endpoint of their own", () => {
  // POST /api/agent-tool-requests had no caller and was removed (endpoint audit 2026-10-25);
  // the chat's submit_tool_request is the one way in, signed in by the chat's own login.
  assert.match(chat, /import \{ createLearnerToolRequest \} from "\.\.\/agent-tool-requests\/service\.js"/);
  assert.doesNotMatch(app, /agent-tool-requests\/routes\.js/);
});

test("the admin request queue is protected and only reviews status/note", () => {
  assert.match(adminRoutes, /const adminOnly = \[authenticateToken, requireRole\(\["admin"\]\)\]/);
  assert.match(adminRoutes, /router\.get\("\/agent-tool-requests", adminOnly/);
  assert.match(adminRoutes, /router\.patch\("\/agent-tool-requests\/:requestId", adminOnly/);
  assert.match(adminRoutes, /normaliseToolRequestUpdate/);
  assert.doesNotMatch(adminRoutes, /openai|fetch\(/i);
});
