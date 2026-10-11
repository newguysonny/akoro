// The agent console: key-guarded, DRY by default, and DRY really stops every
// tool that changes data before it runs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const src = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const chat = await readFile(new URL("../adaptive-learning/chat.js", import.meta.url), "utf8");
const app = await readFile(new URL("../../app.js", import.meta.url), "utf8");
const { runDry, isDryRun } = await import("../../lib/dryRunContext.js");

test("every route is behind the console key, and the console is mounted", () => {
  for (const m of src.matchAll(/router\.(get|post)\("([^"]+)",\s*(\w+)/g)) assert.equal(m[3], "guard", `${m[2]} is not guarded`);
  assert.match(app, /app\.use\("\/api\/agent-console", standardLimit, agentConsoleModule\)/);
  assert.match(app, /import "\.\/lib\/logTap\.js";/);
});

test("dry is the default; only an explicit 'live' changes data", () => {
  assert.equal((src.match(/req\.body\?\.mode === "live" \? "live" : "dry"/g) || []).length, 2);
  assert.match(chat, /if \(isDryRun\(\) && isSideEffecting\(name, input\)\) \{\s*return \{ dryRun: true/);
  assert.match(chat, /req\.get\("x-agent-console-dry"\) === key\) return runDry/);
});

test("the dry-run flag is scoped to the request that set it", async () => {
  assert.equal(isDryRun(), false);
  await runDry(async () => { await new Promise((r) => setTimeout(r, 5)); assert.equal(isDryRun(), true); });
  assert.equal(isDryRun(), false);
});

test("a learner must be a learner account, and the allow-list is honoured", () => {
  assert.match(src, /\["student", "learner"\]\.includes\(String\(u\.role/);
  assert.match(src, /AGENT_CONSOLE_LEARNERS/);
});

test("the console key can arrive as Authorization: Bearer (cloud network secrets)", async () => {
  const src = await readFile(new URL("./routes.js", import.meta.url), "utf8");
  assert.match(src, /\/\^Bearer\\s\+\(\.\+\)\$\/i\.exec\(req\.get\("authorization"\)/);
  assert.match(src, /const got = req\.get\("x-agent-console-key"\) \|\| bearer \|\| req\.query\.key;/);
});

test("the tester cohort boot-seeds with the schemas — not behind an opt-in flag", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../../migrations/manifest.json", import.meta.url), "utf8"),
  );
  for (const f of ["2026-seed-school.sql", "2026-seed-agent-testers.sql"]) {
    assert.ok(manifest.schema.includes(f), `${f} must be in the schema group (applies at backend boot)`);
    assert.ok(!manifest.demo.includes(f), `${f} must not sit in the opt-in demo group`);
  }
  assert.match(app, /applyMigrations\(\{ url: mUrl, groups: \["schema"\]/, "backend boot applies the schema group");
  const seed = await readFile(new URL("../../migrations/2026-seed-agent-testers.sql", import.meta.url), "utf8");
  assert.match(seed, /FOR i IN 1\.\.50 LOOP/, "the seed creates tester01–tester50");
  assert.match(seed, /'tester%s@demo\.akoro\.app'/, "demo.akoro.app emails — the AGENT_CONSOLE_LEARNERS shape");
  assert.match(seed, /Akoro Demo Academy not found/, "the seed skips loudly when its school seed has not run");
});
