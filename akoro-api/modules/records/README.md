# modules/records

Learner records: access rules, ask/grounding helpers, extraction, search and
chunk indexing, object storage, stored text/office parsing, media transcription
clients, study-material tools, text backfill, and the records router.

Entry point: `modules/records/index.js` — a pure re-export list. Other modules
and `app.js` import the barrel only; internals (`access.js`, `askLib.js`,
`lib/storage.js`, …) are private to this module.

Layering: `routes.js` only authenticates and wires handlers. The
`service-*.js` files own orchestration (uploads, folders, extraction, ask /
guide, tools, study material, transcription), `rules.js` holds pure
validation and limits, and `store-*.js` holds every Supabase query. Ownership
checks live in the service before any read or write: upload/cover keys must
pass `ownsRecordFileKey`, and record/folder queries are user-scoped.

To extend: add the function in the owning file (or a new sibling), export it,
then add the name to `index.js`. Cross-module dependencies go through the other
module's `index.js`.

Known limits: the study-material entry (`studyMaterial.js`) is now a thin
orchestrator — the model calls live in `study-material-generate.js`, the
source queries in `study-material-store.js`, and the pure shapes in
`study-material-shape.js`, so none is over the 600-line ratchet. Two default
routers exist (`routes.js`, `parseConsole.js`) and are exposed as named
aliases `recordsModule` / `parseConsoleModule`. Importing the barrel eagerly
loads every re-exported file, including the router.
