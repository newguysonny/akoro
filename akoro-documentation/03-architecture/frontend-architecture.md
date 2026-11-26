---
title: Frontend architecture
status: beta
doc_status: complete
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Frontend architecture

## Purpose

Each portal is its own app in the monorepo. `akoro-learner` (the learner
app, installed as a PWA), `akoro-admin`, `akoro-instructor` and
`akoro-school` are Vite + React single-page apps; `akoro-docs` (the public
documentation site) is a Next.js + Fumadocs site. There
is no shared frontend monorepo package; the apps share conventions, the API
contract, and the realtime protocol rather than code.

## Boundaries

Frontends own presentation, client-side routing, local state and the service
worker. They never own authorisation: every rule that matters is re-checked
by the API. The learner app additionally owns in-browser document work —
rendering uploaded PDFs to page images for extraction — and in-browser media
playback (HLS).

## Diagram

```text
akoro-learner (Vite + React 18 + Tailwind, vite-plugin-pwa)
  src/
    App.jsx / main.jsx     router, providers, boot
    pages/  features/      route-level and feature components
    components/  contexts/ shared UI and React context state
    services/  lib/        API client, socket client, helpers
    hooks/  utils/  data/
        |  HTTPS (JWT bearer)        |  Socket.io (cookie handshake)
        v                            v
                     akoro-api
```

## Request/event flow

1. The app boots from a static bundle (Vercel), reads its API base from
   build-time configuration (`VITE_API_URL`), and restores the session.
2. Data loads over HTTPS; mutations follow the API's confirmation patterns
   (for example, agent change cards are decided in the UI and applied by the
   API under the same approval).
3. Realtime updates — chat streaming, battle state, live sessions — arrive
   over a Socket.io connection authenticated from the handshake cookie; the
   socket origin policy is the API's CORS policy, so only portal origins can
   open credentialed sockets.
4. Install flow: the learner app is a PWA (web app manifest + service
   worker precache). The marketing landing hands install intent to the app
   via a query flag, and the app preserves that intent across the sign-in
   redirect so a signed-out visitor's tap still ends in an install prompt.

## Data and storage

The browser holds no system of record: session tokens, UI state, and the
service worker's precached bundle only. One durable client behaviour worth
knowing: a new app version's service worker can auto-reload the page, so
long-running in-page work (such as a file attach) must tolerate a reload.

## Dependencies

React, React Router, Tailwind CSS, Socket.io client, hls.js for video,
pdfjs-dist for in-browser PDF rendering, Tiptap for rich text, and the
Tabler webfont icon set. Icons are real icon fonts/SVG — product UI uses no
emoji.

## Failure modes

- A stale service worker serving an old bundle after a deploy: deploys are
  verified by walking the live entry chunk's import graph, because the
  dashboard chunk is not in the precache list and the precache alone can
  look current when the app is not.
- API unreachable: apps surface the API's plain-language error envelope;
  error bodies never contain backend internals (enforced server-side).

## Security and permissions

Tokens are obtained from the auth API; sockets authenticate from the
handshake cookie. A tenant school site may call the API under the CORS
policy but is never credentialed, and can never open a socket as its
visitor. See [Security architecture](security-architecture.md) and
[API authentication](../02-api/authentication.md).

## Invariants

- UI changes for the learner, instructor and admin apps are preview-first:
  a mockup is approved before implementation code is written.
- No explanatory or hint text in product UI; warnings belong in
  confirmation dialogs.
- Every screen must load cleanly at desktop, tablet and mobile widths;
  mobile is the acceptance test.

## Observability

Frontends rely on the API's health and error envelope; there is no separate
client telemetry pipeline documented yet.

## Related

- [System overview](system-overview.md)
- [Backend architecture](backend-architecture.md)
- [Learner data model](../05-data-models/learner.md)
