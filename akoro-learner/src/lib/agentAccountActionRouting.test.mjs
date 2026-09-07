import assert from "node:assert/strict";
import test from "node:test";

import { routesToAccountTools } from "./agentAccountActionRouting.js";

const noHistory = [];

test("diverse explicit task and reminder prompts use the authenticated tool route", () => {
  const prompts = [
    "Create a task for me to revise Biology",
    "Please schedule a task to practise Algebra tomorrow",
    "Plan a study task for my WAEC Chemistry revision",
    "Set a reminder to submit my English essay",
    "What is due today?",
    "Show my tasks",
  ];
  for (const prompt of prompts) assert.equal(routesToAccountTools(prompt, noHistory), true, prompt);
});

test("diverse explicit future-message prompts use the authenticated tool route", () => {
  const prompts = ["Message me tomorrow at 7 pm", "Schedule a revision check-in for Friday", "Reschedule the follow-up message", "Cancel my reminder"];
  for (const prompt of prompts) assert.equal(routesToAccountTools(prompt, noHistory), true, prompt);
});

test("capability questions reach the agent tool loop rather than a frontend response", () => {
  for (const prompt of ["What can you do?", "What are your abilities?", "What can the agent do?"]) {
    assert.equal(routesToAccountTools(prompt, noHistory), true, prompt);
  }
});

test("the complete two-turn task scheduling conversation stays on the tool route", () => {
  const start = "I want to schedule a task";
  const agentQuestion = "What task should I create, and when is it due?";
  const details = "Revise Maths tomorrow at 8 am";
  assert.equal(routesToAccountTools(start, noHistory), true);
  assert.equal(routesToAccountTools(details, [{ from: "me", text: start }, { from: "agent", text: agentQuestion }]), true);
});

test("a task detail remains tool-routed after a timezone clarification", () => {
  assert.equal(routesToAccountTools("Make that 8:30 am in Lagos", [{ from: "me", text: "Schedule a study task" }, { from: "agent", text: "What subject and date should I use?" }, { from: "me", text: "Revise Physics tomorrow" }]), true);
});

test("ordinary study chat and stale task context remain on the streaming tutor", () => {
  assert.equal(routesToAccountTools("Explain photosynthesis", noHistory), false);
  assert.equal(routesToAccountTools("Revise Maths tomorrow at 8 am", noHistory), false);
  assert.equal(routesToAccountTools("Explain simultaneous equations", [{ from: "me", text: "I want to schedule a task" }, { from: "agent", text: "What task and deadline should I use?" }, { from: "me", text: "Never mind" }, { from: "agent", text: "No task has been created." }, { from: "me", text: "Okay" }, { from: "agent", text: "What would you like to study instead?" }]), false);
});
