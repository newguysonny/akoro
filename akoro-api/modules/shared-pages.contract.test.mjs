// Shared pages (Grand Plan Phase 19 step 5): one source in
// design-system/pages, copied into each console app as src/pages. The copies
// exist because every app deploys from its own folder; a contract test keeps
// them byte-identical. Run `node design-system/sync.mjs` after editing a page.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { PAGE_TARGETS, pageCopyOf, pageFiles } from "../../design-system/sync.mjs";

const root = new URL("../../", import.meta.url);
const hint = "run node design-system/sync.mjs";

test("every app's shared pages are exact copies of design-system/pages", () => {
  for (const app of PAGE_TARGETS) {
    const dir = new URL(`${app}/src/pages/`, root);
    const present = readdirSync(dir).filter((f) => pageFiles().includes(f)).sort();
    assert.deepEqual(present, pageFiles(), `${app}/src/pages has exactly the shared pages (${hint})`);
    for (const f of pageFiles()) {
      assert.equal(readFileSync(new URL(f, dir), "utf8"), pageCopyOf(f), `${app}/src/pages/${f} matches design-system/pages/${f} (${hint})`);
    }
  }
});
