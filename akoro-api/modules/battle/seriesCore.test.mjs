// node --test modules/battle/seriesCore.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { cleanRepeat, nextOccurrence, zonedToUtc, makeAt, playersFor, seriesTemplate, SERIES, occurrenceJobId } from "./seriesCore.js";

const NOW = Date.parse("2026-10-24T10:00:00Z"); // a Saturday, 11:00 in Lagos

test("cleanRepeat keeps days, time, zone and end; refuses what can't run", () => {
  const r = cleanRepeat({ days: [4, 1, 1], time: "9:05", tz: "Africa/Lagos", until: "2026-12-12T18:00:00Z" }, NOW);
  assert.deepEqual(r, { days: [1, 4], time: "09:05", tz: "Africa/Lagos", until: "2026-12-12T18:00:00.000Z" });
  assert.equal(cleanRepeat({ days: [1], time: "10:00", tz: "Nowhere/Else", until: "2026-12-01" }, NOW).tz, SERIES.DEFAULT_TZ);
  assert.throws(() => cleanRepeat({ days: [], time: "10:00", until: "2026-12-01" }, NOW), /day of the week/);
  assert.throws(() => cleanRepeat({ days: [1], time: "25:00", until: "2026-12-01" }, NOW), /time/);
  assert.throws(() => cleanRepeat({ days: [1], time: "10:00", until: "2026-01-01" }, NOW), /already passed/);
  assert.throws(() => cleanRepeat({ days: [1], time: "10:00", until: "2028-01-01" }, NOW), /up to a year/);
});

test("nextOccurrence: the next allowed weekday at the local time, in the creator's zone", () => {
  const rule = { days: [1, 4], time: "16:00", tz: "Africa/Lagos", until: "2026-11-30T00:00:00Z" };
  // Saturday → Monday 26 Oct, 16:00 Lagos = 15:00 UTC
  assert.equal(new Date(nextOccurrence(rule, NOW)).toISOString(), "2026-10-26T15:00:00.000Z");
  // From that start → Thursday 29 Oct
  assert.equal(new Date(nextOccurrence(rule, Date.parse("2026-10-26T15:00:00Z"))).toISOString(), "2026-10-29T15:00:00.000Z");
  // Same day, before the time → today
  const sat = { ...rule, days: [6] };
  assert.equal(new Date(nextOccurrence(sat, NOW)).toISOString(), "2026-10-24T15:00:00.000Z");
  // Past the end → over
  assert.equal(nextOccurrence({ ...rule, until: "2026-10-26T14:00:00Z" }, NOW), null);
});

test("nextOccurrence crosses a DST change at the right wall-clock time", () => {
  // London leaves BST on 25 Oct 2026: 18:00 local is 17:00 UTC before, 18:00 UTC after.
  const rule = { days: [0, 1], time: "18:00", tz: "Europe/London", until: "2026-12-01T00:00:00Z" };
  assert.equal(new Date(nextOccurrence(rule, NOW)).toISOString(), "2026-10-25T18:00:00.000Z");
  assert.equal(zonedToUtc(2026, 10, 24, 18, 0, "Europe/London"), Date.parse("2026-10-24T17:00:00Z"));
});

test("makeAt, playersFor, template", () => {
  const start = NOW + 3 * 3600_000;
  assert.equal(makeAt(start, NOW), start - SERIES.LEAD_MS);
  assert.equal(makeAt(NOW + 60_000, NOW), NOW);
  assert.equal(occurrenceJobId("s1", 5), "series-s1-5");
  const iso = new Date(start).toISOString();
  assert.deepEqual(playersFor([
    { user_id: "a" }, { user_id: "b", opted_out_at: "x" }, { user_id: "c", skips: [iso] }, { user_id: "d", skips: ["2020-01-01T00:00:00Z"] },
  ], start), ["a", "d"]);
  assert.deepEqual(seriesTemplate({ title: "T", subject: "Maths", user_ids: ["x"], scheduled_for: "y", hp_per_miss: 0 }), { title: "T", subject: "Maths", hp_per_miss: 0 });
});
