import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateFollowUpInput, nextOccurrence } from "./chat-follow-up-validation.js";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
const { formatToolRows } = await import("./chat-follow-ups.js");

const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

test("repeat: daily/weekdays/hourly accepted, defaults bounded; anything else refused", () => {
  const v = validateFollowUpInput({ message: "Your daily subject check", scheduledAt: inHours(2), repeat: "daily" });
  assert.equal(v.repeat, "daily");
  assert.equal(Math.round((Date.parse(v.repeatUntil) - Date.parse(v.scheduledAt)) / 86_400_000), 30);
  assert.equal(validateFollowUpInput({ message: "x", scheduledAt: inHours(2) }).repeat, null, "one-off by default");
  const h = validateFollowUpInput({ message: "x", scheduledAt: inHours(2), repeat: "hourly" });
  assert.equal(h.repeat, "hourly");
  assert.equal(Math.round((Date.parse(h.repeatUntil) - Date.parse(h.scheduledAt)) / 86_400_000), 1, "hourly defaults to a 1-day series");
  assert.throws(() => validateFollowUpInput({ message: "x", scheduledAt: inHours(2), repeat: "hourly", repeatDays: 30 }), /repeatDays/);
  assert.throws(() => validateFollowUpInput({ message: "x", scheduledAt: inHours(2), repeat: "minutely" }), /repeat/);
  assert.throws(() => validateFollowUpInput({ message: "x", scheduledAt: inHours(2), repeat: "daily", repeatDays: 365 }), /repeatDays/);
  assert.throws(() => validateFollowUpInput({ message: "x", scheduledAt: inHours(2), runTool: "DROP TABLE" }), /runTool/);
  assert.equal(validateFollowUpInput({ message: "x", scheduledAt: inHours(2), runTool: "untouched_subjects" }).runTool, "untouched_subjects");
});

test("nextOccurrence: hourly advances one hour and ends at repeatUntil", () => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  assert.equal(nextOccurrence({ scheduledAt: "2026-11-05T15:30:00.000Z", repeat: "hourly", timezone: "Africa/Lagos", now }), "2026-11-05T16:30:00.000Z");
  assert.equal(nextOccurrence({ scheduledAt: "2026-11-05T15:30:00.000Z", repeat: "hourly", repeatUntil: "2026-11-05T16:00:00Z", timezone: "Africa/Lagos", now }), null);
});

test("nextOccurrence: same clock time next day; weekdays skip Sat/Sun in the learner's zone; ends at repeatUntil", () => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  // Thu 5 Nov 2026, 16:30 Lagos (15:30Z)
  const thu = "2026-11-05T15:30:00.000Z";
  assert.equal(nextOccurrence({ scheduledAt: thu, repeat: "daily", timezone: "Africa/Lagos", now }), "2026-11-06T15:30:00.000Z");
  const fri = "2026-11-06T15:30:00.000Z";
  assert.equal(nextOccurrence({ scheduledAt: fri, repeat: "weekdays", timezone: "Africa/Lagos", now }), "2026-11-09T15:30:00.000Z", "Friday → Monday");
  assert.equal(nextOccurrence({ scheduledAt: thu, repeat: "daily", repeatUntil: "2026-11-05T20:00:00Z", timezone: "Africa/Lagos", now }), null, "series over");
  assert.equal(nextOccurrence({ scheduledAt: thu, repeat: null, now }), null, "one-off has no next");
});

test("nextOccurrence never schedules in the past: a late delivery skips to the next future day", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const next = nextOccurrence({ scheduledAt: "2026-11-05T15:30:00.000Z", repeat: "daily", timezone: "Africa/Lagos", now });
  assert.equal(next, "2026-11-10T15:30:00.000Z");
});

test("formatToolRows: a short plain list, capped", () => {
  assert.equal(formatToolRows({ rows: [] }), "Nothing to list today.");
  const out = formatToolRows({ rows: Array.from({ length: 15 }, (_, i) => ({ subject: `Subject ${i}`, sessions: 0 })), total: 15 });
  assert.match(out, /^- Subject 0 · 0/);
  assert.match(out, /…and 3 more\.$/);
});

test("wiring: the agent's tool offers repeat + runTool, and runTool must be the learner's own active tool", async () => {
  const chat = await readFile(new URL("../chat.js", import.meta.url), "utf8");
  assert.match(chat, /repeat: \{ type: "string", enum: \["daily", "weekdays", "hourly"\]/);
  assert.match(chat, /isn't one of the learner's active tools/);
  const fu = await readFile(new URL("./chat-follow-ups.js", import.meta.url), "utf8");
  assert.match(fu, /One pending occurrence per series/);
  assert.match(fu, /if \(out\.status \|\| out\.action\) return null;   \/\/ a change tool never runs from a schedule/);
});
