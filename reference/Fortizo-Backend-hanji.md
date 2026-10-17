# Fortizo Backend — Build Plan

Scope: the backend that powers the Fortizo document viewer + study tools
(Chat/Copilot, Summary, Quiz, Flashcards, Podcast, Video, Notes). Document
parsing is **not** built from scratch — it's the vendored Hanji engine
(`hanji-main/`, upstream source; the zip was removed from `reference/` on
2026-10-17 — the parse prompt the worker needs is vendored in
`runpod-worker/handler.py`), called as an internal service. This doc is written to be
handed to Claude Code as the implementation brief.

---

## 1. Where Hanji fits

Hanji replaces the "Python document worker" layer entirely. It already gives
us: PDF/PPTX/DOCX/image parsing, layout-grounded chunks (bbox + page + type),
an async batch lane (Postgres + S3 + worker + webhooks), and grounded schema
extraction with citation verification. We do **not** reimplement any of that.

What Hanji does **not** do, and what our own API owns instead:

- Long-term storage of materials/chunks (Hanji's Postgres is just batch-job
  bookkeeping — results are meant to be pulled once and persisted by us)
- Embeddings / vector search
- Everything generative: chat replies, summaries, quiz questions, flashcards,
  podcast/video scripts
- Auth, users, notes, chat history
- Serving the original file to the frontend for PDF.js rendering

```
┌───────────────────┐
│   Frontend (React) │  Fortizo viewer + tools panel (already built)
└─────────┬──────────┘
          │ REST (+ SSE for streaming chat)
          ▼
┌───────────────────────────┐        ┌──────────────────────────┐
│   Fortizo API (Node)      │──HTTP─▶│  Hanji (vendored, as-is) │
│   Express + Postgres      │◀─webhook│  FastAPI + Postgres+S3   │
│   + pgvector               │        │  (its own batch lane)    │
└─────────┬──────────────────┘        └──────────────┬───────────┘
          │                                            │
          ▼                                            ▼
   materials / chunks /                         parse-model endpoint
   embeddings / chat /                          (hanji-parse-4b, see §6)
   generated_artifacts
          │
          ▼
   Object storage (original files — can be the same bucket
   Hanji's batch lane already provisions, or a separate one)
```

Two Postgres databases (or at least two schemas), not one:

- **`hanji` DB** — Hanji's own batch-job tables (`migrations/0001...sql`,
  `0002...sql`). Ephemeral, don't build anything on top of it.
- **`fortizo` DB** — our real data: materials, chunks, embeddings, chat,
  generated tool output, notes. This is the one Claude Code builds.

---

## 2. Repo layout

```
fortizo/
├── hanji/                 # vendored, unmodified — a plain copy committed
│                           # into this repo (see note below), not a submodule
├── api/                   # our Node/Express backend (new)
│   ├── src/
│   │   ├── routes/        # materials, chat, tools, notes, webhooks
│   │   ├── services/      # hanji-client, embeddings, llm, storage
│   │   ├── db/            # migrations + query layer
│   │   └── workers/       # embedding worker, tool-generation worker
│   └── package.json
└── docker-compose.yml     # extends hanji's compose: adds our api + our db
```

**Why a plain copy, not a git submodule:** a submodule points at
`YouLearn-AI/hanji` on GitHub and assumes that remote keeps existing. Hanji
(the company) is no longer active — the repo could disappear, go private, or
just stop being reachable with no warning. We already have the code; commit
it directly into this repo as a normal folder. It's Apache-2.0 licensed, so
we're free to fork and maintain it ourselves indefinitely. We get zero
future upstream fixes either way, so a submodule buys us nothing here and
adds a failure mode a plain copy doesn't have.

---

## 3. Data model (`fortizo` DB)

