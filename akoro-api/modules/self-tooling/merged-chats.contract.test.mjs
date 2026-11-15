// The chats merge (library pattern rolled out): ONE my_chats def whose count
// is the platform view count, list/search are the platform handlers, and any
// extra action is the learner's saved delta. Plus Fix 1 (My tools presents
// delta only for merged domains) and Fix 2 (the own-copy gate's delta
// wording). Matt's order 2026-11-15.
import "../../test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHATS_MERGED_ACTIONS, mergedChatsEnabled, mergedChatsDef,
  chatsDeltaActions, chatsBuildIsCovered,
} from "./mergedChats.js";
import { presentMergedToolRow } from "./pipeline.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the merged chats def offers count/list/search in the runtime shape", () => {
  const def = mergedChatsDef();
  assert.equal(def.type, "function");
  assert.equal(def.function.name, "my_chats");
  assert.deepEqual(def.function.parameters.properties.action.enum, ["count", "list", "search"]);
  assert.deepEqual(def.function.parameters.required, ["action"]);
  assert.match(def.function.description, /exact total number of chats/);
  assert.match(def.function.description, /chatId/);
});

test("delta actions extend the chats enum and are named in the description", () => {
  const def = mergedChatsDef({ delta: ["by_month"] });
  assert.deepEqual(def.function.parameters.properties.action.enum, [...CHATS_MERGED_ACTIONS, "by_month"]);
  assert.match(def.function.description, /extra actions on their own copy of this tool: by_month/);
});

test("chats delta = stored minus merged minus switched-off (both row shapes)", () => {
  assert.deepEqual(chatsDeltaActions({ actions: ["count", "list", "search", "by_month"], disabled_actions: [] }), ["by_month"]);
  assert.deepEqual(chatsDeltaActions({ actions: ["count", "list", "search", "by_month"], disabledActions: ["by_month"] }), []);
  assert.deepEqual(chatsDeltaActions({ actions: ["count", "list", "search"] }), []);
  assert.deepEqual(chatsDeltaActions(null), []);
});

test("a build is covered only when every action is in the merged set", () => {
  assert.equal(chatsBuildIsCovered(["count", "list"]), true);
  assert.equal(chatsBuildIsCovered(["count", "by_month"]), false);
  assert.equal(chatsBuildIsCovered([]), false);
});

test("the chats merge has a kill switch", () => {
  const before = process.env.AKORO_MERGED_CHATS;
  delete process.env.AKORO_MERGED_CHATS;
  assert.equal(mergedChatsEnabled(), true);
  process.env.AKORO_MERGED_CHATS = "false";
  assert.equal(mergedChatsEnabled(), false);
  if (before === undefined) delete process.env.AKORO_MERGED_CHATS; else process.env.AKORO_MERGED_CHATS = before;
});

test("Fix 1: My tools presents only delta actions for merged domains", () => {
  const lib = { name: "library_documents", domain: "my_library", actions: ["count", "list", "by_kind", "search", "sum_size"], disabled_actions: ["by_kind", "sum_size"] };
  const shownLib = presentMergedToolRow(lib);
  assert.deepEqual(shownLib.actions, ["sum_size"]);
  assert.deepEqual(shownLib.disabled_actions, ["sum_size"]); // base toggles are the platform's now
  assert.equal(presentMergedToolRow({ name: "library_documents", domain: "my_library", actions: ["count", "list", "search"], disabled_actions: [] }), null);
  assert.equal(presentMergedToolRow({ name: "my_chats", domain: "my_chats", actions: ["count", "list", "search"], disabled_actions: [] }), null);
  const chats = presentMergedToolRow({ name: "my_chats", domain: "my_chats", actions: ["count", "list", "search", "by_month"], disabled_actions: [] });
  assert.deepEqual(chats.actions, ["by_month"]);
  const computed = { name: "goals_percentage_fresh", domain: "my_goals", actions: [], disabled_actions: [] };
  assert.equal(presentMergedToolRow(computed), computed); // a computed tool over a merged view is NOT the domain tool
  const other = { domain: "my_xp", actions: ["count"], disabled_actions: [] };
  assert.equal(presentMergedToolRow(other), other); // unmerged domain: untouched, same object
});

test("wiring: pipeline carries the chats guard, runners and My-tools presentation", () => {
  const src = read("./pipeline.js");
  assert.match(src, /mergedChatsEnabled\(\) && spec\.view === "my_chats" && !resumed && !replaced && chatsBuildIsCovered\(actions\)/);
  assert.match(src, /export async function getChatsToolState/);
  assert.match(src, /export async function runChatsViewAction/);
  assert.match(src, /\.map\(presentMergedToolRow\)\.filter\(\(t\) => t !== null\)/);
  assert.match(src, /That action is built in — it can't be changed here/);
});

test("wiring: chat.js assembles and dispatches the merged chats tool", () => {
  const src = read("../adaptive-learning/chat.js");
  assert.match(src, /allTools = await applyChatsMerge\(allTools, req\.user\.id, selfToolOn\)/);
  assert.match(src, /wantArea === "chats" && role !== "instructor"\) adds = await applyChatsMerge/);
  assert.match(src, /case "my_chats": \{/);
  assert.match(src, /const out = await listChats\(studentId, \{ search: input\?\.query, limit: input\?\.limit, currentChatId: conversationId \}\)/);
  assert.match(src, /const out = await searchChats\(studentId, \{ query: input\?\.query, limit: input\?\.limit, currentChatId: conversationId \}\)/);
  assert.match(src, /name === "my_chats" \? "chats" : undefined/);
});

test("Fix 2: the own-copy gate names beyond-standard actions as NOT covered", () => {
  const src = read("./pipeline.js");
  assert.match(src, /const beyond = actions\.filter\(\(a\) => !\(spec\.actions \|\| \[\]\)\.includes\(a\)\)/);
  assert.match(src, /but it CANNOT do: \$\{beyond\.join\(", "\)\}/);
  assert.match(src, /the extra is what their OWN copy would add/);
});
