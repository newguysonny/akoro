---
title: Educational content
status: beta
doc_status: draft
audience: [engineer, partner]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Educational content

## Purpose

Where the learning material itself comes from. The honest summary: Akoro's
educational content is overwhelmingly **first-party** — authored, uploaded
and curated inside the platform and stored in its own database and object
storage. There is no external content marketplace, question-bank API or
textbook provider integration in the codebase. The external services in this
category are the ones that *process* content, not supply it.

## First-party content sources

| Source | Form | Notes |
| --- | --- | --- |
| Past questions | `modules/past-questions` | Verified questions, kept distinct from generated practice everywhere they surface |
| Curriculum and programmes | `modules/curriculum`, `modules/programmes` | Programme → section → course → content hierarchy, authored by instructors/admins |
| PharmD programme content | `modules/pharmd` | Programme-specific material on the generic programme tables |
| Learner and instructor uploads | Library records | Files in R2 (see [Storage providers](storage-providers.md)); extracted and chunked by the records pipeline |
| Course media | `modules/courses`, course builder | Video and documents published through the platform's own builder |

## Processing integrations

- **Document extraction (OCR / parse).** Scanned and image pages are parsed
  by a self-hosted worker (`runpod-worker/`, the hanji-parse model) running
  on **RunPod Serverless**; `modules/records/extractLib.js` carries page
  images to the endpoint and shapes the result into citation blocks
  (block-level bounding boxes in reading order). Text-layer documents skip
  the model parse entirely. A fast cloud-OCR first layer has been evaluated
  and is **not** integrated — extraction today is the RunPod worker alone.
- **Embeddings for search and grounding.** OpenAI or self-hosted RunPod
  embedding models; see [AI providers](ai-providers.md). Vectors decide
  which chunks ground an answer; citations point back to the source record.
- **Meetings and live classes.** A meeting service (`services/meetingService.js`)
  sits behind its own circuit breaker (`lib/meetingsBreaker.js`), and the
  environment template carries OAuth client configuration for Zoom, Teams
  and YouTube (`ZOOM_CLIENT_ID`, `TEAMS_CLIENT_ID`, `YOUTUBE_CLIENT_ID` and
  matching secrets/redirect URIs). These are configuration surfaces for
  live-class and video features; treat per-provider behaviour as unverified
  until the feature that uses it is exercised end to end.
- **Google sign-in** (`passport-google-oauth20`, `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET`) is an identity integration, not a content source.

## Failure handling

- Extraction failure leaves the record in a visible unprocessed state; the
  agent can retry extraction as a tool step, and the learner is never told a
  failed parse succeeded.
- Embedding-provider failure degrades search to its lexical half rather than
  mixing vector spaces (see [AI providers](ai-providers.md)).
- Meeting-provider failure trips the meetings breaker; live-class features
  report unavailability instead of hanging.

## Data shared and privacy impact

Page images of learner documents are sent to the RunPod extraction endpoint,
and extracted text is sent to the resolved AI provider when a learner asks a
grounded question. Past questions and curriculum content are platform data
under the same ownership rules as everything else in
[Supabase](supabase.md): verified material is never relabelled as generated,
and generated practice is never written back as verified content.

## Related

- [AI providers](ai-providers.md)
- [Storage providers](storage-providers.md)
- [Agent safety](../06-agents/agent-safety.md)
