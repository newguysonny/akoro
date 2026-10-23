// The console rebuild's UI kit (reference/Akoro Console Rebuild — Plan.md):
// one source (design-system/ui), copied into each console as src/ui; the
// kit's look is the learner app's. The instructor app is on it alone (the
// legacy look and its ?ui= switch were removed at the flip).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { TARGETS, copyOf, kitFiles } from "../../design-system/sync.mjs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const varsBlock = (src, name) => {
  const m = src.match(new RegExp(`(?:export )?const ${name} = (\\{[\\s\\S]*?\\n\\});`));
  assert.ok(m, `${name} found`);
  return Object.fromEntries([...m[1].matchAll(/'(--ak-[a-z0-9-]+)':\s*'([^']+)'/g)].map((x) => [x[1], x[2]]));
};

test("every console's src/ui is an exact copy of the kit (run node design-system/sync.mjs)", () => {
  for (const app of TARGETS) {
    const dir = new URL(`${app}/src/ui/`, root);
    assert.deepEqual(readdirSync(dir).sort(), kitFiles(), `${app}/src/ui has exactly the kit's files`);
    for (const f of kitFiles()) assert.equal(readFileSync(new URL(f, dir), "utf8"), copyOf(f), `${app}/src/ui/${f} matches design-system/ui/${f}`);
  }
});

test("the kit's look is the learner app's: theme variables and nav icons identical", () => {
  const learner = read("akoro-learner/src/contexts/ThemeContext.jsx");
  const kit = read("design-system/ui/tokens.js");
  for (const name of ["LIGHT_VARS", "DARK_VARS"]) assert.deepEqual(varsBlock(kit, name), varsBlock(learner, name), name);
  assert.equal(read("design-system/ui/NavIcons.jsx"), read("akoro-learner/src/components/common/NavIcons.jsx"));
  assert.match(kit, /BRAND = '#6C3BFF'/);
});

test("the instructor app has only the learner look — no legacy theme, frame or switch left", async () => {
  const { existsSync } = await import("node:fs");
  for (const f of ["theme/uiMode.js", "theme/legacyVars.js", "components/AppHeader.jsx", "components/LiveClassWizard.jsx", "components/OnDemandWizard.jsx", "pages/CoursesPage.jsx"]) {
    assert.ok(!existsSync(new URL(`akoro-instructor/src/${f}`, root)), `${f} is gone`);
  }
  const main = read("akoro-instructor/src/main.jsx");
  assert.match(main, /setAttribute\('data-ui', 'next'\)/, "the kit's base styles apply");
  assert.match(main, /learnerVars\(isDark\)/, "the learner's light and dark sets");
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(new URL("akoro-instructor/src/", root), { recursive: true })).filter((f) => /\.(jsx|js)$/.test(f));
  const left = files.filter((f) => /isNextUi|UI_MODE|legacyVars/.test(read(`akoro-instructor/src/${f}`)));
  assert.deepEqual(left, [], "no page branches on the old switch");
});

test("every page the instructor nav links to has a route (no dead links)", () => {
  const nav = [...new Set([...read("akoro-instructor/src/components/NextLayout.jsx").matchAll(/to:\s*'(\/[^']*)'/g)].map((m) => m[1]))];
  const app = read("akoro-instructor/src/App.jsx");
  assert.ok(nav.length > 25, "the nav was read");
  // Course Creator's own pages live under its /course-creator/* route.
  const routed = (p) => app.includes(`path="${p}"`) || (p.startsWith("/course-creator") && app.includes('path="/course-creator/*"'));
  assert.deepEqual(nav.filter((p) => !routed(p)), []);
  // No Courses page: its paths go to Course Creator.
  assert.match(app, /path="\/courses" element=\{<Navigate to="\/course-creator" replace \/>\}/);
});

test("every Tabler icon name the instructor app uses exists in the icon font (no blank icons)", async () => {
  const { readdir } = await import("node:fs/promises");
  const css = read("akoro-instructor/node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css");
  const known = new Set([...css.matchAll(/\.(ti-[a-z0-9-]+):before/g)].map((m) => m[1]));
  assert.ok(known.size > 3000, "the font's icon list was read");
  const files = (await readdir(new URL("akoro-instructor/src/", root), { recursive: true })).filter((f) => /\.(jsx|js)$/.test(f));
  const missing = [];
  for (const f of files) {
    const src = read(`akoro-instructor/src/${f}`);
    for (const m of src.matchAll(/(?:ti[=:]\s*|name[=:]\s*)["'`](ti-[a-z0-9-]+)["'`]/g)) if (!known.has(m[1])) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});
