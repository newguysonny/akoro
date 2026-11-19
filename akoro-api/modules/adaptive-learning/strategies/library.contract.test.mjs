import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Strategy Library v3 contract (Grand Plan §7.7.1, §7.7.2, D40): the 22
 * approved strategies, each with a guide, valid targets and workflows, the
 * right executor; and the library is the ONLY list — no module keeps its own.
 */
import {
  GUIDE_FILES, LEGACY_ALIASES, LIBRARY_VERSION, STRATEGIES, STRATEGY_EXECUTORS, STRATEGY_IDS, STRATEGY_WORKFLOWS,
  getStrategy, isPermittedStrategy, normaliseStrategyId, strategiesFor, strategiesForStruggle, strategyRefusal,
} from "./library.js";
import { STRUGGLE_TYPES } from "../../../lib/struggleTypes.js";
import { SETS } from "../../agent-context/manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(HERE, "../../..");
const WORKSPACE = path.join(API_ROOT, "akoro-agent");

// §7.7.2, in the plan's order, with the version each was added in.
const V3 = {
  teach_back: 1, different_analogy: 1, interleave: 1, space_out: 1, escalate_human: 1, retrieval_practice: 2, peer_help: 2,
  contrast_pairs: 3, prerequisite_review: 3, vocabulary_focus: 3, worked_examples: 3, varied_formats: 3, easy_wins_first: 3,
  chunk_plan: 3, make_concrete: 3, schedule_plan: 3, offline_pack: 3, timed_practice: 3, format_practice: 3, check_your_work: 3,
  self_check: 3, goal_clarify: 3,
};

test("the library is the 22 approved v3 strategies, in the plan's order, with their versions", () => {
  assert.equal(LIBRARY_VERSION, 3);
  assert.equal(STRATEGY_IDS.length, 22);
  assert.deepEqual([...STRATEGY_IDS], Object.keys(V3));
  for (const s of STRATEGIES) assert.equal(s.version, V3[s.id], `${s.id} version`);
  assert.equal(new Set(STRATEGY_IDS).size, 22, "no duplicates");
});

test("every entry is a full definition: targets from the taxonomy, known workflows, an executor, a guide", () => {
  for (const s of STRATEGIES) {
    assert.ok(s.name && s.summary && s.success, `${s.id} has words`);
    assert.equal(s.status, "enabled");
    assert.ok(s.targets.length >= 1, `${s.id} targets something`);
    for (const t of s.targets) assert.ok(STRUGGLE_TYPES[t], `${s.id} targets a real struggle type (${t})`);
    assert.ok(s.workflows.length >= 1);
    for (const w of s.workflows) assert.ok(STRATEGY_WORKFLOWS.includes(w), `${s.id} workflow ${w}`);
    assert.ok(STRATEGY_EXECUTORS.includes(s.runsAs.executor), `${s.id} executor`);
    assert.ok(s.runsAs.operation, `${s.id} names its operation`);
    assert.equal(s.guide, `strategies/${s.id}.md`);
    assert.ok(Number.isInteger(s.limits.maxUsesPerTopic) && s.limits.maxUsesPerTopic >= 1);
  }
  // the workflows of §7.7.2 for a few that matter
  assert.deepEqual([...getStrategy("retrieval_practice").workflows], ["decay_review", "practice"]);
  assert.deepEqual([...getStrategy("check_your_work").workflows], ["teaching", "practice"]);
  assert.deepEqual([...getStrategy("goal_clarify").workflows], ["study_prep", "agent_chat"]);
  assert.ok(getStrategy("peer_help").targets.every((t) => !STRUGGLE_TYPES[t].sensitive), "peer help never targets a sensitive type");
  for (const id of ["retrieval_practice", "timed_practice", "check_your_work"]) assert.equal(getStrategy(id).humanAnswers, true, `${id}: the learner answers`);
});

test("strategies run outside Teaching are executed by the harness (replan / schedule / export)", () => {
  assert.equal(getStrategy("chunk_plan").runsAs.operation, "replan");
  assert.equal(getStrategy("prerequisite_review").runsAs.operation, "replan");
  assert.equal(getStrategy("interleave").runsAs.operation, "replan");
  assert.equal(getStrategy("schedule_plan").runsAs.operation, "schedule");
  assert.equal(getStrategy("offline_pack").runsAs.operation, "offline_export");
  for (const id of ["chunk_plan", "schedule_plan", "offline_pack", "prerequisite_review", "interleave"]) {
    assert.equal(getStrategy(id).runsAs.executor, "harness", id);
  }
  assert.equal(getStrategy("contrast_pairs").runsAs.executor, "teaching");
  assert.equal(getStrategy("teach_back").runsAs.mode, "teach_agent");
});

