import assert from "node:assert/strict";
import test from "node:test";
import { validateFollowUpInput, nextOccurrence } from "./chat-follow-up-validation.js";

const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

test("arbitrary interval: every 15 minutes → everySeconds 900, next +900s", () => {
  const v = validateFollowUpInput({ message: "check inbox", scheduledAt: inHours(2), repeat: "interval", repeatEvery: 15, repeatUnit: "minute" });
  assert.equal(v.repeat, "interval");
  assert.equal(v.everySeconds, 900);
  const next = nextOccurrence({ scheduledAt: v.scheduledAt, repeat: "interval", everySeconds: v.everySeconds, repeatUntil: v.repeatUntil });
  assert.equal(new Date(next).getTime() - new Date(v.scheduledAt).getTime(), 900_000);
});

test("sub-minute intervals are rejected; daily still has no everySeconds", () => {
  assert.throws(() => validateFollowUpInput({ message: "x", scheduledAt: inHours(1), repeat: "interval", repeatEvery: 30, repeatUnit: "second" }), /at least 60 seconds/);
  assert.equal(validateFollowUpInput({ message: "x", scheduledAt: inHours(1), repeat: "daily" }).everySeconds, null);
});