```sql
create extension if not exists vector;

create table materials (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  title           text not null,
  file_path       text not null,        -- our object storage key for the original
  mime_type       text not null,
  page_count      int,                  -- documents only; null for audio/video
  duration_ms     numeric,              -- audio/video only; null for documents
  status          text not null default 'uploading',
    -- uploading | processing | ready | failed
  hanji_batch_id  text,                 -- documents only — Hanji's batch id, for its webhook to match on
  error           text,
  created_at      timestamptz not null default now()
);

-- Documents only (PDF/DOCX/PPTX/image). Audio/video materials have no rows
-- here — there's no "page," just a timeline (see material_chunks below).
create table material_pages (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references materials(id) on delete cascade,
  page_number     int not null,
  width           numeric,              -- PDF points — needed to map bbox -> viewer overlay
  height          numeric,
  unique (material_id, page_number)
);

-- One table for every material type. A row is either page-grounded (bbox,
-- page_number — documents, via Hanji) or time-grounded (start_ms, end_ms —
-- audio/video, via the STT/frame pipeline in §5). Never both; whichever
-- pair is null tells you which kind of material this chunk came from.
-- Keeping them in one table means chat/RAG search doesn't care what kind
-- of material a chunk came from — same embedding column, same query.
create table material_chunks (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references materials(id) on delete cascade,
  chunk_index     int not null,         -- reading/playback order within the material
  chunk_type      text not null,        -- text | table | image | kv | speech | visual
  page_number     int,                  -- documents: page this chunk is on
  bbox            numeric[4],           -- documents: [x0, y0, x1, y1], PDF points — straight from Hanji
  start_ms        numeric,              -- audio/video: chunk start, milliseconds
  end_ms          numeric,              -- audio/video: chunk end, milliseconds
  speaker         text,                 -- audio/video: diarization label, if the STT vendor provides one
  text            text not null default '',
  table_cells     jsonb,                -- present only for chunk_type = 'table'
  confidence      real,
  embedding       vector(1536),         -- null until the embedding worker runs
  created_at      timestamptz not null default now()
);
create index on material_chunks using ivfflat (embedding vector_cosine_ops);
create index on material_chunks (material_id, page_number);
create index on material_chunks (material_id, start_ms);

create table chat_threads (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references materials(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create table chat_messages (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references chat_threads(id) on delete cascade,
  role            text not null,        -- user | assistant
  text            text not null,
  citations       jsonb,                -- [{ page, bbox, chunk_id }] or [{ start_ms, end_ms, chunk_id }]
  attachment_name text,
  created_at      timestamptz not null default now()
);

-- One generic table for every generative tool, instead of a table per tool.
create table generated_artifacts (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references materials(id) on delete cascade,
  tool_type       text not null,        -- summary | quiz | flashcards | podcast | video
  params          jsonb not null,       -- the form values (focus, length, difficulty, ...)
  status          text not null default 'pending', -- pending | ready | failed
  content         jsonb,                -- tool-specific shape, see §7
  created_page    int,
  created_at      timestamptz not null default now()
);

create table notes (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references materials(id) on delete cascade,
  page_number     int,
  content         text not null default '',
  updated_at      timestamptz not null default now()
);
```

---

## 4. Ingestion flow (documents — PDF/DOCX/PPTX/image, via Hanji)

1. `POST /materials` — client sends filename + mime type. We create a
   `materials` row (`status='uploading'`), return a presigned upload URL to
   our own bucket (not Hanji's — we want the original file under our own
   storage regardless of how parsing goes).
2. Client uploads the file directly to storage.
3. `POST /materials/:id/process` — client confirms upload finished. We call
   Hanji's **async batch** lane, not the sync `/v1/parse` route:
   - `POST {HANJI_URL}/v1/files` → presigned slot on Hanji's own uploads bucket
   - upload the file there (or pass our own file's signed URL if Hanji
     supports parsing by URL for batch — check `docs/batch.md` for the
     exact request shape at implementation time)
   - `POST {HANJI_URL}/v1/batches` with `chunking=semantic`, our webhook URL,
     and the file reference
   - store the returned batch id on `materials.hanji_batch_id`, set
     `status='processing'`
   - **Why async, not sync `/v1/parse/file`:** sync is fine for a 2-page
     invoice; a 300-page textbook needs the batch lane so the request
     doesn't hang. Use sync only as a fast path for small materials
     (page_count below some threshold, e.g. 5 pages) if we want snappier
     UX for short documents — Claude Code's call, but batch-by-default is
     the safer starting point.
4. `POST /webhooks/hanji` — Hanji calls this when the batch completes
   (signature verification per `docs/webhooks.md`). On success:
   - fetch the batch result (chunks)
   - insert rows into `material_pages` and `material_chunks` verbatim from
     Hanji's output (page_number ← `page_no`, bbox ← `bbox`, etc.)
   - enqueue the embedding worker for this material
   - set `materials.status='processing_embeddings'`, then `'ready'` once
     the embedding worker finishes
   - on failure: `status='failed'`, store `error`
5. Frontend polls `GET /materials/:id` (or we add SSE/websocket later) until
   `status='ready'`.

---

## 5. Ingestion flow (audio/video — a separate pipeline; Hanji doesn't do this)

