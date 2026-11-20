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

Activity drafts are entered through `drafts.js` and split by responsibility:

- `draft-rules.js` — pure rules (types, TTL/cap windows, plan/history shapes).
- `draft-store.js` — draft Supabase queries (classrooms, TTL sweep, cap).
- `draft-audience.js` — audience resolution.
- `draft-plan.js` — plan generation and background enrichment.
- `draft-model.js` — the model calls and the auto-rubric hook.
- `draft-questions.js` — battle and review-battle question preparation.
- `draft-create.js` / `draft-revise.js` — prepare and conversational revision.
- `draft-records.js` / `draft-history.js` — read/list/edit/discard and restore.
- `draft-assign.js` — the approval, replayed through `createAssignment`.
- `draft-edits.js` — version edits/retries, settings and rubrics.

## Extend

Add a focused file and export its public names from `index.js`. Background
version jobs register through the draft/routine helpers, not at import. New
routes go in `routes.js` with their handler in the matching `service-*.js`;
pure decisions belong in `rules.js` and queries in `store-*.js`.

## Limits

`questionPaper.js` is the large file; new behaviour belongs in a smaller
module (`paperTemplate.js`, `plan-scaffold.js`). Route bodies do not live in
`routes.js`.

