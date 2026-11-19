# API modules — structural guardrails (Phase 19)

`scripts/structure-scan.mjs` enforces the Phase 19 rules in `reference/Grand Plan.md`;
`modules/structure.contract.test.mjs` fails when the code is **worse** than
`modules/structure-baseline.json`.

```bash
cd akoro-api
npm run test:structure      # the guardrail
npm run structure:baseline  # only after removing violations
```

Rules:

1. **Size ratchet** — no file over 600 lines that is not already in the
   baseline, and a baselined file may only shrink (`git diff` shows the new
   count). Splitting a large file is the intended way to remove an entry.
2. **One entry per module** — code in `modules/<a>/` may import
   `modules/<b>/index.js` and nothing else from `<b>`. Importing another
   module's internals is listed in the baseline and can only be removed.
3. **No cycles** — module-level import cycles are baselined per module; a
   module that starts cycling fails, and one that stops must leave the
   baseline.
4. **README per module** — every `modules/<name>/` needs a `README.md`
   (purpose, entry point, how to extend, known limits). Existing modules are
   grandfathered in the baseline; a new module without one fails.

The import and cycle lists are now EMPTY and locked by a positive test in
`structure.contract.test.mjs`: a new cross-module internal import or a new
cycle fails even if someone regenerates the baseline. The baseline may only
shrink for the remaining lists (size, READMEs). Never add an entry to make the
test pass — fix the code, then regenerate. Stale entries are failures on
purpose, so a cleanup and its baseline update land together.

Tests (`*.test.mjs`) count for the size ratchet but are exempt from the
import/cycle rules, since a contract test legitimately reaches into the module
it tests.
