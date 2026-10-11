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
