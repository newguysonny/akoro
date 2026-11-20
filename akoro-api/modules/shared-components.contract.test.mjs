// Shared page components (Phase 19 step 5): one source in design-system/shared,
// copied into every app's src/shared by `node design-system/sync.mjs`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { SHARED_TARGETS, sharedCopyOf, sharedFiles } from "../../design-system/sync.mjs";

const root = new URL("../../", import.meta.url);

test("every app's src/shared is an exact copy of design-system/shared", () => {
  for (const app of SHARED_TARGETS) {
    const dir = new URL(`${app}/src/shared/`, root);
    assert.deepEqual(readdirSync(dir).sort(), sharedFiles(), `${app}/src/shared has exactly the shared components`);
    for (const f of sharedFiles()) {
      assert.equal(readFileSync(new URL(f, dir), "utf8"), sharedCopyOf(f), `${app}/src/shared/${f} matches design-system/shared/${f}`);
    }
  }
});

test("shared components import nothing (drop-in for any app shell)", () => {
  for (const f of sharedFiles()) {
    const src = readFileSync(new URL(`design-system/shared/${f}`, root), "utf8");
    assert.doesNotMatch(src, /^\s*import\s/m, `${f} has no imports`);
    assert.doesNotMatch(src, /\benum\s|\bnamespace\s/, `${f} stays erasable`);
  }
});
