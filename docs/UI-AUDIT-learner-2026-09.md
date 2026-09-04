# Akoro Learner — UI Modern-Standards Audit

**Date:** 2026-09-04 · **Scope:** `akoro-learner/src` (+ `index.html`) · **Method:** full-source
scan (greps quantified below) against the app's own token system (`--ak-*` in
`ThemeContext`), our `design-system/browser-native-2026.md` reference, and current
mobile-UI standards (touch targets, safe areas, motion, dark mode, a11y contrast).

---

## Verdict

**The app is genuinely close to modern — the foundation is right, the execution leaks.**
There is a real token system, dark mode is defined end-to-end, the typeface strategy is
correct, safe areas are handled on the nav, and one screen already uses the View
Transition API. The gaps are **consistency leaks**, not architectural problems:

1. ~110 hardcoded light-palette hexes + **98 white-surface backgrounds** break dark mode
   in spots (worst in the dashboard header, live-class sub-tabs, Discovery rails).
2. No design **scales** — radius (17 values), font size (38 values), z-index (27 values)
   and transitions (9 durations) are all freehand. Modern feel comes from rhythm; the app
   currently has vibes.
3. Focus is suppressed everywhere (`outline:'none'` ×14) with **zero** `:focus-visible`
   replacements, and only 1 `prefers-reduced-motion` guard in the whole app.
4. The team's own `design-system/` doc (browser-native 2026) is ~90% unadopted.

**Score: 7/10 modern foundation · 5/10 consistency · 3/10 platform-technique adoption.**

---

## Scorecard

