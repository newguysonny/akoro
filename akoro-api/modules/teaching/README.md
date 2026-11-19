# teaching

The instructor's teaching tool suite: a catalogue of resource generators, the
runner that produces and stores their output, and the shared content-scaffold
and JSON-repair helpers.

## Entry

`index.js` is the only cross-module entry point. Its default export is the
`/api/teaching/tools` router; named exports are the tool catalogue/helpers and
the scaffold/repair functions used by the chat tool runtime and session
assessment.

## Extend

Add a generator to the `TOOLS` catalogue and handle it in
`generateToolResult`; keep prompt scaffolding in `contentScaffold.js` so it can
be tested without a model call.

## Limits

Generating a tool result calls a model, so routes are mounted under `aiLimit`.
`lib/teachingTools.js` is the older facade kept for the task engine and
self-study drafts; new callers should use this entry.
