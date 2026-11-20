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

// The consoles still on their own AppHeader. The instructor app is on the
// shared frame (design-system/ui/Shell.jsx): its own test is below.
const APPS = ["akoro-admin", "akoro-school", "kpemu-business"];
// Every console's source tree, for the crash-class guards.
const ALL_APPS = [...APPS, "akoro-instructor"];
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
    assert.match(layouts[app], /import AppHeader(, \{ ReferenceChatIcon \})? from '\.\/AppHeader\.jsx';/, `${app}: imports AppHeader`);
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

test("admin/school: drawer opens ONLY from the hamburger — closed by X, hamburger, backdrop, Escape", () => {
  for (const app of ["akoro-admin", "akoro-school"]) {
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
    // (Admin's phone layout renders no TopBar at all — the AppHeader is the only header.)
    const mobileBlock = src.slice(src.indexOf("if (mobile)"), src.indexOf("<Sidebar collapsed={collapsed}"));
    assert.ok(/onToggleSidebar=\{null\}/.test(src) || !mobileBlock.includes("<TopBar"), `${app}: mobile TopBar has no hamburger of its own`);
  }
});

test("admin/school: phones get full-width pages — no permanent sidebar", () => {
  for (const app of ["akoro-admin", "akoro-school"]) {
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
    const names = new Set(lucideImports(src));
    // Named imports from ANY module count too (e.g. ReferenceChatIcon from
    // AppHeader) — an imported identifier can never be a free reference.
    for (const m of src.matchAll(/import\s*(?:\w+\s*,)?\s*\{([^}]*)\}\s*from/g))
      for (let s of m[1].split(",")) { s = s.trim().split(/\s+as\s+/).pop().trim(); if (s) names.add(s); }
    // Only action/menu object literals (`{ key: 'x', icon: Y, … }`) —
    // destructured component params (`{ to, icon: Icon, label }`) are not
    // icon references.
    const used = src.split("\n")
      .filter((l) => /key: '/.test(l))
      .flatMap((l) => [...l.matchAll(/icon:\s*([A-Z]\w+)/g)].map((m) => m[1]));
    assert.ok(used.length > 0, `${app}: has icon references`);
    const missing = [...new Set(used)].filter((n) => !names.has(n));
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
  for (const app of ALL_APPS) {
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
      // lazy imports destructured: const [{ default: App }, …] = await Promise.all([import(…), …])
      for (const m of src.matchAll(/\{\s*default\s*:\s*([A-Z]\w*)\s*\}/g)) known.add(m[1]);
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
    // Admin's phone header is the Bachs set (search · preview · bell, 4a7557f6); the others keep help.
    if (app === "akoro-admin") for (const k of ["search", "preview"]) assert.match(src, new RegExp(`key: '${k}',`), `${app}: the header carries ${k}`);
    else assert.match(src, /key: 'help',\s*icon: MessageCircleQuestion/, `${app}: the header carries help (the reference's glyph)`);
    assert.match(src, /progress=\{setupProgressOf\(/, `${app}: the setup ring renders from real progress`);
    assert.match(src, /onSetup=\{\(\) => navigate\('/, `${app}: the ring navigates to a setup surface`);
  }
  // chat surfaces where the app has one (reference order: ring · chat · bell · help)
  assert.match(layouts["akoro-school"], /key: 'chat',\s*icon: ReferenceChatIcon/, "school: agent chat");
  // the consoles keep the page-TopBar bell OFF on mobile — the header is the only bell
  for (const app of ["akoro-admin", "akoro-school"]) {
    const src = layouts[app];
    const mobileBlock = src.slice(src.indexOf("if (mobile)"), src.indexOf("<Sidebar collapsed={collapsed}"));
    assert.ok(/showBell=\{false\} \/>/.test(src) || !mobileBlock.includes("<TopBar"), `${app}: the mobile TopBar renders no second bell`);
    assert.ok(/showBell = true/.test(src) || /export function TopBar[\s\S]{0,4000}<BellButton \/>/.test(src), `${app}: desktop keeps its bell`);
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

test("the instructor app is on the shared frame — the learner's header, sidebar and phone nav", async () => {
  const layout = await read("akoro-instructor", "components/Layout.jsx");
  const next = await read("akoro-instructor", "components/NextLayout.jsx");
  const chat = await read("akoro-instructor", "pages/ChatPage.jsx");
  const shell = await readFile(new URL("../../design-system/ui/Shell.jsx", import.meta.url), "utf8");
  assert.match(layout, /return <NextLayout \{\.\.\.props\}\/>;/, "every page renders in the shared frame");
  assert.doesNotMatch(layout, /AppHeader|LegacyPageLayout|isNextUi/, "no legacy frame left");
  assert.match(layout, /export function useIsMobile/, "the hook is shared with pages");
  // the learner header: coins, cart, bell, the agent toggle
  for (const part of ["<CoinPill", "<CartButton", "<BellButton", "<AgentToggle"]) assert.ok(next.includes(part), `header: ${part}`);
  // phones: the bottom nav + More sheet, no permanent sidebar
  assert.match(shell, /function BottomNav/);
  assert.match(shell, /function MoreSheet/);
  // the agent chat is full screen, like the learner's Agent tab
  assert.match(chat, /<PageLayout bare>/);
});

/* ── The no-emoji guard ────────────────────────────────────────────────────
   The instructor app renders no emoji anywhere: icons are lucide, avatars
   are monograms or drawn SVGs. Emoji may still EXIST as stored DATA (the
   agent_emoji field the learner/admin apps render, and the picker maps
   that translate a chosen icon into that stored value) — so lines that are
   pure data plumbing are allowed; anything rendered is not. */
/* The pictograph ranges every console guard walks: the Misc Symbols and
   Dingbats blocks, the emoji-only ranges, AND the small pictographs
   (\u231A-\u23FF: watch, clock, hourglass…) that render as emoji on most
   platforms even without a variation selector. */
function pictographRe() {
  return new RegExp(
    "[" + String.fromCodePoint(0x1f000) + "-" + String.fromCodePoint(0x1faff)
    + "\\u2600-\\u2712\\u231A-\\u23FF\\u203C\\u2049\\u2139\\u2716-\\u27BF\\u2B00-\\u2BFF\\u2934\\u2935\\u3030\\u303D\\u3297\\u3299\\uFE0F\\u2B50]", "gu",
  );
}
async function emojiOffenders(app, DATA_LINE) {
  const { readdir } = await import("node:fs/promises");
  const root = new URL(`../../${app}/src`, import.meta.url).pathname;
  // ✓ ✔ ✕ ✗ are typographic marks (ticks, crosses), not emoji — allowed.
  const TYPOGRAPHY = /[\u2713\u2714\u2715\u2717]/g;
  async function* walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) yield* walk(p);
      else if (/\.(jsx|js)$/.test(e.name)) yield p;
    }
  }
  const offenders = [];
  for await (const file of walk(root)) {
    const src = await readFile(file, "utf8");
    src.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      const raw = line.replace(TYPOGRAPHY, "");
      if (!pictographRe().test(raw)) return;
      if (DATA_LINE.test(line)) return;
      offenders.push(`${file.slice(file.indexOf("src/") + 4)}:${i + 1}: ${t.slice(0, 90)}`);
    });
  }
  return offenders;
}

test("the instructor app renders no emoji — icons and SVGs only", async () => {
  const pictograph = pictographRe();
  // ✓ ✔ ✕ ✗ are typographic marks (ticks, crosses), not emoji — allowed.
  const TYPOGRAPHY = /[\u2713\u2714\u2715\u2717]/g;
  // Data plumbing: emoji as STORED values, never rendered by this app.
  const DATA_LINE = /AGENT_ICONS|GUIDE_ICONS|TYPE_ICON|KIND_META|useState\(|\?\?|emoji:|agentEmoji|selEmoji|guideEmoji|setEmoji|setAgentEmoji|setGuideEmoji|setSelEmoji|agent_emoji|emoji ===/;
  assert.deepEqual(await emojiOffenders("akoro-instructor", DATA_LINE), [],
    "rendered emoji found — replace with an icon or SVG");
});

test("the school app renders no emoji — icons and SVGs only", async () => {
  // Same rule as the instructor console: icons are lucide or drawn SVGs.
  // Emoji may still EXIST as stored data — agent/teacher avatar picks, the
  // website builder's per-card emoji (user content rendered on their public
  // site), and the dashboard-theme names whose spellings are stored prefs.
  const offenders = await emojiOffenders("akoro-school",
    /AGENT_ICONS|GUIDE_ICONS|GUIDE_EMOJIS|AGENT_AVATARS|EMOJI_ICONS|EMOJI_LIST|KIND_META|THEMES|Classic Dashboard|Mac OS Style|Futuristic Command|Analytics Pro|Executive Pro|useState\(|\?\?|emoji:|agentEmoji|agent_emoji|avatarEmoji|selEmoji|draftEmoji|setEmoji|setAgentEmoji|setDraftEmoji|setSelEmoji|emoji ===|\.emoji\b|placeholder/);
  assert.deepEqual(offenders, [],
    `rendered emoji found — replace with an icon or SVG:\n${offenders.join("\n")}`);
});

test("the admin app renders no emoji — icons and SVGs only", async () => {
  // Same rule. Emoji survives only as the stored app/agent emoji the admin
  // forms edit (rendered by other surfaces), never as this console's chrome.
  const offenders = await emojiOffenders("akoro-admin",
    /useState\(|\?\?|emoji:|\.emoji\b/);
  assert.deepEqual(offenders, [],
    `rendered emoji found — replace with an icon or SVG:\n${offenders.join("\n")}`);
});

test("the header uses the reference's exact glyphs — drawn, not approximated", async () => {
  for (const app of APPS) {
    const src = headers[app];
    // the reference's hamburger: three rounded bars, at the reference's 22px
    assert.match(src, /<rect x="3" y="3\.5" width="18" height="4\.5" rx="1\.6" \/>/, `${app}: reference hamburger bars`);
    assert.match(src, /<ReferenceMenuIcon size=\{22\} \/>/, `${app}: hamburger at the reference's 22px`);
    // the reference's chat bubble carries its two text lines
    assert.match(src, /<path d="M8 9h8" \/>/);
    assert.match(src, /<path d="M8 13h5" \/>/);
  }
  // help is the reference's MessageCircleQuestion — lucide-exact
  for (const app of APPS.filter((a) => a !== "akoro-admin")) {   // admin: the Bachs set, no help
    assert.match(layouts[app], /key: 'help',\s*icon: MessageCircleQuestion/, `${app}: reference help glyph`);
  }
  // chat surfaces use the drawn reference bubble
  assert.match(layouts["akoro-school"], /key: 'chat',\s*icon: ReferenceChatIcon/);

});

test("no console calls a framework hook it never imports — the runtime-ReferenceError class", async () => {
  // useLocation etc. resolve at RUNTIME; a bundler happily ships the call and
  // the page dies on open (this exact crash shipped once). React and
  // react-router hook names are safe to pin: nobody defines them locally.
  const { readdir } = await import("node:fs/promises");
  const HOOKS = ["useState","useEffect","useRef","useMemo","useCallback","useContext","useReducer",
    "useLayoutEffect","useNavigate","useLocation","useSearchParams","useParams","useMatch","useResolvedPath"];
  for (const app of ALL_APPS) {
    const root = new URL(`../../${app}/src`, import.meta.url).pathname;
    async function* walk(dir) {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p2 = `${dir}/${e.name}`;
        if (e.isDirectory()) yield* walk(p2);
        else if (/\.(jsx|js)$/.test(e.name)) yield p2;
      }
    }
    const bad = [];
    for await (const file of walk(root)) {
      const src2 = await readFile(file, "utf8");
      const imported = new Set();
      for (const m of src2.matchAll(/import\s*\{([^}]*)\}\s*from/g))
        m[1].split(",").forEach((x) => { const n = x.trim(); if (n) imported.add(n); });
      for (const m of src2.matchAll(/import\s+(\w+)\s+from/g)) imported.add(m[1]);
      const body = src2.replace(/^import[^\n]*\n/gm, "");
      for (const h of HOOKS) {
        if (new RegExp(`(?<![.\\w])${h}\\s*\\(`).test(body) && !imported.has(h))
          bad.push(`${file.slice(file.indexOf("src/") + 4)}: calls ${h} but never imports it`);
      }
    }
    assert.deepEqual(bad, [], `${app}: missing framework-hook imports:\n${bad.join("\n")}`);
  }
});

test("console-facing notification composers carry no emoji", async () => {
  // The notification pages render whatever the API composes — titles like
  // "New sale 🎉" sailed past the app guards as data. The composers that feed
  // the consoles stay clean; server logs (console.*) and email/Telegram
  // bodies are out of scope.
  const files = [
    "modules/notifications/events.js",
    "modules/battle/service-core.js",
    "modules/battle/service-create.js",
    "modules/battle/service-class.js",
    "modules/battle/service-course.js",
    "modules/battle/service-listings.js",
    "modules/battle/service-challenge.js",
    "modules/battle/service-battle.js",
    "modules/battle/networkBattle.js",
    "modules/battle/worker-create.js",
    "modules/courses/scheduler.js",
    "modules/courses/live-sessions.js",
    "modules/courses/peer-sessions.js",
    "modules/courses/qa-announcements.js",
  ];
  const offenders = [];
  for (const f of files) {
    const src2 = await readFile(new URL(`../../akoro-api/${f}`, import.meta.url), "utf8");
    src2.split("\n").forEach((line, i) => {
      const t = line.trim();
      if (line.includes("console.")) return;
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (!pictographRe().test(line)) return;
      // emoji as STORED payload data (e.g. a challenge card carrying the
      // agent's agent_emoji) is plumbing, not rendered chrome.
      if (/\bemoji\s*[:=]/.test(line)) return;
      offenders.push(`${f}:${i + 1}: ${t.slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [],
    `emoji in console-facing notification composers:\n${offenders.join("\n")}`);
});

test("URL flow shells stay hook-free — the early-return crash class", async () => {
  // ActivitiesPage and CoursesPage route ?draft/?detail/?flow to full pages.
  // The branches used to return BEFORE the page hooks were declared, so the
  // first navigation changed the component's hook count and React killed the
  // render ("rendered fewer hooks than expected"). The shell must declare no
  // hooks beyond useSearchParams, and each flow must be its own component.
  const shells = [
    ["akoro-instructor/src/pages/ActivitiesPage.jsx",
     // ActivitiesHome is its own component in its own file (activities-page/ActivitiesHome.jsx).
     ["function DraftRoute(", "function DetailRoute(", "import ActivitiesHome from './activities-page/ActivitiesHome.jsx'"]],
  ];
  for (const [file, parts] of shells) {
    const src2 = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    for (const part of parts) assert.ok(src2.includes(part), `${file}: missing ${part}`);
    const shell = src2.slice(src2.indexOf("export default function"), src2.indexOf("return <ActivitiesHome") !== -1
      ? src2.indexOf("return <ActivitiesHome") : src2.indexOf("return <CourseFlow"));
    assert.ok(!/useState|useEffect|useNavigate/.test(shell),
      `${file}: the shell declares state/effect/navigate hooks — split the flow pages into components`);
    // The branches must read the PATH (the flows are dedicated routes), not
    // the query string — a query-only shell made every click a no-op.
    assert.match(shell, /useLocation\(\)/, `${file}: the shell must read the location`);
    assert.match(shell, /pathname/, `${file}: routing must branch on the pathname`);
  }
});
