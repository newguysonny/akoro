import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const chat = read("modules/adaptive-learning/chat.js");
const notify = read("modules/notify.js");
const webpush = read("modules/notifications/webpush.js");

test("/chat/agent SSE keeps long tool loops alive through Cloudflare", () => {
  // A silent tool loop + CF's ~100s idle cut + the client's non-streaming
  // fallback = the whole agent loop billed twice. The heartbeat must start
  // when the stream begins and stop when the connection closes.
  assert.match(chat, /let heartbeat = null;/);
  assert.match(chat, /res\.on\("close", stopHeartbeat\);/);
  assert.match(chat, /heartbeat = setInterval\(\(\) => \{[\s\S]*?res\.write\(": ping\\n\\n"\);[\s\S]*?\}, 20_000\);/);
  assert.match(chat, /heartbeat\.unref\?\.\(\);/);
  // Comment frames are inert: the client parser ignores blocks without data.
  assert.doesNotMatch(chat, /send\(": ping"/);
});

test("notifyUser reads notification preferences once, not per channel", () => {
  assert.equal((notify.match(/\.from\("user_notification_preferences"\)/g) || []).length, 1);
  assert.match(notify, /select\("push_enabled, email_enabled"\)/);
});

test("web push carries TTL + collapse topic and a lock-screen-sized body", () => {
  assert.match(webpush, /\{ TTL: 3600, topic \}/);
  assert.match(webpush, /String\(payload\.body \|\| ""\)\.slice\(0, 120\)/);
  assert.match(webpush, /replace\(\/\[\^A-Za-z0-9_-\]\/g, "_"\)/);
});
