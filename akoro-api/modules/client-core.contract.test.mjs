// The shared HTTP core (Grand Plan Phase 19 step 5): one source in
// design-system/client, copied into each app as src/client. The copies exist
// because every app deploys from its own folder; a contract test keeps them
// byte-identical. Run `node design-system/sync.mjs` after editing the core.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { CLIENT_TARGETS, clientCopyOf, clientFiles } from "../../design-system/sync.mjs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

test("every app's src/client is an exact copy of design-system/client (run node design-system/sync.mjs)", () => {
  for (const app of CLIENT_TARGETS) {
    const dir = new URL(`${app}/src/client/`, root);
    assert.deepEqual(readdirSync(dir).sort(), clientFiles(), `${app}/src/client has exactly the client's files`);
    for (const f of clientFiles()) {
      assert.equal(readFileSync(new URL(f, dir), "utf8"), clientCopyOf(f), `${app}/src/client/${f} matches design-system/client/${f}`);
    }
  }
});

test("the client core stays dependency-free and erasable (Node type stripping, Phase 20)", () => {
  for (const f of clientFiles()) {
    const src = read(`design-system/client/${f}`);
    // Erasable syntax only: no enum / namespace, which Node's stripping refuses.
    assert.doesNotMatch(src, /^\s*(export\s+)?(const\s+)?enum\s/m, `${f} declares no enum`);
    assert.doesNotMatch(src, /^\s*(export\s+)?namespace\s/m, `${f} declares no namespace`);
    // One source of truth: no deep imports out of the folder.
    assert.doesNotMatch(src, /from\s+["'](?!\.\/)/, `${f} imports nothing from outside the folder`);
  }
});

test("the client core keeps the cookie-only contract (no token in JS memory)", () => {
  const core = read("design-system/client/apiCore.ts");
  assert.match(core, /credentials:\s*["']include["']/, "cookies are sent");
  assert.doesNotMatch(core, /localStorage\.setItem\(/, "never stores a token in local storage");
  assert.match(core, /X-Akoro-Portal/, "the portal header decides which session is read");
});
