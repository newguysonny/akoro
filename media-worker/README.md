# akoro media-worker

An ffmpeg container for the heavy media lanes — **the API never touches
media again**. Two jobs:

| Endpoint | Job | Replaces |
|---|---|---|
| `POST /jobs/encode` | course-video → adaptive HLS on R2 (same flow + callbacks as the old BullMQ worker) | `akoro-api/worker.js` |
| `POST /jobs/extract-audio` | any A/V source → 16 kHz mono mp3 + scene-change frames on R2 (the ffmpeg half of the transcript lane) | the ffmpeg/download half inside `akoro-api`'s `avTranscribeLib.js` |

Every job endpoint is `x-internal-secret`-authenticated and answers **202
immediately**; the caller polls `GET /jobs/:id`. Deepgram, RunPod
captions, transcripts and the database all stay in the API — this
container only ever moves bytes and runs ffmpeg.

**Current concurrency:** the API queue keeps `MEDIA_ENCODE_VIDEOS` videos
in flight (default 2). Each video is inspected once, then fans out to one
named container per rendition (`video-<id>-360p`, `video-<id>-1080p`, …);
each container still runs `MAX_CONCURRENT_JOBS=1`. `max_instances: 12`
covers two 4K videos plus the planner/extract lanes. The legacy
`/jobs/encode` path remains for one-container fallback.

## Why

Render's 512 MB free instance OOMs when ffmpeg + a downloaded original +
the API share a box. Media was always a separate concern: worker.js
already talked to the API only over `INTERNAL_SECRET`-authenticated HTTP,
and pulled/pushed straight from R2. This package makes that boundary a
real container.

## Deploy

### Cloudflare Containers — two ways

**From the browser (recommended, no local tooling):** the repo's GitHub
Actions workflow `Deploy media-worker` builds the image on a GitHub runner
(which has Docker — the Render API does not) and runs wrangler deploy with
repo secrets. One-time setup is documented in the workflow header
(`.github/workflows/deploy-media-worker.yml`): 2 Cloudflare secrets +
7 `MW_*` app secrets, then Actions → Deploy media-worker → Run workflow.

**From a local machine:**

```bash
cd media-worker
npm install
npx wrangler secret put INTERNAL_SECRET
npx wrangler secret put R2_ACCOUNT_ID        # …and the other R2_* secrets
npx wrangler secret put API_BASE_URL
npx wrangler deploy
```

The `containers` block in `wrangler.jsonc` sets `instance_type:
standard-3` (2 vCPU / 8 GiB / 16 GB disk). The default `dev` tier
(1/16 vCPU, 256 MiB) cannot run ffmpeg. Use `standard-4` for 4K sources.
**Secrets** set via `wrangler secret put` live in the Worker environment;
make sure the start env of the container picks them up per the current
docs (or bake non-secret config via `vars`, and secrets via your
registry's image env).

### Anywhere else Docker runs

The image is deliberately self-sufficient — Fly.io, Hetzner, Render
(docker runtime) all work unchanged:

```bash
docker build -t akoro-media-worker .
docker run -d -p 8080:8080 --env-file .env akoro-media-worker
```

## Wiring the API

Point `akoro-api` at it with one env:

```
MEDIA_WORKER_URL=https://akoro-media-worker.<your-subdomain>.workers.dev
```

- **Transcription lane**: `avTranscribeLib.transcribeRecord` delegates the
  ffmpeg half to `POST /jobs/extract-audio` when `MEDIA_WORKER_URL` is
  set — the API then downloads only the tiny 16 kHz mp3 + frames from R2
  for Deepgram/captions. Unset → the in-process ffmpeg path remains as
  the fallback (byte-for-byte the old behavior).
- **Encode lane** (flipped): the stream module's `POST /api/stream/upload-url`
  hands the browser a presigned PUT (bytes go straight to R2), and
  `POST /api/stream/upload-complete` dispatches `POST /jobs/encode` when
  `MEDIA_WORKER_URL` is set — media moves container ↔ R2, never through the
  API, and no BullMQ encode queue is opened at all. The container then drives
  the SAME `/api/stream/internal/*` callbacks the old worker did, so the
  instructor's status polling and the auto-transcribe hook are unchanged.
  Unset → the BullMQ queue + `akoro-api/worker.js` run exactly as before.
  With it set, stand the old worker down (`VIDEO_WORKER_ENABLED=false`).
  The API queue (`video-encode-fanout`) retries lost jobs; each variant
  runs on a named container and the API writes the nested master playlist.
  HLS segment uploads use `R2_UPLOAD_CONCURRENCY` (default 8), not one
  `Promise.all` for thousands of segments.

## Endpoints

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/healthz` | — | no auth; platform probe |
| POST | `/jobs/inspect` | `{videoId}` | sync ffprobe + variant plan |
| POST | `/jobs/encode` | `{videoId, courseId, sourceKey}` | 202 → `{jobId}` (legacy full encode) |
| POST | `/jobs/encode-variant` | `{videoId, courseId, sourceKey, variant, frameRate}` | 202 → `{jobId}` (one rendition) |
| POST | `/jobs/extract-audio` | `{url, kind?, maxFrames?, sceneThreshold?, prefix?}` | `kind` audio\|video (default video); HLS urls read directly by ffmpeg |
| GET | `/jobs/:id` | — | `{state: running\|done\|failed, log, result}` |
| GET | `/jobs` | — | recent snapshots |

Job results:

- encode → `{videoUrl, variants}` (and the API got its
  `/api/stream/internal/update` callbacks, exactly like the old worker)
- extract → `{audio: {key, url}, frames: [{key, url, tSec}], durationSec}`
  — URLs are 1-hour presigned GETs; the mp3 is ~7 MB/hour of audio.

## Tests

```bash
npm test
```

Offline contract tests: pure ffmpeg arg builders pinned against the
API's conventions, the HTTP surface (auth, 409 lanes, 202 + poll), and
the API-side delegation seam. The integration test that actually runs
ffmpeg skips itself when no binary is present (CI / sandbox).
