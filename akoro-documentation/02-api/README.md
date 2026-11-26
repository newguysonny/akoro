# API documentation

Status: Phase 2 in progress. OpenAPI now covers auth, records core, public
catalogue, blog/careers, contact and pilot intake (34 paths, 35 operations).

## Files

| File | Purpose |
| --- | --- |
| [openapi.yaml](openapi.yaml) | Machine-readable contract |
| [authentication.md](authentication.md) | Sessions, portals, 2FA and OAuth |
| [authorization.md](authorization.md) | Portals, roles, ownership and internal callers |
| [request-response-schemas.md](request-response-schemas.md) | Envelope and schema conventions |
| [errors.md](errors.md) | Error envelope and recovery |
| [pagination.md](pagination.md) | Cursor and limit/offset conventions |
| [rate-limits.md](rate-limits.md) | Rate-limit tiers, 429 shape and client behaviour |
| [webhooks.md](webhooks.md) | Inbound provider callbacks and the realtime channel |
| [endpoints/README.md](endpoints/README.md) | Per-operation endpoint reference |

## Conventions

- Current base path: `https://api.akoro.ng/api`.
- Sandbox base path: `https://sandbox.akoro.ng/api`.
- Canonical `/api/v1` is proposed, not yet implemented.
- JSON requests and responses.
- Auth is portal-scoped: send `X-Akoro-Portal` and the matching session cookie,
  or use the bearer access token returned by sign-in.
- Webhooks use provider signatures, not sessions.
- Internal callbacks use `x-internal-secret`, not sessions.

## Coverage rule

An endpoint appears here only when it is in the public allow-list or explicitly
marked as a core authenticated operation. Admin, school ERP, agent-console,
verification and other internal routes are not public API.

## Validation

Phase 2 adds CI checks for:

- OpenAPI validity;
- every documented route exists;
- every public route is documented or allow-listed;
- examples validate against schemas;
- the spec and route inventory agree.