Confirmed by reading the actual source (`src/extract/core/kind.py`): Hanji's
`InputKind` enum is `PDF | PPTX | DOCX | IMAGE`, full stop. No audio, no
video, no speech-to-text anywhere in the codebase. A lecture recording needs
a completely different pipeline, built as our own second ingestion path
alongside Hanji's — not a Hanji feature we're missing a flag for.

**What changes conceptually:** documents are *spatial* (a citation is a
page + a box); audio/video is *temporal* (a citation is a time range). The
`material_chunks` table in §3 already accounts for this — `page_number`/
`bbox` for documents, `start_ms`/`end_ms` for audio/video, same table, same
`embedding` column, so chat/RAG search doesn't need to know which kind of
material it's searching.

**Audio pipeline:**
1. Upload flow is identical to §4 steps 1–2 (presigned URL, direct upload).
2. `POST /materials/:id/process` detects `mime_type` starts with `audio/`
   and instead of calling Hanji, first runs the file through `ffmpeg` to
   extract to **16kHz mono** (`-vn -ac 1 -ar 16000`) before sending it
   anywhere. STT models are trained/optimized around that sample rate —
   sending higher-quality audio doesn't improve accuracy, it just costs
   more upload bandwidth and, for providers billed by file size or
   duration-to-process, more money for nothing.
3. The 16kHz mono file goes to the active STT provider (see below), which
   returns **segment-level transcripts with timestamps** (start/end per
   segment, ideally per-word too) and, for Deepgram, **speaker
   diarization** ("Speaker 1" / "Speaker 2") — very useful for a lecture
   Q&A or an interview-style recording.
4. Insert one `material_chunks` row per segment: `chunk_type='speech'`,
   `start_ms`/`end_ms`/`speaker` set, `page_number`/`bbox` left null.
5. Same as documents from here: enqueue embeddings, `status='ready'`.

**Don't chunk blindly, same principle as §3's note on Hanji's chunking:**
most STT vendors already return segments broken at natural pauses — use
those boundaries (merging very short ones, splitting very long ones to a
reasonable token count for embedding) rather than slicing on a fixed
time window like "every 30 seconds," which will cut sentences in half and
hurt retrieval quality exactly the way naive fixed-character chunking does
for text.

**Video pipeline — two extractions running in parallel, merged into one
chronological chunk list:**
1. **Audio track** → `ffmpeg` extracts it to the same 16kHz mono format as
   the audio pipeline above (`-vn -ac 1 -ar 16000`), which then goes
   through the exact same STT step. Extracting audio server-side first —
   rather than sending the raw video file to the STT API — is cheaper and
   faster: video containers are far larger than their audio tracks, and
   most STT vendors only want the audio anyway, so uploading the full
   video wastes bandwidth (and, for size-capped providers, risks hitting
   the cap on the upload itself) for no benefit.
2. **Visual track** → sample frames at scene changes (`ffmpeg`'s scene-
   detection filter, not a fixed "one frame every N seconds," for the same
   "don't chunk blindly" reason) and send each sampled frame to a
   vision-capable LLM for a caption, or run OCR on it specifically to
   capture on-screen text — slide content, code on screen, a whiteboard —
   which is usually the part that actually matters for a lecture capture.
   Insert one `material_chunks` row per sampled frame: `chunk_type='visual'`,
   `start_ms`/`end_ms` set to that frame's window, `text` = caption/OCR
   result.
3. Both extractions land in the same `material_chunks` table for that
   material, naturally interleaved by `start_ms` once queried in time
   order — the reader's timeline shows speech and visual chunks together.

**Speech-to-text: both providers built, switched by environment variable —
same swappable-by-config pattern as the parse-model endpoint in §6, not a
hard commitment to one vendor at code level.**

```
STT_PROVIDER=deepgram        # or "openai"
DEEPGRAM_API_KEY=...
OPENAI_API_KEY=...           # reused for STT if STT_PROVIDER=openai — same
                              # key already needed if OpenAI is also the
                              # chat/tools LLM provider (§7/§10)
```

Implement a small `SttProvider` interface (`transcribe(audioFile) → segments`)
with two implementations behind it, selected once at startup by
`STT_PROVIDER`. Neither implementation needs to know the other exists;
the ingestion worker just calls whichever one is active.

- **Deepgram** — the faster and cheaper of the two at scale (roughly
  20 seconds to transcribe an hour of audio in batch, well under a cent
  per minute), with diarization, topic/sentiment tagging, and custom
  vocabulary built into the same API call rather than as add-ons.
