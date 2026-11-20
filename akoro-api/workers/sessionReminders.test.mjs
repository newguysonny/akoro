// Live-session reminders (workers/sessionNotifier.js): scheduled from every
// path that creates or moves a session, skipped when the session changed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { reminderPlan, staleReason } from "./sessionReminders.js";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");

test("the reminders still ahead, each with an id that carries the start time", () => {
  const now = Date.parse("2026-10-23T10:00:00Z");
  const start = "2026-10-25T10:00:00Z";
  const plan = reminderPlan("s1", start, now);
  assert.deepEqual(plan.map((r) => r.type), ["reminder_24h", "reminder_1h", "reminder_10min"]);
  assert.equal(plan[0].delayMs, 24 * 3600_000);
  assert.equal(plan[0].jobId, `reminder_24h-s1-${Date.parse(start)}`);
  assert.ok(plan.every((r) => !r.jobId.includes(":")));   // BullMQ refuses ":" in ids
  // 30 minutes before the start, only the 10-minute reminder is left
  assert.deepEqual(reminderPlan("s1", start, Date.parse(start) - 30 * 60_000).map((r) => r.type), ["reminder_10min"]);
  assert.deepEqual(reminderPlan("s1", "not a date", now), []);
  assert.deepEqual(reminderPlan(null, start, now), []);
});

test("a reminder for a cancelled, ended, deleted or moved session sends nothing", () => {
  const s = { status: "scheduled", scheduled_start: "2026-10-25T10:00:00+00:00" };
  assert.equal(staleReason(s, "2026-10-25T10:00:00Z"), null);
  assert.equal(staleReason(null, "2026-10-25T10:00:00Z"), "session_deleted");
  assert.equal(staleReason({ ...s, status: "cancelled" }, "2026-10-25T10:00:00Z"), "session_cancelled");
  assert.equal(staleReason(s, "2026-10-24T10:00:00Z"), "session_rescheduled");
});

test("every path that creates, moves or removes a session handles its reminders", async () => {
  const [live, instructor, app, notifier] = await Promise.all([
    read("../modules/courses/live-sessions-service.js"), read("../modules/instructor/service-sessions.js"), read("../app.js"), read("./sessionNotifier.js"),
  ]);
  // the old import pointed at modules/workers/ (no such folder) and queued a job type the worker never handled
  assert.match(live, /import\("\.\.\/\.\.\/workers\/sessionNotifier\.js"\)/);
  assert.doesNotMatch(live, /"schedule-reminders"/);
  assert.match(live, /m\.scheduleSessionReminders\(\{\s*sessionId:\s+session\.id/);
  assert.match(live, /m\.cancelSessionReminders\(sessionId\)/);
  assert.match(instructor, /import\("\.\.\/\.\.\/workers\/sessionNotifier\.js"\)/);
  assert.match(instructor, /m\.scheduleSessionReminders\(\{ sessionId: data\.id/);
  assert.match(instructor, /m\.cancelSessionReminders\(id\)/);
  // started at boot; far-off reminders wait in Postgres
  assert.match(app, /m\.startSessionNotifier\(\)/);
  assert.match(notifier, /addLater\(sessionQueue\(\), r\.type/);
  assert.match(notifier, /const stale = staleReason\(session, scheduledStart\)/);
});
