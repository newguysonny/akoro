import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { mergeInbox, parseRef, reasonOf, normalizeTitle } from "./inboxCore.js";
const src = await readFile(new URL("./inbox.js", import.meta.url), "utf8");
const cycle = await readFile(new URL("../autonomy/cycle.js", import.meta.url), "utf8");
const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");

test("one list over both sources, newest first, each idea once", () => {
  const items = mergeInbox({
    suggestions: [
      { id: "a", kind: "task", title: "Revise titration!", rationale: "weak topic", created_at: "2026-10-18T10:00:00Z" },
      { id: "b", kind: "conversation", title: "Talk through moles", created_at: "2026-10-18T08:00:00Z" },
    ],
    proposals: [
      { id: "c", kind: "task", title: "revise  TITRATION", rationale: "planner", created_at: "2026-10-18T09:00:00Z", expires_at: "2026-10-25T09:00:00Z" },
      { id: "d", kind: "goal", title: "Score an A", created_at: "2026-10-18T11:00:00Z" },
    ],
  });
  assert.deepEqual(items.map((i) => i.ref), ["p:d", "s:a", "s:b"]);
  assert.deepEqual(items.map((i) => i.source), ["planner", "chat", "chat"]);
  assert.equal(items[1].why, "weak topic");
});

test("refs and reasons", () => {
  assert.deepEqual(parseRef("s:0f9c3e2a-0000-4000-8000-000000000000"), { source: "chat", id: "0f9c3e2a-0000-4000-8000-000000000000" });
  assert.equal(parseRef("x:nope"), null);
  assert.equal(reasonOf("wrong_time"), "wrong_time");
  assert.equal(reasonOf("rm -rf"), "other");
  assert.equal(normalizeTitle(" Revise—Titration! "), "revise titration");
});

test("approve stays claim-first and replays the chat's own tools", () => {
  const approve = src.slice(src.indexOf("export async function approveProposal"), src.indexOf("export async function dismissProposal"));
  assert.match(approve, /\.update\(\{ status: "approved", decided_at: now\(\) \}\)[\s\S]*\.eq\("status", PENDING\)/);
  assert.match(approve, /executeChatTool\("create_task"/);
  assert.match(approve, /executeChatTool\("schedule_chat_follow_up"/);
  assert.match(approve, /createGoal\(userId,/, "goals through the goals service (its cap and rules)");
  assert.match(approve, /status: "failed", decision_note/, "a failure is visible, never back to proposed");
});

test("each source skips what the other already offers; the planner notifies through notifyUser", () => {
  assert.match(cycle, /db\.from\("agent_suggestions"\)\.select\("title"\)\.eq\("user_id", userId\)\.eq\("status", "open"\)/);
  assert.match(cycle, /\.\.\.chatOpen\.map\(\(s\) => normalizeTitle\(s\.title\)\)/);
  assert.match(cycle, /await notifyUser\(\{\s*userId, type: "agent_proposals"/);
  assert.doesNotMatch(cycle, /db\.from\("notifications"\)\.insert/, "no bare insert that skips push and the socket");
  const help = chat.slice(chat.indexOf('case "suggest_help"'), chat.indexOf('case "schedule_chat_follow_up"'));
  assert.match(help, /\(await openTitles\(studentId\)\)\.has\(normalizeTitle\(title\)\)/);
});