- **OpenAI Whisper API** — no native diarization on the base model (a
  separate concern from OpenAI's newer GPT-4o Transcribe line, which does
  have it, but that's a different model/endpoint if it's ever wanted
  instead), noticeably slower in practice (minutes rather than seconds
  per hour of audio), and capped at **25MB per upload** — a long lecture
  recording may need to be split into chunks by the same `ffmpeg` step
  before sending if this is the active provider, which Deepgram doesn't
  require. Its long-standing reputation for handling accented/non-native
  speech better than commercial alternatives is worth treating as "test
  it on real samples" rather than assumed fact going in — recent
  benchmarks show Deepgram's newer models closing or reversing that gap
  specifically on noisy/accented audio, so the older reputation may not
  hold for whatever specific audio Fortizo actually ingests.
- **Frame captioning:** don't add a third vendor for this — reuse
  whichever LLM provider gets picked for chat/tools (§7/§10 open
  decisions), since the major ones (Claude, GPT, Gemini) all accept image
  input already. A dedicated captioning model is more infra to run for no
  real benefit here.

**Frontend consequence:** the "Original Content" tab currently only knows
how to render a paged document. For an audio/video material it needs to
render a player instead, and a citation click seeks the player to
`start_ms` (optionally flashing that segment in a transcript list) rather
than scrolling to a page and highlighting a bbox. Same interaction
pattern as the existing `citeJump`, different target.

---

## 6. The parse-model dependency (decide before starting)

Hanji's `/v1/parse*` and the batch worker both require `PARSE_MODEL_URL` —
it is **not optional**, unlike Gemini.

**Checked just now:** `hanji-dev/hanji-parse-4b` is still live on Hugging
Face (`huggingface.co/hanji-dev/hanji-parse-4b`), with activity from one of
Hanji's former founders within the last couple weeks. So the weights are
reachable *today*. That's independent of whether hanji.dev the product is
still running — Hanji-the-company being defunct means there's no one left
maintaining that Hugging Face org either, so this can go away without
warning the same way the GitHub repo could have. Don't build a permanent
dependency on it being there next month.

**Step 0, before anything else in this section: mirror the weights.**
Download `hanji-dev/hanji-parse-4b` now and re-upload it to storage we
control — our own Hugging Face org (private or public), or straight into
our own S3/GCS bucket. This is a five-minute job today and possibly
impossible later. Every option below should then point at *our* copy, not
`hanji-dev/hanji-parse-4b` directly.

Once we have our own copy of the weights, three ways to serve them, in
order of how fast Claude Code can get something running:

1. **Hosted deployment (fastest to start with).** `serving/baseten-truss-config.yaml`
   is already in the repo — point it at our mirrored weights and deploy on
   Baseten, then set `PARSE_MODEL_URL` / `PARSE_MODEL_API_KEY` to that
   endpoint. No GPU ops.
2. **Self-host** via `docker compose --profile gpu` (needs a GPU with
   ~12 GB+ VRAM), pointing `MODEL_PATH` at our mirrored copy instead of
   `hanji-dev/hanji-parse-4b`. Not realistic for a normal dev sandbox;
   revisit once there's real usage to justify the ops cost.
3. ~~Hosted API directly from hanji.dev~~ — not an option; the company's
   no longer operating it.

Pick one and put it in `.env` before Claude Code starts on §4 — nothing in
the ingestion flow works without it.

`GEMINI_API_KEY` is also needed if we ever use Hanji's `/v1/extract/schema`
route (see §7, optional use for flashcards term extraction) — this one's a
normal live Google Cloud dependency, not affected by Hanji's shutdown.

---

## 7. Study tools — what each one actually calls

All of these read from `material_chunks` (already embedded) rather than
re-parsing anything. They're standard LLM generation calls, not Hanji calls
— Hanji's job ended at ingestion.

- **Chat / Copilot** — `POST /materials/:id/chat`. Body: `{ text, selection?
  }` where `selection` is `{ page, text, chunk_ids? }` when the message came
  from the selection popover ("Explain: ..."). Flow: embed the user's
  message → pgvector similarity search over `material_chunks` for that
  material → build a context window from top-k chunks (+ the selected
  chunks directly, if present, pinned regardless of similarity rank) → call
  the LLM → store the reply in `chat_messages` with `citations` pointing at
  the chunk ids/pages actually used → stream the response back (SSE) so the
  frontend's typing-indicator UX has something real to show progress for.
- **Summary** — `POST /materials/:id/tools/summary` with `{ depth, page? }`.
  Pull chunks for the given page (or whole document), one LLM call, store
  bullet points in `generated_artifacts.content`.
- **Quiz** — `{ focus?, count, difficulty }`. LLM call constrained to return
  structured JSON (question + 4 options + correct index) — use the LLM
  provider's structured-output / JSON-schema mode so the frontend doesn't
  need to parse free text.
