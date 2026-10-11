// The learner-tools eval suite stays in step with the Agent Chat: one case per
// learner tool, arguments that exist in the tool's schema, and "run" only on
// tools that change nothing.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";
process.env.OPENAI_API_KEY ||= "test-openai-key";

const data = JSON.parse(await readFile(new URL("./data/learner-tools.json", import.meta.url), "utf8"));
const { learnerToolsSuite } = await import("./learnerTools.js");
const chatSrc = await readFile(new URL("../../modules/adaptive-learning/chat.js", import.meta.url), "utf8");
const indexSrc = await readFile(new URL("./index.js", import.meta.url), "utf8");

// The learner tool catalogue, read from chat.js's CHAT_TOOLS source (importing
// chat.js pulls in auth/passport, which needs real OAuth keys).
function learnerTools() {
  const start = chatSrc.indexOf("[", chatSrc.indexOf("const CHAT_TOOLS"));
  const end = chatSrc.indexOf("\n];", start);
  return chatSrc.slice(start, end).split(/\n  \{\s*\n/).slice(1).map((b) => ({
    name: b.match(/name:\s*"([^"]+)"/)[1],
    props: new Set([...b.matchAll(/\b(\w+):\s*\{\s*type:/g)].map((x) => x[1])),
  }));
}

test("every learner chat tool has exactly one case, and every case names a real tool", () => {
  const tools = learnerTools().map((t) => t.name).sort();
  const cased = data.cases.map((c) => c.tool).sort();
  assert.deepEqual(cased, tools);
  assert.equal(learnerToolsSuite.cases.length, tools.length);
  assert.match(indexSrc, /SUITES = \[[^\]]*learnerToolsSuite/);
});

test("case arguments exist in the tool's input schema", () => {
  const byName = new Map(learnerTools().map((t) => [t.name, t]));
  for (const c of data.cases) {
    const props = byName.get(c.tool)?.props ?? new Set();
    for (const k of Object.keys(c.args ?? {})) assert.ok(props.has(k), `${c.tool}: no "${k}" in its schema`);
  }
});

test("only read-only tools are executed — nothing that changes data runs in an eval", () => {
  const m = chatSrc.match(/SIDE_EFFECT_TOOLS = \[([\s\S]*?)\];/);
  const changing = new Set([...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
  for (const c of data.cases.filter((x) => x.run)) {
    assert.ok(!changing.has(c.tool), `${c.tool} changes data — it must not have run:true`);
    if (["study_buddy", "daily_challenge", "revision_circle"].includes(c.tool)) {
      assert.ok([].concat(c.args?.action).every((a) => ["list", "status", "ranking", "search", null].includes(a)), `${c.tool} may only run a read-only action`);
    }
  }
  // Tools that send, cost or mark things are never run even if not in the list above.
  for (const t of ["check_agent_inbox", "consult_peer_agents", "consult_teaching_guide", "read_blog_post"]) {
    assert.ok(!data.cases.find((c) => c.tool === t).run, `${t} must not run`);
  }
});
