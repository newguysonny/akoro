import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const learnerRoutes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const adminRoutes = await readFile(new URL("../admin/agent-tool-requests.js", import.meta.url), "utf8");

test("only an authenticated learner can submit a compact tool request", () => {
  assert.match(learnerRoutes, /router\.post\("\/agent-tool-requests", authenticateToken, requireRole\(\["student"\]\)/);
  assert.match(learnerRoutes, /createLearnerToolRequest/);
  assert.match(learnerRoutes, /duplicate: !request\.createdNew/);
});

test("the admin request queue is protected and only reviews status/note", () => {
  assert.match(adminRoutes, /const adminOnly = \[authenticateToken, requireRole\(\["admin"\]\)\]/);
  assert.match(adminRoutes, /router\.get\("\/agent-tool-requests", adminOnly/);
  assert.match(adminRoutes, /router\.patch\("\/agent-tool-requests\/:requestId", adminOnly/);
  assert.match(adminRoutes, /normaliseToolRequestUpdate/);
  assert.doesNotMatch(adminRoutes, /openai|fetch\(/i);
});
