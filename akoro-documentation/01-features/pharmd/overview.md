---
title: PharmD programme overview
status: beta
doc_status: overview
tier: 1
audience: [developer, learner, agent]
last_reviewed: 2026-11-25
owners: [TBD]
---

# PharmD programme overview

The PharmD module publishes a Doctor of Pharmacy programme tree and supports
learner reading, progress and question answering around topic PDFs.

## Public catalogue

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/pharmd/programme` | Programme, years and courses with topic counts |
| GET | `/api/pharmd/courses/:code` | One course and its topics |
| GET | `/api/pharmd/topics/:id/file` | Public topic PDF/URL |

## Authenticated learner surface

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/pharmd/ask` | Ask about the current topic text/selection |
| GET | `/api/pharmd/progress` | Completed topics for the signed-in learner |
| POST | `/api/pharmd/topics/:id/complete` | Mark a topic done/undone |

## Status

The public programme tree and authenticated progress endpoints are implemented.
Some learner-facing course/year states still show "coming soon" when content is
missing. Treat PharmD as **beta** and mark missing content explicitly.

## Data

Core entities: `edu.pharmd_programmes`, `edu.pharmd_years`,
`edu.pharmd_courses`, `edu.pharmd_topics`, `edu.pharmd_topic_progress`.

## Capabilities

- `pharmd.get_programme`

## Related

- [Programmes overview](../programmes/overview.md)
- [Library overview](../records/overview.md)
- [OpenAPI](../../02-api/openapi.yaml)
