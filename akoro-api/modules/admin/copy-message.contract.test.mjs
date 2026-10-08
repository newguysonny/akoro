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

test("the agent chat drawer copies a WHOLE session from its row", () => {
  // The chats drawer's session rows carry a copy affordance beside the
  // delete one — for researching agent responses outside the app.
  assert.match(learnerTab, /const copySession = async \(s, e\)/);
  assert.match(learnerTab, /copySession\(s,e\)/);                       // on the row, next to delete
  assert.match(learnerTab, /\/sessions\/\$\{s\.id\}\/messages/);        // the FULL conversation from the server
  assert.match(learnerTab, /copyPlainText/);                            // the shared clipboard helper
  assert.match(learnerTab, /m\.role === "user" \? "You" : "Agent"/);    // role-labelled for research
  assert.match(learnerTab, /copiedId===s\.id/);                         // check-then-revert confirmation
  assert.match(learnerTab, /\} catch \{ \/\* leave the icon untouched \*\/ \}/); // never throws into the tab
});
