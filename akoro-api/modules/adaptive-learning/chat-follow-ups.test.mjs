import assert from "node:assert/strict";
import test from "node:test";

const { validateFollowUpId, validateFollowUpInput } = await import("./chat-follow-up-validation.js");

const future = () => new Date(Date.now() + 5 * 60_000).toISOString();

test("a follow-up needs an offset-aware future time and uses the Lagos display default", () => {
  const parsed = validateFollowUpInput({
    message: "It is 2pm — ready to revise biology?",
    scheduledAt: future(),
  });
  assert.equal(parsed.timezone, "Africa/Lagos");
  assert.equal(parsed.title, "Scheduled check-in");
  assert.ok(parsed.delayMs >= 60_000);
});

test("a follow-up rejects ambiguous or already-due delivery times", () => {
  assert.throws(() => validateFollowUpInput({
    message: "Hello", scheduledAt: "2026-09-08T14:00:00",
  }), /timezone offset/);
  assert.throws(() => validateFollowUpInput({
    message: "Hello", scheduledAt: new Date(Date.now() + 10_000).toISOString(),
  }), /at least one minute/);
  assert.throws(() => validateFollowUpInput({
    message: "Hello", scheduledAt: future(), timezone: "Not/A_Zone",
  }), /IANA timezone/);
});

test("cancellation accepts only a generated follow-up UUID", () => {
  assert.equal(validateFollowUpId("7de311f4-a5dd-4be5-b37a-c87fdb036823"), "7de311f4-a5dd-4be5-b37a-c87fdb036823");
  assert.throws(() => validateFollowUpId("follow-up-1"), /followUpId is invalid/);
});

test("diverse future-message actions preserve their exact title, message, and timezone", () => {
  const actions = [
    ["Message me tomorrow with a Biology revision check-in", {
      title: "Biology revision check-in", message: "Ready for your Biology revision?", timezone: "Africa/Lagos",
    }],
    ["Send me a London essay reminder", {
      title: "Essay reminder", message: "Time to complete your English essay.", timezone: "Europe/London",
    }],
    ["Schedule a New York Physics practice prompt", {
      title: "Physics practice", message: "Try five Physics past questions now.", timezone: "America/New_York",
    }],
  ];
  for (const [prompt, input] of actions) {
    const parsed = validateFollowUpInput({ ...input, scheduledAt: future() });
    assert.equal(parsed.title, input.title, prompt);
    assert.equal(parsed.message, input.message, prompt);
    assert.equal(parsed.timezone, input.timezone, prompt);
    assert.ok(parsed.delayMs >= 60_000, prompt);
  }
});

test("a follow-up uses the authenticated learner's supplied account timezone by default", () => {
  const parsed = validateFollowUpInput({
    message: "Good morning!", scheduledAt: future(),
  }, { defaultTimezone: "Europe/London" });
  assert.equal(parsed.timezone, "Europe/London");
});

test("an omitted account default retains the explicit Lagos platform fallback", () => {
  const parsed = validateFollowUpInput({
    message: "Good morning!", scheduledAt: future(),
  }, { defaultTimezone: undefined });
  assert.equal(parsed.timezone, "Africa/Lagos");
});
