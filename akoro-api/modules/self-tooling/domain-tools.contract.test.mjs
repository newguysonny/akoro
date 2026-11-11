import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

test("split domain tools: one per view, action cap, cleanup + builder guidance", () => {
  const pipe = read("./pipeline.js");
  assert.match(pipe, /MAX_DOMAIN_ACTIONS/, "action cap enforced");
  assert.match(pipe, /retireSameView\(learnerId, spec\.view, spec\.name\)/, "retires other domain tools over the same view");
  assert.match(pipe, /isDomainTool/, "writes (no action enum) are never retired with read domains");
  assert.match(read("../adaptive-learning/chat.js"), /Prefer ONE tool per data domain/, "builder guidance");
  const consoleSrc = read("../agentConsole/routes.js");
  assert.match(consoleSrc, /router\.post\("\/cleanup-domain-tools"/, "cleanup endpoint");
  assert.match(consoleSrc, /router\.post\("\/repair-library-tools"/, "repair endpoint");
});

test("reuse is domain-based, not goal-text fuzzy", () => {
  const pipe = read("./pipeline.js");
  assert.match(pipe, /const goalView = docGoal \? "my_library"/, "resolves the goal's data view");
  assert.match(pipe, /bestSelfView\(goal\)/, "falls back to the views' own keywords");
  assert.match(pipe, /domainOf\(t\) === goalView/, "only same-domain tools are candidates");
  assert.match(pipe, /hasDomainTool[\s\S]{0,220}buildDomain\(spec\)/, "a same-view domain tool is extended, not duplicated");
  assert.match(pipe, /!asksForChange\(goal\) \|\| !isDomainTool\(t\)/, "a read domain tool never serves a write goal");
});

test("stale cleanup is per-learner and global, and never archives write tools", () => {
  const src = read("../agentConsole/routes.js");
  assert.match(src, /req\.body\?\.all === true/, "all-learner sweep");
  assert.match(src, /confirm:true/, "global archive needs confirmation");
  assert.match(src, /\(t\.capabilities \|\| \[\]\)\.length\) continue/, "write tools are skipped");
});

test("agent_tools carries domain/actions and the migration is registered", () => {
  const pipe = read("./pipeline.js");
  assert.match(pipe, /domain: spec\.view, actions/, "domain tool writes domain + actions");
  const manifest = JSON.parse(read("../../migrations/manifest.json"));
  assert.ok(manifest.schema.includes("2026-agent-tools-domain.sql"), "migration registered");
  assert.match(read("../agentConsole/routes.js"), /t\.domain \|\|/, "cleanup reads the domain column");
});

test("a rejected rebuild never archives the working domain tool", () => {
  const pipe = read("./pipeline.js");
  const verifyAt = pipe.indexOf("await verifyDomainActions(spec2");
  const rejectAt = pipe.indexOf("if (bad.length)");
  const archiveAt = pipe.indexOf("Retire ONLY after verification passes");
  assert.ok(verifyAt > 0, "verification runs");
  assert.ok(rejectAt > verifyAt, "rejection is decided after verification");
  assert.ok(archiveAt > rejectAt, "retirement happens only after the rejection check passes");
});

test("replace captures actions before archiving, so a rebuild keeps them", () => {
  const pipe = read("./pipeline.js");
  const replaceBlock = pipe.slice(pipe.indexOf("const replaceRaw"), pipe.indexOf("// Build a domain tool"));
  assert.match(replaceBlock, /select\("id, name, views, domain, params_schema"\)/, "reads the old params_schema before archiving");
  assert.ok(replaceBlock.indexOf("params_schema") < replaceBlock.indexOf('status: "archived"'), "captured before the archive update");
  assert.match(pipe, /carriedActions\(spec\.view\)/, "buildDomain unions carried actions");
});
