import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = await readFile(new URL("./deliver.js", import.meta.url), "utf8");
const cycle = await readFile(new URL("./cycle.js", import.meta.url), "utf8");
const index = await readFile(new URL("./index.js", import.meta.url), "utf8");
const inbox = await readFile(new URL("../agent-proposals/inbox.js", import.meta.url), "utf8");
const tab = await readFile(new URL("../../../akoro-learner/src/components/tabs/AgentChatTab.jsx", import.meta.url), "utf8");

test("which chat (D49): the idea's own chat if used in 7 days, else the latest, else a new one", () => {
  assert.match(src, /SOURCE_CHAT_DAYS: 7/);
  const pick = src.slice(src.indexOf("export async function chatFor"), src.indexOf("export async function deliverProactive"));
  assert.ok(pick.indexOf("sourceChatId") < pick.indexOf('order("last_message_at"'), "source first");
  assert.match(pick, /data\.last_message_at >= since/);
  assert.match(pick, /insert\(\{ user_id: userId, title:/, "a new chat only when there is none");
});

test("when: not in quiet hours, not mid-chat, once a day — claimed once", () => {
  assert.match(src, /if \(!ignoreQuietHours && inQuietHours\(now\)\) return \{ posted: false, reason: "quiet_hours" \}/);
  assert.match(src, /BUSY_MS: 10 \* 60 \* 1000/);
  assert.match(src, /reason: "chat_busy"/);
  assert.match(src, /DAILY: 1/);
  assert.match(src, /\.is\("posted_at", null\)\.eq\("status", "proposed"\)\.select\("id"\)\.maybeSingle\(\)/, "claim first");
});

test("how: an agent message written by code, carrying the proposal; a link to that chat", () => {
  assert.match(src, /`One thing I noticed: \$\{why\}/);
  assert.match(src, /role: "agent", text: proactiveMessage\(p\), meta/);
  assert.match(src, /link: `\/app\?tab=agent&sessionId=\$\{encodeURIComponent\(target\.chatId\)\}`/);
});

test("wired: the planner tags the source note and posts after a run; a sweep retries; decisions sync", () => {
  assert.match(cycle, /required: \["kind", "title", "rationale", "from_note", "payload"\]/);
  assert.match(cycle, /sourceChatId: note\?\.chatId \|\| null/);
  assert.match(cycle, /const delivered = await deliverProactive\(userId\)/);
  assert.match(cycle, /if \(!delivered\.posted\) await notifyUser\(\{/, "one bell row when nothing was posted");
  assert.match(index, /if \(\+\+deliveryTicks % 10 === 0\) deliverDue\(\)/);
  assert.equal((inbox.match(/await markPostedDecision\(/g) || []).length, 3, "executed, failed, dismissed");
  assert.match(tab, /\.\.\.\(m\.role !== "user" && m\.meta\?\.proposal \? \{ proposal: m\.meta\.proposal \} : \{\}\)/);
  assert.match(tab, /onClick=\{\(\)=>decidePosted\(msg,"accept"\)\}/);
  assert.match(tab, /decidePosted\(msg,"wrong_time"\)/);
  assert.match(tab, /decidePosted\(msg,"not_useful"\)/);
});
