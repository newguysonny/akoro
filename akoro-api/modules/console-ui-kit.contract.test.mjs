// The console rebuild's UI kit (reference/Akoro Console Rebuild — Plan.md):
// one source (design-system/ui), copied into each console as src/ui; the
// kit's look is the learner app's; the ?ui= switch picks legacy or next.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { TARGETS, copyOf, kitFiles } from "../../design-system/sync.mjs";
import { pickUiMode } from "../../akoro-instructor/src/theme/uiMode.js";

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

test("the instructor's legacy look sets every variable the next look sets", () => {
  const keys = (src) => [...src.matchAll(/'(--ak-[a-z0-9-]+)':/g)].map((m) => m[1]).sort();
  const legacy = keys(read("akoro-instructor/src/theme/legacyVars.js")).filter((k) => !k.startsWith("--ak-bx-") && !k.startsWith("--ak-skel-"));
  const next = keys(read("design-system/ui/tokens.js").replace(/export const DARK_VARS[\s\S]*?\n\};/, "")).concat("--ak-brand", "--ak-font").sort();
  assert.deepEqual(legacy, [...new Set(next)].sort());
});

test("?ui= picks the look: next / legacy stick, reset clears, any case, default legacy", () => {
  assert.deepEqual(pickUiMode("?ui=next", null, undefined), { mode: "next", store: "next" });
  assert.deepEqual(pickUiMode("?UI=Next", null, undefined), { mode: "next", store: "next" });
  assert.deepEqual(pickUiMode("?ui=legacy", "next", undefined), { mode: "legacy", store: "legacy" });
  assert.deepEqual(pickUiMode("", "next", undefined), { mode: "next", store: undefined }, "the stored choice sticks");
  assert.deepEqual(pickUiMode("?ui=reset", "next", undefined), { mode: "legacy", store: null });
  assert.deepEqual(pickUiMode("", null, undefined), { mode: "legacy", store: undefined }, "default: legacy");
  assert.deepEqual(pickUiMode("", null, "next"), { mode: "next", store: undefined }, "VITE_CONSOLE_UI=next flips the default");
  assert.deepEqual(pickUiMode("?ui=banana", "legacy", "next"), { mode: "legacy", store: undefined }, "an unknown value changes nothing");
});

test("the instructor's next nav reaches every page the legacy nav does (and nothing else)", () => {
  const paths = (src) => new Set([...src.matchAll(/to:\s*'(\/[^']*)'/g)].map((m) => m[1]));
  const legacySrc = read("akoro-instructor/src/components/Layout.jsx");
  const legacy = paths(legacySrc.slice(legacySrc.indexOf("const NAV = ["), legacySrc.indexOf("function NavItem")));
  legacy.add("/course-creator/review");   // the admin-only Review Queue, appended in the legacy Sidebar
  const next = paths(read("akoro-instructor/src/components/NextLayout.jsx"));
  assert.deepEqual([...next].sort(), [...legacy].sort());
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
