---
title: Coding standards
status: implemented
doc_status: complete
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Coding standards

The standards that are mechanically enforced in the repo, plus the working
rules the team follows. Where a rule is enforced by a test or a script, the
enforcer is named — if the enforcer and this page disagree, the enforcer wins
and this page needs fixing.

## Language and module system

- JavaScript ESM throughout: `akoro-api/package.json` sets `"type": "module"`;
  files use `.js` / `.mjs` with `import`/`export`. Frontend apps are React +
  Vite with JSX.
- TypeScript is used as a checker, not a compiler target: both `akoro-api`
  and `akoro-learner` expose `npm run typecheck` (`tsc --noEmit`) and extend
  the repo-root `tsconfig.base.json`.

## Structural rules (enforced)

From the repository `AGENTS.md` and `akoro-api/modules/README.md`, ratcheted
by `akoro-api/modules/structure.contract.test.mjs` against
`akoro-api/modules/structure-baseline.json`:

- The baseline may only shrink: fix the code, then regenerate with
  `npm run structure:baseline`. Never grow the baseline to make a failure go
  away.
- New files over 600 lines fail the structure test.
- Modules are entered through `index.js` only.
- No import cycles.
- Every module needs a README.
- Import integrity is separately guarded by `npm run test:imports`
  (module-import, import-resolution, barrel-export and unbound-helper
  contract tests).

Run `npm run test:structure` on every API change — the repo guide lists it as
"always run".

## Backend working rules

- The API is a modular monolith: new behaviour belongs in the owning module
  under `akoro-api/modules/`; shared code goes in `lib/` only when more than
  one module genuinely uses it.
- Workflow/agent code follows the Grand Plan's authority split: the LLM
  proposes, code (the harness) decides what is allowed, and the database
  confirms. The LLM never decides scores, thresholds, mastery, charges or
  state transitions.
- Kill switches are the established pattern for risky slices: a feature reads
  an `AKORO_*` environment flag where absent means enabled and `=false`
  removes the slice everywhere at once (the pattern is documented in
  `akoro-api/.env.example`).
- User-facing errors must not leak backend internals; the API sanitises error
  strings before they reach clients.

## Frontend working rules

- No emojis in product UI; icons come from the shared icon set (Tabler
  webfont in the learner app).
- No explanatory or hint text in product UI; warnings belong in confirmation
  dialogs.
- UI changes to the learner, admin and instructor apps are preview-first: an
  interactive mockup is approved before implementation code is written.
- Frontend changes are verified at desktop, tablet and mobile widths; the
  mobile load is the acceptance test.

## Documentation as part of the change

- A pull request that changes behaviour updates the relevant docs and adds a
  changelog entry (see [README](../README.md)).
- Run `node akoro-documentation/scripts/validate-docs.mjs` after editing
  anything in `akoro-documentation/` (see [scripts README](../scripts/README.md)).
- Never write secrets, tokens, cookies or real learner/school data into code
  or docs; examples use demo accounts and sandbox data only.
