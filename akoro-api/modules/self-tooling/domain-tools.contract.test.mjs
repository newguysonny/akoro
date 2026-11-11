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
  assert.match(pipe, /t\.views\.includes\(spec\.view\)/, "retires other tools over the same view");
  assert.match(read("../adaptive-learning/chat.js"), /Prefer ONE tool per data domain/, "builder guidance");
  const consoleSrc = read("../agentConsole/routes.js");
  assert.match(consoleSrc, /router\.post\("\/cleanup-domain-tools"/, "cleanup endpoint");
  assert.match(consoleSrc, /router\.post\("\/repair-library-tools"/, "repair endpoint");
});
