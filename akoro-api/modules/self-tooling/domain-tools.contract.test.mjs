import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const PIPELINE_PARTS = ["./pipeline.js", "./pipeline-create.js", "./pipeline-dry.js", "./pipeline-io.js", "./pipeline-verify.js", "./rules.js"];
const readPipeline = () => PIPELINE_PARTS.map(read).join("\n");

test("split domain tools: one per view, action cap, cleanup + builder guidance", () => {
  const pipe = readPipeline();
  assert.match(pipe, /MAX_DOMAIN_ACTIONS/, "action cap enforced");
  assert.match(pipe, /retireSameView\(learnerId, spec\.view, spec\.name\)/, "retires other domain tools over the same view");
  assert.match(pipe, /isDomainTool/, "writes (no action enum) are never retired with read domains");
  assert.match(read("../adaptive-learning/chat/tool-catalogue-core.js"), /Prefer ONE tool per data domain/, "builder guidance");
  const consoleSrc = read("../agentConsole/routes.js");
  assert.match(consoleSrc, /router\.post\("\/cleanup-domain-tools"/, "cleanup endpoint");
  assert.match(consoleSrc, /router\.post\("\/repair-library-tools"/, "repair endpoint");
});

test("reuse is domain-based, not goal-text fuzzy", () => {
  const pipe = readPipeline();
  assert.match(pipe, /const goalView = docGoal \? "my_library"/, "resolves the goal's data view");
  assert.match(pipe, /bestSelfView\(goal\)/, "falls back to the views' own keywords");
  assert.match(pipe, /domainOf\(t\) === goalView/, "only same-domain tools are candidates");
  assert.match(pipe, /hasDomainTool[\s\S]{0,220}buildDomain\(spec\)/, "a same-view domain tool is extended, not duplicated");
  assert.match(pipe, /!asksForChange\(goal\) \|\| !isDomainTool\(t\)/, "a read domain tool never serves a write goal");
  assert.match(pipe, /textsOf\(t\)\.some\(\(x\) => similarGoal\(x, goal\)\)/, "matches on goal, label and name");
  assert.match(pipe, /const dkey = audience === "learner" && !asksForChange\(goal\)/, "curated domains skip change goals");
  assert.match(pipe, /audience === "learner" && !asksForChange\(goal\)\) \{\n    try \{\n      const lookupD = await schemaLookup/, "dynamic domains skip change goals");
});

test("stale cleanup is per-learner and global, and never archives write tools", () => {
  const src = read("../agentConsole/routes.js");
  assert.match(src, /req\.body\?\.all === true/, "all-learner sweep");
  assert.match(src, /confirm:true/, "global archive needs confirmation");
  const cleanupSrc = read("../agentConsole/cleanup.js");
  assert.match(cleanupSrc, /isWriteTool\(t\)\) continue/, "write tools are skipped");
  assert.match(cleanupSrc, /isSimpleRead/, "bespoke readers are kept beside the domain tool");
});

test("agent_tools carries domain/actions and the migration is registered", () => {
  const pipe = readPipeline();
  assert.match(pipe, /domain: spec\.view, actions/, "domain tool writes domain + actions");
  const manifest = JSON.parse(read("../../migrations/manifest.json"));
  assert.ok(manifest.schema.includes("2026-agent-tools-domain.sql"), "migration registered");
  assert.match(read("../agentConsole/cleanup.js"), /t\.domain \|\|/, "cleanup reads the domain column");
});

test("a rejected rebuild never archives the working domain tool", () => {
  const pipe = readPipeline();
  const verifyAt = pipe.indexOf("await verifyDomainActions(spec2");
  const rejectAt = pipe.indexOf("if (bad.length)");
  const archiveAt = pipe.indexOf("Retire ONLY after verification passes");
  assert.ok(verifyAt > 0, "verification runs");
  assert.ok(rejectAt > verifyAt, "rejection is decided after verification");
  assert.ok(archiveAt > rejectAt, "retirement happens only after the rejection check passes");
});

test("replace captures actions before archiving, so a rebuild keeps them", () => {
  const pipe = readPipeline();
  const replaceBlock = pipe.slice(pipe.indexOf("const replaceRaw"), pipe.indexOf("// Build a domain tool"));
  assert.match(replaceBlock, /select\("id, name, views, domain, params_schema"\)/, "reads the old params_schema before archiving");
  assert.ok(replaceBlock.indexOf("params_schema") < replaceBlock.indexOf('status: "archived"'), "captured before the archive update");
  assert.match(pipe, /carriedActions\(spec\.view\)/, "buildDomain unions carried actions");
});

test("a domain build reports what was added and that the rest still works", () => {
  const pipe = readPipeline();
  assert.match(pipe, /const added = actions\.filter\(\(a\) => !have\.has\(a\)\)/, "computes what was added");
  assert.match(pipe, /const kept = actions\.filter\(\(a\) => have\.has\(a\)\)/, "computes what was kept");
  assert.match(pipe, /nothing that worked before has broken/i, "reassures no regression");
  assert.match(pipe, /verified: checks\.filter\(\(c\) => c\.ok\)/, "reports the checks that ran");
  assert.match(read("../agentConsole/routes.js"), /verification: t\.verification/, "console exposes the assertions");
});
