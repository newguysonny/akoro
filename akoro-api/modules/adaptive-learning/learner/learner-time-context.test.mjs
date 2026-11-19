import assert from "node:assert/strict";
import test from "node:test";

import { isIanaTimeZone, localiseInstant, resolveLearnerTimeZone } from "./learner-time-context.js";

test("learner time context prefers a valid saved IANA account timezone", () => {
  assert.equal(isIanaTimeZone("Africa/Lagos"), true);
  assert.equal(isIanaTimeZone("not/a-timezone"), false);
  assert.deepEqual(resolveLearnerTimeZone({ configuredTimeZone: "Europe/London" }), {
    timeZone: "Europe/London",
    source: "account_preference",
  });
});

test("learner time context labels the platform fallback and renders a local instant", () => {
  const zone = resolveLearnerTimeZone({ configuredTimeZone: "bad-zone" });
  assert.deepEqual(zone, { timeZone: "Africa/Lagos", source: "platform_default" });
  const local = localiseInstant("2026-09-08T07:00:00.000Z", zone.timeZone);
  assert.ok(local.timeZone);
  assert.match(local.dateTime, /8 Sept 2026/);
  assert.match(local.dateTime, /08:00/);
  assert.equal(local.date, "2026-09-08");
});
