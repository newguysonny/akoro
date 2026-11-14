/*
 * answer-only.contract.test.mjs — option 2 (2026-11-14): a pure computed
 * READ (verified run, no write, no run-time inputs) is answered from its dry
 * run and NOT saved — no draft, no Keep card. The verified definition is
 * stashed on an 'answered' event so an explicit "save that" (save_computation)
 * or the repeated-computation sweep can save that exact tool later. Writes
 * and parameterized tools keep the build + Keep path.
 */
import "../../test-env.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAnswerOnlyRead, toolParamNames } from "./pipeline.js";
import { chatToolChange } from "../adaptive-learning/chat-trace.js";

const pipeline = readFileSync(new URL("./pipeline.js", import.meta.url), "utf8");
const chat = readFileSync(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../../migrations/manifest.json", import.meta.url), "utf8");

test("the predicate: only a successful, write-free, input-free read is answer-only", () => {
  const read = { params_schema: {} };
  assert.equal(isAnswerOnlyRead(read, { ok: true, rows: [] }), true);
  assert.equal(isAnswerOnlyRead(read, { ok: true, write: { rows: [] } }), false, "a write is never answer-only");
  assert.equal(isAnswerOnlyRead(read, { ok: false, error: "x" }), false, "a failed run is not answered from");
  assert.equal(isAnswerOnlyRead({ params_schema: { position: { type: "number" } } }, { ok: true, rows: [] }), false, "a parameterized tool is saved, not one-off");
  assert.equal(isAnswerOnlyRead({ params_schema: { type: "object", properties: { subject: { type: "string" } } } }, { ok: true, rows: [] }), false);
  assert.deepEqual(toolParamNames({ action: { type: "string" } }), ["action"]);
  assert.deepEqual(toolParamNames(null), []);
});

test("register answers a pure computed read and stashes the verified definition on the event", () => {
  assert.match(pipeline, /isAnswerOnlyRead\(def, runNow\)/);
  assert.match(pipeline, /ev\.detail = \{ name, label, goal, mode: stage, definition: built\.definition/);
  assert.match(pipeline, /await finish\("answered", \{\}\)/);
  assert.match(pipeline, /status: "answered", ephemeral: true/);
  // the answer-only branch sits BEFORE the build-consent gate it replaces for these tools
  assert.ok(pipeline.indexOf("isAnswerOnlyRead(def, runNow)") < pipeline.indexOf("return draftBuildAndAsk({ def, runNow })"));
});

test("the trace store can hold it: detail column + 'answered' outcome, in the manifest", () => {
  assert.ok(manifest.includes("2026-self-tooling-oneoff-traces.sql"));
  const sql = readFileSync(new URL("../../migrations/2026-self-tooling-oneoff-traces.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS detail jsonb/);
  assert.match(sql, /'answered'/);
});

test("saveComputation hint scoring treats goalTokens as the Set it is", () => {
  assert.match(pipeline, /\[\.\.\.hintTokens\]\.filter\(\(t\) => goalTokens\(e\.goal\)\.has\(t\)\)/);
  assert.doesNotMatch(pipeline, /hintTokens\.filter/);
  assert.doesNotMatch(pipeline, /goalTokens\(e\.goal\)\.includes/);
});

test("the trace claims 'Saved a tool' only for a saved outcome", () => {
  assert.equal(chatToolChange("save_computation", { status: "rejected", reason: "x" }), null);
  assert.equal(chatToolChange("save_computation", { status: "none" }), null);
  assert.equal(chatToolChange("save_computation", { status: "saved", label: "Goals completion rate" })?.label, "Saved a tool");
});

test("saveComputation awaits validateDefinition (it is async — an un-awaited Promise reads as stale)", () => {
  assert.match(pipeline, /const v = await validateDefinition\(d\.definition/);
});

test("saveComputation compares the verify verdict in the case verifyTool returns (PASS)", () => {
  assert.match(pipeline, /check\.verdict !== "PASS"/);
  assert.doesNotMatch(pipeline, /check\.verdict !== "pass"/);
});

test("saveComputation saves the stashed computation — re-verified, never rebuilt", () => {
  assert.match(pipeline, /export async function saveComputation/);
  assert.match(pipeline, /\.eq\("outcome", "answered"\)/);
  assert.match(pipeline, /validateDefinition\(d\.definition/);
  assert.match(pipeline, /verifyTool\(d\.definition/);
  assert.match(pipeline, /status: "exists"/);
  assert.match(pipeline, /LIMITS\.maxTools/);
});

test("the chat wires save_computation: definition, gate, side-effect list, dispatch, steering", () => {
  assert.match(chat, /name: "save_computation"/);
  assert.match(chat, /saveComputation\(\)|saveComputation\(\{/);
  assert.match(chat, /"create_tool", "save_computation"/);
  assert.match(chat, /call save_computation/);
  assert.match(chat, /answered \(a pure computed read/);
});

test("the trace says what happened: one-off for answered, a save row for save_computation", () => {
  const oneOff = chatToolChange("create_tool", { status: "answered", label: "Weekly XP by subject" }, {});
  assert.equal(oneOff?.label, "Worked it out — one-off");
  const saved = chatToolChange("save_computation", { status: "saved", label: "Weekly XP by subject" }, {});
  assert.equal(saved?.label, "Saved a tool");
});
