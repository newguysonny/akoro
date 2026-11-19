# agent-context

The strategy/context layer: the workspace manifest, context-set loading and
budgets, prompt assembly (`chat-doctrine`), persona prompt builders, and the
admin override store.

## Entry

`index.js` is the only cross-module entry point. `context-manager.js` loads and
validates context sets; `overrides.js` / `override-store.js` hold the editable
prompt parts.

## Extend

Add a persona or loader file and export its public names from `index.js`.
Prompt literals live in the `akoro-agent/` workspace templates, not here.

## Limits

Context loads are byte-budgeted (`CONTEXT_BUDGET`) and resolved through the
manifest; a file not registered in `manifest.mjs` is unreachable by design.
