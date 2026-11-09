import assert from "node:assert/strict";
import test from "node:test";

import {
  normaliseToolRequest,
  normaliseToolRequestUpdate,
} from "./validation.js";

test("tool requests are compact, categorised, and whitespace-normalised", () => {
  assert.deepEqual(normaliseToolRequest({
    title: "  Add a revision timer\n",
    description: "  I want a focused timer that can start from a study task and show short breaks.  ",
    category: "organisation",
  }), {
    title: "Add a revision timer",
    description: "I want a focused timer that can start from a study task and show short breaks.",
    category: "organisation",
    kind: "tool",
  });
});

test("component kind is accepted and defaults to tool; unknown kinds are rejected", () => {
  assert.deepEqual(normaliseToolRequest({
    title: "Active recall learning method",
    description: "A study session that hides the material and asks me to reconstruct it from memory.",
    category: "study_support",
    kind: "component",
  }).kind, "component");
  assert.deepEqual(normaliseToolRequest({
    title: "Library count shows the wrong total",
    description: "The Library count tool reports 6 when there are 51 documents.",
    category: "other",
    kind: "bug",
  }).kind, "bug");
  assert.throws(() => normaliseToolRequest({
    title: "A valid feature title",
    description: "This description has enough detail for the request.",
    category: "other",
    kind: "widget",
  }), /kind/);
});

test("tool requests reject too-short, unclassified, and raw-extra payloads at the boundary", () => {
  assert.throws(() => normaliseToolRequest({ title: "Timer", description: "Too short", category: "other" }), /title/);
  assert.throws(() => normaliseToolRequest({ title: "A valid feature title", description: "This description has enough detail for the request.", category: "payments" }), /category/);
  assert.throws(() => normaliseToolRequest({ title: "A valid feature title", description: "This description has enough detail for the request.", category: "other", rawPrompt: "private chat" }), /unexpected/);
  assert.throws(() => normaliseToolRequest({ title: "Calendar integration request", description: "Connect this to me@example.com and use my API key sk-private-secret.", category: "integration" }), /Remove contact details/);
  assert.throws(() => normaliseToolRequest(null), /required/);
});

test("admin can update only a known status and bounded internal note", () => {
  assert.deepEqual(normaliseToolRequestUpdate({ status: "planned", adminNote: "Assess calendar integration after the privacy review." }), {
    status: "planned",
    admin_note: "Assess calendar integration after the privacy review.",
  });
  assert.throws(() => normaliseToolRequestUpdate({ status: "released" }), /status/);
  assert.throws(() => normaliseToolRequestUpdate({ status: "new", requesterId: "cannot-change" }), /unexpected/);
  assert.throws(() => normaliseToolRequestUpdate({}), /required/);
});
