# Akoro Console Rebuild — Plan

The instructor, school and admin apps rebuilt on the learner app's frontend:
the same theme, background, colours, text, header, navigation and layout. The
goal is that they are identical. Instructor first, then school, then admin.

Status: approved 2026-10-20. Runs alongside the Grand Plan's Phase 7 (decay
review); this work is frontend only.

## Decisions (2026-10-20)

1. **Brand colour:** the learner's purple everywhere (`BRAND #6C3BFF`). No
   per-app accent.
2. **Phone bottom nav:** five slots like the learner app — Home, Courses,
   Battles, Agent/Chat, More. Every other destination lives in More.
3. **Dark mode:** on, from the shared theme tokens (the learner's
   `ThemeContext` light and dark sets).
4. **Order:** done alongside Phase 7, in turns.
5. **Nav groups (pages with sections):** a group (Course Creator, Student
   Information, Academic, and the like in school and admin) is a dropdown in
   the open sidebar: its pages indented under it, with a purple bar on the
   current page. In the collapsed icon rail, tapping a group's icon opens a
   **flyout** beside it — the admin app's pattern (`akoro-admin/src/components/Layout.jsx`):
   the group's label on top, then its pages; it closes on a page tap, an
   outside click or Escape, and when the sidebar is opened. Styled with the
   learner tokens (surface, border, radius 14, purple active state), light and
   dark. It is part of the shared frame, so every console gets it.

## Where things stand

| | Learner (the target) | Instructor today |
|---|---|---|
| Brand colour | purple `#6C3BFF` | amber `#E8884A` |
| Font | Nunito | DM Sans |
| Theme | `--ak-*` tokens from `ThemeContext.jsx`, light + dark | hard-coded colours (446 uses in 71 files), no dark mode |
| Frame | `AppShell.jsx`: sidebar (tablet/desktop), bottom nav (phone), page headers | own `Layout.jsx` sidebar + `AppHeader.jsx` |
| Icons | Tabler webfont (`common/Icons.jsx`) + brand nav icons (`common/NavIcons.jsx`) | lucide-react |
| Base styles | `index.css` + theme tokens | `GlobalStyles.jsx` (cream `#FAF8F5`, ink `#1A1A2E`) |

School and admin are built like instructor. Admin also uses `tailwind.css`.

Already in place: `reference/Akoro app header.md` (the console header, on the
learner's tokens) and `akoro-api/modules/mobile-gate.contract.test.mjs`, which
checks the console headers, drawers and the no-emoji rule.

`design-system/` is reference notes only; no app imports it.

## Old and new look side by side (the switch)

No copied app folder. Each console keeps one codebase and gets a switch between
its **legacy** look (today's) and the **next** look (the learner's), so the two
can be compared on the same pages with the same data until the rebuild is done.

How it works:

- **Two themes, one set of tokens.** Phase 3 replaces hard-coded colours with
  tokens. The legacy theme sets those tokens to today's values (amber, cream,
  ink, DM Sans), so a migrated page looks exactly as before; the next theme
  sets the learner's values (purple, Nunito, light + dark). Fonts and icons go
  through the same switch.
- **Two frames.** The old `Layout.jsx` sidebar and `AppHeader.jsx` stay until
  the end; the shared frame sits beside them. The switch picks one.
- **The default is legacy** (build setting `VITE_CONSOLE_UI`, `legacy` until the
  flip). Real instructors see no change until then, so other work on this
  branch can reach `main` while the rebuild is half done.

### Trying it

On the live instructor app (`instructors.akoro.name.ng`), add `?ui=` to any page:

| URL | Shows |
|---|---|
| `instructors.akoro.name.ng/chat?ui=next` | the new look |
| `instructors.akoro.name.ng/chat?ui=legacy` | today's look |
| `instructors.akoro.name.ng/chat?ui=reset` | back to the default |

- Not case-sensitive: `?UI=next` works too.
- The choice sticks in that browser while you move around the app, until
  another `?ui=` changes it.
- To compare, open the same page in two tabs (or a normal and a private
  window), one `next` and one `legacy`.
- There's no button in the app for it, so nobody switches by accident.

When it's live: the instructor app builds from `main`, so the links work once
this work is merged there (safe, since the default stays legacy). Before that:

- each step comes with legacy/next screenshot pairs of the same pages, from the
  ui-gate, in one grid;
- if Vercel builds this branch, each push has its own preview URL where the
  same `?ui=` links work (Vercel → instructor project → Deployments; the setting
  is under Project → Settings → Git).

