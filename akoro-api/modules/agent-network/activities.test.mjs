import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";
const { lagosDay, weekStart, dailyStart, upcomingDay, dailyKey, DAILY_START_HOUR, DAILY_SEATS } = await import("./activities.js");
const src = await readFile(new URL("./activities.js", import.meta.url), "utf8");
const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");

test("Lagos day and week boundaries", () => {
  assert.equal(lagosDay(Date.parse("2026-10-10T23:30:00Z")), "2026-10-11");        // 00:30 WAT
  assert.equal(weekStart(Date.parse("2026-10-14T12:00:00Z")), "2026-10-11T23:00:00.000Z");   // Mon 00:00 WAT
  assert.equal(weekStart(Date.parse("2026-10-11T22:30:00Z")), "2026-10-04T23:00:00.000Z");   // still Sunday in Lagos
});

test("circles start once; leagues honour opt-out; buddy check-ins carry no marks", () => {
  assert.match(src, /\.update\(\{ status: "running" \}\)\.eq\("id", c\.id\)\.in\("status", \["open", "full"\]\)\.is\("battle_id", null\)/);
  assert.match(src, /show_on_leaderboards", false/);
  assert.match(src, /never marks or messages/);    // a buddy check-in carries goal progress and XP only
  for (const name of ["study_buddy", "daily_challenge", "revision_circle", "get_weekly_league"]) {
    assert.match(chat, new RegExp(`name: "${name}",`));
    assert.match(chat, new RegExp(`case "${name}": \\{`));
  }
});

test("the daily battle: a real battle every day at 7 PM Lagos, seats roll over to tomorrow once it starts", () => {
  assert.equal(DAILY_START_HOUR, 19);
  assert.equal(dailyStart("2026-10-10"), "2026-10-10T18:00:00.000Z");                        // 19:00 WAT
  assert.equal(upcomingDay(Date.parse("2026-10-10T17:00:00Z")), "2026-10-10");               // 18:00 WAT → today's
  assert.equal(upcomingDay(Date.parse("2026-10-10T17:59:30Z")), "2026-10-11");               // under a minute to go → tomorrow's
  assert.equal(upcomingDay(Date.parse("2026-10-10T20:00:00Z")), "2026-10-11");
  assert.equal(dailyKey("2026-10-10", " Mathematics ", 2), "daily:2026-10-10:mathematics:2");
  assert.equal(DAILY_SEATS, 30);
  // Played in the normal arena: a battles row the worker starts, not a separate quiz.
  assert.match(src, /db\.from\("battles"\)\.insert\(\{[\s\S]*?recurring_key: key/);
  assert.match(src, /addLater\(battleQueue, "start-battle"/);   // a 7 PM start waits in Postgres (lib/deferredJobs.js)
  assert.doesNotMatch(src, /daily_challenge_attempts/);
  // An automatic join never undoes a skip.
  assert.match(src, /if \(seat\.declined_at && !auto\)/);
});
