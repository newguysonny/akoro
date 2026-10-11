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

/* ── The undefined-icon guard ──────────────────────────────────────────────
   A layout that uses `icon: SomeIcon` without importing it still BUILDS
   (a free identifier is a runtime ReferenceError, not a build error) —
   business.kpemu.com shipped exactly that crash (MessageCircleQuestion).
   Parse every layout's lucide import block (multiline-aware) and require
   every `icon: X` identifier to be imported exactly once. */
function lucideImports(src) {
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*'lucide-react';/s);
  assert.ok(m, "lucide import block found");
  const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean);
  const dups = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dups, [], `duplicate lucide imports: ${dups.join(", ")}`);
  return names;
}

test("every header action icon is imported — no runtime ReferenceError class", () => {
  for (const app of APPS) {
    const src = layouts[app];
    const names = lucideImports(src);
    // Only action/menu object literals (`{ key: 'x', icon: Y, … }`) —
    // destructured component params (`{ to, icon: Icon, label }`) are not
    // lucide references.
    const used = src.split("\n")
      .filter((l) => /key: '/.test(l))
      .flatMap((l) => [...l.matchAll(/icon:\s*([A-Z]\w+)/g)].map((m) => m[1]));
    assert.ok(used.length > 0, `${app}: has icon references`);
    const missing = [...new Set(used)].filter((n) => !names.includes(n));
    assert.deepEqual(missing, [], `${app}: icons used but not imported — this deploys as a crash: ${missing.join(", ")}`);
  }
});

/* ── The undefined-identifier guard (whole src tree) ───────────────────────
   Production shipped this crash class TWICE: a component/icon used but not
   imported still BUILDS (a free identifier is a runtime ReferenceError, not
   a build error) — business.kpemu.com and instructors.akoro.name.ng both
   went down with "MessageCircleQuestion is not defined". For EVERY source
   file in every console app: collect the file's import bindings, local
   definitions, and destructured bindings, then require every JSX component
   (<Name/>) and every `icon: Name` reference to be in that set. */
test("no source file uses a component or icon it never imports — the production-crash class", async () => {
  const { readdir } = await import("node:fs/promises");
  const root = new URL("../../", import.meta.url).pathname;
  async function* walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) yield* walk(p);
      else if (/\.(jsx|js)$/.test(e.name)) yield p;
    }
  }
  for (const app of APPS) {
    for await (const file of walk(`${root}${app}/src`)) {
      const src = await readFile(file, "utf8");
      const known = new Set();
      // import defaults, namespaces, and named bindings (multiline-aware)
      for (const m of src.matchAll(/import\s+([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*["'][^"']+["']/g)) {
        if (m[1]) known.add(m[1]);
        for (let spec of (m[2] ?? "").split(",")) {
          spec = spec.trim();
          if (spec) known.add(spec.split(/\s+as\s+/).pop().trim());
        }
      }
      // local definitions and destructured bindings ({ key, icon: Icon, … })
      for (const m of src.matchAll(/(?:function|class)\s+([A-Z]\w*)/g)) known.add(m[1]);
      for (const m of src.matchAll(/(?:const|let|var)\s+([A-Z]\w*)\s*=/g)) known.add(m[1]);
      for (const m of src.matchAll(/\(\s*\{([^()]*?)\}\s*[,)]/g))
        for (const p of m[1].split(",")) {
          const alias = p.trim().match(/^(\w+)\s*:\s*([A-Z]\w*)$/);
          if (alias) known.add(alias[2]);
          else if (/^\s*[A-Z]\w*\s*$/.test(p)) known.add(p.trim());
        }
      // positional parameters are bindings too: (onClick, Icon, title) => …
      for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g))
        for (const p of m[1].split(","))
          if (/^\s*[A-Z]\w*\s*$/.test(p)) known.add(p.trim());
      // array destructuring: .map(([url, Icon], k) => …) / const [a, B] = …
      for (const m of src.matchAll(/\(\s*\[([^[\]()]*)\]/g))
        for (const p of m[1].split(","))
          if (/^\s*[A-Z]\w*\s*$/.test(p.trim())) known.add(p.trim());
      for (const m of src.matchAll(/(?:const|let|var)\s*\[([^[\]]*)\]\s*=/g))
        for (const p of m[1].split(","))
          if (/^\s*[A-Z]\w*\s*$/.test(p.trim())) known.add(p.trim());
      // statement object destructuring: const { icon: Icon, color } = …
      for (const m of src.matchAll(/(?:const|let|var)\s*\{([^{}]*)\}\s*=/g)) {
        for (const p of m[1].split(",")) {
          const alias = p.trim().match(/^(\w+)\s*:\s*([A-Z]\w*)$/);
          if (alias) known.add(alias[2]);
          else if (/^\s*[A-Z]\w*\s*$/.test(p)) known.add(p.trim());
        }
      }
      // usages: JSX components (dotted members like <Ctx.Provider> skipped —
      // the namespace itself is what must be imported) and icon: props
      const used = new Set();
      for (const m of src.matchAll(/<([A-Z]\w*)([.\s/>])/g)) if (m[2] !== ".") used.add(m[1]);
      for (const m of src.matchAll(/\bicon:\s*([A-Z]\w*)/g)) used.add(m[1]);
      const missing = [...used].filter((n) => !known.has(n));
      assert.deepEqual(missing, [],
        `${app}/${file.slice(file.indexOf("/src/") + 5)}: uses ${missing.join(", ")} without importing — this deploys as a runtime crash`);
    }
  }
});

test("every header carries the FULL reference set — ring · chat/messages · bell · help", async () => {
  for (const app of APPS) {
    const src = layouts[app];
    assert.match(src, /key: 'notifications', icon: Bell,/, `${app}: the header carries the bell`);
    assert.match(src, /key: 'help',\s*icon: LifeBuoy,/, `${app}: the header carries help`);
    assert.match(src, /progress=\{setupProgressOf\(/, `${app}: the setup ring renders from real progress`);
    assert.match(src, /onSetup=\{\(\) => navigate\('/, `${app}: the ring navigates to a setup surface`);
  }
  // chat surfaces where the app has one (reference order: ring · chat · bell · help)
  assert.match(layouts["akoro-instructor"], /key: 'chat',\s*icon: MessageSquare/, "instructor: agent chat");
  assert.match(layouts["akoro-school"], /key: 'chat',\s*icon: MessageSquare/, "school: agent chat");
  assert.match(layouts["akoro-admin"], /key: 'messages',\s*icon: MessageSquare/, "admin: messages");
  // the consoles keep the page-TopBar bell OFF on mobile — the header is the only bell
  for (const app of ["akoro-admin", "akoro-school", "akoro-instructor"]) {
    assert.match(layouts[app], /showBell=\{false\} \/>/, `${app}: the mobile TopBar renders no second bell`);
    assert.match(layouts[app], /showBell = true/, `${app}: desktop keeps its bell`);
  }
  // kpemu: the bell has a real destination — route + page exist — and the
  // shared ring button is actually clickable.
  const appJs = await read("kpemu-business", "App.jsx");
  assert.match(appJs, /path="\/notifications"/, "kpemu: /notifications route");
  const notifPage = await read("kpemu-business", "pages/NotificationsPage.jsx");
  assert.match(notifPage, /all caught up/, "kpemu: notifications page exists");
  const headerSrc = await read("kpemu-business", "components/AppHeader.jsx");
  assert.match(headerSrc, /onClick=\{onSetup\}/, "the ring button navigates");
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
