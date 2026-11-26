---
title: Contribution guide
status: implemented
doc_status: complete
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---
# Contribution guide

How a change moves from idea to shipped on `kilo/modular-storm-thz`. The
short version: pushing to that branch deploys, so the discipline happens
*before* the push.

## Before you write code

1. Find the relevant capability in `documentation-index.json` and confirm its
   status in `capability-registry.yaml` — a feature described in prose is
   not necessarily available (see [AGENTS guide](../AGENTS.md) §4).
2. Read the feature doc, the OpenAPI operations and the data model for the
   area you are touching.
3. For UI work on the learner, admin or instructor apps: produce an
   interactive preview and get it approved before writing implementation
   code. Behaviour fixes and small, explicitly specified additions are
   exempt; redesigns are not.
4. Check whether someone has already implemented the direction — pull the
   branch and look before assuming what exists.

## Making the change

- Keep the change inside the owning module (`akoro-api/modules/<domain>/`)
  or app; respect the structural rules in [Coding standards](coding-standards.md)
  (600-line file cap, `index.js` entry, no import cycles, module READMEs).
- New database changes are new SQL files in `akoro-api/migrations/` **and**
  new entries in `akoro-api/migrations/manifest.json` — both, or the
  migration silently never applies.
- New behaviour behind risk gets a kill switch: an `AKORO_*` flag where
  `=false` removes the slice (see [Naming conventions](naming-conventions.md)).
- Never commit secrets, real learner data or production credentials. Examples
  and tests use demo accounts and sandbox data only.

## Documentation ships with the change

Per the rules in [README](../README.md) and the [AGENTS guide](../AGENTS.md)
§10, a behaviour change updates, in the same body of work:

1. OpenAPI, if the contract changed.
2. The feature/capability document.
3. Affected workflows and examples.
4. `capability-registry.yaml`, if availability changed.
5. A changelog entry, if users or developers are affected.
6. Validation: `node akoro-documentation/scripts/validate-docs.mjs`
   (see [scripts README](../scripts/README.md)).

Do not create a new top-level plan; extend the existing plans under `docs/`.

## Verification before the push

- Run the affected suites plus the always-run set:
  `npm run test:structure`, `npm run test:client`, `npm run typecheck`
  (API) and the app suites for frontend changes — see
  [Testing strategy](testing-strategy.md).
- After a build failure: explain the cause first, verify the fix second,
  push third. Stage the fix; do not ship it on a guess.
- Pushes, merges and branch deletions on shared repositories happen on an
  explicit go-ahead, not on momentum. A declined or unanswered approval ends
  the attempt.

## After the push

1. Fetch the pushed files back from the branch and grep them — confirm the
   change is really there.
2. Wait for the sandbox `/health` build SHA to equal the pushed commit, then
   run the verify gate and report verdict, run id, commit and every failed
   assertion.
3. For frontend changes, confirm the live bundle flipped before telling
   anyone to test (see [Deployment guide](deployment-guide.md)).
4. Report honestly: what was verified, what was not, and what remains open.
   FAIL means not verified — say so.