### The flip, and removing the legacy look

1. Every route reviewed in `next`, light and dark, phone/tablet/desktop.
2. The default becomes `next`; `?ui=legacy` still works for a short while.
3. Then the legacy theme values, `Layout.jsx`, `AppHeader.jsx` and the switch
   are deleted — one small, contained change.

Phase 0's screenshots of every route stay as the frozen record of the old app.
While both looks exist, a ui-gate check confirms that each migrated page still
matches its legacy screenshot with the switch on `legacy`.

School and admin follow the same approach (`?ui=` on their own domains).

## How the apps share the kit

The kit's source lives in one place, `design-system/ui/`. A sync script copies
it into each app (`src/ui/`), and a contract test fails if any copy differs
from the source.

Why copy rather than import across folders: the instructor app deploys on
Vercel from its own folder, and files outside that folder may not be in its
build without changing deploy settings. Copying needs no deploy change. The
learner app moves onto the same kit, so all apps stay identical.

## Phases

### Phase 0 — Baseline (½ day)

- ui-gate screenshots of every instructor route, on phone and desktop, as the
  before/after reference (kept out of git, like all screenshots).
- A page inventory: each route and the shared pieces it needs.

### Phase 1 — The shared UI kit (2–3 days)

Lifted out of the learner app, unchanged in look:

- theme tokens (light + dark) and the theme provider;
- Nunito and the base CSS;
- `constants` (BRAND, RED, GREEN, GOLD …);
- icons (`Icon`, `NavIcon`);
- building blocks: button, card, input, badge, tabs, sheet, modal, empty state,
  skeleton;
- the frame: header, sidebar, phone bottom nav, More sheet. Each app passes its
  own nav as a setting.

Then the learner app imports its own pieces from the kit (no visible change),
and the sync script and drift test land.

The `?ui=` switch is built here too, in the instructor app, before anything
visible changes: the legacy and next token sets, and the frame choice.

### Phase 2 — Instructor frame swap (2 days)

The instructor app gets the learner's theme, header, sidebar and bottom nav. The
whole app changes look at once, without changing what any page does.

A grid PNG preview goes to the owner for approval before building.

Instructor nav:

- **Bottom nav (phone):** Home, Courses, Battles, Agent/Chat, More.
- **More / sidebar:** Course Creator, Sales & Earnings, Tasks, Submissions,
  Activities, AI Self Study, Documents, Assessments, App Center, Tools & Assets,
  Library, Wallet & Credits, Profile, the school pages (`/mgmt/*`), Settings.

### Phase 3 — Page-by-page migration (4–6 days, in waves)

Hard-coded colours become tokens, using one fixed mapping:

| Instructor today | Becomes |
|---|---|
| `AMBER #E8884A` | `BRAND` / `--ak-purple` |
| `LIGHT #FAF8F5` (cream background) | `--ak-bg` |
| `WHITE` (cards) | `--ak-surface` |
| `INK #1A1A2E` | `--ak-text` |
| `MUTED #6B6B80` | `--ak-text-sub` |
| `MUTED2 #9490A0` | `--ak-text-muted` |
| `BORDER #EDE8E1` | `--ak-border` / `--ak-border2` |
| DM Sans | Nunito |
| lucide-react icons | the learner's `Icon` / `NavIcon` |

Waves:

1. Home, Profile, Settings, sign-in and onboarding
2. Courses and Course Creator
3. Battles, Tasks, Submissions, Activities, Assessments
4. Chat and AI Self Study (chat already uses the learner's composer)
5. School management (`/mgmt/*`)
6. Wallet, Sales, Orders, Marketplace, App Center, Library, Documents,
   notifications, legal pages

After each wave: build, ui-gate screenshots (phone and desktop, light and dark),
a preview to the owner, then push.

### Phase 4 — Guardrails (1 day)

- A contract test: no hard-coded colours outside the kit's token files.
- The mobile-gate header tests check the shared frame.
- The no-emoji tests stay.
- An instructor ui-gate suite that visits every route, light and dark.

### Phase 5 — School, then admin

The same kit and steps. School shares many files with instructor (mgmt pages,
wizards, recorder), so it should go faster. Admin goes last: its Tailwind
styles are folded into the tokens first.

## Working rules

- Icons, not emojis.
- A grid PNG preview is approved before each visible change is built.
- Screenshots never go into git (`ui-gate/.out/`).
- Look and layout change; behaviour, routes and API calls don't.
