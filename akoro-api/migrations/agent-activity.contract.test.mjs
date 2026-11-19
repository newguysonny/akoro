import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * The agent's header subtitle streams what the agent is doing RIGHT NOW
 * ("Checking your schedule…", "Preparing a check-in…", "Creating a
 * battle…") instead of a static "Your learning agent". Background workers
 * and tool loops emit best-effort labels to the user's socket room; the
 * learner header streams them live and falls back when quiet.
 */

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [lib, autonomy, followUps, worker, chat, dashboard, tab] = await Promise.all([
  read("../../akoro-api/lib/agentActivity.js"),
  read("../../akoro-api/modules/adaptive-learning/learner-autonomy.js"),
  read("../../akoro-api/modules/adaptive-learning/chat/chat-follow-ups.js"),
  read("../../akoro-api/modules/tasks/worker.js"),
  read("../../akoro-api/modules/adaptive-learning/chat.js"),
  read("../../akoro-learner/src/pages/LearnerDashboard.jsx"),
  read("../../akoro-learner/src/components/tabs/AgentChatTab.jsx"),
]);

test("the emitter is best-effort and speaks human labels", () => {
  assert.match(lib, /export function reportAgentActivity/);
  assert.match(lib, /export function agentToolActivity/);
  assert.match(lib, /export function clearAgentActivity/);
  // Only mapped tools speak; the room is user:<id>; never throws.
  assert.match(lib, /TOOL_LABELS\[String\(tool \|\| ""\)\]/);
  assert.match(lib, /user:\$\{id\}/);
  assert.match(lib, /a status line must never break the work it describes/);
});

test("background workers report what they are doing — and clear when done", () => {
  // Autonomy: checking the schedule at claim, clear before delivery completes.
  assert.match(autonomy, /reportAgentActivity\(review\.user_id, "Checking your schedule/);
  assert.match(autonomy, /clearAgentActivity\(review\.user_id\)/);
  // Scheduled follow-ups: preparing a check-in.
  assert.match(followUps, /reportAgentActivity\(followUp\.user_id, "Preparing a check-in for you/);
  assert.match(followUps, /clearAgentActivity\(followUp\.user_id\)/);
  // Task runs: working on <title>, per-tool labels, all through the lib.
  assert.match(worker, /reportAgentActivity\(task\.creator_id, `Working on "/);
  assert.match(worker, /agentToolActivity\(task\.creator_id, name\)/);
  // Active chats: tool turns stream to the header as well.
  assert.match(chat, /agentToolActivity\(studentId, tool\)/);
});

test("the learner header streams the activity and falls back when quiet", () => {
  // The dashboard owns the live socket (its inline effect) and absorbs
  // events; a 90s quiet stretch reverts to the static subtitle.
  assert.match(dashboard, /socket\.on\("agent:activity"/);
  assert.match(dashboard, /absorbAgentActivity\(label\)/);
  assert.match(dashboard, /setTimeout\(\(\) => setAgentActivity\(null\), 90_000\)/);
  assert.match(dashboard, /agentActivity=\{agentActivity\}/);
  // The header shows the live label with a pulse. Quiet falls back to the
  // resting "Idle" line — the old "status · agent name" composite was
  // replaced by a dedicated status strip with honest transient states
  // ("Checking agent…", "Agent offline") in the consent + Idle redesigns.
  assert.match(tab, /agentActivity = null/);
  assert.match(tab, /animation:"pulse-dot 1\.4s ease-in-out infinite"/);
  assert.match(tab, /agentActivity \|\| "Idle"/);
  assert.match(tab, /!agentOnline \? "Agent offline"/);
});
