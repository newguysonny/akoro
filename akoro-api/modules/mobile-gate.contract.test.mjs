import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The consoles went mobile. Admin + instructor used to gate phones behind a
// full-page "built for bigger screens" notice; school and kpemu-business
// never gated. All four now share the Akoro app header on phones (below
// 768px): hamburger | spacer | actions | avatar menu. Pages render full
// width — there is no permanent sidebar on a phone; the sidebar exists only
// as a drawer. Tablet/desktop shells are unchanged.
//
// admin / school / instructor share ONE wiring (this session): the drawer
// opens ONLY from the AppHeader hamburger, which also closes it, and it
// closes on the Sidebar's brand-row X, the backdrop, and Escape.
// kpemu-business shipped the same UX earlier with the drawer inside its own
// Sidebar component — pinned separately, to the same user-visible contract.

const read = (app, file) => readFile(
  new URL(`../../${app}/src/${file}`, import.meta.url), "utf8",
);

const [instructorMain, adminMain, learnerMain, learnerApp] = await Promise.all([
  read("akoro-instructor", "main.jsx"),
  read("akoro-admin", "main.jsx"),
  read("akoro-learner", "main.jsx"),
  readFile(new URL("../../akoro-learner/src/App.jsx", import.meta.url), "utf8").catch(() => ""),
]);

const APPS = ["akoro-admin", "akoro-school", "akoro-instructor", "kpemu-business"];
const layouts = {}, headers = {}, headerCss = {};
for (const app of APPS) {
  layouts[app] = await read(app, "components/Layout.jsx");
  headers[app] = await read(app, "components/AppHeader.jsx");
  headerCss[app] = await read(app, "components/AppHeader.css");
}

test("no console gates phones any more — and the learner app never did", () => {
  assert.doesNotMatch(instructorMain, /MobileGate/, "instructor main mounts no gate");
  assert.doesNotMatch(adminMain, /MobileGate/, "admin main mounts no gate");
  assert.doesNotMatch(learnerMain, /MobileGate/);
  assert.doesNotMatch(learnerApp, /MobileGate/);
});

test("every console shell renders the shared Akoro AppHeader on mobile", () => {
  for (const app of APPS) {
    assert.match(layouts[app], /import AppHeader from '\.\/AppHeader\.jsx';/, `${app}: imports AppHeader`);
    assert.match(layouts[app], /<AppHeader/, `${app}: renders it`);
    assert.match(layouts[app], /max-width: 767px/, `${app}: phones only — tablets keep the desktop shell`);
    // The header component itself is the reference port, everywhere: the
    // avatar opens an account menu with the reference keyboard model, and
    // the reference motion tokens live in the css.
    assert.match(headers[app], /aria-haspopup="menu"/, `${app}: avatar declares the menu`);
    assert.match(headers[app], /ArrowDown/, `${app}: arrow-key navigation present`);
    assert.match(headerCss[app], /--akhd-ease-spring/, `${app}: reference motion tokens`);
  }
});

test("admin/school/instructor: drawer opens ONLY from the hamburger — closed by X, hamburger, backdrop, Escape", () => {
  for (const app of ["akoro-admin", "akoro-school", "akoro-instructor"]) {
    const src = layouts[app];
    assert.match(src, /onMenu=\{\(\) => setDrawerOpen\(\(o\) => !o\)\}/,
      `${app}: the AppHeader hamburger TOGGLES the drawer (open AND close)`);
    assert.match(src, /<Sidebar collapsed=\{false\} onClose=\{\(\) => setDrawerOpen\(false\)\} \/>/,
      `${app}: the drawer mounts the sidebar expanded; its brand-row X closes`);
    assert.match(src, /onClick=\{\(\) => setDrawerOpen\(false\)\} aria-hidden="true"/,
      `${app}: the backdrop closes it`);
    assert.match(src, /if \(e\.key === 'Escape'\) setDrawerOpen\(false\);/,
      `${app}: Escape closes it`);
    // The old desktop TopBar hamburger must NOT render on mobile — the
    // AppHeader owns the drawer there.
    assert.match(src, /onToggleSidebar=\{null\}/, `${app}: mobile TopBar has no hamburger of its own`);
  }
});

test("admin/school/instructor: phones get full-width pages — no permanent sidebar", () => {
  for (const app of ["akoro-admin", "akoro-school", "akoro-instructor"]) {
    const src = layouts[app];
    const cut = src.indexOf("if (mobile) {");
    assert.ok(cut !== -1, `${app}: has a mobile branch`);
    const mobileBranch = src.slice(cut, src.indexOf("  return (", cut));
    assert.doesNotMatch(mobileBranch, /<Sidebar collapsed=\{collapsed\} \/>/,
      `${app}: the mobile branch never mounts the permanent sidebar`);
  }
});

test("kpemu-business: same contract, shipped drawer-inside-Sidebar wiring", () => {
  const src = layouts["kpemu-business"];
  assert.match(src, /onMenu=\{\(\) => setMenuOpen\(true\)\}/, "the hamburger opens the drawer");
  assert.match(src, /<Sidebar mobile=\{mobile\} open=\{menuOpen\} onClose=\{\(\) => setMenuOpen\(false\)\} \/>/,
    "the Sidebar IS the drawer — X closes it via onClose");
  assert.match(src, /if \(e\.key === 'Escape'\) onClose\?\.\(\);/, "Escape closes it");
});

test("the instructor chat uses the learner app's Fortizo composer", () => {
  const composer = readFile(
    new URL("../../akoro-instructor/src/components/common/FortizoChatComposer.jsx", import.meta.url), "utf8",
  );
  return composer.then((src) => {
    assert.match(src, /export default function FortizoChatComposer/);
    assert.match(src, /taskAction/);   // instructor-only task toggle
    assert.match(src, /sendFromKeyboard/);
  });
});
