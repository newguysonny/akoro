# Akoro Docs

Public documentation site for Akoro, built with Next.js + Fumadocs.

Status: **public docs preview** — auth, Library, public catalogues, API overview,
uploads, generated OpenAPI operation pages and changelog are live in the app.
School ERP, admin and agent-internal surfaces remain internal.

## Run

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm start
```

## Routes

- `/` redirects to `/docs`.
- `/docs` — landing.
- `/docs/start/*` — getting started, auth, environments, errors.
- `/docs/build/*` — API overview and uploads.
- `/docs/reference/api` — public/core endpoint tables.
- `/docs/changelog` — product/API changelog.

## Content source

Public content is curated from the internal Platform Documentation System at
`../akoro-documentation/`. The machine-readable API contract lives there at
`../akoro-documentation/02-api/openapi.yaml`.

Do not copy internal-only docs into `content/docs`. Update the internal source
and curate the public page.

## Deploy

Connect a Vercel project with root directory `akoro-docs`; `vercel.json` selects
the Next.js framework. Recommended production domain: `docs.akoro.ng`.

## API reference

The OpenAPI spec is synced from
`../akoro-documentation/02-api/openapi.yaml` by `scripts/sync-openapi.mjs`
(runs automatically before `dev` and `build`). Fumadocs generates one operation
page per OpenAPI operation under `/docs/api-reference/<operationId>`.

## Changelog feeds

- `/changelog/rss.xml`
- `/changelog/feed.json`

The page is `/docs/changelog`; entries are currently curated. PR-label automation
is not wired yet.

## CI

`.github/workflows/docs.yml` installs `akoro-docs`, syncs OpenAPI, builds the
site, and runs the internal docs validator.

## Not started

- Public status page (managed provider) and incident history.
- Changelog PR-label automation.
- Search analytics and feedback.
