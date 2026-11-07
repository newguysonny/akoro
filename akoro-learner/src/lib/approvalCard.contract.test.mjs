import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (f) => readFile(new URL(f, import.meta.url), "utf8");

test("one approval card: every approval row is ApprovalButtons — Allow / Reject / Later", async () => {
  const [btns, tab, confirm] = await Promise.all([
    read("../components/tabs/agentChat/ApprovalButtons.jsx"), read("../components/tabs/AgentChatTab.jsx"), read("../components/tabs/agentChat/ConfirmChangeCard.jsx"),
  ]);
  for (const label of [">Allow<|'Allow'", "Reject", "Later"]) assert.match(btns, new RegExp(label));
  assert.match(btns, /Saved for later — it waits in Tasks → Needs you\./, "Later changes nothing on the server");
  assert.match(tab, /<ApprovalButtons /);
  assert.equal((confirm.match(/<ApprovalButtons /g) || []).length, 2, "the change card and the permission card");
  assert.doesNotMatch(confirm, /Not now\s*<\/button>/);
});

test("cards and chips arrive on the stream: a card when the tool makes it, chips right after the reply", async () => {
  const [api, tab, serverChat] = await Promise.all([
    read("../services/api.js"), read("../components/tabs/AgentChatTab.jsx"), read("../../../akoro-api/modules/adaptive-learning/chat.js"),
  ]);
  assert.match(api, /event === 'card'\) \{ onCard\?\.\(parsed\); \}/);
  assert.match(api, /event === 'suggestions'\) \{ onSuggestions\?\./);
  assert.match(tab, /inlineSuggestions: true/);
  assert.match(tab, /!inlineIdeas\)\{\s*\n\s*apiPost\('\/api\/adaptive\/chat\/suggestions'/, "the second request only when the stream had no chips");
  assert.match(serverChat, /trace\?\.card\?\.\(\{ tool, confirm: executions\.at\(-1\)\.confirm \}\)/);
  assert.match(tab, /data\.message\?\.id \? \{ messages: \[data\.message\] \}/, "a pinged message shows without a refetch");
});
