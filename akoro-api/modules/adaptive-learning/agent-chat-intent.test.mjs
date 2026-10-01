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

import { requiresActivityPreparation } from "./agent-chat-intent.js";

test("instructor activity requests force prepare_activity — the prose detour is closed", () => {
  // The live hallucination transcript: these MUST reach the tool, and the
  // tool (not the model) decides what is still missing.
  assert.equal(requiresActivityPreparation(
    "Family, due tomorrow 8pm, assignments on family week 1, for the whole class, normal questions on Family"), true);
  assert.equal(requiresActivityPreparation("Create a quiz on fractions for JSS1"), true);
  assert.equal(requiresActivityPreparation("Prep an assignment on photosynthesis"), true);
});

test("a short confirmation continues a pending request instead of losing it", () => {
  const history = [
    { role: "user", content: "Family, due tomorrow 8pm, assignments on family week 1, for the whole class" },
    { role: "assistant", content: "I can help you create questions about the topic of family…" },
  ];
  assert.equal(requiresActivityPreparation("Proceed", history), true);
  assert.equal(requiresActivityPreparation("Proceed with the assignment", history), true);
  assert.equal(requiresActivityPreparation("yes", history), true);
  assert.equal(requiresActivityPreparation("The topic is family, the questions should be 5 questions..", history), true);
  assert.equal(requiresActivityPreparation("use the class", history), true);
});

test("confirmations never start a request and reads/tutoring never force the tool", () => {
  // No pending activity request in history → a bare "Proceed" is not a force.
  assert.equal(requiresActivityPreparation("Proceed", [
    { role: "user", content: "Explain photosynthesis" },
    { role: "assistant", content: "Photosynthesis is…" },
  ]), false);
  // Reads about activities are not creation requests.
  assert.equal(requiresActivityPreparation("show my drafts"), false);
  assert.equal(requiresActivityPreparation("What assignments did I assign last week?"), false);
  assert.equal(requiresActivityPreparation("check the results of the quiz"), false);
  // Tutoring asks, even with an activity noun, stay in conversation.
  assert.equal(requiresActivityPreparation("Quiz me on Algebra"), false);
  assert.equal(requiresActivityPreparation("test me on yesterday's topic"), false);
  assert.equal(requiresActivityPreparation("Explain photosynthesis"), false);
});

import { requiredLearnerDataTool } from "./agent-chat-intent.js";

test("the live hallucination transcript now forces the matching directory tool", () => {
  // 2026-10-01, answered from general knowledge with tools=0 and an invented
  // subject list — these MUST reach the school's own records.
  assert.equal(requiredLearnerDataTool("What subjects do we have in the class?"), "list_school_subjects");
  assert.equal(requiredLearnerDataTool("Which subjects are we offering this term?"), "list_school_subjects");
  assert.equal(requiredLearnerDataTool("List the subjects in my school"), "list_school_subjects");
  assert.equal(requiredLearnerDataTool("What subjects does the school have?"), "list_school_subjects");
  assert.equal(requiredLearnerDataTool("Who is my teacher?"), "list_my_teachers");
  assert.equal(requiredLearnerDataTool("Who teaches us Mathematics?"), "list_my_teachers");
  assert.equal(requiredLearnerDataTool("Who are my teachers this term?"), "list_my_teachers");
  assert.equal(requiredLearnerDataTool("What's my school name?"), "get_my_school");
  assert.equal(requiredLearnerDataTool("Tell me about my school"), "get_my_school");
  assert.equal(requiredLearnerDataTool("Which school am I in?"), "get_my_school");
  assert.equal(requiredLearnerDataTool("How am I doing?"), "check_progress");
  assert.equal(requiredLearnerDataTool("What's my progress like?"), "check_progress");
  // Live 2026-10-01: this exact question was answered with the SCHOOL's
  // subject catalogue framed as "subjects you have learned" — the learner's
  // teaching history is a different tool and MUST win over the catalogue.
  assert.equal(requiredLearnerDataTool("What subjects have I learnt so far with my protégé, my agent on here and the topics"), "get_my_learning_sessions");
  assert.equal(requiredLearnerDataTool("What have I learnt so far?"), "get_my_learning_sessions");
  assert.equal(requiredLearnerDataTool("Show my learning sessions"), "get_my_learning_sessions");
  assert.equal(requiredLearnerDataTool("my learning history"), "get_my_learning_sessions");
  // The catalogue question still routes to the catalogue.
  assert.equal(requiredLearnerDataTool("What subjects do we have in the class?"), "list_school_subjects");
});

test("conversational mentions never force a directory lookup", () => {
  for (const message of [
    "Explain photosynthesis",
    "My teacher said I should revise algebra",   // mention, not an identity question
    "I hate my subjects",                        // opinion, not a list question
    "Can you prep me for my exam?",
    "Hey",
    "my school fees are due",                    // fees are not school identity
    "Teach my protégé about photosynthesis",     // a session-start ask, not history
  ]) {
    assert.equal(requiredLearnerDataTool(message), null, message);
  }
});
