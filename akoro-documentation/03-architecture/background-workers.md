---
title: Background workers
status: implemented
doc_status: complete
audience: [engineer, agent]
last_reviewed: 2026-11-26
owners: [TBD]
---

# Background workers

## Purpose

Three worker shapes keep slow and scheduled work off the request path:
in-process BullMQ workers and schedulers started by the API at boot, a
standalone video-encoding worker, and a RunPod serverless GPU worker for
document parsing.

## Boundaries

| Worker | Runs where | Work |
| --- | --- | --- |
| Battle worker | API process | Battle lifecycle jobs (started eagerly at boot; battles used to stall when it was imported lazily) |
| Eval worker | API process | Verification/eval suites — minutes of model calls, polled by the admin page |
| Agent inbox worker | API process | Agent-to-agent messages: a message arriving or an agent coming online wakes it, plus a periodic sweep |
| Chat follow-ups worker | API process | Learner-scheduled agent check-ins as durable delayed jobs |
| Learner autonomy / autonomy cycle | API process | Scheduled agent activity for learners |
| Quiet learning worker | API process | Post-chat memory passes (see [Memory architecture](memory-architecture.md)) |
| Self-tool resumes worker + sweep | API process | Resuming a learner's tool build after admin approval; a 15-minute sweep recovers lost jobs and expiry |
| Routine scheduler | API process | Self-study routine scheduling |
| Tasks worker | API process | Teacher task-agent work (own legacy gate, `ENABLE_TASK_WORKER`) |
| Billing jobs | API process | Trial expiry, invoice generation, payment retry (module crons) |
| Session reminders/notifier | API process | Session reminder delivery (`workers/sessionReminders.js`, `sessionNotifier.js`) |
| Video encoding worker | Separate VPS (`worker.js`) | FFmpeg multi-resolution HLS encoding |
| Document parsing worker | RunPod serverless (`runpod-worker/handler.py`) | Page-image parsing/OCR by the hanji-parse model |

## Diagram

```text
app.js boot -> migrations applied -> lib/startWorkers.js
   startWorkers()            in-process workers, each start isolated:
                             a failure is logged, the API still serves
   startRoutineSchedulerJob()
   startTaskWorker()
        |
        +-- jobs gate (lib/jobsGate.js) consulted by every worker/cron

video:  API enqueues -> worker.js (VPS, BullMQ) -> signed R2 URL ->
        FFmpeg HLS -> upload to R2 public prefix -> delete staging file ->
        POST /internal/update callback (shared secret)

parse:  API submits page images -> RunPod endpoint -> handler.py loads the
        model OFFLINE from the cached snapshot -> returns layout blocks
        (bbox_2d + text) the API stores as the record's extracted content
```

## Request/event flow

Extraction is the clearest end-to-end example: born-digital PDFs with a
text layer skip the model entirely; scanned pages are rendered in the
client and submitted in batches, with concurrent submit/poll and one
automatic upload retry, because the endpoint's throughput — not storage —
is the bottleneck.

## Data and storage

Queues live in Redis; durable waits live in Postgres deferred jobs; all
results land in Postgres or R2. The video worker needs no shared disk: it
pulls the source from a signed URL and pushes HLS back to R2.

## Dependencies

Redis/BullMQ, FFmpeg (video worker host), RunPod (parse worker), R2.

## Failure modes

- Idle workers burn metered Redis commands even with zero users. That is
  why the jobs gate exists, with three dials, most specific first:
  `AKORO_JOBS_ENABLED` (only the named jobs run), `AKORO_JOBS_DISABLED`
  (all except the named), `AKORO_BACKGROUND_JOBS_ENABLED=false`
  (everything off). Module-level crons consult the same gate.
- `VIDEO_WORKER_ENABLED=false` stands the video worker down before it
  opens any Redis connection.
- A worker that fails to start at boot logs and is skipped; request-path
  features that depend on it degrade to their sweep or in-process fallback
  where one exists.

## Security and permissions

Worker-to-API callbacks authenticate with the shared internal secret;
queue payloads carry identifiers only. Background agent work inherits the
learner's permissions — a scheduled follow-up runs as that learner, with
the same tool gates as a live turn.

## Invariants

- No worker starts before boot migrations finish.
- Every recurring job must be gateable by name through the jobs gate —
  including crons that register at module import.

## Observability

Boot logs name each worker as it starts; per-job worker logging
(`lib/workerLog.js`) tags job output; Redis command volume is traceable
(`AKORO_REDIS_TRACE`) because quota is a real operating constraint.

## Related

- [Event-driven architecture](event-driven-architecture.md)
- [Backend architecture](backend-architecture.md)
- [Caching strategy](caching-strategy.md)
