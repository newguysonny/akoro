# Documentation scripts

## `validate-docs.mjs`

Phase 1 validation for the documentation foundation.

Run from the repository root:

```bash
node akoro-documentation/scripts/validate-docs.mjs
```

Checks:

- `documentation-index.json` parses and its document paths resolve.
- `capability-registry.yaml` parses; every capability has a valid status.
- Capability docs and API references resolve.
- `documentation-index.json` capability IDs exist in the registry.
- `02-api/openapi.yaml` parses and its internal `$ref`s resolve.
- Local Markdown links resolve.

This is a foundation check, not yet a full API contract test. Phase 2 adds:

- runtime Express route comparison;
- public allow-list enforcement;
- OpenAPI schema validation against running responses;
- example validation against the sandbox.
