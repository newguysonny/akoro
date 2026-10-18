import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Agent suggestions contract — the chat page's Tasks tab grows a third pill
 * (To do / Done / Suggestions). Suggestions are the agent's proactive ideas
 * (task / goal / conversation), filed by the `suggest_help` chat tool. They
 * are advice only: accept creates the real task, dismiss closes the idea.
 * The chat header moved into the sessions drawer — avatar, name and online
 * status included — and the customize modal is gone (Settings owns it).
 */
const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [inbox, migration, manifest, routes, chat, page, taskApi, en] = await Promise.all([
  read("../../akoro-api/modules/agent-proposals/inbox.js"),
  read("./2026-agent-suggestions.sql"),
  read("./manifest.json"),
  read("../../akoro-api/modules/tasks/routes.js"),
  read("../../akoro-api/modules/adaptive-learning/chat.js"),
  read("../../akoro-learner/src/components/tabs/AgentChatTab.jsx"),
  read("../../akoro-learner/src/hooks/useTaskAPI.js"),
  read("../../akoro-learner/src/contexts/i18n/en.js"),
]);

test("the migration gives suggestions a real, provenance-keeping table", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS agent_suggestions/);
  assert.match(migration, /kind\s+TEXT NOT NULL DEFAULT 'task'/);
  assert.match(migration, /status\s+TEXT NOT NULL DEFAULT 'open'/);
  assert.match(migration, /task_id\s+UUID/);
  assert.match(migration, /session_id\s+UUID/);
  assert.match(migration, /REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(manifest, /2026-agent-suggestions\.sql/, "manifest registers the migration");
});

test("the API serves, accepts and dismisses suggestions — always user-scoped", () => {
  // "/suggestions" must be declared before "/:taskId" so it is never read as a task id.
  assert.ok(routes.indexOf('router.get("/suggestions"') < routes.indexOf('router.get("/:taskId"'),
    "suggestions routes precede the task-id route");
  assert.match(routes, /\.eq\("user_id", req\.user\.id\)\.eq\("status", "open"\)/, "open rows for this user only");
  // The routes go through the one inbox service (agent-proposals/inbox.js).
  const accept = routes.slice(routes.indexOf('"/suggestions/:id/accept"'), routes.indexOf('"/suggestions/:id/dismiss"'));
  assert.match(accept, /acceptChatSuggestion\(req\.user\.id, req\.params\.id, \{ asTask: true \}\)/, "the Tasks tab's accept still makes a task (its UI says so)");
  assert.match(routes, /dismissChatSuggestion\(req\.user\.id, req\.params\.id, req\.body\?\.reason\)/);
  // Accept does what the kind says: a task, a goal, or the chat to start — claimed first.
  const take = inbox.slice(inbox.indexOf("export async function acceptChatSuggestion"), inbox.indexOf("export async function dismissChatSuggestion"));
  assert.match(take, /\.update\(\{ status: "accepted", resolved_at: now\(\) \}\)[\s\S]*\.eq\("status", "open"\)/, "claim first: a double tap acts once");
  assert.match(take, /createGoal\(userId, \{ title: sg\.title \}, \{ source: "agent" \}\)/, "a goal suggestion becomes a goal");
  assert.match(take, /kind === "conversation"[\s\S]*prompt: sg\.title/, "a conversation is handed back to start the chat");
  assert.match(take, /db\.from\("tasks"\)\.insert\(/, "a task suggestion inserts a real task");
  assert.match(take, /update\(\{ task_id: task\.id \}\)/, "the suggestion keeps its task link");
  assert.match(take, /emit\("task:created"/, "same live signal as the agent's own create_task");
  // Dismiss: never deletes, just closes with the reason — and 404s when there is nothing to close.
  assert.match(inbox, /status: "dismissed", resolved_at: now\(\), dismiss_reason: reasonOf\(reason\)/);
  assert.match(inbox, /fail\("Suggestion not found", 404\)/);
});

test("the agent files suggestions through the suggest_help chat tool", () => {
  assert.match(chat, /name: "suggest_help"/);
  assert.match(chat, /enum: \["task", "goal", "conversation"\]/, "task / goal / conversation kinds");
  assert.match(chat, /required: \["kind", "title", "rationale"\]/, "the why is not optional");
  const executor = chat.slice(chat.indexOf('case "suggest_help"'), chat.indexOf('case "schedule_chat_follow_up"'));
  assert.match(executor, /db\.from\("agent_suggestions"\)\.insert\(/);
  assert.match(executor, /session_id: conversationId/, "the chat session that produced it");
  assert.match(chat, /"create_task", "suggest_help",/, "registered as side-effecting in the tool transcript");
});

test("the Tasks tab is To do / Done / Suggestions, and suggestions are advice only", () => {
  assert.match(page, /\["pending",t\('agent\.to_do'\)\],\["done",t\('agent\.done'\)\],\["suggestions",t\('agent\.suggestions'\)\]/);
  assert.match(page, /agent\.suggestions_empty/);
  assert.match(page, /acceptSuggestion\(sg\)/);
  assert.match(page, /dismissSuggestion\(sg\)/);
  assert.match(taskApi, /apiPost\(`\/api\/tasks\/suggestions\/\$\{sg\.id\}\/accept`\)/);
  assert.match(taskApi, /apiPatch\(`\/api\/tasks\/suggestions\/\$\{id\}\/dismiss`\)/);
  // A filed suggestion refreshes the list live, stream and JSON path alike.
  assert.equal((page.match(/tool === "suggest_help" && entry\?\.success/g) || []).length, 2);
  // Nothing auto-creates tasks from suggestions — accept is a learner action.
  assert.doesNotMatch(taskApi, /acceptSuggestion[\s\S]*?createTask\(/);
});

test("the chat header lives in the drawer now; customise is Settings' job", () => {
  // Header bar gone: no customise button, no customize sheet, no draft state.
  assert.doesNotMatch(page, /agent\.customise/);
  assert.doesNotMatch(page, /custOpen|draftName|draftEmoji/);
  assert.doesNotMatch(page, /putAgent/);
  // Drawer identity: avatar with online dot, agent name, autonomy toggle.
  const drawer = page.slice(page.indexOf("drawerOpen&&("));
  assert.match(drawer, /agentOnline\?GREEN:"var\(--ak-text-muted\)"/, "online dot");
  assert.match(drawer, /\{shownName\}/, "agent name");
  assert.match(drawer, /onToggleAgentAutonomy/, "online status stays a working toggle");
  assert.match(drawer, /t\('agent\.chats'\)/, "the chats list survives below the identity");
});
