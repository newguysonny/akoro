import assert from "node:assert/strict";
import test from "node:test";
import { intervalSeconds, normalizeUnit, seriesSpanMs } from "./scheduleInterval.js";

test("any unit → seconds; plural/case tolerated; invalid → null", () => {
  assert.equal(intervalSeconds(15, "minute"), 900);
  assert.equal(intervalSeconds(15, "minutes"), 900);
  assert.equal(intervalSeconds(2, "HOURS"), 7200);
  assert.equal(intervalSeconds(3, "day"), 259200);
  assert.equal(intervalSeconds(2, "week"), 1209600);
  assert.equal(intervalSeconds(1, "month"), 2592000);
  assert.equal(intervalSeconds(1, "year"), 31536000);
  assert.equal(intervalSeconds(0, "minute"), null);
  assert.equal(intervalSeconds(5, "fortnight"), null);
  assert.equal(normalizeUnit("days"), "day");
});

test("series span is bounded by a max occurrence count", () => {
  assert.ok(seriesSpanMs({ everySeconds: 60, days: 90 }) <= 60 * 1000 * 1000, "capped");
});
