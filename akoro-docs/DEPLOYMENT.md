# Public Docs Deployment

Target: Vercel project + `docs.akoro.ng`.

## Vercel project

- Repository: `newguysonny/akoro`
- Root directory: `akoro-docs`
- Framework preset: Next.js
- Node: 22+
- Install: `npm ci`
- Build: `npm run build`
- Output: Next.js default

## Environment

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://docs.akoro.ng` |
| `NEXT_PUBLIC_STATUS_URL` | Instatus public URL, once created |

## Domain

1. Add `docs.akoro.ng` in Vercel → Project → Domains.
2. At the DNS provider, create the CNAME Vercel shows
   (`cname.vercel-dns.com` is typical).
3. Wait for the certificate and verify HTTPS.
4. Keep the apex `akoro.ng` and app domains unchanged.

## Build notes

- `scripts/sync-openapi.mjs` copies the internal spec to `openapi/akoro.yaml`.
- In a Vercel root-only build the internal source is absent; the committed copy
  is used instead.
- `scripts/validate-public-docs.mjs` checks local links, generated operation
  routes, changelog JSON and OpenAPI freshness.
- Both run in `prebuild`.

## Post-deploy checks

```bash
curl -I https://docs.akoro.ng/docs
curl -I https://docs.akoro.ng/docs/api-reference/login
curl -I https://docs.akoro.ng/changelog/rss.xml
curl -I https://docs.akoro.ng/changelog/feed.json
curl -I https://docs.akoro.ng/llms.txt
```

Then verify `/status` redirects after `NEXT_PUBLIC_STATUS_URL` is set.

## Rollback

Revert the docs commit in Vercel or promote the previous deployment. The API
deployment is independent.
