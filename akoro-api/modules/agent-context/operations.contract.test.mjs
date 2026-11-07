import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

/**
 * Phase 4 exit (Grand Plan §7.4): each workflow operation loads its own
 * manifest set — planning loads `planning`, strategy selection loads
 * `strategies`, teaching turns load `teaching_controller` — every set is
 * within budget, the boot preflight is green, and no controller hard-codes a
 * set name. Reads the REAL akoro-agent/ workspace.
 */

import {
  CONTEXT_BUDGET, CONTEXT_MANIFEST, CONTEXT_SETS, clearContextCache, contextSetFor, loadContext, preflight,
} from "./context-manager.js";
import { LIVE_OPERATIONS, OPERATION_SETS, UNMAPPED_SETS, operationRows, teachingTurnOperation } from "./operations.mjs";

// The §7.4 table, written out: changing a mapping is a conscious edit here.
const EXPECTED = {
  study_prep: {
    research: "research", inspection: "research",
    planning: "planning", replanning: "planning", draft: "planning",
    verification: "safety",
    strategy_selection: "strategies", teach_back_creation: "strategies",
    diagnostic: "reflection", retest: "reflection", reflection: "reflection", outcome_evaluation: "reflection",
    synthesis: "reflection", topic_advance: "reflection", session_completion: "reflection",
    wake: "wake",
  },
  teaching: {
    "turn:teach_agent": "teaching_controller", "turn:learn_with_guide": "guide_controller",
    select_teaching_strategy: "teaching_strategy", adapt_strategy: "teaching_strategy",
  },
  decay_review: {
    inspect_decay: "decay_inspection", inspect_history: "decay_inspection", inspect_concept: "decay_inspection",
    evaluate_retention: "decay_inspection", intervene: "decay_review", select_strategy: "decay_review",
  },
  practice: { prepare: "practice", generate: "practice", evaluate: "practice" },
};

// The workflow file that gives each set its role (second, right after AGENT.md).
const ROLE_FILE = {
  planning: "workflows/STUDY_PREP.md", research: "workflows/STUDY_PREP.md", safety: "workflows/STUDY_PREP.md",
  strategies: "workflows/STUDY_PREP.md", reflection: "workflows/STUDY_PREP.md", wake: "workflows/STUDY_PREP.md",
  teaching_controller: "workflows/TEACHING.md", guide_controller: "workflows/TEACHING.md", teaching_strategy: "workflows/TEACHING.md",
  decay_inspection: "workflows/DECAY_REVIEW.md", decay_review: "workflows/DECAY_REVIEW.md",
  practice: "workflows/PRACTICE.md",
};

test("each operation maps to its §7.4 set (the table is pinned)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(OPERATION_SETS)), EXPECTED);
  assert.equal(contextSetFor("study_prep", "planning"), "planning");
  assert.equal(contextSetFor("study_prep", "replanning"), "planning");
  assert.equal(contextSetFor("study_prep", "strategy_selection"), "strategies");
  assert.equal(contextSetFor("study_prep", "verification"), "safety");
  assert.equal(contextSetFor("teaching", teachingTurnOperation("teach_agent")), "teaching_controller");
  assert.equal(contextSetFor("teaching", teachingTurnOperation("learn_with_guide")), "guide_controller");
  assert.equal(contextSetFor("teaching", teachingTurnOperation(undefined)), "teaching_controller");
  assert.equal(contextSetFor("decay_review", "inspect_decay"), "decay_inspection");
  assert.equal(contextSetFor("decay_review", "intervene"), "decay_review");
  assert.equal(contextSetFor("practice", "evaluate"), "practice");
});

