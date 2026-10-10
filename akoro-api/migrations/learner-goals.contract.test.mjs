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
const [migration, routes, chat, settingsTab, goalService] = await Promise.all([
  read("./2026-learner-goals.sql"),
  read("../../akoro-api/modules/learner-goals/routes.js"),
  read("../../akoro-api/modules/adaptive-learning/chat.js"),
  read("../../akoro-learner/src/pages/settings/agentTab.jsx"),
  read("../../akoro-api/modules/learner-goals/service.js"),
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
  // Every route authenticates; the service is the ONE write path (routes and
  // the agent's chat tools share it), ownership rides user_id inside it.
  assert.equal((routes.match(/authenticateToken/g) || []).length >= 4, true);
  assert.match(routes, /import \{ listGoals, createGoal, updateGoal \} from "\.\/service\.js";/);
  assert.match(goalService, /\.eq\("user_id", userId\)/);
  // Active-goal cap with an actionable message.
  assert.match(goalService, /MAX_ACTIVE_GOALS = 10/);
  assert.match(goalService, /achieve, pause or remove one first/);
  // Status transitions are whitelisted; provenance defaults to learner.
  assert.match(goalService, /GOAL_STATUSES = \["active", "paused", "achieved", "dismissed"\]/);
  assert.match(goalService, /Unknown goal status\./);
  assert.match(goalService, /\{ source = "learner" \}/);
});

test("the agent knows the learner's active goals in every chat", () => {
  assert.match(chat, /from\("learner_goals"\)/);
  assert.match(chat, /\.eq\("status", "active"\)/);
  assert.match(chat, /align advice and suggestions with these/);
  // Students only, best-effort, and it rides the system prompt.
  assert.match(chat, /if \(role === "student"\)/);
  // No goals adds nothing — never the word "undefined" into the prompt.
  assert.match(chat, /\(goalsCtx \|\| ""\) \+/);
});

test("settings manages goals with the shared loading/lock primitives", () => {
  assert.match(settingsTab, /apiGet\('\/api\/goals'\)/);
  assert.match(settingsTab, /runGoalSave/);            // one request at a time
  assert.match(settingsTab, /function GoalsSheet/);    // title + category + date
  assert.match(settingsTab, /toggleAchieved/);
  assert.match(settingsTab, /confirmDialog\(\{ title: 'Remove goal'/);
});
