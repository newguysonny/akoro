import assert from "node:assert/strict";
import test from "node:test";

import { hasExplicitToolRequestConsent } from "./agent-tool-request-intent.js";

test("clear learner instructions permit the product-request tool to be offered", () => {
  for (const message of [
    "Please submit this as a feature request.",
    "Send a tool request to the Akoro team.",
    "Yes, submit it.",
    "Tell the admins to consider integrating my school timetable.",
  ]) {
    assert.equal(hasExplicitToolRequestConsent(message), true, message);
  }
});

test("an unsupported request alone is never consent to transmit product feedback", () => {
  for (const message of [
    "Can you connect to my calendar?",
    "I wish you had a revision timer.",
    "My school timetable is private.",
    "Explain photosynthesis.",
  ]) {
    assert.equal(hasExplicitToolRequestConsent(message), false, message);
  }
});