| Area | Grade | Evidence |
|---|---|---|
| Theming architecture | **A−** | `--ak-*` tokens for light+dark, applied pre-paint (no FOUC), accent-colour system, 1,036 token usages |
| Dark mode completeness | **C** | Tokens exist, but 98 `background:'#fff'` + 105 light-grey/border hexes in `src/` render light-only surfaces in dark mode |
| Typography | **B−** | Nunito via preconnect + `display=swap` ✓; but **38 distinct font sizes** (8–22px in halves), no scale |
| Shape/radius | **B−** | 12/14/20 dominate, but **17 distinct values** (2…100) — no scale |
| Spacing | **B** | Mostly 4/8-multiples in practice; not tokenized |
| Color semantics | **C+** | Success/warn/danger/accents are inline hex constants per file (`GREEN`/`GOLD`/`RED` imported from constants but mixed with raw hex); no `--ak-*` semantic vars for them |
| Touch targets | **C** | Dozens of <36px tap targets (22/24/26/28/30/32/34px buttons) |
| Safe areas | **B+** | 7 `env(safe-area-inset-*)` uses; nav ✓, bottom sheets ✓; FABs use fixed px offsets (fine today, breaks on notched landscape) |
| Motion | **C+** | Consistent *durations* (.15–.3s) but 9 distinct values, 3 easing curves, spring keyframes re-declared per component; `prefers-reduced-motion` honoured once |
| Focus & a11y | **D+** | `outline:'none'` ×14, `:focus-visible` ×0, small muted text (#9CA3AF at 9.5–11px ≈ 2.8:1 — fails WCAG AA), 41 `aria-label`s is a decent start |
| Loading states | **B** | Skeletons exist (9 shimmer uses) alongside spinners; some lists flash empty-before-loaded |
| Z-index discipline | **C** | 27 distinct values (1…9999) — collisions waiting to happen (toasts 3000/4000, sheets 2000/2100, bars 850) |
| Design-system adoption (own doc) | **D** | View Transitions: 1 use (landing). `animation-timeline`/`oklch`/`color-mix`/`@container`/`:has()`/`popover`/`field-sizing`: **0 uses** |

---

## What's already right (keep)

- **Token-first theming with pre-paint application** — better than most apps this size.
- **Nunito + `display=swap` + preconnect**, weights 400–900 only — lean and correct.
- **PWA hygiene**: no-cache headers on shell, SW update prompt, offline cache tiers.
- **Bottom nav** ≥44px targets, safe-area padding, active states.
- **Sheets/drawers** (bottom-sheet pattern with drag handle) — the right mobile idiom,
  used consistently for tasks/customise/records.
- Recent screens (onboarding teacher grid, Discover hub, Now-Studying bar) are
  token-clean, aria-labelled, and dark-mode correct — the standard to hold.

---

## Findings (prioritized)

### P0 — Dark-mode leaks (user-visible bugs)
**98 white-surface backgrounds** in `src/`; worst clusters outside intentionally-light
marketing pages (`landing/sections.jsx` ×14 is fine — it's the public landing):

| File | bg '#fff'/light hexes |
|---|---|
| `pages/LearnerDashboard.jsx` | header pills `#F0EBFF`/`#DDD3FF`/`#FFF7E6`/`#FEECEC`, `#FAFBFF` sub-tab strips, `#fff` chips |
| `components/tabs/DiscoveryTab.jsx` | `#FAFBFF` strips, `#fff` sub-tab bar, `#F3F4F6` dividers, `#E5E7EB` badges |
| `pages/course-details/parts.jsx`, `PricingPage`, `BlogPostPage`, `PartnersPage`, `SiteChrome` | 5–9 each |

**Fix:** replace with tokens; add missing semantic tokens (below). Marketing pages keep
hardcoded light by design (add a comment saying so).

### P1 — No scales (radius / type / space / z / motion)
Modern "feel" is rhythm. Propose token scales in `index.css` (or a `tokens.css`):

```css
:root {
  /* radius */   --r-sm:8px; --r-md:12px; --r-lg:16px; --r-xl:22px; --r-full:999px;
  /* type */     --fs-xs:10px; --fs-sm:12px; --fs-md:13.5px; --fs-lg:16px; --fs-xl:21px;
  /* space */    --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-6:24px; --s-8:32px;
  /* z */        --z-bar:850; --z-fab:900; --z-sheet:2000; --z-overlay:2100; --z-toast:3000;
  /* motion */   --t-fast:.15s; --t-med:.2s; --t-spring:.3s cubic-bezier(.32,1.2,.64,1);
  /* status */   --ak-success:#10B981; --ak-warn:#F59E0B; --ak-danger:#EF4444;
}
```
Then migrate incrementally (new code must use them; touch a line, move it to tokens).

### P1 — Focus & reduced motion (a11y)
- Add one global rule: `:focus-visible { outline:2px solid var(--ak-accent); outline-offset:2px; }`
  and keep `outline:'none'` only on mouse-specific controls. 30 minutes, whole-app win.
- Wrap keyframe animations in `@media (prefers-reduced-motion: no-preference)` (one
  block in `index.css` covers `pulse-dot`, `bounce-dot`, `sheet-up`, `drawer-in`).

### P2 — Touch targets
22–34px icon buttons (chat task ✏️/🗑 at 26px, Now-Studying ✕ at 28px, etc.) fail the
44px standard. Fix the top 12 offenders by hit-area padding (`padding` + negative
`margin`, or `::before` hit expansion) so visuals stay compact but taps land.

### P2 — Muted-text contrast
`#9CA3AF` (`--ak-text-muted`) at 9.5–11px is ~2.8:1 on white — fails AA. Either reserve
muted for ≥13px non-essential text or darken one step (`#8B93A1` in light theme).

### P3 — Adopt our own browser-native 2026 playbook (high-leverage picks)
1. **`popover` + anchor positioning** — replace 8 hand-rolled bottom sheets' z-index
   juggling and the toast/fab collisions (top-layer stacking, zero z-index).
2. **`animation-timeline: view()`** — card/rail reveals in Discovery & Learn lists,
   deleting IntersectionObserver-style code.
3. **`linear()` springs + `@starting-style`** — unify the 3 easing curves; entry
   animations for sheets/drawers/toasts without keyframe re-declarations.
4. **`oklch()` + `color-mix()`** — derive hover/active/tints from `--ak-accent`
   (kills the `${BRAND}14`-style alpha-string pattern and the 8-accent tint tables).
5. **`field-sizing: content`** — chat + paste textareas auto-grow (deletes JS).
All behind `@supports`, per the design-system doc's own rules.

---

## Suggested order of work

| Step | Effort | Impact |
|---|---|---|
| 1. Global `:focus-visible` + reduced-motion block | ~1h | A11y, feel |
| 2. Token scales commit (radius/type/space/z/status/motion) | ~2h | Foundation for everything |
| 3. Dark-mode P0 sweep (non-marketing surfaces, ~60 sites) | ~1 day | Correctness users see daily |
| 4. Touch-target pass (top offenders) | ~half day | Mobile feel |
| 5. `popover`/anchor-positioning for sheets + toasts | ~2 days | Deletes z-index class of bugs |
| 6. Scroll-driven reveals + `linear()` springs | ~1 day | Perceived polish |

---

*Numbers in this doc are reproducible via the greps described; run from
`akoro-learner/src` with `--include='*.jsx'`.*
