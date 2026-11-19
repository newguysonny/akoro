# agent-capabilities

The one taxonomy of what the agent can do: the curated areas and per-tool
examples that Agent Chat's tool selection reads, plus the built-in and promoted
tool catalogue and the non-tool feature list shown in Admin → Agent capabilities.

## Entry

`index.js` is the only cross-module entry point. `examples.js` holds `AREAS`
and `TOOL_EXAMPLES`; `catalogue.js` builds the admin catalogues over the shared
tool registry.

## Extend

Add a tool example to `examples.js` in the same change as the tool itself —
`catalogue.contract.test.mjs` fails when a catalogue tool has no example. Add a
non-tool capability to `features.js`.

## Limits

This module is data + pure builders: it must not import adaptive-learning or
the tool runtime, so selection and the admin page can both read it.
