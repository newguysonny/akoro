# Akoro Design System

Shared design references and assets used across the Akoro apps
(`akoro-learner`, `akoro-instructor`). Not built or imported by any app — this
is a reference library: patterns, techniques, and source demos we can pull from.

## Contents

- **[`browser-native-2026.md`](./browser-native-2026.md)** — reference guide to
  browser platform features that replace JS libraries (GPU shaders, scroll-driven
  animation, anchor positioning/popovers, OKLCH color, container/`:has()`/`if()`
  queries, View Transitions + `linear()` springs, feature-detection patterns).
  Each entry notes what it replaces, a snippet, and where it could apply in Akoro.
- **[`references/baseline-2026.html`](./references/baseline-2026.html)** — the
  full BASE/LINE'26 single-file demo the guide is based on. Self-contained; open
  in a browser to see every technique live. "View source, take anything."

## How to use

Before adding a dependency for tooltips, scroll animation, spring motion,
theming, or layout state, check `browser-native-2026.md` for a native option.
Adopt behind `@supports` / `CSS.supports()` with a graceful fallback, honour
`prefers-reduced-motion`, and verify current browser support before shipping.
