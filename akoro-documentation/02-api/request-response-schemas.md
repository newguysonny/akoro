---
title: Request and response schemas
status: beta
doc_status: draft
audience: [developer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Request and response schemas

[OpenAPI](openapi.yaml) is the canonical contract. This page explains the
conventions the schemas follow so the spec is predictable to read. Where this
page and the spec disagree, the spec wins.

## Envelope

Successful responses use a two-field envelope:

```json
{ "success": true, "data": { } }
```

- `data` is an object for single-resource operations, an array for unpaged
  lists, or a page object for paged lists (see [Pagination](pagination.md)).
- Error responses use `success: false` with a `message` and an optional
  machine `code`; validation errors add an `errors` array of
  `{field, message}` entries. Some legacy handlers return `{ "error": "..." }`
  instead. Full detail: [Errors](errors.md).

## Schema components

Reusable shapes live under `components/schemas` in the spec and are shared by
every operation that returns them:

| Component | Used for |
| --- | --- |
| `SuccessAuth` | Sign-in/refresh: envelope wrapping `AuthSession` |
| `AuthSession` | `accessToken`, `refreshToken`, `accessExpiresAt`, `user` |
| `User` | `id` (uuid), `email`, `username`, `fullName`, `avatarUrl`, `role`, `onboardingCompleted` |
| `Record` / `RecordPage` | Library records and the paged record envelope |
| `UploadUrlRequest` / `UploadUrlResponse` | Presigned-upload handshake (`uploadUrl`, `fileKey`, `store`) |
| `Error` / `ValidationError` | The error shapes described in [Errors](errors.md) |

Shared responses (`Unauthorized`, `ValidationFailed`, `RateLimited`,
`ServerError`) are defined once under `components/responses` and referenced
by operations, so a 401 or 429 means the same shape everywhere it is declared.

## Conventions

- **Identifiers** are UUID strings (`format: uuid`) unless an operation says
  otherwise. Never construct an id; use one returned by the API.
- **Required fields** are listed in each schema's `required` array. Sending a
  subset and hoping for defaults is a validation error (422), not a partial
  success.
- **Enums are closed.** For example `Record.kind` is one of `upload`,
  `paste`, `link`; `UploadUrlRequest.purpose` is `record` or `folder-cover`.
  Unknown enum values are rejected.
- **Nullable vs absent.** Fields marked `nullable: true` (e.g.
  `User.fullName`, `Record.duration`) may be present with a `null` value;
  undeclared fields are not part of the contract and may be dropped.
- **Unknown request fields** are ignored by most handlers, but agents must
  not rely on that: send only documented fields.
- **Numbers.** Sizes are integer bytes; timestamps returned in bodies follow
  the field's declared format in the spec (for example `accessExpiresAt` is
  an integer epoch value in `AuthSession`).
- **Content type** is `application/json` for all documented operations
  except the raw storage PUT to a presigned `uploadUrl`, which is not an API
  call and takes the file bytes with the file's MIME type.

## Versioning of schemas

The spec is version `0.1.0-skeleton`: it covers the verified Tier-1 surface
(auth, records core, public catalogue, blog/careers, contact, pilot intake),
not every route in the server. Canonical `/api/v1` versioning is proposed,
not implemented — the live base path is `/api`. Schema changes follow the
policy in [API migrations](../11-changes-releases/migrations/api-migrations.md).

## Validating your payloads

1. Find the operation in [OpenAPI](openapi.yaml) and read its request schema.
2. Build the smallest body that satisfies `required`.
3. Check the response against the declared schema, including the error
   responses — a 200 with an unexpected shape is a bug to report, not to
   code around.

## Related

- [OpenAPI](openapi.yaml)
- [Authentication](authentication.md)
- [Errors](errors.md)
- [Pagination](pagination.md)
