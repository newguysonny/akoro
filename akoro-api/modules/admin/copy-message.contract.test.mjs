import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Every chat message carries a subtle copy affordance (frontend-only): it
// copies the exact text via the clipboard API, falls back to execCommand for
// older webviews, confirms with a brief check, and never throws into chat.

const instructorPage = await readFile(
  new URL("../../../akoro-instructor/src/pages/ChatPage.jsx", import.meta.url), "utf8");
const learnerTab = await readFile(
  new URL("../../../akoro-learner/src/components/tabs/AgentChatTab.jsx", import.meta.url), "utf8");
const sessionChat = await readFile(
  new URL("../../../akoro-learner/src/components/teaching/SessionChatView.jsx", import.meta.url), "utf8");
const learnerButton = await readFile(
  new URL("../../../akoro-learner/src/components/common/CopyMessageButton.jsx", import.meta.url), "utf8");
const apiChat = await readFile(
  new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");

test("all three chat surfaces render a per-message copy button", () => {
  assert.match(instructorPage, /<CopyMsgButton text=\{textPart\} \/>/);
  assert.match(instructorPage, /function CopyMsgButton/);
  assert.match(learnerTab, /<CopyMessageButton text=\{msg\.text\} \/>/);
  // The teaching-session surface has it on BOTH sides of the conversation.
  const copyCount = sessionChat.match(/<CopyMessageButton text=\{m\.text\} dark \/>/g)?.length ?? 0;
  assert.equal(copyCount, 2);
});

test("the copy action degrades gracefully and confirms — it never throws", () => {
  for (const src of [instructorPage, learnerButton]) {
    assert.match(src, /navigator\.clipboard\.writeText/);      // modern path
    assert.match(src, /execCommand\('copy'\)/);                // legacy webview fallback
    assert.match(src, /setTimeout\(\(\) => setDone\(false\), 1400\)/); // check-then-revert
    assert.match(src, /return false;\s*\} catch \{ return false; \}|catch \{ return false; \}/);
  }
});

test("the agent chat drawer's session rows carry a kebab options menu", () => {
  // ONE affordance per row — a vertical-dots button opening a small menu
  // with the three actions: copy the whole chat, rename it, delete it.
  assert.match(learnerTab, /<Icon name="ti-dots-vertical" size=\{14\}/);
  assert.match(learnerTab, /"Copy chat"/);
  assert.match(learnerTab, /"Rename"/);
  assert.match(learnerTab, /"Delete"/);
  assert.match(learnerTab, /data-session-menu/, "menu + kebab share the outside-click guard");
  assert.match(learnerTab, /openUp=idx>=sessions\.length-2/, "bottom rows open the menu upward so it never clips");
});

test("the drawer's menu copies a WHOLE session for research", () => {
  // Pulls the FULL conversation from the server (not just what's on
  // screen), formats it role-labelled, copies via the shared helper.
  assert.match(learnerTab, /const copySession = async \(s, e\)/);
  assert.match(learnerTab, /copySession\(s\);/);                                      // fired from the menu item
  assert.match(learnerTab, /\/sessions\/\$\{s\.id\}\/messages/);                      // the FULL conversation from the server
  assert.match(learnerTab, /copyPlainText/);                                          // the shared clipboard helper
  assert.match(learnerTab, /m\.role === "user" \? "You" : "Agent"/);                  // role-labelled for research
  assert.match(learnerTab, /copiedId===s\.id/, "check-then-revert confirmation");
  assert.match(learnerTab, /\} catch \{ \/\* leave the icon untouched \*\/ \}/);      // never throws into the tab
});

test("rename goes through the API's owner-scoped PATCH", () => {
  assert.match(learnerTab, /apiPatch\(`/);
  assert.match(learnerTab, /saveRename/);
  assert.match(learnerTab, /d\.session\.title/, "the server-normalized title wins in the list");
  assert.match(learnerTab, /apiPatch/, "services/api exports apiPatch");
  assert.match(apiChat, /router\.patch\("\/sessions\/:id"/, "PATCH /sessions/:id exists");
  assert.match(apiChat, /sessionTitleFrom\(req\.body\?\.title\)/, "…and normalizes the title like create does");
});
