# Endpoint reference

Status: Phase 2 in progress. These pages cover the verified auth/library core.
The generated OpenAPI reference is the canonical field list.

| Operation | Page |
| --- | --- |
| `POST /api/auth/login` | [Sign in](auth-login.md) |
| `POST /api/auth/refresh` | [Refresh a session](auth-refresh.md) |
| `GET /api/records` | [List records](records-list.md) |
| `POST /api/records/upload-url` | [Presign a record upload](records-upload-url.md) |
| `POST /api/records` | [Create a record](records-create.md) |
| `GET /api/records/extract/status` | [Extraction status](records-extract-status.md) |
| `POST /api/records/ask` | [Ask about a record](records-ask.md) |

## Conventions

- Base path: `https://api.akoro.ng/api` (current).
- Sandbox: `https://sandbox.akoro.ng/api`.
- Send `X-Akoro-Portal`.
- Browser sessions use portal-scoped cookies; mobile uses the bearer token.
- All records endpoints enforce record ownership.
- Do not use real learner data in examples.
