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

test("transcript 2026-11-03: 'the request' counts; a plain yes counts only after the agent's own offer", async () => {
  const { agentOfferedRequest } = await import("./agent-tool-request-intent.js");
  for (const message of ["Yes, send the request to the Akoro team", "Yes file the request"]) {
    assert.equal(hasExplicitToolRequestConsent(message), true, message);
  }
  const offer = "If you'd like, I can ask the Akoro team to add it properly. Say the word and I'll send the request.\n\nWant me to send that request to the Akoro team?";
  assert.equal(agentOfferedRequest(offer), true);
  assert.equal(hasExplicitToolRequestConsent("Yes", { previousAgentText: offer }), true);
  assert.equal(hasExplicitToolRequestConsent("Yes", { previousAgentText: "Want me to set a 30 XP weekly target?" }), false, "a yes to something else");
  assert.equal(hasExplicitToolRequestConsent("Yes", {}), false, "no offer, no consent");
  assert.equal(hasExplicitToolRequestConsent("No, not now", { previousAgentText: offer }), false);
  assert.equal(hasExplicitToolRequestConsent("Yes but first tell me about photosynthesis and then the water cycle in detail please", { previousAgentText: offer }), false, "a long message is not a plain yes");
});