test("each operation loads exactly its set: workflow role first, within budget", async () => {
  clearContextCache();
  for (const { workflow, operation, set } of operationRows()) {
    const loaded = await loadContext(contextSetFor(workflow, operation));
    assert.equal(loaded.set, set);
    assert.deepEqual(loaded.files, [...CONTEXT_MANIFEST[set].files], `${workflow}.${operation} loads every file of ${set}, in order`);
    assert.equal(loaded.files[0], "AGENT.md", `${set} opens with the neutral identity`);
    assert.equal(loaded.files[1], ROLE_FILE[set], `${set}: its workflow file gives the role`);
    assert.ok(Buffer.byteLength(loaded.system) <= CONTEXT_BUDGET.MAX_CONTEXT_BYTES, `${set} within the assembled budget`);
    // never another workflow's role
    for (const other of new Set(Object.values(ROLE_FILE))) {
      if (other !== ROLE_FILE[set]) assert.ok(!loaded.files.includes(other), `${set} does not load ${other}`);
    }
  }
  // planning never carries the research files; a teaching turn never the study-prep plan rules
  const planning = await loadContext(contextSetFor("study_prep", "planning"));
  assert.ok(!planning.files.includes("reasoning/RESEARCH.md"));
  const turn = await loadContext(contextSetFor("teaching", "turn:teach_agent"));
  assert.ok(!turn.files.includes("reasoning/PLANNING.md"));
  const guide = await loadContext(contextSetFor("teaching", "turn:learn_with_guide"));
  assert.ok(guide.files.includes("workflows/GUIDE_MODE.md"));
  assert.ok(!guide.files.some((f) => /PROTEGE/i.test(f)), "guide mode carries no protégé doctrine");
});

test("every joined set is reached by an operation, or listed as unmapped with a reason", () => {
  const mapped = new Set(Object.values(OPERATION_SETS).flatMap((table) => Object.values(table)));
  for (const name of Object.keys(CONTEXT_SETS)) {
    assert.ok(mapped.has(name) || UNMAPPED_SETS[name], `${name} is loaded by no operation`);
  }
  assert.deepEqual(Object.keys(UNMAPPED_SETS), ["teaching"]);
  for (const ops of Object.values(LIVE_OPERATIONS)) for (const op of ops) assert.ok(operationRows().some((r) => r.operation === op && r.live));
});

test("context failure: an unknown workflow, operation or set is context_unavailable, never an empty prompt", async () => {
  assert.throws(() => contextSetFor("study_prep", "made_up"), (e) => e.code === "context_unavailable");
  assert.throws(() => contextSetFor("nope", "planning"), (e) => e.code === "context_unavailable");
  await assert.rejects(() => loadContext("not_a_set"), (e) => e.code === "context_unavailable");
});

test("boot preflight is green with the new sets", async () => {
  clearContextCache();
  const report = await preflight();
  assert.deepEqual(report.problems, []);
  assert.equal(report.ok, true);
  for (const name of ["teaching_controller", "guide_controller", "teaching_strategy", "decay_inspection", "decay_review", "practice"]) {
    const row = report.sets.find((s) => s.set === name);
    assert.ok(row, `${name} is preflighted`);
    assert.equal(row.present, row.files, `${name}: every file present`);
  }
});

test("AGENT.md is workflow-neutral; the workflow files carry the roles", async () => {
  const read = (f) => readFile(new URL(`../../akoro-agent/${f}`, import.meta.url), "utf8");
  const agent = await read("AGENT.md");
  assert.doesNotMatch(agent, /Study Agent|examination|study session/i, "no study-prep role in the shared identity");
  assert.match(await read("workflows/STUDY_PREP.md"), /Study Agent/);
  assert.match(await read("workflows/TEACHING.md"), /teaching controller/i);
});

test("study-prep wiring names operations, never a set literal", async () => {
  const src = await readFile(new URL("../adaptive-learning/study-prep/wiring.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /setName:\s*["']/, "buildAgentContext gets its set from contextSetFor()");
  assert.doesNotMatch(src, /contextSetName:\s*["']/, "runAgentStep gets its set from contextSetFor()");
  assert.match(src, /contextSetFor\("study_prep", operation\)/);
  assert.match(src, /contextSetFor\("study_prep", "wake"\)/);
});
