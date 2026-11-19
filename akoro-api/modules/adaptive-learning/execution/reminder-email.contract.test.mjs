import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("scheduled reminders can also be delivered by email", () => {
  const followUps = read("../chat/chat-follow-ups.js");
  // The check-in passes an email to notifyUser, gated by the reminder toggle and
  // the learner's overall email setting — never overriding the in-app path.
  assert.match(followUps, /notify_agent_reminders\s*!==\s*false/, "reminder-email toggle is honoured");
  assert.match(followUps, /email_enabled\s*!==\s*false/, "global email preference is honoured");
  assert.match(followUps, /email\s*=\s*\{[\s\S]{0,400}ctaUrl/, "an email payload (with a deep link) is built");
  assert.match(followUps, /await notifyUser\(\{[\s\S]{0,400}\bemail,?\s*\}\)/, "the email rides notifyUser");
});

test("the reminder-email preference is stored and exposed", () => {
  const migration = new URL("../../../migrations/2026-agent-reminder-email.sql", import.meta.url);
  assert.ok(existsSync(migration), "a migration adds the column");
  assert.match(readFileSync(migration, "utf8"), /notify_agent_reminders\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+true/i);

  const profiles = read("../../../modules/profiles/routes.js");
  assert.match(profiles, /reminderEmails:\s*notif\.notify_agent_reminders/, "GET returns reminderEmails");
  assert.match(profiles, /row\.notify_agent_reminders\s*=\s*reminderEmails/, "PATCH saves reminderEmails");
});
