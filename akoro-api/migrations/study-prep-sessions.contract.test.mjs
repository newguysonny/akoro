import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Study-prep migration + wiring source contract (Master Plan §4.13).
 * The schema and the route/chat wiring are db-backed, so they are asserted
 * as source contracts — the house pattern.
 */

const sql = await readFile(new URL("./2026-study-prep-sessions-v1.sql", import.meta.url), "utf8");
const chat = await readFile(new URL("../modules/adaptive-learning/chat.js", import.meta.url), "utf8");
const index = await readFile(new URL("../modules/adaptive-learning/index.js", import.meta.url), "utf8");
const routes = await readFile(new URL("../modules/adaptive-learning/study-prep/routes.js", import.meta.url), "utf8");
const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");

test("the union events schema: sequence uniqueness, S5 origins, S4 thought types and durations", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS edu\.study_prep_events/);
  assert.match(sql, /UNIQUE \(session_id, sequence\)/);
  assert.match(sql, /'agent_tool_call', 'agent_action', 'harness_decision',\s*'observation', 'human_gate', 'engine_result'/);
  assert.match(sql, /'agent_stated_intent', 'harness', 'engine'/);
  assert.match(sql, /thought_type/);
  assert.match(sql, /duration_ms/);
  assert.match(sql, /agent_intent\s+TEXT CHECK \(agent_intent IS NULL OR char_length\(agent_intent\) <= 240\)/);
  assert.match(sql, /policy_version/);
});

test("session and topic state machines match the plan (§1.3)", () => {
  assert.match(sql, /'planning', 'awaiting_confirmation', 'topic_active',\s*'replanning', 'paused', 'completed', 'abandoned', 'cancelled'/);
  assert.match(sql, /'queued', 'active', 'understood', 'flagged_gap', 'capped_out', 'deferred'/);
  assert.match(sql, /'agent_loop_cap', 'insufficient_balance', 'learner_requested'/);
  assert.match(sql, /position\s+INTEGER NOT NULL CHECK \(position BETWEEN 1 AND 12\)/);
  // one active session per learner, airtight under concurrency
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_study_prep_sessions_one_active/);
});

test("the workflow projection links to sessions and attempts roll up to topics (§4.8.3)", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS study_prep_session_id/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS study_prep_topic_id/);
});

test("events are append-only for the service role — no UPDATE/DELETE grant", () => {
  const eventsGrant = sql.slice(sql.indexOf("GRANT SELECT, INSERT ON edu.study_prep_events"));
  assert.ok(eventsGrant.includes("TO service_role"));
  assert.ok(!eventsGrant.includes("UPDATE"));
  assert.ok(!eventsGrant.includes("DELETE"));
});

test("the chat tools are plan-only: no model-callable confirm/advance/generate (S5 §6.3)", () => {
  assert.match(chat, /name: "start_study_prep_session"/);
  assert.match(chat, /name: "get_study_prep_session"/);
  assert.match(chat, /featureGate: "study_prep"/);
  assert.match(chat, /AKORO_STUDY_PREP_ENABLED/);
  // the plan-only contract, stated in the tool description itself
  assert.match(chat, /Plan-only — no practice is generated and nothing is charged until the learner approves the plan card/);
  // and there is NO chat tool that confirms, advances, defers or generates
  assert.doesNotMatch(chat, /name: "confirm_study_prep/);
  assert.doesNotMatch(chat, /name: "advance_study_prep/);
  assert.doesNotMatch(chat, /name: "generate_study_prep/);
});

test("the REST surface mounts under /api/adaptive/study-prep behind auth", () => {
  assert.match(index, /import studyPrepRouter\s+from "\.\/study-prep\/routes\.js"/);
  assert.match(index, /router\.use\("\/study-prep",\s+authenticateToken, studyPrepRouter\)/);
});

test("every route responds with one envelope and a stable code on failure", () => {
  // the shared fail() helper carries a code; no bare res.status(...).json({ success:false }) without one
  const bare = routes.match(/res\.status\(\d+\)\.json\(\{\s*success:\s*false,\s*error/g);
  assert.equal(bare, null, "no codeless failure envelopes");
  assert.match(routes, /fail\(res, (\d+), "([a-z_]+)",/);
  assert.match(routes, /study_prep_disabled/);
  assert.match(routes, /insufficient_balance/);
  // 402 is money-only; 500 is genuine faults only
  assert.match(routes, /500, "study_prep_fault"/);
});

test("the study-prep flags ship DEFAULT-ON (kill switches), like peer consult", () => {
  assert.match(env, /AKORO_STUDY_PREP_ENABLED=true/);
  assert.match(env, /AKORO_EXAM_PREP_CONFIDENCE_ENABLED=true/);
  assert.match(env, /AKORO_ADAPTIVE_WORKFLOWS_ENABLED=true/);
  // the opt-in slices stay off
  assert.match(env, /AKORO_CONCEPT_TRACKER_ENABLED=false/);
  assert.match(env, /AKORO_LEARNER_INSIGHTS_ENABLED=false/);
  // every runtime read uses kill-switch semantics (absent env = enabled)
  assert.match(chat, /AKORO_STUDY_PREP_ENABLED \?\? "true"/);
  assert.match(chat, /AKORO_EXAM_PREP_CONFIDENCE_ENABLED \?\? "true"/);
});

test("study-prep sessions ride the reply as a session echo (the activity-draft pattern)", () => {
  assert.match(chat, /start_study_prep_session" && toolResult\?\.sessionId/);
  assert.match(chat, /get_study_prep_session" && toolResult\?\.sessions\?\.\[0\]\?\.sessionId/);
  assert.match(chat, /\? \{ session: \{ id: toolResult\.sessionId \|\| toolResult\.sessions\[0\]\.sessionId \} \}/);
});

test("the plan-card endpoints exist: confirm, adjust, teach-back gate, pause/resume/cancel", () => {
  for (const endpoint of [
    'router.post("/sessions"', 'router.get("/sessions/:id"', 'router.post("/sessions/:id/confirm"',
    'router.post("/sessions/:id/adjust"', 'router.post("/sessions/:id/topics/:topicId/practice"',
    'router.post("/sessions/:id/topics/:topicId/submit"', 'router.post("/sessions/:id/topics/:topicId/teach-back-done"',
    'router.post("/sessions/:id/next"', 'router.post("/sessions/:id/advance"', 'router.post("/sessions/:id/defer"',
    'router.post("/sessions/:id/conclude"', 'router.post("/sessions/:id/pause"', 'router.post("/sessions/:id/resume"',
    'router.post("/sessions/:id/cancel"',
  ]) {
    assert.ok(routes.includes(endpoint), `${endpoint} is mounted`);
  }
});