test("every strategy has its guide file, within the 8 KB budget, registered in the context manifest", async () => {
  const registered = new Set([...SETS.strategy_guides_teaching.files, ...SETS.strategy_guides_harness.files]);
  for (const s of STRATEGIES) {
    const text = await readFile(path.join(WORKSPACE, s.guide), "utf8");
    assert.ok(text.length > 200 && text.length <= 8192, `${s.guide} size ${text.length}`);
    assert.match(text, new RegExp(`^# Strategy: ${s.id}\\b`), `${s.guide} names its strategy`);
    assert.ok(registered.has(s.guide), `${s.guide} is in a manifest set`);
  }
  assert.equal(registered.size, 22);
  assert.equal(GUIDE_FILES.teaching.length + GUIDE_FILES.harness.length, 22);
  // and the folder holds nothing else but the overview
  const files = (await readdir(path.join(WORKSPACE, "strategies"))).sort();
  assert.deepEqual(files, [...STRATEGY_IDS.map((id) => `${id}.md`), "STRATEGIES.md"].sort());
  const overview = await readFile(path.join(WORKSPACE, "strategies/STRATEGIES.md"), "utf8");
  for (const id of STRATEGY_IDS) assert.ok(overview.includes(id), `STRATEGIES.md mentions ${id}`);
});

test("per-workflow lists come from the library; refusals are stable codes", () => {
  assert.ok(strategiesFor("study_prep").includes("chunk_plan"));
  assert.ok(!strategiesFor("study_prep").includes("retrieval_practice"));
  assert.deepEqual(strategiesFor("teaching", { executor: "teaching" }),
    ["teach_back", "different_analogy", "contrast_pairs", "vocabulary_focus", "worked_examples", "varied_formats", "easy_wins_first", "make_concrete", "check_your_work", "self_check"]);
  assert.equal(strategyRefusal("drop_the_topic", "study_prep"), "unknown_strategy");
  assert.equal(strategyRefusal("retrieval_practice", "study_prep"), "strategy_not_permitted");
  assert.equal(strategyRefusal("teach_back", "teaching"), null);
  assert.equal(isPermittedStrategy("schedule_plan", "study_prep"), true);
  assert.deepEqual(strategiesForStruggle("interference", "teaching"), ["peer_help", "contrast_pairs"]);
  assert.deepEqual(strategiesForStruggle("interference"), ["interleave", "peer_help", "contrast_pairs"]);
  assert.deepEqual(strategiesForStruggle("anxiety"), ["timed_practice"], "sensitive: no peer stories");
  assert.equal(normaliseStrategyId("worked_example"), "worked_examples");
  for (const target of Object.values(LEGACY_ALIASES)) assert.ok(getStrategy(target));
});

test("the admin/env kill switch disables a strategy at once", () => {
  const env = { AKORO_STRATEGIES_DISABLED: "contrast_pairs, chunk_plan" };
  assert.equal(strategyRefusal("contrast_pairs", "teaching", env), "strategy_disabled");
  assert.ok(!strategiesFor("study_prep", { env }).includes("chunk_plan"));
  assert.ok(strategiesFor("study_prep", { env, includeDisabled: true }).includes("chunk_plan"));
  assert.ok(!strategiesForStruggle("interference", "teaching", env).includes("contrast_pairs"));
});

async function sourceFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await sourceFiles(full, out);
    else if (/\.(m?js)$/.test(entry.name) && !/\.test\.mjs$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("no other strategy list is left: no module spells out three or more library ids in one array", async () => {
  const roots = ["modules", "lib", "routes"].map((d) => path.join(API_ROOT, d));
  const files = [];
  for (const root of roots) { try { if ((await stat(root)).isDirectory()) await sourceFiles(root, files); } catch { /* absent */ } }
  assert.ok(files.length > 50, "scanned the API source");
  const ids = new Set([...STRATEGY_IDS, ...Object.keys(LEGACY_ALIASES), "socratic", "chunking"]);
  const offenders = [];
  for (const file of files) {
    if (file.endsWith(path.join("strategies", "library.js")) || file.endsWith(path.join("lib", "strategyLibrary.js"))) continue;
    const src = await readFile(file, "utf8");
    for (const arr of src.match(/\[[^[\]]*\]/g) || []) {
      const found = new Set([...arr.matchAll(/["'`]([a-z_]+)["'`]/g)].map((m) => m[1]).filter((w) => ids.has(w)));
      if (found.size >= 3) offenders.push(`${path.relative(API_ROOT, file)}: ${[...found].join(", ")}`);
    }
  }
  assert.deepEqual(offenders, [], "strategy lists live only in strategies/library.js");
});
