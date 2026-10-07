# Browser-Native Techniques (2026 Reference)

A field guide to browser platform features that now replace JavaScript libraries
we used to reach for. Distilled from the **BASE/LINE'26** demo
([artifact](https://claude.ai/public/artifacts/236e5ef7-e80b-4ef3-803a-023a2dc560c6)):
one HTML file, zero libraries, ~93 KB, 2 external requests (both fonts).

**Why keep this:** every item below lets us delete a dependency or a pile of
custom JS. Before adding a library for tooltips, scroll animation, spring
motion, theming, or layout state — check here first. Always pair with
`@supports` / `CSS.supports()` and a graceful fallback (see [Feature detection](#10-feature-detection--graceful-degradation)).

> Support notes reflect the demo's mid-2026 baseline claims. **Verify current
> support on caniuse / MDN before shipping** — treat "baseline" as "check it",
> not "assume it".

---

## 1. GPU shaders — WebGPU with a WebGL2 fallback

A full-screen animated background computed per-pixel on the GPU (a domain-warped
fractal noise field, `fbm(p + fbm(p + fbm(p)))`).

- **WebGPU / WGSL** where available, detected with `navigator.gpu`; **WebGL2 /
  GLSL ES 3.0** twin as fallback.
- `OffscreenCanvas` to render off the main thread.
- UI controls (sliders) write straight into the shader's **uniform buffer** —
  no framework in between.

```js
const adapter = await navigator.gpu.requestAdapter();
const device  = await adapter.requestDevice();
ctx.configure({ device, format, alphaMode: "opaque" });
```

**Replaces:** three.js / regl for simple full-bleed shader backgrounds.
**Caveat:** ship the GLSL fallback; honour `prefers-reduced-motion` (render one
still frame). Heavy — reserve for hero/marketing surfaces, not app chrome.

---

## 2. Scroll-driven animation — CSS, no JS

Scroll position as an animation timeline, entirely in CSS.

- `animation-timeline: view()` binds keyframes to an element's journey through
  the viewport (reveals, top progress bar, parallax numerals).
- `animation-timeline: scroll()` for scroll-container-driven progress.
- `scroll-state()` container queries — e.g. style a sticky header when it's
  actually `stuck`.

```css
.reveal {
  animation: fade-up linear both;
  animation-timeline: view();
  animation-range: entry 0% cover 40%;
}
```

**Replaces:** IntersectionObserver reveal code, AOS, ScrollMagic, GSAP
ScrollTrigger for basic cases.

---

## 3. Anchor positioning, popovers, invokers — the tooltip-library era is over

Position a floating box next to an anchor with automatic flipping, no z-index
archaeology.

- `anchor-name` + `position-area` position an element relative to an anchor.
- `position-try-fallbacks` auto-flips when space runs out.
- `popover` attribute → top-layer stacking (no z-index wars).
- `command` / `commandfor` → script-free buttons that open dialogs/popovers.
- `appearance: base-select` → stylable native `<select>`.

```css
.menu {
  position-anchor: --btn;
  position-area: block-end span-inline-end;
  position-try-fallbacks: flip-block, flip-inline;
}
```

**Replaces:** Floating UI, Popper.js, most custom dropdown/tooltip/dialog code.

---

## 4. Geometry — boxes that stop being boxes

- `corner-shape` → squircle / scoop / notch / bevel corners, and it *transitions*.
- `clip-path` polygons interpolate (pair with spring `linear()` easing).
- `offset-path` puts an element on rails / a motion path.
- Gap decoration: `row-rule` / `column-rule` draw dividers in grid/flex gaps —
  no extra divider DOM.

```css
.sq {
  corner-shape: squircle;
  border-radius: 34px;
  transition: border-radius .6s, corner-shape .6s;
}
```

---

## 5. Color science — leave sRGB behind

- `oklch()` — perceptually uniform: same `L` = same perceived brightness (HSL
  lies — its yellow at 50% screams, blue broods).
- **Relative color** `oklch(from var(--token) calc(l ± n) c h)` — derive an
  entire scale (hover/active/tints) from one token.
- `color-mix()` for blends; `display-p3` for wide-gamut accents.

```css
:root { --hue: 265; --acc: oklch(0.8 0.15 var(--hue)); }
.btn:hover { background: oklch(from var(--acc) calc(l - 0.08) c h); }
```

**Replaces:** SASS color functions, chroma.js, hand-maintained tint/shade scales.
**Relevance to Akoro:** our theme tokens (`--ak-*`) could derive hover/active
states from one accent instead of listing each shade.

---

## 6. Queries — CSS that observes instead of being told

- `@container` + `cqi` units → components size to their container, not the
  viewport (true reusable cards).
- `:has()` → parents react to children (the long-wanted "parent selector").
- `if()` → inline conditional property values, incl. `if(media(...))`.
- `@scope` → scoped styles without naming conventions.

```css
@container (inline-size < 400px) { .card { grid-template-columns: 1fr; } }
.field:has(> input:invalid) { border-color: var(--danger); }
```

**Replaces:** ResizeObserver + utility-class toggling, many BEM/CSS-module scoping tricks.

---

## 7. Motion — interfaces that don't teleport

- **View Transition API** `startViewTransition()` — snapshot → mutate DOM →
  morph between states (the FLIP trick, built in). Also cross-document.
- `interpolate-size: allow-keywords` + `calc-size()` → animate to
  `height: auto` (finally).
- `linear()` easing → real sampled spring physics as a plain timing function,
  no rAF loop.
- `::details-content` → animate `<details>` open/close.
- `@starting-style` → animate an element's first appearance (entry transitions).

```js
document.startViewTransition(() => applyDomChange());
```
```css
/* spring overshoot as a timing function */
.card { transition: transform .6s linear(0, 0.009, /* …sampled… */ 1.077, 1); }
details::details-content { transition: height .3s, content-visibility .3s allow-discrete; }
```

**Replaces:** FLIP libraries, Framer-Motion-style layout animation for simple
cases, rAF spring loops.
**Relevance to Akoro:** tab/route/list transitions and the session-sheet /
drawer open-close could use View Transitions + `linear()` springs.

---

## 8. Live capability audit

The demo probes ~33 features at runtime with `CSS.supports()` and JS feature
detection, rendering a live LIVE/SOON ledger.

- **LIVE (mid-2026 claim):** WebGPU, WebGL2, OffscreenCanvas,
  `animation-timeline: view()`, `::scroll-marker` carousels, `scroll-state()`,
  anchor positioning, `popover`, invoker commands, styleable `<select>`, view
  transitions, `@starting-style`, `interpolate-size`, `calc-size()`,
  `::details-content`, `linear()` easing, `corner-shape`, `shape()`,
  `offset-path`, `oklch()`, relative color, `color-mix()`, `@container`+`cqi`,
  `:has()`, `if()`, `@scope`, `@function`, text-box trimming, `field-sizing`,
  `reading-flow`.
- **SOON (still landing):** gap decoration rules, wide-gamut display, CSS
  masonry (any syntax).

```js
const ok = CSS.supports("corner-shape: squircle") && "gpu" in navigator;
```

---

## 9. Other niceties mentioned

- **`::scroll-marker` / `::scroll-button()`** — carousel dots & arrows as CSS
  pseudo-elements, zero script.
- **`field-sizing: content`** — inputs/textareas that grow with their content,
  no JS auto-resize.
- **`text-box` trimming** — trim font leading for precise vertical rhythm.
- **`reading-flow`** — decouple visual order from tab/reading order safely.
- **`@function`** — author custom CSS functions.
- **`shape()`** — path-based shapes that interpolate.

---

## 10. Feature detection & graceful degradation

Non-negotiable pattern for anything above — enhance when present, degrade politely otherwise.

```css
@supports (corner-shape: squircle) { .card { corner-shape: squircle; } }
@supports not (animation-timeline: view()) {
  /* static fallback; or wire an IntersectionObserver */
}
```
```js
if (CSS.supports("anchor-name: --x")) { /* native anchor */ }
else { /* fallback positioning */ }

if ("gpu" in navigator) { /* WebGPU */ } else { /* WebGL2 */ }
```

**Rules of thumb**
- Progressive enhancement only — the page must work with none of these.
- Always honour `prefers-reduced-motion`.
- These are frontend/CSS techniques; they don't touch the Akoro API. Adopt in
  `akoro-learner` / `akoro-instructor` behind `@supports`, verify current
  browser support first, and keep a fallback path.

---

### Source
BASE/LINE'26 demo — "one file, zero dependencies, all browser." Built as a
demonstration; explicitly "view source, take anything." This doc summarizes its
claims; the **full working source is vendored in this repo** so you can read the
WGSL/GLSL shaders, the CSS, and the runtime feature detection directly, and open
it in a browser to see each technique live:

- [`references/baseline-2026.html`](./references/baseline-2026.html) — the
  complete single-file demo (self-contained HTML + inline JS/WGSL/GLSL; the only
  external requests are two Google Fonts). Open it in a July-2026 evergreen
  browser; it degrades politely elsewhere (see [plate 08 / the audit](#8-live-capability-audit)).
