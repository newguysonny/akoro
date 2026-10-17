// Behaviour tests for the study-prep REST router: mounted on a real express
// app on an ephemeral port, with the real wiring/harness/store running
// against the in-memory fake db. Nothing here reaches the planning LLM step.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const { default: express } = await import("express");
const { default: router } = await import("./routes.js");

const ME = randomUUID();
const THEM = randomUUID();
const S = "edu.study_prep_sessions";

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: req.get("x-test-user") || ME, role: "student" }; next(); });
app.use("/study-prep", router);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/study-prep`;
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, path, { body, user } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", connection: "close", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function fakeFor(t, seed = {}, options = {}) {
  const fake = installFakeDb(db, seed, options);
  t.after(() => fake.restore());
  return fake;
}

const session = (id, learnerId, status, extra = {}) => ({
  id, learner_id: learnerId, status, goal: "Pass BECE", subject: "Basic Science", class_level: "JSS1",
  exam_board: "WAEC", entry_mode: "syllabus", policy_version: "study-prep-v1", updated_at: "2026-02-01T00:00:00Z", ...extra,
});

test("GET /sessions with no active session → { success: true, session: null }", async (t) => {
  fakeFor(t, { [S]: [session(randomUUID(), ME, "completed"), session(randomUUID(), THEM, "planning")] });
  const res = await call("GET", "/sessions");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, session: null });
});

test("GET /sessions restores the learner's active session view with topics and public events", async (t) => {
  const id = randomUUID();
  fakeFor(t, {
    [S]: [session(id, ME, "awaiting_confirmation", { plan: [{ syllabusTopicId: "matter" }] })],
    "edu.study_prep_topics": [{ id: randomUUID(), session_id: id, position: 1, label: "Matter", syllabus_topic_id: "matter", status: "queued" }],
    "edu.study_prep_events": [{ session_id: id, sequence: 0, event_type: "observation", origin: "harness", facts: { goal: "x" }, narrative: "Started" }],
  });
  const res = await call("GET", "/sessions");
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.session.id, id);
  assert.equal(res.body.session.status, "awaiting_confirmation");
  assert.deepEqual(res.body.topics.map((topic) => topic.label), ["Matter"]);
  assert.equal(res.body.events[0].eventType, "observation");
  assert.equal(res.body.events[0].narrative, "Started");
});

test("GET /sessions surfaces a db failure as a 500, not as 'no session'", async (t) => {
  const fake = fakeFor(t, { [S]: [session(randomUUID(), ME, "planning")] });
  fake.failNext(S, "select", { message: "db down" });
  const res = await call("GET", "/sessions");
  assert.equal(res.status, 500);
  assert.equal(res.body.code, "study_prep_fault");
});

test("a malformed :id is a 422 tool_schema_invalid before any db read", async (t) => {
  const fake = fakeFor(t);
  for (const bad of ["not-a-uuid", "12345678-1234-1234-1234-1234567890123", "12345678-1234-1234-1234-12345678901g"]) {
    const res = await call("GET", `/sessions/${bad}`);
    assert.equal(res.status, 422, bad);
    assert.deepEqual(res.body, { success: false, code: "tool_schema_invalid", error: "Invalid session id" });
  }
  assert.equal((await call("POST", "/sessions/nope/cancel")).status, 422);
  assert.equal(fake.calls.length, 0);
});

test("a real UUID passes the id check (regression: valid ids were 422) — unknown session is 404 session_not_found", async (t) => {
  fakeFor(t);
  for (const id of [randomUUID(), randomUUID().toUpperCase()]) {
    const res = await call("GET", `/sessions/${id}`);
    assert.equal(res.status, 404, id);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, "session_not_found");
  }
});

test("GET /sessions/:id returns the owned session's view", async (t) => {
  const id = randomUUID();
  fakeFor(t, { [S]: [session(id, ME, "planning")] });
  const res = await call("GET", `/sessions/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.session.id, id);
  assert.deepEqual(res.body.topics, []);
  assert.deepEqual(res.body.events, []);
});

test("POST /sessions/:id/cancel cancels an owned session", async (t) => {
  const id = randomUUID();
  const fake = fakeFor(t, { [S]: [session(id, ME, "topic_active")] });
  const res = await call("POST", `/sessions/${id}/cancel`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.session.id, id);
  assert.equal(res.body.session.status, "cancelled");
  assert.equal(fake.rows(S)[0].status, "cancelled");
  // It is no longer the learner's active session.
  assert.deepEqual((await call("GET", "/sessions")).body, { success: true, session: null });
});

test("another learner's session is 404 session_not_found and is left untouched", async (t) => {
  const id = randomUUID();
  const fake = fakeFor(t, { [S]: [session(id, THEM, "topic_active")] });
  const view = await call("GET", `/sessions/${id}`);
  assert.equal(view.status, 404);
  assert.equal(view.body.code, "session_not_found");
  const cancel = await call("POST", `/sessions/${id}/cancel`);
  assert.equal(cancel.status, 404);
  assert.equal(cancel.body.code, "session_not_found");
  assert.equal(fake.rows(S)[0].status, "topic_active");
  // The owner can still see it.
  assert.equal((await call("GET", `/sessions/${id}`, { user: THEM })).status, 200);
});

test("POST /sessions validates goal and subject with 422 before creating anything", async (t) => {
  const fake = fakeFor(t);
  for (const body of [{}, { goal: "ok", subject: "Basic Science" }, { goal: "Pass my exam", subject: "B" }, { goal: "  \n ", subject: "Basic Science" }]) {
    const res = await call("POST", "/sessions", { body });
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal(res.body.code, "tool_schema_invalid");
  }
  assert.equal(fake.calls.length, 0);
});

test("AKORO_STUDY_PREP_ENABLED=false → every route answers 409 study_prep_disabled", async (t) => {
  const fake = fakeFor(t, { [S]: [session(randomUUID(), ME, "planning")] });
  const previous = process.env.AKORO_STUDY_PREP_ENABLED;
  process.env.AKORO_STUDY_PREP_ENABLED = "FALSE";
  t.after(() => { if (previous === undefined) delete process.env.AKORO_STUDY_PREP_ENABLED; else process.env.AKORO_STUDY_PREP_ENABLED = previous; });
  const disabled = { success: false, code: "study_prep_disabled", error: "Study-prep sessions are not enabled for this learner" };
  for (const [method, path] of [["GET", "/sessions"], ["GET", `/sessions/${randomUUID()}`], ["GET", "/sessions/not-a-uuid"], ["POST", "/sessions"], ["POST", `/sessions/${randomUUID()}/cancel`]]) {
    const res = await call(method, path, { body: method === "POST" ? { goal: "Pass my exam", subject: "Basic Science" } : undefined });
    assert.equal(res.status, 409, `${method} ${path}`);
    assert.deepEqual(res.body, disabled);
  }
  assert.equal(fake.calls.length, 0);
});
