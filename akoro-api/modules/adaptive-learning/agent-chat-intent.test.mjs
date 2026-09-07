import assert from "node:assert/strict";
import test from "node:test";

import { requiresAgentCapabilitiesTool } from "./agent-chat-intent.js";

test("common learner ability questions require the live capabilities tool", () => {
  for (const message of [
    "What are your abilities?",
    "What can you do?",
    "What's your features?",
    "What features does the agent have?",
    "How can Akoro help me?",
    "What are you able to do?",
  ]) {
    assert.equal(requiresAgentCapabilitiesTool(message), true, message);
  }
});

test("ordinary study questions remain for the unified agent prompt to answer directly", () => {
  for (const message of ["Explain photosynthesis", "Quiz me on Algebra", "I have a Biology test tomorrow"]) {
    assert.equal(requiresAgentCapabilitiesTool(message), false, message);
  }
});
