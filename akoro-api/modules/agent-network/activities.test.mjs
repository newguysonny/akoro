import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";
const { lagosDay, weekStart, DAILY_SIZE } = await import("./activities.js");
const src = await readFile(new URL("./activities.js", import.meta.url), "utf8");
const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");

test("Lagos day and week boundaries", () => {
  assert.equal(lagosDay(Date.parse("2026-10-10T23:30:00Z")), "2026-10-11");        // 00:30 WAT
  assert.equal(weekStart(Date.parse("2026-10-14T12:00:00Z")), "2026-10-11T23:00:00.000Z");   // Mon 00:00 WAT
  assert.equal(weekStart(Date.parse("2026-10-11T22:30:00Z")), "2026-10-04T23:00:00.000Z");   // still Sunday in Lagos
});

test("daily challenge: five shared questions, answers never sent, one go a day; circles start once; leagues honour opt-out", () => {
  assert.equal(DAILY_SIZE, 5);
  assert.match(src, /const publicQ = \(q, i\) => \(\{ n: i \+ 1, stem: q\.stem, options: q\.options/);   // no answer key in what the learner gets
  assert.match(src, /already done today's challenge/);
  assert.match(src, /\.update\(\{ status: "running" \}\)\.eq\("id", c\.id\)\.in\("status", \["open", "full"\]\)\.is\("battle_id", null\)/);
  assert.match(src, /show_on_leaderboards", false/);
  assert.match(src, /never marks or messages/);    // a buddy check-in carries goal progress and XP only
  for (const name of ["study_buddy", "daily_challenge", "revision_circle", "get_weekly_league"]) {
    assert.match(chat, new RegExp(`name: "${name}",`));
    assert.match(chat, new RegExp(`case "${name}": \\{`));
  }
});
