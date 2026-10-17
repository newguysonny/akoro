// The chat history loads a page at a time (newest first): GET
// /sessions/:id/messages with ?limit and ?before. Without them it is still
// the whole transcript — the drawer's "copy chat" relies on that.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-key";
process.env.AI_TELEMETRY_DB = "off";
process.env.AI_TELEMETRY = "off";
process.env.JWT_SECRET ||= "stub-jwt-secret";
process.env.JWT_ISSUER ||= "https://api.akoro.app";
process.env.JWT_AUDIENCE ||= "https://akoro.app";
process.env.GOOGLE_CLIENT_ID ||= "stub-google-id";
process.env.GOOGLE_CLIENT_SECRET ||= "stub-google-secret";
delete process.env.PRIVATE_KEY;
delete process.env.PUBLIC_KEY;

const { default: db } = await import("../../db.js");
const { installFakeDb } = await import("../../lib/testing/fakeDb.mjs");
const { default: express } = await import("express");
const { default: router, historyPage } = await import("./chat.js");

const ME = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const at = (n) => new Date(Date.UTC(2026, 9, 17, 10, 0, n)).toISOString();
const messages = Array.from({ length: 23 }, (_, i) => ({
  id: `m${String(i + 1).padStart(2, "0")}`, session_id: SESSION, user_id: ME,
  role: i % 2 ? "agent" : "user", text: `message ${i + 1}`, created_at: at(i), trace: null, meta: null,
}));

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: ME, role: "student" }; next(); });
app.use("/chat", router);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/chat`;
test.after(() => {
  // chat.js loads the real auth/db modules, whose background handles keep this
  // subprocess alive (the same shutdown as think-loop.contract.test.mjs).
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
});

const get = async (path) => (await fetch(`${base}${path}`, { headers: { connection: "close" } })).json();

test("historyPage: a bounded limit, a valid before only with a limit", () => {
  assert.deepEqual(historyPage({}), { limit: null, before: null });
  assert.deepEqual(historyPage({ limit: "10" }), { limit: 10, before: null });
  assert.equal(historyPage({ limit: "0" }).limit, 1);
  assert.equal(historyPage({ limit: "5000" }).limit, 100);
  assert.equal(historyPage({ limit: "x" }).limit, null);
  assert.equal(historyPage({ limit: "10", before: "nope" }).before, null);
  assert.equal(historyPage({ before: at(3) }).before, null);
  assert.equal(historyPage({ limit: "10", before: at(3) }).before, at(3));
});

test("pages walk back from the newest, oldest-first within a page, until hasMore is false", async (t) => {
  const fake = installFakeDb(db, { chat_sessions: [{ id: SESSION, user_id: ME }], chat_messages: messages.map((m) => ({ ...m })) });
  t.after(() => fake.restore());

  const first = await get(`/sessions/${SESSION}/messages?limit=10`);
  assert.deepEqual(first.messages.map((m) => m.id), messages.slice(13).map((m) => m.id));
  assert.equal(first.hasMore, true);

  const second = await get(`/sessions/${SESSION}/messages?limit=10&before=${encodeURIComponent(first.messages[0].created_at)}`);
  assert.deepEqual(second.messages.map((m) => m.id), messages.slice(3, 13).map((m) => m.id));
  assert.equal(second.hasMore, true);

  const third = await get(`/sessions/${SESSION}/messages?limit=10&before=${encodeURIComponent(second.messages[0].created_at)}`);
  assert.deepEqual(third.messages.map((m) => m.id), ["m01", "m02", "m03"]);
  assert.equal(third.hasMore, false);

  // Copy chat: no limit → every message, oldest first, no paging fields.
  const all = await get(`/sessions/${SESSION}/messages`);
  assert.equal(all.messages.length, 23);
  assert.equal(all.messages[0].id, "m01");
  assert.equal(all.hasMore, undefined);
});

test("another learner's session is still not found, paged or not", async (t) => {
  const fake = installFakeDb(db, { chat_sessions: [{ id: SESSION, user_id: "someone-else" }], chat_messages: messages });
  t.after(() => fake.restore());
  const res = await fetch(`${base}/sessions/${SESSION}/messages?limit=10`, { headers: { connection: "close" } });
  assert.equal(res.status, 404);
});
