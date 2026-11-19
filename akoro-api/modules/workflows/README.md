# modules/workflows

Generic workflow runtime: definitions and transitions, the engine, Supabase and
in-memory stores, thread/model picking, envelopes, registry, live bus, narrator
and dashboard descriptors, plus the HTTP routes.

Entry point: `modules/workflows/index.js` — a pure re-export list. Callers
outside the module import the barrel, never `engine.js` or `store.js`.

To extend: implement in the owning file (or a new sibling), export it, then add
the name to `index.js`. Keep outbound imports on other modules' `index.js`.

Known limits: the barrel re-exports `routes.js`, so importing it loads the
router and its dependencies. Workflow type modules (e.g. under
`adaptive-learning`) register themselves by importing this barrel; keep the
barrel free of side effects so registration order stays with the caller.
