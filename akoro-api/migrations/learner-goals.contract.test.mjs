import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Step 1 of Full Autonomy (docs/learner-full-autonomy-plan.md): the goals
 * model. The learner's educational goals get a real table, own CRUD, and a
 * voice in the agent's system prompt. The agent NEVER writes goals on its
 * own — 'agent'-sourced rows appear only via approved proposals (later step).
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [migration, routes, chat, settingsTab] = await Promise.all([
  read("./2026-learner-goals.sql"),
  read("../../akoro-api/modules/learner-goals/routes.js"),
  read("../../akoro-api/modules/adaptive-learning/chat.js"),
  read("../../akoro-learner/src/pages/settings/agentTab.jsx"),
]);

test("goals are a real table with status and provenance discipline", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS edu\.learner_goals/);
  assert.match(migration, /status\s+TEXT NOT NULL DEFAULT 'active'/);
  assert.match(migration, /CHECK \(status IN \('active','paused','achieved','dismissed'\)\)/);
  // The agent never inserts on its own — provenance is tracked for the
  // approval flow that arrives with the proposal inbox.
  assert.match(migration, /CHECK \(source IN \('learner','agent'\)\)/);
  assert.match(migration, /idx_edu_learner_goals_user/);
});

test("the goals API is the learner's own — capped, validated, owned", () => {
  // Every route authenticates; ownership rides user_id on patch/delete.
  assert.equal((routes.match(/authenticateToken/g) || []).length >= 4, true);
  assert.match(routes, /\.eq\("user_id", req\.user\.id\)/);
  // Active-goal cap with an actionable message.
  assert.match(routes, /MAX_ACTIVE_GOALS = 10/);
  assert.match(routes, /achieve, pause or remove one first/);
  // Status transitions are whitelisted.
  assert.match(routes, /GOAL_STATUSES = \["active", "paused", "achieved", "dismissed"\]/);
  assert.match(routes, /Unknown goal status\./);
});

test("the agent knows the learner's active goals in every chat", () => {
  assert.match(chat, /from\("learner_goals"\)/);
  assert.match(chat, /\.eq\("status", "active"\)/);
  assert.match(chat, /align advice and suggestions with these/);
  // Students only, best-effort, and it rides the system prompt.
  assert.match(chat, /if \(role === "student"\)/);
  assert.match(chat, /\(goalsCtx \|\| undefined\) \+/);
});

test("settings manages goals with the shared loading/lock primitives", () => {
  assert.match(settingsTab, /apiGet\('\/api\/goals'\)/);
  assert.match(settingsTab, /runGoalSave/);            // one request at a time
  assert.match(settingsTab, /function GoalsSheet/);    // title + category + date
  assert.match(settingsTab, /toggleAchieved/);
  assert.match(settingsTab, /confirmDialog\(\{ title: 'Remove goal'/);
});
