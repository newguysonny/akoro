import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LIBRARY_MERGED_ACTIONS, mergedLibraryEnabled, mergedLibraryDef,
  libraryDeltaActions, libraryBuildIsCovered,
} from "./mergedLibrary.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the merged def offers base + platform actions, in the runtime shape", () => {
  const def = mergedLibraryDef();
  assert.equal(def.type, "function");
  assert.equal(def.function.name, "library_documents");
  assert.deepEqual(def.function.parameters.properties.action.enum, ["count", "list", "by_kind", "search"]);
  assert.deepEqual(def.function.parameters.required, ["action"]);
  assert.match(def.function.description, /Never invent a document/);
});

test("a learner's delta actions extend the enum; switched-off merged actions leave it", () => {
  const def = mergedLibraryDef({ delta: ["sum_size"], disabled: ["list"] });
  assert.deepEqual(def.function.parameters.properties.action.enum, ["count", "by_kind", "search", "sum_size"]);
  assert.match(def.function.description, /also added their own action\(s\) to this tool: sum_size/);
});

test("delta = stored actions minus the merged set, minus the switched-off ones", () => {
  assert.deepEqual(libraryDeltaActions(null), []);
  assert.deepEqual(
    libraryDeltaActions({ actions: ["count", "list", "by_kind", "search"], disabledActions: [] }), []);
  assert.deepEqual(
    libraryDeltaActions({ actions: ["count", "list", "by_kind", "search", "sum_size"], disabledActions: [] }), ["sum_size"]);
  assert.deepEqual(
    libraryDeltaActions({ actions: ["count", "sum_size"], disabledActions: ["sum_size"] }), []);
  // rows read back from the API shape (disabled_actions) work too
  assert.deepEqual(
    libraryDeltaActions({ params_schema: { action: { enum: ["count", "by_size"] } }, disabled_actions: [] }), ["by_size"]);
});

test("a library build is covered only when it adds nothing beyond the merged set", () => {
  assert.equal(libraryBuildIsCovered(["count", "list"]), true);
  assert.equal(libraryBuildIsCovered(["count", "list", "by_kind", "search"]), true);
  assert.equal(libraryBuildIsCovered(["count", "sum_size"]), false);
  assert.equal(libraryBuildIsCovered(["by_size"]), false);
  assert.equal(libraryBuildIsCovered([]), false);
});

test("the kill switch defaults on and honours AKORO_MERGED_LIBRARY=false", () => {
  const prev = process.env.AKORO_MERGED_LIBRARY;
  delete process.env.AKORO_MERGED_LIBRARY;
  assert.equal(mergedLibraryEnabled(), true);
  process.env.AKORO_MERGED_LIBRARY = "false";
  assert.equal(mergedLibraryEnabled(), false);
  if (prev === undefined) delete process.env.AKORO_MERGED_LIBRARY; else process.env.AKORO_MERGED_LIBRARY = prev;
});

test("wiring: chat.js dispatches the merged tool and swaps the defs; pipeline serves view actions", () => {
  const chat = read("../adaptive-learning/chat.js");
  assert.match(chat, /case "library_documents": \{/);
  assert.match(chat, /async function searchMyLibraryTool\(studentId, input\)/);
  assert.match(chat, /case "search_my_library":\s+return searchMyLibraryTool\(studentId, input\);/);
  assert.match(chat, /applyLibraryMerge\(allTools, req\.user\.id, selfToolOn\)/);
  assert.match(chat, /runLibraryViewAction\(action, input, studentId\)/);
  const pipe = read("./pipeline.js");
  assert.match(pipe, /export async function runLibraryViewAction\(action, input, learnerId\)/);
  assert.match(pipe, /export async function getLibraryToolState\(learnerId\)/);
  assert.match(pipe, /libraryBuildIsCovered\(actions\)\) \{\s+return finish\("reused"/);
  // the own-copy gate reads existingDraft — it must be declared BEFORE the gate
  const decl = pipe.indexOf("const existingDraft = existing?.status");
  const gate = pipe.indexOf('await finish("offer_own_copy"');
  assert.ok(decl > -1 && gate > -1 && decl < gate, "existingDraft is declared before the own-copy gate reads it");
});
