import test from "node:test";
import assert from "node:assert/strict";
import { similarGoal, findDuplicateTool } from "./toolSimilarity.js";

test("near-duplicate delete goals are caught", () => {
  assert.equal(similarGoal("Delete my earliest chat", "Delete my earliest chat (by position)"), true);
  assert.equal(similarGoal("Delete the chat titled 'hey'", "delete the chat titled hey"), true);
});

test("library count variants are caught (subset)", () => {
  assert.equal(similarGoal("Library count", "Library count (correct total)"), true);
  assert.equal(similarGoal("Count my documents", "count all my library documents by subject"), true);
});

test("different objects with the same verb are NOT duplicates", () => {
  assert.equal(similarGoal("Delete my earliest chat", "Delete a task by position"), false);
  assert.equal(similarGoal("Count my tasks", "Delete my tasks"), false);
  assert.equal(similarGoal("Weekly XP by subject", "Set Chemistry tasks to high priority"), false);
});

test("empty goals never match", () => {
  assert.equal(similarGoal("", "Delete my tasks"), false);
  assert.equal(findDuplicateTool("", [{ goal: "x" }]), null);
});

test("findDuplicateTool returns the matching existing tool", () => {
  const tools = [
    { name: "delete_earliest_chat", label: "Delete my earliest chat", goal: "Delete my earliest chat" },
    { name: "library_count", label: "Library count", goal: "Library count" },
  ];
  assert.equal(findDuplicateTool("Delete my earliest chat by position", tools)?.name, "delete_earliest_chat");
  assert.equal(findDuplicateTool("Library count correct total", tools)?.name, "library_count");
  assert.equal(findDuplicateTool("Set Chemistry to high priority", tools), null);
});