- **Flashcards** — `{ count }`. Same structured-output approach, array of
  `{ front, back }`. *Optional accelerant:* Hanji's `/v1/extract/schema`
  with `auto_schema=true` can pull a grounded list of key terms/definitions
  first, which the flashcard LLM call then elaborates on — gives citations
  for free. Not required for v1; plain generation is fine to start.
- **Podcast / Video** — these are two-stage: (1) LLM generates a script from
  the chunks, stored immediately so the UI can show progress; (2) a
  separate async job turns the script into audio (TTS) or a video (script +
  slides/TTS), updates `generated_artifacts.status` to `ready` with the
  final asset URL when done. Pick TTS/video vendors later — not blocking for
  the rest of the plan.
- **Notes** — plain CRUD against the `notes` table, no LLM involved.

Every generative call above should log which `material_chunks` it used, so
"click a citation → jump the viewer to that page/bbox" works the same way
for tool output as it does for chat.

---

## 8. API surface (Fortizo → frontend)

```
POST   /materials                       start upload, returns presigned URL
POST   /materials/:id/process           confirm upload — routes to Hanji's batch lane
                                         for documents, or the STT/frame pipeline
                                         for audio/video, based on mime_type
GET    /materials/:id                   status + metadata
GET    /materials/:id/file              signed URL to the original (PDF.js source,
                                         or an <audio>/<video> src, depending on kind)
GET    /materials/:id/chunks            paginated chunks — page/bbox for documents,
                                         start_ms/end_ms for audio/video; the viewer
                                         uses this for selection/seek → chunk mapping

POST   /materials/:id/chat              send a chat message (SSE response)
GET    /materials/:id/chat              thread history

POST   /materials/:id/tools/:toolType   generate summary|quiz|flashcards|podcast|video
GET    /materials/:id/tools             list generated artifacts for this material
GET    /artifacts/:id                   poll a single artifact until status='ready'

GET    /materials/:id/notes
PUT    /materials/:id/notes             upsert by page_number

POST   /webhooks/hanji                  internal — Hanji batch-completion callback (documents only)
```

---

## 9. Build phases (sequenced for Claude Code)

1. **Scaffold** — Express app, `fortizo` DB + migrations from §3, storage
   client, env config. No Hanji integration yet.
2. **Document ingestion** — §4 end to end against a real deployed Hanji
   instance (needs §6 decided first). Verify a real PDF goes upload →
   processing → `material_chunks` populated, by hand via curl before
   touching the frontend.
3. **Embeddings** — worker that embeds any `material_chunks` row where
   `embedding is null`, triggered after ingestion completes. Written once,
   works for both document and audio/video chunks since they share the
   same table and column.
4. **Audio/video ingestion** — §5 end to end (STT for audio; STT + sampled
   frames for video), independent of Hanji entirely. Can be built in
   parallel with step 2 rather than strictly after it, since neither
   pipeline depends on the other.
5. **Chat** — similarity search + LLM + citations + SSE streaming.
6. **Tools** — summary first (simplest), then quiz/flashcards (structured
   output), then notes (no LLM, quick win), then podcast/video last (extra
   vendor integration for TTS/video).
7. **Wire up the existing frontend** — swap Fortizo's mocked chat/tool
   responses for real calls to this API, and add the audio/video player
   view for the "Original Content" tab when a material isn't a document.

Auth is intentionally not in this plan — decide whether Fortizo needs
multi-user accounts before Claude Code builds `materials.user_id` handling,
or stub it with a single hardcoded user for now and add real auth later.

---

## 10. Open decisions before Claude Code starts

- [ ] **Mirror `hanji-dev/hanji-parse-4b` to storage we control — do this
      first, today, independent of everything else** (§6)
- [ ] Parse-model hosting choice (§6)
- [x] Speech-to-text vendor — settled: both Deepgram and OpenAI Whisper
      built behind `STT_PROVIDER`, not a single hard-coded choice (§5)
- [ ] Which one `STT_PROVIDER` actually defaults to in `.env` (§5)
- [ ] Confirm the chosen LLM provider (below) also covers video frame
      captioning, or decide on a separate one (§5)
- [ ] LLM provider for chat/tools (and whether it's the same provider as
      Hanji's Gemini dependency or separate)
- [ ] Object storage provider (S3 / Supabase Storage / R2)
- [ ] Sync-vs-batch threshold for small documents (§4 step 3)
- [ ] TTS/video vendor for the Podcast/Video tools
- [ ] Auth approach (real accounts vs. stub for now)
