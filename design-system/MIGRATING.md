# Migrating a console page to the shared look

How a page in a console app (instructor first; school and admin later) is moved
onto the shared theme so it follows the `?ui=` switch. Read with
`reference/Akoro Console Rebuild — Plan.md`.

## The one rule

**The page takes the learner app's look (purple, Nunito, light and dark).**
(The instructor app was flipped on 2026-10-23: it has no legacy look or
`?ui=` switch any more. A console still on its old look keeps that rule
until its own flip: legacy unchanged, next the learner's.)

Behaviour, routes, API calls, text and layout do not change. This is colours,
fonts and icons only.

## What you have

| File | What it gives you |
|---|---|
| `src/theme/colors.js` | `C.*` colour names (theme variables) and `tint(pct, color?)` |
| `src/theme/Ico.jsx` | `<Ico ti="ti-x" size={16} color={…}/>`: the learner's Tabler glyph |
| `scripts/tokenize-colors.mjs` | the mechanical step (below) |
| `src/ui/` | the shared kit. Generated: never edit it in an app |

## Steps for each file

1. **Run the mechanical step:**
   `node scripts/tokenize-colors.mjs src/pages/Foo.jsx`.
   It swaps the constants and the Bachs `BX.*` palette for `C.*`, turns
   `` `${AMBER}18` `` into `tint(9)`, fixes the imports, and prints what it
   left for you.
2. **Read the diff.** Fix anything wrong (see "Judgement calls").
3. **Icons.** Wrap every lucide icon *use* in `Ico` with the closest Tabler
   name (https://tabler.io/icons; the `ti-` prefix). Keep the lucide import:
   legacy still uses it. A lucide component passed as a prop (`icon={Users}`)
   gets a `ti="ti-users"` prop next to it, and the component that draws it
   uses `<Ico lucide={Icon} ti={ti} …/>`.
4. **Check the file:** no `AMBER INK MUTED MUTED2 BORDER LIGHT WHITE FONT`
   left, and no `BX`. Then `npm run build` passes.

## The mapping (the script does most of it)

| Today | Becomes |
|---|---|
| `AMBER` | `C.brand` |
| `` `${AMBER}18` `` (hex alpha) | `tint(9)`: percent = hex ÷ 255 × 100 |
| `` `${color}15` `` (any colour variable) | `tint(8, color)` |
| `INK` / `MUTED` / `MUTED2` | `C.ink` / `C.muted` / `C.muted2` |
| `BORDER` | `C.border` |
| `LIGHT` (cream page background) | `C.bg` |
| `WHITE` as a background or surface | `C.surface` |
| `WHITE` as text or icon colour on a coloured fill | `'#fff'` |
| `FONT` | `C.font` |
| `BX.primary/ink/muted/border/bg/font/white` | `C.bxPrimary/bxInk/bxMuted/bxBorder/bxBg/bxFont/surface` |
| `'#FFF7ED'` (the light peach brand wash) | `C.brandSoft` |
| the darker gradient end of the brand (`'#D4651E'`, `'#C2410C'`…) | `C.brandDeep` |
| a dark feature card (`background: INK`, white text) | `background: C.hero` (stays dark in both themes) |
| `'rgba(26,26,46,.45)'` overlay | `C.overlay` |

## Judgement calls

- **Status hues stay:** `GREEN`, `RED`, `BLUE`, `PURPLE`, `GOLD`, and their
  pastel pills (`#DCFCE7`, `#FEE2E2`, `#FEF3C7`…). They read on both themes.
- **Inline grey hexes** (`'#F3F4F6'`, `'#E5E7EB'`, `'#6B7280'`…): use the
  nearest `C.*` (`C.tagBg`, `C.borderSoft`, `C.muted`), so it follows dark
  mode. If none fits, leave the hex and list it in your report.
- **Brand logos** (Zoom, YouTube, Google…) keep their own colours.
- **PDF/print output** (`lib/activityPdf.js`, `components/paper/*` print
  styles) keeps fixed colours: paper is always white. Don't migrate print
  colours.
- **`background: C.ink` with white text** is wrong in dark mode (ink becomes
  light). Use `C.hero`.
- **CSS files** (e.g. `pages/course-creator/cc.css`): use the variables
  directly, `var(--ak-brand)`, `var(--ak-text)`….
- **Icon names are checked:** a contract test fails on any `ti-*` name that
  isn't in the installed font. Look names up in
  `node_modules/@tabler/icons-webfont/dist/tabler-icons.min.css`.
- **Never** edit `src/ui/*`, `Layout.jsx`, `AppHeader.jsx`,
  `NextLayout.jsx`, `src/theme/*` or another wave's files. If you need a
  colour name that doesn't exist, say so in your report; don't add one.

## Worked example

The instructor Home: `src/pages/home-page/HomePage.jsx` and `parts.jsx`, and
`src/components/Primitives.jsx`. Read their diffs (`git log -p` on them)
before starting.

## Done means

- The build passes (`cd akoro-instructor && npm run build`).
- `node --test akoro-api/modules/console-ui-kit.contract.test.mjs` passes.
  The mobile-gate test has 3 failures that were already there; no new ones.
- Your report lists every file changed and every leftover hex or icon you
  weren't sure of.
