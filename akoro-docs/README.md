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

## Changelog feeds and automation

- `/changelog/rss.xml`
- `/changelog/feed.json`
- Page: `/docs/changelog`
- PR labels produce a changelog draft comment via
  `.github/workflows/changelog-draft.yml`; an editor still approves and adds the
  entry.

## Status page

See [STATUS.md](STATUS.md). Instatus Starter is selected; `/status` shows a setup
notice until `NEXT_PUBLIC_STATUS_URL` is set, then redirects to the managed page.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Vercel project, `docs.akoro.ng`
domain, environment variables and post-deploy checks.

## CI

`.github/workflows/docs.yml` installs `akoro-docs`, syncs OpenAPI, builds the
site, and runs the internal docs validator. `prebuild` also runs
`validate-public-docs.mjs` for local links, generated operation routes, changelog
JSON and OpenAPI freshness.

## Not started

- Instatus Starter account, monitors, incident templates and subscriber setup.
- Vercel project creation and DNS for `docs.akoro.ng`.
- Search analytics and feedback.
