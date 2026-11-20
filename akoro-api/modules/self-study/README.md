# self-study

Instructor self-study authoring: activity drafts and versions, routines,
generated question papers/rubrics, activity reviews, and submission rendering.

## Entry

`index.js` is the only cross-module entry point. `routes.js` is the module's
default export; draft/routine helpers are named exports.

`routes.js` is a thin router: it authenticates, applies roles and wires
handlers. The layers below it are:

- `service-*.js` — orchestration by resource: `activities` (plan/questions,
  assignment CRUD, analytics, reports, reviews), `drafts` (draft versions,
  rubrics, settings, routines), `files` (uploads, paper and submission
  artifacts), `grading` (publish/unpublish, markup, AI drafts, instant
  release), `learner` (answer autosave, start/link, hand-in) and `mine`
  (assigned feed, journeys, streak).
- `rules.js` — pure validation, stale-draft windows, grade bounds and the
  ownership predicate.
- `store-*.js` — Supabase queries only (assignments/targets/files; people,
  agents, sessions, battles); no Express objects cross that boundary.
- `service-common.js` / `http.js` — the ownership and target-visibility
  guards plus the response helpers.

## Extend

Add a focused file and export its public names from `index.js`. Background
version jobs register through the draft/routine helpers, not at import. New
routes go in `routes.js` with their handler in the matching `service-*.js`;
pure decisions belong in `rules.js` and queries in `store-*.js`.

## Limits

`drafts.js` and `questionPaper.js` are the large files; new behaviour belongs
in a smaller module (`paperTemplate.js`, `plan-scaffold.js`). Route bodies do
not live in `routes.js`.
