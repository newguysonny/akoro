import test from "node:test";
import assert from "node:assert/strict";
import { cleanupPlan, isSimpleRead } from "./cleanup.js";

const tool = (o) => ({ capabilities: [], params_schema: {}, created_at: "2026-01-01", ...o });
const domain = (view, name = view, actions = ["count", "list"]) => tool({
  name, label: name, goal: `${name}: count, list`, mode: "code",
  views: [view], domain: view, params_schema: { action: { enum: actions } },
});

test("cleanup keeps one domain tool per view and archives simple readers", () => {
  const lib = domain("my_library", "library_documents", ["count", "list", "by_kind"]);
  const simple = tool({
    name: "library_documents_total", label: "Library document count",
    goal: "Count all documents in my library — with a total and a breakdown by kind",
    mode: "code", views: ["my_library"], domain: "my_library",
  });
  const plan = cleanupPlan([lib, simple]);
  assert.equal(plan.kept.my_library, "library_documents");
  assert.deepEqual(plan.archive.map((t) => t.name), ["library_documents_total"]);
});

test("a bespoke reader is kept beside the domain tool", () => {
  const xp = domain("my_xp", "my_xp", ["count", "list", "sum_amount"]);
  const weekly = tool({
    name: "xp_by_subject_weekly", label: "Weekly XP by subject",
    goal: "Which subject I earned the most XP in over the last 4 weeks, with XP per subject broken down week by week",
    mode: "code", views: ["my_xp"], domain: "my_xp",
  });
  const plan = cleanupPlan([xp, weekly]);
  assert.equal(plan.kept.my_xp, "my_xp");
  assert.deepEqual(plan.archive, [], "a weekly breakdown is not superseded by count/list/sum");
  assert.equal(isSimpleRead(weekly), false);
});

test("write tools are never archived, even over the same view", () => {
  const chats = domain("my_chats", "my_chats", ["count", "list", "search"]);
  const del = tool({ name: "delete_earliest_chat", label: "Delete my earliest chat", goal: "Delete my earliest chat",
    mode: "code", views: ["my_chats"], domain: "my_chats", capabilities: ["chats.delete"] });
  const plan = cleanupPlan([chats, del]);
  assert.equal(plan.kept.my_chats, "my_chats");
  assert.deepEqual(plan.archive, []);
});

test("a duplicate domain tool is archived", () => {
  const a = domain("my_library", "library_documents", ["count", "list", "by_kind", "search"]);
  const b = domain("my_library", "library_documents_total", ["count", "by_kind"]);
  const plan = cleanupPlan([b, a]);
  assert.equal(plan.kept.my_library, "library_documents");
  assert.deepEqual(plan.archive.map((t) => t.name), ["library_documents_total"]);
});

test("a read-capability tool is a read when superseded; a filtered one is kept", () => {
  const lib = domain("my_library", "library_documents", ["count", "list", "search"]);
  const search = tool({ name: "search_my_library", label: "Search my library",
    goal: "Find matching documents in my library", mode: "code", views: ["my_library"], domain: "my_library",
    capabilities: ["tasks.list_mine"] });
  assert.deepEqual(cleanupPlan([lib, search]).archive.map((t) => t.name), ["search_my_library"], "a read capability doesn't protect a duplicate");

  const tasks = domain("my_tasks", "my_tasks", ["count", "list", "by_status"]);
  const pending = tool({ name: "my_pending_tasks", label: "My pending tasks",
    goal: "Show my pending tasks", mode: "code", views: ["my_tasks"], domain: "my_tasks",
    capabilities: ["tasks.list_mine"] });
  assert.deepEqual(cleanupPlan([tasks, pending]).archive, [], "a filtered reader is kept");
});
