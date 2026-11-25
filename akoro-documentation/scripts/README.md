# Documentation scripts

All scripts are offline and deterministic. They work from the repository root or
from `akoro-documentation/`; paths are resolved from the script location, not the
current directory. The only dependency is the `yaml` package already installed
for `akoro-docs`.

## `validate-docs.mjs`

Documentation foundation and tool-alignment validation.

```bash
node akoro-documentation/scripts/validate-docs.mjs
```

Checks:

- `documentation-index.json` parses and its document paths resolve.
- `capability-registry.yaml` parses; every capability has a valid status.
- Capability docs and API references resolve.
- `documentation-index.json` capability IDs exist in the registry.
- `02-api/openapi.yaml` parses and its internal `$ref`s resolve.
- `tool-registry.yaml` passes the tool-registry checks below.
- Local Markdown links resolve.

## `validate-tool-registry.mjs`

Phase 3 validation for the agent tool registry.

```bash
node akoro-documentation/scripts/validate-tool-registry.mjs
```

Checks:

- Every tool ID is unique and matches the required pattern.
- Every tool `capability` exists in `capability-registry.yaml` and is not
  `planned` or `disabled`.
- Documentation paths resolve inside `akoro-documentation/`.
- `api_reference` resolves to a real OpenAPI method, path and operation ID.
- `internal` tools declare `internal_reason`; `http` tools declare an API
  reference.
- `permissions.access`, `requires_authentication`,
  `requires_confirmation` and `confirmation_reason` are present.
- A tool cannot claim access wider than its capability, and a tool cannot drop a
  confirmation its capability requires.
- `input_schema` required properties are declared.

## `search-docs.mjs`

Offline keyword search over the index and registries.

```bash
node akoro-documentation/scripts/search-docs.mjs "records ask"
node akoro-documentation/scripts/search-docs.mjs --json "published course"
node akoro-documentation/scripts/search-docs.mjs --limit 5 "auth refresh"
```

Prints matching features, capabilities, tools and documents. All query terms
must match. The script validates index, registry and tool references and exits
non-zero when a reference is broken. It never uses the network.

## Notes

This is not a full API contract test. Runtime route comparison, sandbox example
validation and live capability verification remain separate.

## Sandbox verification scripts

These require `--confirm`; without it they perform no HTTP request. They refuse
any host except `sandbox.akoro.ng`.

- `sandbox-write-smoke.mjs` — record create → ask → delete → cleanup.
- `sandbox-course-video-smoke.mjs` — course create → video upload/encode →
  status → delete video/course.
- `sandbox-auth-smoke.mjs` — disposable admin-created user, TOTP setup/enable/
  login/disable, registration probe, reset validation, user deletion.
- `sandbox-content-validation.mjs` — blog/job validation-only and admin
  read-back; no writes.

Run them when the sandbox is reachable:

```bash
node akoro-documentation/scripts/sandbox-write-smoke.mjs --confirm
```
